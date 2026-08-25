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

/** Mutable per-year balances tracked through the simulation. */
interface SimState {
  investments: number
  /** Cost basis of the investments (for taxing realised gains). */
  investmentBasis: number
  homeValue: number
  mortgage: number
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

interface PathResult {
  investments: number[]
  /** Per-year home equity (home value − mortgage). */
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
  /** Per-year outstanding mortgage balance. */
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
  // avoids a spurious micro-loan from tax-rounding residue.
  if (shortfall > 1) {
    borrowed = Math.min(shortfall, Math.max(0, s.homeValue - s.mortgage))
    s.mortgage += borrowed
    shortfall -= borrowed
  }
  return { tax, sold, borrowed, unfunded: Math.max(0, shortfall) }
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
      const realisedEquity = s.homeValue - s.mortgage
      s.investments += realisedEquity
      s.investmentBasis += realisedEquity // tax-free home proceeds → basis
      const ltv = Math.min(1, Math.max(0, ev.mortgageLtv))
      const downPayment = ev.newValue * (1 - ltv)
      const newBasisFraction =
        s.investments > 0 ? Math.min(1, s.investmentBasis / s.investments) : 1
      s.investments -= downPayment
      s.investmentBasis = Math.max(0, s.investmentBasis - downPayment * newBasisFraction)
      s.homeValue = ev.newValue
      s.mortgage = ev.newValue * ltv
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

/**
 * Household net retirement income per year, after personal income tax on the
 * taxable pension (applied per person), plus tax-free aldersopsparing.
 */
function pensionNetIncomeByYear(state: PlanningState): {
  net: number[]
  tax: number[]
} {
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
  for (let y = 0; y <= years; y++) {
    const ctx: TaxContext = { t: y, inflation, profile: state.tax, married }
    for (let i = 0; i < incomes.length; i++) {
      const { taxable, taxFree } = incomes[i][y]
      // The partner's taxable income lets the mellem-/topskat thresholds shift.
      const spouseTaxable = married ? incomes[1 - i][y].taxable : undefined
      const t = pensionIncomeTax(taxable, ctx, spouseTaxable)
      tax[y] += t
      net[y] += taxable - t + taxFree
    }
  }
  return { net, tax }
}

/**
 * Run one full trajectory. `investmentReturnFor(yearIndex)` supplies the net
 * investment return for each step — a constant for the deterministic path, or a
 * random draw for a Monte Carlo run. Returns per-year totals (length = years+1,
 * including the starting year).
 *
 * `incomeByYear` is the gross retirement income; from the retirement age the
 * portfolio takes in (retirement income − annual spending) instead of a
 * contribution, i.e. it draws down when pensions don't cover spending.
 */
function runPath(
  state: PlanningState,
  investmentReturnFor: (yearIndex: number) => number,
  /** Net (after-tax) household pension income per year. */
  netPensionByYear: number[],
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
    mortgageMonthsLeft: Math.max(1, Math.round(state.mortgageTermYears * 12)),
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
  const homeEquitySeries: number[] = [s.homeValue - s.mortgage]
  const cashSeries: number[] = [s.cash]
  const otherDebtSeries: number[] = [s.debt]
  const netWorth: number[] = [liquid0 + (s.homeValue - s.mortgage) - s.debt]
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

  // Mortgage borrowed to fund retirement spending (repaid first from surpluses).
  let borrowedForSpending = 0
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
    const equityBefore = s.homeValue - s.mortgage
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
      borrowedForSpending += funded.borrowed
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
        taxCtx
      )
    }
    if (!retired) {
      // Paid out of salary, so it comes off what is left to invest. A tax that
      // outruns the saving is drawn from assets rather than deposited as a
      // negative amount, which would quietly drain the portfolio and report the
      // year as a withdrawal under "Indbetalinger".
      const net = contribution - propertyTaxThisYear
      contribThisYear = Math.max(0, net)
      s.investments += contribThisYear
      s.investmentBasis += contribThisYear
      if (net < 0) drawFromAssets(-net)
      contribution *= 1 + state.assumptions.contributionGrowth
    } else {
      const inflatedSpending =
        state.annualSpending * Math.pow(1 + state.assumptions.inflation, y)
      spendingThisYear = inflatedSpending
      // Living costs plus any remaining other-debt service and property tax.
      const need = inflatedSpending + debtServiceThisYear + propertyTaxThisYear
      const surplus = netPensionByYear[y] - need
      if (surplus >= 0) {
        // A surplus first repays any equity borrowed earlier for spending
        // (restoring home equity), then tops up investments.
        let extra = surplus
        if (borrowedForSpending > 0) {
          const repay = Math.min(borrowedForSpending, extra)
          s.mortgage -= repay
          borrowedForSpending -= repay
          extra -= repay
        }
        if (extra > 0) {
          s.investments += extra
          s.investmentBasis += extra
        }
      } else {
        drawFromAssets(-surplus)
      }
    }
    if (s.investments < 0) s.investments = 0

    // Equity change captures appreciation + afdrag − any retirement borrowing.
    const housingGain = s.homeValue - s.mortgage - equityBefore

    // 4) Life events at this age.
    const beforeMonthly = s.monthly
    for (const e of byAge.get(age) ?? []) {
      applyEvent(s, e, state.assumptions.housingReturn)
    }
    if (s.monthly !== beforeMonthly) contribution = s.monthly * 12

    const homeEquity = s.homeValue - s.mortgage
    investments.push(s.investments)
    homeEquitySeries.push(homeEquity)
    cashSeries.push(s.cash)
    otherDebtSeries.push(s.debt)
    netWorth.push(s.investments + s.cash + homeEquity - s.debt)
    contributions.push(contribThisYear)
    housingGains.push(housingGain)
    investmentGains.push(gain)
    mortgageSeries.push(s.mortgage)
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

  // Net (after-tax) retirement income + pension income tax per year
  // (deterministic — shared by all paths).
  const { net: netPensionByYear, tax: pensionTaxByYear } =
    pensionNetIncomeByYear(state)

  // Deterministic path (median + growth sources).
  const deterministic = runPath(state, () => meanReturn, netPensionByYear)

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
      netPensionByYear,
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
      retirementIncome: netPensionByYear[y],
      taxPaid:
        pensionTaxByYear[y] +
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
