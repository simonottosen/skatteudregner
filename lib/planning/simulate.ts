/**
 * Pure future-economy simulation engine.
 *
 * Projects total wealth (liquid investments + home equity) year by year. The
 * deterministic path uses the mean net return; a seeded Monte Carlo run draws
 * yearly investment returns from a normal distribution to produce a p10–p90
 * confidence band. Everything is deterministic given the same inputs, so the
 * chart never jitters between renders.
 *
 * Monthly contributions stop at the retirement age. The deterministic path also
 * tracks where each year's growth comes from — contributions, home appreciation
 * (+ mortgage paydown), and investment returns — for the growth-sources view.
 */

import type {
  PlanningEvent,
  PlanningResult,
  PlanningState,
  PropertyEvent,
} from "./types"
import { amortizeYear } from "./amortisation"
import {
  PRIVATE_PAYOUT_OFFSET,
  afterPalReturn,
  annuityPayment,
  folkepensionAfterModregning,
} from "./pension"
import {
  annualInvestmentTax,
  grossUpStockSale,
  pensionIncomeTax,
  propertyHoldingTax,
  stockGainTax,
  type TaxContext,
} from "./taxation"

// A fresh realkredit loan (e.g. after buying a new home) defaults to 30 years.
const MORTGAGE_TERM_MONTHS = 30 * 12

/** The described loan's term; at least one month, so the annuity is defined. */
const mortgageTermMonths = (state: PlanningState) =>
  Math.max(1, Math.round(state.mortgageTermYears * 12))

/** The loan a move leaves behind: a fresh 30-year one at the event's LTV. */
const mortgageAfterMove = (ev: PropertyEvent) =>
  ev.newValue * Math.min(1, Math.max(0, ev.mortgageLtv))

/** Mutable per-year balances tracked through the simulation. */
interface SimState {
  investments: number
  /** Cost basis of the investments (for taxing realised gains). */
  investmentBasis: number
  homeValue: number
  /**
   * The scheduled loan: the plan's own realkredit, plus whatever a property
   * event replaces it with. Kept apart from {@link borrowedForSpending} because
   * only this balance is amortised, and only this balance is what the schedule
   * in {@link MortgageCost.byYear} charges for.
   */
  mortgage: number
  /**
   * Equity borrowed to fund an outflow the household could not otherwise cover.
   * A second, separate balance: it accrues interest (charged as an outflow of
   * its own, so the household really pays it) but is never amortised, since
   * nothing in the cash flow pays it down except an explicit surplus.
   */
  borrowedForSpending: number
  /** Months left on the current mortgage (drives the amortization annuity). */
  mortgageMonthsLeft: number
  /** Housing return for the current home (a property event can change it). */
  housingReturn: number
  /** Monthly contribution (a recurring event can change it). */
  monthly: number
  /** Liquid cash buffer (grows with inflation, spent before investments). */
  cash: number
  /** Outstanding non-mortgage debt. */
  debt: number
  /** Months left on the other-debt annuity. */
  debtMonthsLeft: number
}

/** What the household owns of its home: the value less every claim on it. */
const homeEquityOf = (s: SimState) =>
  s.homeValue - s.mortgage - s.borrowedForSpending

interface PathResult {
  investments: number[]
  /** Per-year home equity (home value − scheduled loan − borrowed equity). */
  homeEquity: number[]
  /** Per-year liquid cash buffer. */
  cash: number[]
  /** Per-year outstanding non-mortgage debt. */
  otherDebt: number[]
  netWorth: number[]
  /** Per-year amount contributed to investments. */
  contributions: number[]
  /** Per-year home equity gain (appreciation + afdrag). */
  housingGains: number[]
  /** Per-year investment return earned. */
  investmentGains: number[]
  /** Per-year mortgage debt: the scheduled loan plus any borrowed equity. */
  mortgage: number[]
  /** Per-year tax on realised investment gains. */
  investmentTax: number[]
  /** Per-year inflation-grown spending drawn (0 before retirement). */
  spending: number[]
  /** Per-year gross amount sold from investments to cover the spending gap. */
  investmentsSold: number[]
  /** Per-year amount borrowed against home equity to cover spending. */
  borrowed: number[]
  /** Per-year property tax (ejendomsværdiskat + grundskyld). */
  propertyTax: number[]
  /** First age where spending could not be funded (insolvent); null if never. */
  ruinAge: number | null
}

