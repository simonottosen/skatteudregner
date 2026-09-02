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
 *
 * ## Nominal vs. real
 *
 * **The projection is nominal throughout.** Every krone this module emits is in
 * the kroner of the year it falls in, and `toTodayKroner` in `summary.ts` is the
 * single place that deflates them for display. Nothing here is pre-deflated, and
 * the two things that look like exceptions are not:
 *
 * - `taxation.ts` deflates internally, taxes in today's kroner, and re-inflates,
 *   which is how it keeps bracket creep out of a 40-year projection. It hands
 *   back a nominal tax like everything else.
 * - The FI test compares nominal investments against nominal spending in the
 *   *same* year (`annualSpending × (1+inflation)^y × 1/SWR`), so the inflation
 *   factor cancels. `safeWithdrawalRate` therefore keeps its conventional real
 *   meaning even though both sides are nominal.
 *
 * Amounts that grow with inflation: spending, the cash buffer, pension
 * contributions. The contribution grows at its own `contributionGrowth` instead,
 * since a household's saving rate tracks its pay, not the CPI.
 *
 * Amounts that are nominally level, on purpose: the mortgage service. A
 * fixed-rate realkredit annuity is a flat number of kroner for its whole term,
 * so it shrinks in real terms year over year — which is exactly what the loan
 * does in real life. Not deflating it is the *point*, not an oversight.
 *
 * `mortgage.budgeted` is the odd one out: it is the payment the budget deducted
 * *today*, held flat for the whole horizon while the contribution it is added
 * back to grows. That is deliberate. The contribution is the budget's surplus
 * *after* the mortgage, so handing the payment back reconstructs the pre-mortgage
 * surplus; the figure being reconstructed is a today's-kroner one, and inflating
 * it would credit the household with kroner its budget never showed. The
 * consequence to be aware of: over a long horizon the handed-back payment is a
 * shrinking share of a growing contribution, so the reconciliation matters less
 * and less the further out the projection runs.
 */

import type {
  PlannedProperty,
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
  createPropertyPortfolioTax,
  grossUpStockSale,
  nedslagRespondsToStockIncome,
  pensionIncomeTax,
  pensionerNedslagInPlay,
  qualifiesForPensionerNedslag,
  stockGainTax,
  type PropertyPortfolioTax,
  type TaxableProperty,
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
  /**
   * Combined market value of every property owned right now.
   *
   * A single number rather than the per-property list, which lives beside this
   * in {@link runPath}. Everything reading it — {@link homeEquityOf} and through
   * it {@link fundShortfall} — asks only what the household could borrow
   * against, and the list would answer that with a loop. Keeping it out also
   * keeps `SimState` a flat bag of numbers, which is what makes the `{...s}`
   * snapshot in {@link settleAgainstDrawdown} an exact copy rather than a shared
   * reference the throwaway pass could mutate.
   */
  propertyValue: number
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
  /** Monthly contribution (a recurring event can change it). */
  monthly: number
  /** Liquid cash buffer (grows with inflation, spent before investments). */
  cash: number
}

/**
 * What the household owns of its property: every value less every claim on it.
 *
 * One figure across the portfolio, not one per property. Both claims are
 * portfolio-wide in effect — a lender looks at the household's whole balance
 * sheet — and splitting them per property would need an allocation rule the plan
 * has no input for.
 */
const homeEquityOf = (s: SimState) =>
  s.propertyValue - s.mortgage - s.borrowedForSpending

/**
 * One property as a path sees it: the plan's static facts plus the value and
 * ownership that the path moves. Local to {@link runPath} — every Monte Carlo
 * path grows its properties through its own housing shocks, so these cannot be
 * shared the way the schedule around them is.
 */
interface RunProperty {
  value: number
  landValue: number
  kind: TaxableProperty["kind"]
  /** This property's own appreciation (a property event can change slot 0's). */
  housingReturn: number
  /** Whether the household holds it right now — see {@link PropertySchedule}. */
  owned: boolean
}

interface PathResult {
  investments: number[]
  /** Per-year home equity (property values − scheduled loan − borrowed equity). */
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
  /**
   * Per-year tax relief on the interest of equity borrowed for spending — the
   * one fradrag {@link PensionIncome.tax} cannot carry, because the balance it
   * accrues on is path state. Reported separately because it is realised as a
   * smaller cash outflow rather than as a smaller tax bill, so the figures the
   * UI shows have to be corrected by it; see `simulatePlanning`.
   */
  extraInterestRelief: number[]
  /** First age where spending could not be funded (insolvent); null if never. */
  ruinAge: number | null
}

/**
 * Draws `shortfall` kroner out of the household's assets — cash buffer, then a
 * taxed sale, then a loan against home equity — mutating `s` and reporting what
 * each step produced. Shared by both halves of the projection: a property tax
 * that outruns the monthly saving is funded exactly the way retirement spending
 * is.
 *
 * `gain` is the part of `sold` that is a realised gain, i.e. the year's positive
 * aktieindkomst under realisationsbeskatning. Reported rather than left implicit
 * because callers cannot recompute it: the gain fraction it is measured at is
 * the one from *before* the sale, and the sale moves it.
 */