/**
 * Draws `shortfall` kroner out of the household's assets — cash buffer, then a
 * taxed sale, then a loan against home equity — mutating `s` and reporting what
 * each step produced. Shared by both halves of the projection: a property tax
 * that outruns the monthly saving is funded exactly the way retirement spending
 * is.
 */
function fundShortfall(
  s: SimState,
  shortfall: number,
  taxCtx: TaxContext
): { tax: number; sold: number; borrowed: number; unfunded: number } {
  let tax = 0
  let sold = 0
  let borrowed = 0

  if (s.cash > 0) {
    const cashUsed = Math.min(s.cash, shortfall)
    s.cash -= cashUsed
    shortfall -= cashUsed
  }
  if (shortfall > 0 && s.investments > 0) {
    const g = Math.max(0, (s.investments - s.investmentBasis) / s.investments)
    // Sell exactly enough to net the shortfall after gains tax, so a sufficient
    // pot covers the need without spurious borrowing.
    sold = Math.min(s.investments, grossUpStockSale(shortfall, g, taxCtx))
    tax = stockGainTax(sold * g, taxCtx)
    s.investmentBasis = Math.max(0, s.investmentBasis - sold * (1 - g))
    s.investments -= sold
    shortfall -= sold - tax // net proceeds of this sale
  }
  // Borrow the rest against home equity (a loan — not taxed). The 1-krone floor
  // avoids a spurious micro-loan from tax-rounding residue. It lands on its own
  // balance, not on the scheduled loan: the schedule is derived from the plan's
  // inputs and would never charge for this, so adding it there would have the
  // household amortise — for free — a debt nobody is billed for.
  if (shortfall > 1) {
    borrowed = Math.min(shortfall, Math.max(0, homeEquityOf(s)))
    s.borrowedForSpending += borrowed
    shortfall -= borrowed
  }
  return { tax, sold, borrowed, unfunded: Math.max(0, shortfall) }
}

/**
 * One year of servicing a loan: the principal repaid, the interest accrued and
 * the bidrag charged — i.e. what actually leaves the household's account.
 *
 * Bidrag is taken on the balance the year opens with, which is how the budget
 * quotes it (`loan × bidragssats`, `lib/budget/mortgage.ts`), so a plan whose
 * loan is the budget's loan reconciles to zero in year one instead of to a
 * rounding-sized residue.
 *
 * A repaid loan leaves a sub-krone floating-point residue, which needs no floor
 * here: the residue's service is a residue too, so a paid-off loan costs ~0 a
 * year all by itself.
 */
function serviceYear(
  balance: number,
  rate: number,
  monthsLeft: number,
  interestOnly: boolean,
  bidragssats: number
): { service: number; balance: number } {
  if (balance <= 0) return { service: 0, balance: 0 }
  const step = amortizeYear(balance, rate, monthsLeft, interestOnly)
  return {
    service: balance - step.balance + step.interest + balance * bidragssats,
    balance: step.balance,
  }
}

/**
 * The plan's own loan costs this much a month in its first year. Not used by the
 * cash flow — that reads the schedule below — but it is the figure that makes
 * `mortgageBudgetNotice` (`./summary`) actionable, and it has to be the same
 * arithmetic or the notice would quote a payment the projection never charges.
 */
export function modelledMortgageMonthly(state: PlanningState): number {
  return (
    serviceYear(
      state.mortgageBalance,
      state.mortgageRate,
      mortgageTermMonths(state),
      state.mortgageInterestOnlyYears >= 1,
      state.mortgageBidragssats
    ).service / 12
  )
}

interface MortgageCost {
  /**
   * Modelled service per year of the projection (element 0 unused). Follows
   * property events, which swap the loan for a fresh 30-year one.
   *
   * Deliberately a schedule derived from the plan's inputs rather than a
   * reading of the running balance. Feeding equity borrowed in retirement back
   * into the service compounds principal as well as interest — a bigger balance
   * charges a bigger service, which borrows more, which charges more again — and
   * that is why the borrowing lives on {@link SimState.borrowedForSpending},
   * where it accrues interest alone and never asks this schedule for anything.
   */
  byYear: number[]
  /**
   * The payment the household's budget already deducted, per year — a reading of
   * `state.mortgageBudgetedMonthly` and never of the loan above. The working
   * household has already paid this much to its lender by the time the
   * contribution reaches the simulation, so it may only be charged what the
   * modelled service differs from it by. See {@link PlanningState.mortgageBudgetedMonthly}.
   *
   * Fixed for the whole projection: the budget was measured once, today, and
   * never learns that a property event swapped the loan out or that it matured.
   */
  budgeted: number
}

/**
 * Pure in `state`, so the Monte Carlo paths all share one schedule.
 *
 * One bidragssats serves every loan in the projection, the plan's own and any a
 * property event creates. The rate a lender charges does climb with LTV, so a
 * move to a more leveraged home understates its fee slightly — but the
 * household's own rate is better evidence about its own lender than a generic
 * band average would be, and the move's dominant effect on bidrag, the change in
 * balance, is modelled either way.
 */
function mortgageCost(state: PlanningState, years: number): MortgageCost {
  const byYear = new Array<number>(Math.max(0, years) + 1).fill(0)
  const byAge = eventsByAge(state.events)
  let balance = state.mortgageBalance
  let monthsLeft = mortgageTermMonths(state)

  const swapLoanAt = (age: number) => {
    for (const e of byAge.get(age) ?? []) {
      if (e.type !== "property") continue
      balance = mortgageAfterMove(e)
      monthsLeft = MORTGAGE_TERM_MONTHS
    }
  }

  // Events at the starting age fire before year 1, as they do in `runPath`.
  swapLoanAt(state.currentAge)
  for (let y = 1; y < byYear.length; y++) {
    const year = serviceYear(
      balance,
      state.mortgageRate,
      monthsLeft,
      y <= state.mortgageInterestOnlyYears,
      state.mortgageBidragssats
    )
    byYear[y] = year.service
    balance = year.balance
    monthsLeft = Math.max(0, monthsLeft - 12)
    swapLoanAt(state.currentAge + y)
  }
  return { byYear, budgeted: state.mortgageBudgetedMonthly * 12 }
}

const MC_RUNS = 400
const MC_SEED = 0x9e3779b9

/** Mulberry32 — tiny, fast, deterministic PRNG seeded by an integer. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal via Box–Muller, driven by a uniform PRNG. */
function nextNormal(rng: () => number): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Apply a single life event to the running state (mutates and returns it). */
function applyEvent(
  s: SimState,
  event: PlanningEvent,
  globalHousingReturn: number
): SimState {
  // Fraction of the investment pot that is cost basis (not gains).
  const basisFraction =
    s.investments > 0 ? Math.min(1, s.investmentBasis / s.investments) : 1
  switch (event.type) {
    case "expense":
      // Spending from the pot reduces basis proportionally (gains untaxed here).
      s.investments -= event.amount
      s.investmentBasis = Math.max(0, s.investmentBasis - event.amount * basisFraction)
      break
    case "windfall":
      // New cash is all basis.
      s.investments += event.amount
      s.investmentBasis += event.amount
      break
    case "recurring":
      s.monthly += event.monthlyDelta
      break
    case "property": {
      const ev = event as PropertyEvent
      // Selling settles every claim on the house, borrowed equity included, so
      // the borrowing does not follow the household into the new home.
      const realisedEquity = homeEquityOf(s)
      s.borrowedForSpending = 0
      s.investments += realisedEquity
      s.investmentBasis += realisedEquity // tax-free home proceeds → basis
      const newMortgage = mortgageAfterMove(ev)
      const downPayment = ev.newValue - newMortgage
      const newBasisFraction =
        s.investments > 0 ? Math.min(1, s.investmentBasis / s.investments) : 1
      s.investments -= downPayment
      s.investmentBasis = Math.max(0, s.investmentBasis - downPayment * newBasisFraction)
      s.homeValue = ev.newValue
      s.mortgage = newMortgage
      s.mortgageMonthsLeft = MORTGAGE_TERM_MONTHS // fresh 30-year loan
      s.housingReturn = ev.housingReturnOverride ?? globalHousingReturn
      break
    }
  }
  return s
}

/** Events grouped by the age at which they fire. */
function eventsByAge(events: PlanningEvent[]): Map<number, PlanningEvent[]> {
  const map = new Map<number, PlanningEvent[]>()
  for (const e of events) {
    const arr = map.get(e.age) ?? []
    arr.push(e)
    map.set(e.age, arr)
  }
  return map
}

/** A year's pension income split by tax treatment, for one person. */
interface PensionYear {
  /** Ratepension + livrente + folkepension — taxed as personal income. */
  taxable: number
  /** Aldersopsparing payout — tax-free. */
  taxFree: number
}