function fundShortfall(
  s: SimState,
  shortfall: number,
  taxCtx: TaxContext
): {
  tax: number
  sold: number
  gain: number
  borrowed: number
  unfunded: number
} {
  let tax = 0
  let sold = 0
  let gain = 0
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
    gain = sold * g
    tax = stockGainTax(gain, taxCtx)
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
  return { tax, sold, gain, borrowed, unfunded: Math.max(0, shortfall) }
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
 * The deductible part is reported separately as well as being part of `service`,
 * because the household's tax needs it apart from the cash it leaves with. It is
 * interest *and* bidrag, and only the afdrag is excluded: realkreditbidrag is a
 * løbende provision for a lån under ligningslovens § 8, stk. 3, litra a, and
 * § 15 J, stk. 1 — which otherwise bars an owner-occupier from deducting the
 * costs of the dwelling — names "reservefonds- og administrationsbidrag til
 * realkreditinstitutter" alongside prioritetsrenterne as one of the two things
 * that stay deductible. Personskattelovens § 4, stk. 1, nr. 2 puts the same
 * provisions in kapitalindkomst, so it belongs in the very assessment the
 * interest goes into and shares § 11's beløbsgrænse with it. That is also why it
 * shows up on the årsopgørelse next to renteudgifterne.
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
): { service: number; deductible: number; balance: number } {
  if (balance <= 0) return { service: 0, deductible: 0, balance: 0 }
  const step = amortizeYear(balance, rate, monthsLeft, interestOnly)
  const bidrag = balance * bidragssats
  return {
    service: balance - step.balance + step.interest + bidrag,
    deductible: step.interest + bidrag,
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
   * The deductible part of that service — interest plus bidrag, without the
   * afdrag. Same schedule, same loan swaps, same year the sale settles it. See
   * {@link serviceYear} for why the lender's bidrag is in here.
   */
  deductibleByYear: number[]
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
function mortgageCost(
  state: PlanningState,
  years: number,
  schedule: PropertySchedule
): MortgageCost {
  const byYear = new Array<number>(Math.max(0, years) + 1).fill(0)
  const deductibleByYear = new Array<number>(byYear.length).fill(0)
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
    // The sale settles the loan out of the proceeds (`runPath`, step 2e), so the
    // household is billed nothing from that year on. Fired once, at the sale,
    // rather than in every later year: a move afterwards takes out a new loan,
    // and blanking the balance again would bill nothing for a debt `runPath`
    // does charge interest on.
    if (y === schedule.loanRepaidYear) balance = 0
    const year = serviceYear(
      balance,
      state.mortgageRate,
      monthsLeft,
      y <= state.mortgageInterestOnlyYears,
      state.mortgageBidragssats
    )
    byYear[y] = year.service
    deductibleByYear[y] = year.deductible
    balance = year.balance
    monthsLeft = Math.max(0, monthsLeft - 12)
    swapLoanAt(state.currentAge + y)
  }
  return {
    byYear,
    deductibleByYear,
    budgeted: state.mortgageBudgetedMonthly * 12,
  }
}

/**
 * The non-mortgage debt's whole annuity, walked once.
 *
 * Pure in `state`: no life event reaches this balance and no return draw moves
 * it, so what the 400 Monte Carlo paths would each recompute is the same
 * schedule. Hoisted for the same reason {@link mortgageCost} is — and because
 * the interest has to be known before the paths run, so the household's tax can
 * deduct it (see {@link pensionNetIncomeByYear}).
 */
interface OtherDebtCost {
  /** Outstanding balance at the end of each year; element 0 is today's. */
  balanceByYear: number[]
  /** Principal repaid in each year (element 0 unused). */
  principalByYear: number[]
  /**
   * Deductible interest accrued in each year (element 0 unused). Interest and
   * nothing else — unlike {@link MortgageCost.deductibleByYear}, which also
   * carries bidrag: a bank loan charges no reservefonds- og administrationsbidrag
   * for ligningslovens § 8, stk. 3 to make deductible.
   */
  interestByYear: number[]
}

function otherDebtCost(state: PlanningState, years: number): OtherDebtCost {
  const length = Math.max(0, years) + 1
  const balanceByYear = new Array<number>(length).fill(0)
  const principalByYear = new Array<number>(length).fill(0)
  const interestByYear = new Array<number>(length).fill(0)
  let balance = state.otherDebtBalance
  let monthsLeft = Math.max(0, Math.round(state.otherDebtTermYears * 12))
  balanceByYear[0] = balance
  for (let y = 1; y < length; y++) {
    const step = amortizeYear(balance, state.otherDebtRate, monthsLeft)
    principalByYear[y] = balance - step.balance
    interestByYear[y] = step.interest
    balance = step.balance
    monthsLeft = Math.max(0, monthsLeft - 12)
    balanceByYear[y] = balance
  }
  return { balanceByYear, principalByYear, interestByYear }
}

const MC_RUNS = 400
const MC_SEED = 0x9e3779b9

/**
 * Passes used by {@link settleAgainstDrawdown} — a fixed count, never a
 * tolerance loop. See there for why three is enough and why a loop is the
 * wrong shape.
 */
const PROPERTY_TAX_REFINEMENT_PASSES = 3

/**
 * Settle a year's property tax against the drawdown that pays for it, and
 * return the charge the two agree on.
 *
 * Under realisationsbeskatning the two define each other: the charge sizes the
 * withdrawal, the withdrawal realises a gain, § 26 grades the pensionistnedslag
 * on that aktieindkomst — and the nedslag sets the charge. `shortfallGiven`
 * closes the loop by rebuilding the year's funding gap from a candidate charge,
 * which is why each half of the projection supplies its own.
 *
 * Every pass predicts the sale on a **throwaway copy** of the state.
 * `fundShortfall` mutates, so iterating over the real one would sell the pot
 * several times over; `SimState` is a flat bag of numbers, so the spread is an
 * exact snapshot. The real sale happens once, after this returns — which makes
 * double-selling structurally impossible rather than merely avoided. Funding
 * only the incremental difference with a second real call would not: it would
 * re-derive the gain fraction from an already-reduced pot, and the 1-krone
 * borrow floor and the ruin test would then fire on a partial delta.
 *
 * A fixed three passes, never a tolerance loop. Each pass shrinks the error by
 * at most 5 % × g/(1 − 42 % × g) ≤ 0,087, and the whole nedslag is at most
 * 6.000 + 2.000 kr. — a helårsbolig and a fritidsbolig — so three passes leave
 * under 5,3 kr. even for a pot that is all gain, and under an øre at a realistic
 * gain fraction. That is finer than the engine's own resolution, since
 * `calculatePropertyTax` rounds to whole real kroner. The same rounding is what
 * makes a tolerance loop the wrong shape: it turns the map into a step function
 * that can cycle between two adjacent integers forever. Repeating a value
 * exactly *is* a fixed point, so the early return below both stops that and
 * settles the year exactly — the real sale is then funded at the very charge it
 * was predicted from.
 *
 * Lives out here rather than inside {@link runPath} because a body this size
 * nested in the year loop measurably slows every path that never reaches it.
 */
function settleAgainstDrawdown(
  s: SimState,
  taxCtx: TaxContext,
  /** The § 26 base's personal-income half — the same figure `chargeGiven` uses. */
  personalIncome: number,
  /** The year's combined § 25 amounts — the width of the band that can move. */
  nedslagInPlay: number,
  initialCharge: number,
  chargeGiven: (realisedGain: number) => number,
  shortfallGiven: (propertyTax: number) => number
): number {
  let charge = initialCharge
  for (let pass = 0; pass < PROPERTY_TAX_REFINEMENT_PASSES; pass++) {
    const shortfall = shortfallGiven(charge)
    if (shortfall <= 0) return charge
    const realised = fundShortfall({ ...s }, shortfall, taxCtx).gain
    // The first prediction is also what bounds the answer: the fixed point's
    // aktieindkomst is at least this and at most a known step above it, so a
    // band test on it says whether the engine needs asking at all. The
    // prediction costs a fraction of the tax call it saves.
    if (
      pass === 0 &&
      !nedslagRespondsToStockIncome(
        taxCtx,
        personalIncome,
        realised,
        nedslagInPlay
      )
    ) {
      return charge
    }
    const settled = chargeGiven(realised)
    if (settled === charge) return charge
    charge = settled
  }
  return charge
}

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

/**
 * Apply a single life event to the running state (mutates and returns it).
 *
 * `properties` is the path's live list; a move rewrites its first entry, the one
 * the scheduled loan is secured on. Giving a move its own choice of which
 * property to replace is issue #9.
 */
function applyEvent(
  s: SimState,
  event: PlanningEvent,
  globalHousingReturn: number,
  properties: RunProperty[]
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
      // `planProperties` guarantees the slot exists whenever a move can fire.
      const home = properties[0]
      // A home the plan has not bought yet is worth nothing to sell, and the
      // move is what makes the household own one.
      const oldValue = home.owned ? home.value : 0
      // Selling settles every claim on the house, borrowed equity included, so
      // the borrowing does not follow the household into the new home. Only the
      // home is sold: any further property stays put, value and all.
      const realisedEquity = oldValue - s.mortgage - s.borrowedForSpending
      s.borrowedForSpending = 0
      s.investments += realisedEquity
      s.investmentBasis += realisedEquity // tax-free home proceeds → basis
      const newMortgage = mortgageAfterMove(ev)
      const downPayment = ev.newValue - newMortgage
      const newBasisFraction =
        s.investments > 0 ? Math.min(1, s.investmentBasis / s.investments) : 1
      s.investments -= downPayment
      s.investmentBasis = Math.max(0, s.investmentBasis - downPayment * newBasisFraction)
      s.propertyValue += ev.newValue - oldValue
      // The grundværdi moves with the home it belongs to. Scaling by the change
      // in value is the only estimate available — the event says what the new
      // home costs, not how its plot is valued — and it keeps a move from
      // carrying the old plot's grundskyld into a home twice the size.
      home.landValue = oldValue > 0 ? (home.landValue * ev.newValue) / oldValue : 0
      home.value = ev.newValue
      home.owned = true
      // A move leaves the household living in a helårsbolig whatever the slot
      // held before, which is what `MOVE_HOME` already assumes when it counts the
      // year's § 25 amounts. Saying it here too keeps the two from disagreeing
      // for a plan whose first entry is a fritidsbolig.
      home.kind = "helaarsbolig"
      home.housingReturn = ev.housingReturnOverride ?? globalHousingReturn
      s.mortgage = newMortgage
      s.mortgageMonthsLeft = MORTGAGE_TERM_MONTHS // fresh 30-year loan
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

/** Ownership is the half-open interval `[acquisitionAge, disposalAge)`. */
const ownsAt = (p: PlannedProperty, age: number) =>
  age >= p.acquisitionAge && (p.disposalAge === null || age < p.disposalAge)

/** The earliest age a move happens at, or null if the plan has no move. */
function firstMoveAge(events: PlanningEvent[]): number | null {
  let first: number | null = null
  for (const e of events) {
    if (e.type !== "property") continue
    if (first === null || e.age < first) first = e.age
  }
  return first
}

/**
 * The properties a run tracks, in the order its `RunProperty` indices follow.
 *
 * Normally the plan's own list. A {@link PropertyEvent} in a plan that lists no
 * property is the exception: the household still lives somewhere afterwards, and
 * reserving the slot here — worth nothing until the move fills it — lets every
 * later step read one list rather than special-case a home that has no entry.
 */
function planProperties(state: PlanningState): PlannedProperty[] {
  if (state.properties.length > 0) return state.properties
  const moveAge = firstMoveAge(state.events)
  if (moveAge === null) return state.properties
  return [
    {
      id: "move",
      label: "",
      kind: "helaarsbolig",
      value: 0,
      landValue: 0,
      acquisitionAge: moveAge,
      disposalAge: null,
    },
  ]
}

/** Shared stand-in for "nothing changed hands this year" — never mutated. */
const NO_TRANSFERS: readonly number[] = []

/**
 * The helårsbolig a move leaves the household living in, for the § 25 count
 * alone. Only its kind is read, so it needs no value of its own.
 */
const MOVE_HOME: TaxableProperty = {
  value: 0,
  landValue: 0,
  kind: "helaarsbolig",
}

/**
 * Everything about the portfolio that every Monte Carlo path agrees on.
 *
 * Which properties are held, bought and sold in a given year turns on ages
 * alone, and so does the § 25 nedslag their kinds can claim — none of it moves
 * with a return draw. Computing it once instead of inside `runPath` takes the
 * work off the 400 paths that would otherwise each redo it. What is *not*
 * hoistable is the values: every path grows its properties through its own
 * housing shocks, so those live in {@link RunProperty}.
 */
interface PropertySchedule {
  items: PlannedProperty[]
  /** Whether each property is already held at the plan's starting age. */
  ownedAtStart: boolean[]
  /** Indices acquired in year y (element 0 unused). */
  boughtByYear: (readonly number[])[]
  /** Indices disposed of in year y (element 0 unused). */
  soldByYear: (readonly number[])[]
  /**
   * The year's combined § 25 amounts before § 26 grades them. Zero in a year
   * with nothing to claim, which is also the cheapest possible way to skip the
   * settlement in {@link settleAgainstDrawdown}.
   */
  nedslagByYear: number[]
  /**
   * The year the loan-bearing property (index 0) is disposed of, or `Infinity`
   * if it never is.
   *
   * Read by both halves of the loan's arithmetic — {@link mortgageCost} stops
   * billing for it and {@link runPath} stops amortising it — so that the balance
   * the sale settles is the one the household last paid for. Derived from the
   * same ownership transitions as {@link soldByYear} rather than from
   * `disposalAge` directly, which is what keeps the two from disagreeing about a
   * property that is disposed of in the year it is bought.
   */
  loanRepaidYear: number
}

function propertySchedule(
  state: PlanningState,
  years: number
): PropertySchedule {
  const items = planProperties(state)
  const boughtByYear: (readonly number[])[] = new Array(years + 1).fill(
    NO_TRANSFERS
  )
  const soldByYear: (readonly number[])[] = new Array(years + 1).fill(
    NO_TRANSFERS
  )
  const nedslagByYear = new Array<number>(years + 1).fill(0)
  const ownedAtStart = items.map((p) => ownsAt(p, state.currentAge))
  const owned = [...ownedAtStart]
  // A move makes the household a homeowner from the year it fires, whatever the
  // plan's own list says, so the nedslag has to see it too.
  const moveAge = firstMoveAge(state.events)
  const claiming: TaxableProperty[] = []
  let loanRepaidYear = Infinity

  for (let y = 0; y <= years; y++) {
    const age = state.currentAge + y
    if (y > 0) {
      for (let i = 0; i < items.length; i++) {
        const now = ownsAt(items[i], age)
        if (now === owned[i]) continue
        const into = now ? boughtByYear : soldByYear
        if (into[y] === NO_TRANSFERS) into[y] = []
        ;(into[y] as number[]).push(i)
        owned[i] = now
        if (i === 0 && !now && loanRepaidYear === Infinity) loanRepaidYear = y
      }
    }
    claiming.length = 0
    let hasHome = false
    for (let i = 0; i < items.length; i++) {
      if (!owned[i]) continue
      claiming.push(items[i])
      hasHome ||= items[i].kind !== "fritidsbolig"
    }
    if (!hasHome && moveAge !== null && age >= moveAge) {
      claiming.push(MOVE_HOME)
    }
    nedslagByYear[y] = pensionerNedslagInPlay(claiming, state.tax)
  }
  return {
    items,
    ownedAtStart,
    boughtByYear,
    soldByYear,
    nedslagByYear,
    loanRepaidYear,
  }
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
  /**
   * Tax relief on `extra` kroner of deductible interest in year `y`, beyond the
   * scheduled debt {@link PensionIncome.tax} already deducts.
   *
   * For the one interest stream the schedules cannot see: equity borrowed to
   * fund spending, which differs from Monte Carlo path to Monte Carlo path.
   */
  reliefOnExtraInterest: (y: number, extra: number) => number
}

/**
 * Household retirement income per year, with personal income tax on the taxable
 * pension applied per person, the household's interest expense deducted from it,
 * and the tax-free aldersopsparing added back.
 *
 * ## Why the deduction is a retirement-only figure
 *
 * `scheduledDeductible` is supplied for every year of the plan, but only the
 * retirement years claim it. That mirrors where the projection *charges* the
 * debt. In retirement it charges the whole service — mortgage, other debt and
 * borrowed-equity interest are all explicit outflows — because `annualSpending`
 * is the budget's expense total and excludes them. While the household is still
 * working it charges only what the modelled service exceeds `mortgage.budgeted`
 * by, and it charges no other-debt service at all: the budget already paid the
 * rest out of salary. The deduction follows the charge.
 *
 * And it has to, because a working household's rentefradrag is already inside
 * the budget it came from. The plan's contribution is a *net, post-tax* surplus,
 * and a Danish household's take-home pay is withheld on a trækprocent computed
 * from a forskudsopgørelse that already carries its renteudgifter. The relief on
 * the debt the household has today is therefore in that surplus whether or not
 * the budget's mortgage line was ever filled in — the payment is an expense, the
 * fradrag is an adjustment to income, and the two arrive by different routes.
 * Granting it again here would count it twice.
 *
 * That leaves only the interest the budget's surplus cannot already contain:
 * a larger loan taken out after a move, and the slow decline of the present
 * loan's interest as it amortises (which cuts the other way — the budget's
 * baseline keeps crediting a year-one-sized fradrag forever). Both are second
 * order, both need a proxy for the interest inside `mortgage.budgeted` that the
 * plan does not carry — and, decisively, both need a marginal tax rate the model
 * cannot compute: the working household's salary is exactly what the projection
 * does not have (issue #39). Note in particular that the afdragsfrihed step-up
 * is *not* one of them: when interest-only years end, the payment jumps because
 * principal starts falling due, while the interest itself is flat across the
 * step and declining after it. There is no missing fradrag in that step.
 *
 * In retirement none of that applies. `pensionIncomeTax` builds the household's
 * tax return from scratch out of modelled pension income, nothing stands in for
 * a tax card, and the interest is simply absent from it. That is the error.
 */
function pensionNetIncomeByYear(
  state: PlanningState,
  /**
   * The year's deductible cost of the household's scheduled debt, nominal:
   * interest on every loan plus the realkreditlån's bidrag (see
   * {@link MortgageCost.deductibleByYear}).
   */
  scheduledDeductible: readonly number[]
): PensionIncome {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const married = !state.pension.single
  const inflation = state.assumptions.inflation
  // Per-person taxable + tax-free pension income for every year.
  const persons = married
    ? [state.pension.person1, state.pension.person2]
    : [state.pension.person1]
  const incomes = persons.map((p) => onePersonPensionByYear(state, p))

  const contextFor = (y: number): TaxContext => ({
    t: y,
    inflation,
    profile: state.tax,
    married,
  })
  const claimableIn = (y: number) =>
    state.currentAge + y >= state.retirementAge
      ? Math.max(0, scheduledDeductible[y] ?? 0)
      : 0

  /**
   * One partner's share of `interest`, in proportion to their taxable pension
   * income.
   *
   * Not a 50/50 split, though a couple's realkreditlån is usually reported that
   * way. Kapitalindkomst is deducted from each partner's *own* skattepligtige
   * indkomst, which the engine floors at zero, and personskattelovens § 13
   * stk. 2 — which hands a negative one to the other spouse — is not modelled.
   * A share larger than the partner's own income would therefore be thrown away
   * silently. Weighting by income is exactly the split that cannot overshoot:
   * while the household's interest stays under its income, no partner's share
   * exceeds theirs, so none of the deduction is lost.
   *
   * It also decides how wide § 11's beløbsgrænse is. The grænse is per person
   * and `lib/tax` applies a flat 50.000 kr., so two comparable pensions split
   * into two bands — 100.000 kr. between them, which is what the statute grants
   * a couple. A household whose pension sits on one partner sees a single band
   * and is understated, by at most 8 % of 50.000 kr.; § 11 stk. 3 would transfer
   * the idle partner's unused grænse, and the engine has no input for that.
   */
  const shareOf = (y: number, person: number, interest: number): number => {
    if (interest <= 0) return 0
    let total = 0
    for (const income of incomes) total += income[y].taxable
    return total > 0 ? (interest * incomes[person][y].taxable) / total : 0
  }

  const taxIn = (y: number, person: number, interest: number): number =>
    pensionIncomeTax(
      incomes[person][y].taxable,
      contextFor(y),
      // The partner's taxable income lets the mellem-/topskat thresholds shift.
      married ? incomes[1 - person][y].taxable : undefined,
      shareOf(y, person, interest)
    )

  const net = new Array<number>(years + 1).fill(0)
  const tax = new Array<number>(years + 1).fill(0)
  const taxableByYear = new Array<number>(years + 1).fill(0)
  for (let y = 0; y <= years; y++) {
    const interest = claimableIn(y)
    for (let i = 0; i < incomes.length; i++) {
      const { taxable, taxFree } = incomes[i][y]
      const t = taxIn(y, i, interest)
      tax[y] += t
      taxableByYear[y] += taxable
      net[y] += taxable - t + taxFree
    }
  }

  /**
   * The relief `extra` further kroner of deductible interest earn in year `y`:
   * the year's assessment redone with the extra on top of what the schedule
   * already claims, differenced against the assessment {@link tax} came from.
   *
   * A second full assessment rather than a marginal rate applied linearly,
   * because the relief is not linear in `extra` and the households that ask are
   * exactly the ones far out along the curve. It flattens at § 11's
   * beløbsgrænse, again when the deduction exhausts the skattepligtige indkomst
   * that kommune- and kirkeskat are levied on, and it is zero beyond the point
   * where there is no tax left to reduce — which a rate measured on a small
   * probe and multiplied out would sail straight past, handing back more than
   * the household ever paid. Differencing inherits `pensionIncomeTax`'s own
   * clamp instead, so `relief ≤ tax[y]` holds by construction; `runPath` relies
   * on that when it nets the relief off the tax it reports.
   *
   * The measured cost of being exact, on a 60-year plan that borrows equity in
   * most of its retirement years: 23 ms → 35 ms for a whole 400-path
   * simulation. `pensionIncomeTax` is ~1.4 µs, and only a retired year that has
   * actually borrowed reaches this, so the plans that never borrow pay nothing.
   */
  const reliefOnExtraInterest = (y: number, extra: number): number => {
    if (extra <= 0) return 0
    const claimed = claimableIn(y)
    let taxWithExtra = 0
    for (let i = 0; i < incomes.length; i++) {
      taxWithExtra += taxIn(y, i, claimed + extra)
    }
    return Math.max(0, tax[y] - taxWithExtra)
  }

  return {
    net,
    tax,
    taxable: taxableByYear,
    reliefOnExtraInterest,
  }
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
  /** The non-mortgage debt's schedule, shared by every path. */
  otherDebt: OtherDebtCost,
  /** The household's property tax, bound to its kommune and rules year. */
  holdingTax: PropertyPortfolioTax,
  /** Which properties are held, bought and sold in each year of the plan. */
  schedule: PropertySchedule,
  /** Per-year home-price shock (0 for the deterministic path). */
  housingShockFor: (yearIndex: number) => number = () => 0
): PathResult {
  const years = Math.max(0, Math.round(state.endAge - state.currentAge))
  const byAge = eventsByAge(state.events)
  /**
   * Realisation is the only mode where the year's aktieindkomst depends on the
   * property tax being computed, because the drawdown that funds the charge is
   * what realises the gain. Under lager the gain accrues whether or not anything
   * is sold, and an ASK gain is not aktieindkomst at all — aktiesparekontoloven
   * taxes it separately, and the basis resets each year so a drawdown realises
   * nothing anyway. Both are already right without any of this.
   */
  const nedslagFollowsDrawdown =
    state.includePropertyTax &&
    !state.propertyTaxInBudget &&
    state.investmentTaxMode === "realisation"
  // The path's own copy: it grows these through its own housing shocks, so
  // nothing here may be shared with the schedule or with another path.
  const properties: RunProperty[] = schedule.items.map((p, i) => ({
    value: p.value,
    landValue: p.landValue,
    kind: p.kind,
    housingReturn: state.assumptions.housingReturn,
    owned: schedule.ownedAtStart[i],
  }))
  let ownedValue = 0
  for (const p of properties) if (p.owned) ownedValue += p.value

  const s: SimState = {
    investments: state.startInvestments,
    investmentBasis: state.startInvestments,
    propertyValue: ownedValue,
    mortgage: state.mortgageBalance,
    borrowedForSpending: 0,
    mortgageMonthsLeft: mortgageTermMonths(state),
    monthly: state.monthlyContribution,
    cash: state.cashBuffer,
  }

  // Apply any events registered at the starting age before recording year 0.
  for (const e of byAge.get(state.currentAge) ?? []) {
    applyEvent(s, e, state.assumptions.housingReturn, properties)
  }

  const liquid0 = s.investments + s.cash
  const investments: number[] = [Math.max(0, s.investments)]
  const homeEquitySeries: number[] = [homeEquityOf(s)]
  const cashSeries: number[] = [s.cash]
  const otherDebtSeries: number[] = [otherDebt.balanceByYear[0]]
  const netWorth: number[] = [
    liquid0 + homeEquityOf(s) - otherDebt.balanceByYear[0],
  ]
  const contributions: number[] = [0]
  const housingGains: number[] = [0]
  const investmentGains: number[] = [0]
  const mortgageSeries: number[] = [s.mortgage]
  const investmentTaxSeries: number[] = [0]
  const spendingSeries: number[] = [0]
  const investmentsSoldSeries: number[] = [0]
  const borrowedSeries: number[] = [0]
  const propertyTaxSeries: number[] = [0]
  const extraInterestReliefSeries: number[] = [0]

  // Refilled with the year's owned properties and handed straight to the tax,
  // which reads it synchronously and keeps no reference. One array for the whole
  // path rather than one per year: the year loop below is the hot one.
  const taxable: TaxableProperty[] = []

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
    let extraInterestReliefThisYear = 0
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

    // 2) Property appreciation (+ a Monte Carlo shock) + mortgage paydown. The
    // shock is one housing market, so every property feels the same draw; the
    // trend is per property, since a plan may say a summer house appreciates
    // differently from the home. Grundværdi rides along at the same rate — the
    // plan has no separate land-price assumption to grow it by.
    const equityBefore = homeEquityOf(s)
    const shock = housingShockFor(y)
    let ownedValueNow = 0
    for (const p of properties) {
      if (!p.owned) continue
      const growth = 1 + p.housingReturn + shock
      p.value = Math.max(0, p.value * growth)
      p.landValue = Math.max(0, p.landValue * growth)
      ownedValueNow += p.value
    }
    s.propertyValue = ownedValueNow
    // Afdragsfrihed is counted from today, not from when the loan was taken out
    // — the user enters the years they have left of it. The year the loan-bearing
    // property is sold is skipped: `mortgageCost` bills nothing for it, so
    // amortising anyway would hand the household a year's afdrag it never paid.
    if (y !== schedule.loanRepaidYear) {
      s.mortgage = amortizeYear(
        s.mortgage,
        state.mortgageRate,
        s.mortgageMonthsLeft,
        y <= state.mortgageInterestOnlyYears
      ).balance
    }
    s.mortgageMonthsLeft = Math.max(0, s.mortgageMonthsLeft - 12)

    // 2b) Cash buffer keeps its real value (grows with price inflation).
    s.cash *= 1 + state.assumptions.inflation

    // 2c) Other (non-mortgage) debt follows its own schedule. While working the
    // payment comes out of salary (like the mortgage); in retirement it's an
    // explicit outflow — and its interest is deducted there too, in
    // `pensionNetIncomeByYear`, which is handed the same schedule.
    const debtServiceThisYear = retired
      ? otherDebt.principalByYear[y] + otherDebt.interestByYear[y]
      : 0

    // 2d) Interest on equity borrowed in earlier years, on the balance the year
    // opens with. An outflow like any other — funding it by borrowing again is
    // how the debt compounds, which is what a real loan does. Only interest:
    // nothing amortises this balance, so it cannot bill the household for a
    // repayment it never made.
    const borrowedInterestThisYear = s.borrowedForSpending * state.mortgageRate

    // 2e) Properties change hands. A disposal is settled at the value it has
    // just grown to; an acquisition is paid at the value the plan states, which
    // is the price in the year it is bought, and starts appreciating from there.
    // Both are all-equity, since the plan has one loan and it stays with the
    // home (issue #8) — and a helårsbolig sale is tax-free under EBL § 8, a
    // fritidsbolig sale under stk. 2, so no gain is realised either way.
    let housingCash = 0
    for (const i of schedule.soldByYear[y]) {
      const p = properties[i]
      if (!p.owned) continue
      p.owned = false
      s.propertyValue -= p.value
      housingCash += p.value
      if (i === 0 && s.mortgage > 0) {
        // The loan is secured on this property, so the sale settles it. Not
        // floored at zero: a household selling for less than it owes still owes
        // the difference, and hiding that would forgive a real debt.
        housingCash -= s.mortgage
        s.mortgage = 0
        s.mortgageMonthsLeft = 0
      }
      if (s.propertyValue <= 0 && s.borrowedForSpending > 0) {
        // Equity borrowing is secured on the portfolio as a whole, so it comes
        // due only when the last of it is gone.
        housingCash -= s.borrowedForSpending
        s.borrowedForSpending = 0
      }
    }
    for (const i of schedule.boughtByYear[y]) {
      const p = properties[i]
      if (p.owned) continue
      p.owned = true
      s.propertyValue += p.value
      housingCash -= p.value
    }
    // A net inflow is money the household now holds; a net outflow joins the
    // year's funding need below, so the one `fundShortfall` call covers it along
    // with everything else instead of drawing on the pot a second time.
    let housingNeed = 0
    if (housingCash > 0) {
      s.investments += housingCash
      s.investmentBasis += housingCash
    } else {
      housingNeed = -housingCash
    }

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
    const chargesPropertyTax =
      state.includePropertyTax &&
      s.propertyValue > 0 &&
      !state.propertyTaxInBudget
    const nedslagInPlay = schedule.nedslagByYear[y]
    /**
     * The year's charge as a function of the aktieindkomst a drawdown realises —
     * but only in a year where the two define each other, and null in every
     * other year. That null *is* the guard: most years of most plans owe no
     * settlement, and this is reached once per year per Monte Carlo path.
     */
    let chargeGivenDrawdown: ((realisedGain: number) => number) | null = null
    if (chargesPropertyTax) {
      taxable.length = 0
      for (const p of properties) if (p.owned) taxable.push(p)
      const chargeGiven = (realisedGain: number) =>
        holdingTax(taxable, age, taxCtx, {
          // Pension income only. A household still working carries a salary the
          // plan never sees — it models a contribution, the budget's surplus —
          // so that part of the § 26 base is missing and needs an input this
          // model does not have. Tracked as issue #39; not what this fixes.
          personalIncome: pension.taxable[y],
          positiveStockIncome: realisedGain,
        })
      // Under lager the year's whole gain is aktieindkomst, sold or not, because
      // it is taxed as it accrues. Under realisation nothing is income until
      // something is sold — which is what the settlement works out — and an ASK
      // gain is never aktieindkomst.
      propertyTaxThisYear = chargeGiven(
        state.investmentTaxMode === "lager" ? Math.max(0, gain) : 0
      )
      if (
        nedslagFollowsDrawdown &&
        nedslagInPlay > 0 &&
        qualifiesForPensionerNedslag(age, taxCtx)
      ) {
        chargeGivenDrawdown = chargeGiven
      }
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
      const beforePropertyTax =
        contribution +
        mortgage.budgeted -
        mortgage.byYear[y] -
        borrowedInterestThisYear -
        housingNeed
      // `retirementAge` and folkepensionsalderen are separate inputs, so a
      // household can be old enough for the nedslag while the plan still counts
      // it as working — and the tax that outruns its saving is funded by selling,
      // exactly as retirement spending is. The guard makes this free otherwise.
      if (chargeGivenDrawdown) {
        propertyTaxThisYear = settleAgainstDrawdown(
          s,
          taxCtx,
          pension.taxable[y],
          nedslagInPlay,
          propertyTaxThisYear,
          chargeGivenDrawdown,
          (tax) => tax - beforePropertyTax
        )
      }
      const net = beforePropertyTax - propertyTaxThisYear
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
      // The borrowed balance is a real debt and its interest a real fradrag, but
      // the balance is path state, so `pension.tax[y]` — one figure shared by
      // every path — cannot have deducted it. Relieved here instead, against the
      // interest already claimed there so the two do not both spend § 11's band.
      // Kept as well as spent: it is a real reduction in the household's tax,
      // and the reported figures still quote the shared `pension.tax[y]`, so
      // they have to be told about it (see `simulatePlanning`).
      extraInterestReliefThisYear = pension.reliefOnExtraInterest(
        y,
        borrowedInterestThisYear
      )
      const borrowedInterestNet =
        borrowedInterestThisYear - extraInterestReliefThisYear
      const beforePropertyTax =
        inflatedSpending +
        mortgage.byYear[y] +
        debtServiceThisYear +
        borrowedInterestNet +
        housingNeed
      if (chargeGivenDrawdown) {
        propertyTaxThisYear = settleAgainstDrawdown(
          s,
          taxCtx,
          pension.taxable[y],
          nedslagInPlay,
          propertyTaxThisYear,
          chargeGivenDrawdown,
          (tax) => beforePropertyTax + tax - pension.net[y]
        )
      }
      const need = beforePropertyTax + propertyTaxThisYear
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
    // and the interest it accrued. Buying and selling move equity too, but they
    // are transfers, not gains: adding the year's net housing cash flow back
    // cancels them, so "Boligværdi" reports appreciation and afdrag alone.
    const housingGain = homeEquityOf(s) - equityBefore + housingCash

    // 4) Life events at this age.
    const beforeMonthly = s.monthly
    for (const e of byAge.get(age) ?? []) {
      applyEvent(s, e, state.assumptions.housingReturn, properties)
    }
    if (s.monthly !== beforeMonthly) contribution = s.monthly * 12

    const homeEquity = homeEquityOf(s)
    investments.push(s.investments)
    homeEquitySeries.push(homeEquity)
    cashSeries.push(s.cash)
    otherDebtSeries.push(otherDebt.balanceByYear[y])
    netWorth.push(
      s.investments + s.cash + homeEquity - otherDebt.balanceByYear[y]
    )
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
    extraInterestReliefSeries.push(extraInterestReliefThisYear)
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
    extraInterestRelief: extraInterestReliefSeries,
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

  // Which properties are held in which year, and what § 25 they can claim, turns
  // on ages and kinds — not on a return draw, so every path shares one schedule.
  const schedule = propertySchedule(state, years)

  // The loan schedule doesn't care about return draws either, but it does care
  // about the year the property it is secured on is sold.
  const mortgage = mortgageCost(state, years, schedule)
  const otherDebt = otherDebtCost(state, years)

  // Retirement income per year (deterministic — shared by all paths). Computed
  // after the two loan schedules because it deducts their interest: one figure
  // per year covering every loan, so the household gets one § 11 beløbsgrænse
  // per person rather than one per debt.
  const pension = pensionNetIncomeByYear(
    state,
    mortgage.deductibleByYear.map((d, y) => d + otherDebt.interestByYear[y])
  )

  // Bound once for the whole run rather than per path: the kommune lookup and
  // the default input behind each call are fixed for the household, and the
  // paths below ask tens of thousands of times between them.
  const holdingTax = createPropertyPortfolioTax(state.tax, !state.pension.single)

  // Deterministic path (median + growth sources).
  const deterministic = runPath(
    state,
    () => meanReturn,
    pension,
    mortgage,
    otherDebt,
    holdingTax,
    schedule
  )

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
      otherDebt,
      holdingTax,
      schedule,
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
      // `pension.net`/`pension.tax` are the schedules' assessment, shared by
      // every path, so the relief on this path's borrowed-equity interest is
      // missing from both. Added back here and nowhere else: the cash flow spent
      // it on a smaller outflow, and no reported field carries that outflow —
      // `spending` is living costs alone and `borrowed` is a loan, not a cost —
      // so this is the one place it can appear without being counted twice.
      // Never negative: `reliefOnExtraInterest` cannot exceed `pension.tax[y]`.
      retirementIncome: pension.net[y] + deterministic.extraInterestRelief[y],
      taxPaid:
        pension.tax[y] -
        deterministic.extraInterestRelief[y] +
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