/**
 * Per-year pension income for one person (index 0..years). Pots are filled by
 * inflation-growing contributions until retirement, then paid out from the
 * earliest payout age (folkepensionsalder − 3, not before retirement).
 * Ratepension is an annuity; livrente is lifelong; aldersopsparing is paid as a
 * single tax-free lump sum on the folkepension date.
 */
function onePersonPensionByYear(
  state: PlanningState,
  person: PlanningState["pension"]["person1"]
): PensionYear[] {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const p = state.pension
  const out: PensionYear[] = Array.from({ length: years + 1 }, () => ({
    taxable: 0,
    taxFree: 0,
  }))
  // Pension pots grow net of PAL-skat (15,3 % on the yearly return).
  const r = afterPalReturn(p.pensionReturn)
  const privateAge = Math.max(
    state.retirementAge,
    person.folkepensionAge - PRIVATE_PAYOUT_OFFSET
  )

  let rate = person.ratepensionBalance
  let liv = person.livrenteBalance
  let alder = person.aldersopsparingBalance
  let rateYearsLeft = Math.max(1, Math.round(p.ratepensionYears))

  // Annual contributions are assumed to grow with inflation.
  const inflation = state.assumptions.inflation
  let rateContribution = person.ratepensionAnnual
  let livContribution = person.livrenteAnnual
  let alderContribution = person.aldersopsparingAnnual

  for (let y = 1; y <= years; y++) {
    const age = state.currentAge + y
    if (age < state.retirementAge) {
      rate += rateContribution
      liv += livContribution
      alder += alderContribution
      rateContribution *= 1 + inflation
      livContribution *= 1 + inflation
      alderContribution *= 1 + inflation
    }
    rate *= 1 + r
    liv *= 1 + r
    alder *= 1 + r

    let ratePay = 0
    let livPay = 0
    if (age >= privateAge) {
      if (rateYearsLeft > 0) {
        ratePay = Math.min(rate, annuityPayment(rate, r, rateYearsLeft))
        rate -= ratePay
        rateYearsLeft--
      }
      // Livrente is lifelong → spread the balance over the remaining sim years.
      const livYearsLeft = state.endAge - age + 1
      livPay = Math.min(liv, annuityPayment(liv, r, livYearsLeft))
      liv -= livPay
    }

    // Aldersopsparing: one tax-free lump sum on the folkepension date.
    let alderLump = 0
    if (age === person.folkepensionAge) {
      alderLump = alder
      alder = 0
    }

    let folke = 0
    if (p.includeFolkepension && age >= person.folkepensionAge) {
      // Aldersopsparing is exempt from modregning; ratepension + livrente count.
      folke = folkepensionAfterModregning(ratePay + livPay, p.single)
    }

    out[y] = { taxable: ratePay + livPay + folke, taxFree: alderLump }
  }
  return out
}

/** A household's yearly pension income, before and after tax. */
interface PensionIncome {
  /** After personal income tax, plus the tax-free aldersopsparing lump. */
  net: number[]
  /** The personal income tax itself. */
  tax: number[]
  /**
   * Gross taxable pension income, both partners summed — i.e. the household's
   * personlig indkomst, which ejendomsskattelovens § 26 grades the pensioner
   * nedslag against.
   */
  taxable: number[]
}

/**
 * Household retirement income per year, with personal income tax on the taxable
 * pension applied per person and the tax-free aldersopsparing added back.
 */
function pensionNetIncomeByYear(state: PlanningState): PensionIncome {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const married = !state.pension.single
  const inflation = state.assumptions.inflation
  // Per-person taxable + tax-free pension income for every year.
  const persons = married
    ? [state.pension.person1, state.pension.person2]
    : [state.pension.person1]
  const incomes = persons.map((p) => onePersonPensionByYear(state, p))

  const net = new Array<number>(years + 1).fill(0)
  const tax = new Array<number>(years + 1).fill(0)
  const taxableByYear = new Array<number>(years + 1).fill(0)
  for (let y = 0; y <= years; y++) {
    const ctx: TaxContext = { t: y, inflation, profile: state.tax, married }
    for (let i = 0; i < incomes.length; i++) {
      const { taxable, taxFree } = incomes[i][y]
      // The partner's taxable income lets the mellem-/topskat thresholds shift.
      const spouseTaxable = married ? incomes[1 - i][y].taxable : undefined
      const t = pensionIncomeTax(taxable, ctx, spouseTaxable)
      tax[y] += t
      taxableByYear[y] += taxable
      net[y] += taxable - t + taxFree
    }
  }
  return { net, tax, taxable: taxableByYear }
}

/**
 * Run one full trajectory. `investmentReturnFor(yearIndex)` supplies the net
 * investment return for each step — a constant for the deterministic path, or a
 * random draw for a Monte Carlo run. Returns per-year totals (length = years+1,
 * including the starting year).
 *
 * From the retirement age the portfolio takes in (retirement income − annual
 * spending) instead of a contribution, i.e. it draws down when pensions don't
 * cover spending.
 */
function runPath(
  state: PlanningState,
  investmentReturnFor: (yearIndex: number) => number,
  /** The household's pension income per year, net and gross. */
  pension: PensionIncome,
  /** What the mortgage costs, modelled and as the budget already saw it. */
  mortgage: MortgageCost,
  /** Per-year home-price shock (0 for the deterministic path). */
  housingShockFor: (yearIndex: number) => number = () => 0
): PathResult {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const byAge = eventsByAge(state.events)
  const s: SimState = {
    investments: state.startInvestments,
    investmentBasis: state.startInvestments,
    homeValue: state.homeValue,
    mortgage: state.mortgageBalance,
    borrowedForSpending: 0,
    mortgageMonthsLeft: mortgageTermMonths(state),
    housingReturn: state.assumptions.housingReturn,
    monthly: state.monthlyContribution,
    cash: state.cashBuffer,
    debt: state.otherDebtBalance,
    debtMonthsLeft: Math.max(0, Math.round(state.otherDebtTermYears * 12)),
  }

  // Apply any events registered at the starting age before recording year 0.
  for (const e of byAge.get(state.currentAge) ?? []) {
    applyEvent(s, e, state.assumptions.housingReturn)
  }

  const liquid0 = s.investments + s.cash
  const investments: number[] = [Math.max(0, s.investments)]
  const homeEquitySeries: number[] = [homeEquityOf(s)]
  const cashSeries: number[] = [s.cash]
  const otherDebtSeries: number[] = [s.debt]
  const netWorth: number[] = [liquid0 + homeEquityOf(s) - s.debt]
  const contributions: number[] = [0]
  const housingGains: number[] = [0]
  const investmentGains: number[] = [0]
  const mortgageSeries: number[] = [s.mortgage]
  const investmentTaxSeries: number[] = [0]
  const spendingSeries: number[] = [0]
  const investmentsSoldSeries: number[] = [0]
  const borrowedSeries: number[] = [0]
  const propertyTaxSeries: number[] = [0]

  // Land value as a fraction of home value (kept constant across the projection,
  // so property events that change the home value scale the land value too).
  const landFraction =
    state.homeValue > 0 ? Math.min(1, state.landValue / state.homeValue) : 0

  // First age the household can't fund its spending (investments + home gone).
  let ruinAge: number | null = null

  let contribution = s.monthly * 12
  for (let y = 1; y <= years; y++) {
    const age = state.currentAge + y
    const retired = age >= state.retirementAge
    let investmentTax = 0
    let spendingThisYear = 0
    let investmentsSoldThisYear = 0
    let borrowedThisYear = 0
    let propertyTaxThisYear = 0
    const taxCtx: TaxContext = {
      t: y,
      inflation: state.assumptions.inflation,
      profile: state.tax,
      married: !state.pension.single,
    }

    // 1) Investment growth. Under realisation the gain is unrealised (basis
    // unchanged); under lager/ASK the year's gain is taxed as it accrues and
    // the basis catches up to the value (so nothing is taxed again at sale).
    const invBefore = s.investments
    const gain = invBefore * investmentReturnFor(y)
    s.investments = invBefore + gain
    const annualInvTax = annualInvestmentTax(gain, state.investmentTaxMode, taxCtx)
    if (annualInvTax !== 0) {
      s.investments -= annualInvTax
      investmentTax += annualInvTax
      s.investmentBasis = s.investments
    }

    // 2) Home appreciation (+ a Monte Carlo shock) + mortgage paydown.
    const equityBefore = homeEquityOf(s)
    s.homeValue *= 1 + s.housingReturn + housingShockFor(y)
    if (s.homeValue < 0) s.homeValue = 0
    // Afdragsfrihed is counted from today, not from when the loan was taken out
    // — the user enters the years they have left of it.
    s.mortgage = amortizeYear(
      s.mortgage,
      state.mortgageRate,
      s.mortgageMonthsLeft,
      y <= state.mortgageInterestOnlyYears
    ).balance
    s.mortgageMonthsLeft = Math.max(0, s.mortgageMonthsLeft - 12)

    // 2b) Cash buffer keeps its real value (grows with price inflation).
    s.cash *= 1 + state.assumptions.inflation

    // 2c) Other (non-mortgage) debt amortizes. While working the payment comes
    // out of salary (like the mortgage); in retirement it's an explicit outflow.
    const debtBefore = s.debt
    const debtYear = amortizeYear(s.debt, state.otherDebtRate, s.debtMonthsLeft)
    s.debt = debtYear.balance
    s.debtMonthsLeft = Math.max(0, s.debtMonthsLeft - 12)
    const debtPrincipal = debtBefore - s.debt
    const debtServiceThisYear = retired ? debtPrincipal + debtYear.interest : 0

    // 2d) Interest on equity borrowed in earlier years, on the balance the year
    // opens with. An outflow like any other — funding it by borrowing again is
    // how the debt compounds, which is what a real loan does. Only interest:
    // nothing amortises this balance, so it cannot bill the household for a
    // repayment it never made.
    const borrowedInterestThisYear = s.borrowedForSpending * state.mortgageRate

    // 3) Cash flow. While working: deposit the contribution (forbrug is paid
    // from salary). In retirement: cover inflation-grown spending from net
    // pension income, then by selling investments (gains taxed), then by
    // borrowing against the home equity.
    let contribThisYear = 0
    const drawFromAssets = (need: number) => {
      const funded = fundShortfall(s, need, taxCtx)
      investmentTax += funded.tax
      investmentsSoldThisYear += funded.sold
      borrowedThisYear += funded.borrowed
      if (funded.unfunded > 1 && ruinAge === null) ruinAge = age
    }
    // Ejendomsværdiskat + grundskyld fall due in every year the house is owned,
    // working or retired — but both the contribution and `annualSpending` derive
    // from the budget, so a budget that already lists the tax would count it twice.
    if (state.includePropertyTax && s.homeValue > 0 && !state.propertyTaxInBudget) {
      propertyTaxThisYear = propertyHoldingTax(
        s.homeValue,
        s.homeValue * landFraction,
        age,
        taxCtx,
        {
          // Zero before retirement: the plan models a contribution (the budget's
          // surplus), never a salary, so there is no working-year income to give.
          // Harmless while retirement starts at or after folkepensionsalderen,
          // which is the only time the nedslag this grades is granted at all.
          personalIncome: pension.taxable[y],
          // The aktieindkomst the year has produced by this point. Under lager
          // that is the whole of it — the gain is taxed as it accrues, sold or
          // not. An ASK gain is not aktieindkomst at all (aktiesparekontoloven
          // taxes it on its own), and a realisation-mode drawdown is realised
          // below, sized by the very charge being computed here, so folding it
          // in would make the two mutually recursive.
          positiveStockIncome:
            state.investmentTaxMode === "lager" ? Math.max(0, gain) : 0,
        }
      )
    }
    if (!retired) {
      // Paid out of salary, so it comes off what is left to invest. A tax that
      // outruns the saving is drawn from assets rather than deposited as a
      // negative amount, which would quietly drain the portfolio and report the
      // year as a withdrawal under "Indbetalinger".
      //
      // The contribution is the budget's surplus *after* today's mortgage
      // payment, so handing that payment back and charging the modelled one is
      // what keeps the two in step: a step-up or a larger loan after a move eats
      // into the saving, and a repaid loan frees the whole payment to be
      // invested instead of being paid to a lender that no longer exists. A
      // budget that deducted nothing hands back nothing, so the whole modelled
      // payment falls on the saving — see `mortgageBudgetedMonthly`.
      const net =
        contribution +
        mortgage.budgeted -
        mortgage.byYear[y] -
        propertyTaxThisYear -
        borrowedInterestThisYear
      contribThisYear = Math.max(0, net)
      s.investments += contribThisYear
      s.investmentBasis += contribThisYear
      if (net < 0) drawFromAssets(-net)
      contribution *= 1 + state.assumptions.contributionGrowth
    } else {
      const inflatedSpending =
        state.annualSpending * Math.pow(1 + state.assumptions.inflation, y)
      spendingThisYear = inflatedSpending
      // Living costs plus whatever is still owed to a lender, plus property
      // tax. The *whole* mortgage payment, not the difference from today's:
      // `annualSpending` is the budget's expense total, which excludes the
      // realkredit payment (`lib/budget/state.ts`), so unlike the contribution
      // it has nothing netted out to hand back. Same shape as the other-debt
      // line above — absorbed by salary while working, an explicit outflow
      // after.
      const need =
        inflatedSpending +
        mortgage.byYear[y] +
        debtServiceThisYear +
        propertyTaxThisYear +
        borrowedInterestThisYear
      const surplus = pension.net[y] - need
      if (surplus >= 0) {
        // A surplus first repays any equity borrowed earlier for spending
        // (restoring home equity), then tops up investments. Only the borrowed
        // balance: the scheduled loan is paid down by its own schedule, which
        // the household is already charged for above.
        const repay = Math.min(s.borrowedForSpending, surplus)
        s.borrowedForSpending -= repay
        const extra = surplus - repay
        if (extra > 0) {
          s.investments += extra
          s.investmentBasis += extra
        }
      } else {
        drawFromAssets(-surplus)
      }
    }
    if (s.investments < 0) s.investments = 0

    // Equity change captures appreciation + afdrag − any retirement borrowing
    // and the interest it accrued.
    const housingGain = homeEquityOf(s) - equityBefore

    // 4) Life events at this age.
    const beforeMonthly = s.monthly
    for (const e of byAge.get(age) ?? []) {
      applyEvent(s, e, state.assumptions.housingReturn)
    }
    if (s.monthly !== beforeMonthly) contribution = s.monthly * 12

    const homeEquity = homeEquityOf(s)
    investments.push(s.investments)
    homeEquitySeries.push(homeEquity)
    cashSeries.push(s.cash)
    otherDebtSeries.push(s.debt)
    netWorth.push(s.investments + s.cash + homeEquity - s.debt)
    contributions.push(contribThisYear)
    housingGains.push(housingGain)
    investmentGains.push(gain)
    // Both balances: a household that borrowed against its house to eat is not
    // debt-free just because the scheduled loan matured.
    mortgageSeries.push(s.mortgage + s.borrowedForSpending)
    investmentTaxSeries.push(investmentTax)
    spendingSeries.push(spendingThisYear)
    investmentsSoldSeries.push(investmentsSoldThisYear)
    borrowedSeries.push(borrowedThisYear)
    propertyTaxSeries.push(propertyTaxThisYear)
  }

  return {
    investments,
    homeEquity: homeEquitySeries,
    cash: cashSeries,
    otherDebt: otherDebtSeries,
    netWorth,
    contributions,
    housingGains,
    investmentGains,
    mortgage: mortgageSeries,
    investmentTax: investmentTaxSeries,
    spending: spendingSeries,
    investmentsSold: investmentsSoldSeries,
    borrowed: borrowedSeries,
    propertyTax: propertyTaxSeries,
    ruinAge,
  }
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.round((p / 100) * (sortedAsc.length - 1)))
  )
  return sortedAsc[idx]
}

/**
 * Simulate the household's wealth trajectory. Produces the deterministic median
 * path, a p10–p90 confidence band from a seeded Monte Carlo, the per-year
 * growth-source breakdown, and the FI age (first year liquid investments cover
 * 1/SWR × inflation-grown annual spending).
 */
export function simulatePlanning(state: PlanningState): PlanningResult {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const {
    investmentReturn,
    investmentFee,
    volatility,
    housingVolatility,
    inflation,
    safeWithdrawalRate,
  } = state.assumptions
  const meanReturn = investmentReturn - investmentFee

  // Retirement income per year (deterministic — shared by all paths).
  const pension = pensionNetIncomeByYear(state)

  // Also deterministic: the loan schedule doesn't care about return draws.
  const mortgage = mortgageCost(state, years)

  // Deterministic path (median + growth sources).
  const deterministic = runPath(state, () => meanReturn, pension, mortgage)

  // Monte Carlo paths for the bands (only investment return is randomised).
  const mcNetWorthByYear: number[][] = Array.from({ length: years + 1 }, () => [])
  const mcInvestmentsByYear: number[][] = Array.from(
    { length: years + 1 },
    () => []
  )
  const rng = mulberry32(MC_SEED)
  let mcFailures = 0
  for (let run = 0; run < MC_RUNS; run++) {
    const path = runPath(
      state,
      () => meanReturn + volatility * nextNormal(rng),
      pension,
      mortgage,
      () => housingVolatility * nextNormal(rng)
    )
    if (path.ruinAge !== null) mcFailures++
    for (let y = 0; y <= years; y++) {
      mcNetWorthByYear[y].push(path.netWorth[y])
      mcInvestmentsByYear[y].push(path.investments[y])
    }
  }
  // Share of Monte Carlo runs where spending was funded for the whole horizon.
  const successProbability = MC_RUNS > 0 ? 1 - mcFailures / MC_RUNS : 1

  const fiMultiple = safeWithdrawalRate > 0 ? 1 / safeWithdrawalRate : 25
  let fiAge: number | null = null

  // Debt-free: first year the mortgage hits ~0 (only if there was a loan).
  let debtFreeAge: number | null = null
  if (state.mortgageBalance > 0) {
    for (let y = 1; y < deterministic.mortgage.length; y++) {
      if (deterministic.mortgage[y] <= 1) {
        debtFreeAge = state.currentAge + y
        break
      }
    }
  }

  let cumContrib = 0
  let cumHousing = 0
  let cumInvest = 0

  const points = deterministic.netWorth.map((netWorth, y) => {
    const age = state.currentAge + y
    const investments = deterministic.investments[y]
    const homeEquity = deterministic.homeEquity[y]

    cumContrib += deterministic.contributions[y]
    cumHousing += deterministic.housingGains[y]
    cumInvest += deterministic.investmentGains[y]

    const sorted = [...mcNetWorthByYear[y]].sort((a, b) => a - b)
    const sortedInv = [...mcInvestmentsByYear[y]].sort((a, b) => a - b)

    if (fiAge === null) {
      // Use the Monte Carlo median (not the optimistic mean path) so FI reflects
      // a coin-flip outcome rather than a lucky one.
      const medianInvestments = percentile(sortedInv, 50)
      const spendingNeed =
        state.annualSpending * Math.pow(1 + inflation, y) * fiMultiple
      if (spendingNeed > 0 && medianInvestments >= spendingNeed) fiAge = age
    }
    return {
      age,
      investments,
      homeEquity,
      cash: deterministic.cash[y],
      otherDebt: deterministic.otherDebt[y],
      netWorth,
      band: [percentile(sorted, 10), percentile(sorted, 90)] as [number, number],
      investmentsBand: [
        percentile(sortedInv, 10),
        percentile(sortedInv, 90),
      ] as [number, number],
      contributionsTotal: cumContrib,
      housingGainsTotal: cumHousing,
      investmentGainsTotal: cumInvest,
      contributionYoY: deterministic.contributions[y],
      housingGainYoY: deterministic.housingGains[y],
      investmentGainYoY: deterministic.investmentGains[y],
      retirementIncome: pension.net[y],
      taxPaid:
        pension.tax[y] +
        deterministic.investmentTax[y] +
        deterministic.propertyTax[y],
      spending: deterministic.spending[y],
      investmentsSold: deterministic.investmentsSold[y],
      borrowed: deterministic.borrowed[y],
      propertyTax: deterministic.propertyTax[y],
    }
  })

  return {
    points,
    fiAge,
    debtFreeAge,
    ruinAge: deterministic.ruinAge,
    successProbability,
  }
}

/**
 * Smallest monthly contribution that makes the household financially independent
 * (median investments ≥ 1/SWR × spending) by the retirement age. Returns 0 if
 * already on track with no extra saving, or null if it can't be reached even
 * with a very large contribution. A simple monotonic binary search — more saving
 * never pushes FI later.
 */
export function solveRequiredMonthlyContribution(
  state: PlanningState
): number | null {
  const fiByRetirement = (monthly: number): boolean => {
    const { fiAge } = simulatePlanning({ ...state, monthlyContribution: monthly })
    return fiAge !== null && fiAge <= state.retirementAge
  }
  if (fiByRetirement(0)) return 0
  // Grow an upper bound until it suffices (or give up).
  let hi = Math.max(10_000, state.monthlyContribution || 0)
  for (let i = 0; i < 20 && !fiByRetirement(hi); i++) hi *= 2
  if (!fiByRetirement(hi)) return null
  // Binary search for the smallest sufficient contribution.
  let lo = 0
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2
    if (fiByRetirement(mid)) hi = mid
    else lo = mid
  }
  return Math.ceil(hi / 100) * 100
}
