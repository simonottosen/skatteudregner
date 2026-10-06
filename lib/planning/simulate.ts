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
 * `debt.budgeted` is the odd one out: it is the payment the budget deducted
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
  PlannedLoan,
  PlannedProperty,
  PlanningEvent,
  PlanningResult,
  PlanningState,
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

/**
 * What a purchase borrows: nothing for an all-equity one, otherwise the price at
 * the stated LTV.
 *
 * Clamped here as well as in `clampLtv` (`./properties`), which the form and the
 * normalizer share. Not redundant: `simulatePlanning` is called on states this
 * module did not normalize — the MCP tools build one, and so does every test —
 * and a negative LTV would hand the household money for buying a house while an
 * LTV above 1 would hand it a house and change besides.
 */
const financedPrincipal = (p: PlannedProperty) =>
  p.financing ? p.value * Math.min(1, Math.max(0, p.financing.ltv)) : 0

/**
 * Whether the debt is a claim on the household's property — i.e. whether it
 * comes off home equity rather than standing beside it as a balance of its own.
 *
 * That, and nothing more: it does not decide *which* property answers for the
 * debt, and so says nothing about which sale settles it. That is
 * {@link settledBySaleOf}'s question, and the two deliberately disagree about
 * the loan described below.
 *
 * A realkredit loan counts even when the plan names no property for it to fall
 * on. A realkreditlån is a lån mod pant i fast ejendom; there is no unsecured
 * kind, so a plan carrying one while listing no property has left its home
 * undescribed rather than described a loan without security. That plan is
 * reachable on the default path and not just in principle: `use-planning.ts`
 * infers a balance from the renteudgifter typed on /skat, while
 * `propertiesFromBudget` adds nothing to the list until a market value or a
 * beskatningsgrundlag arrives — so the household that entered only its mortgage
 * interest has a loan and no home. Reading that loan as unsecured would lift it
 * out of the home equity the projection has always subtracted it from.
 */
const reducesHomeEquity = (loan: PlannedLoan) =>
  loan.propertyId !== null || loan.type === "realkredit"

/**
 * Whether selling that property settles this loan: the pant the plan names, and
 * only it.
 *
 * Narrower than {@link reducesHomeEquity} on purpose — no fallback to the loan's
 * type. A realkredit naming no property is a claim on the household's equity
 * that no *particular* sale discharges, and answering "yes" for whichever
 * property this happens to be asked about first would settle it on the earliest
 * sale the plan makes. Where such a loan does come due is `settlingIndex` in
 * {@link debtCost}.
 */
const settledBySaleOf = (loan: PlannedLoan, propertyId: string) =>
  loan.propertyId === propertyId

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
   * Equity borrowed to fund an outflow the household could not otherwise cover.
   *
   * The household's only path-dependent debt, and the only one that could be:
   * every scheduled loan is pure in the plan's inputs, so {@link debtCost} walks
   * the whole list once for all 401 paths. This balance no schedule can predict.
   * It accrues interest — charged as an outflow of its own, so the household
   * really pays it — but is never amortised, since nothing in the cash flow pays
   * it down except an explicit surplus.
   */
  borrowedForSpending: number
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
 *
 * The scheduled debt is passed in rather than read off `s`, because it is not
 * path state: it comes from {@link DebtCost.securedBalanceByYear}, and which of
 * a year's two readings of it applies — before the year's move or after it — is
 * something only the caller knows.
 */
const homeEquityOf = (s: SimState, securedDebt: number) =>
  s.propertyValue - securedDebt - s.borrowedForSpending

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
  /**
   * This property's own appreciation — {@link PlannedProperty.housingReturn}, or
   * the plan's global rate where the entry states none.
   */
  housingReturn: number
  /** Whether the household holds it right now — see {@link PropertySchedule}. */
  owned: boolean
}

interface PathResult {
  investments: number[]
  /** Per-year home equity (property values − secured debt − borrowed equity). */
  homeEquity: number[]
  /** Per-year liquid cash buffer. */
  cash: number[]
  /** Per-year outstanding balance of the loans no property secures. */
  otherDebt: number[]
  netWorth: number[]
  /** Per-year amount contributed to investments. */
  contributions: number[]
  /** Per-year home equity gain (appreciation + afdrag). */
  housingGains: number[]
  /** Per-year investment return earned. */
  investmentGains: number[]
  /**
   * Per-year debt that the household's property answers for: the scheduled
   * secured loans plus any equity borrowed for spending.
   */
  securedDebt: number[]
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
  taxCtx: TaxContext,
  /** The scheduled secured balance, for the equity there is left to borrow. */
  securedDebt: number
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
  // balance, not on any scheduled loan: the schedule is derived from the plan's
  // inputs and would never charge for this, so adding it there would have the
  // household amortise — for free — a debt nobody is billed for.
  if (shortfall > 1) {
    borrowed = Math.min(shortfall, Math.max(0, homeEquityOf(s, securedDebt)))
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
 * The plan's own realkredit debt costs this much a month in its first year. Not
 * used by the cash flow — that reads the schedule below — but it is the figure
 * that makes `mortgageBudgetNotice` (`./summary`) actionable, and it has to be
 * the same arithmetic or the notice would quote a payment the projection never
 * charges.
 *
 * The realkredit half of the list and nothing else, because a single housing
 * line in the budget is what the notice is about — see {@link DebtCost.budgeted}.
 * Summed over however many such loans the plan holds, for the same reason: the
 * budget's one line paid for all of them.
 */
export function modelledMortgageMonthly(state: PlanningState): number {
  let service = 0
  for (const loan of state.loans) {
    if (loan.type !== "realkredit") continue
    service += serviceYear(
      loan.principal,
      loan.rate,
      loan.termMonths,
      loan.interestOnlyYears >= 1,
      loan.bidragssats
    ).service
  }
  return service / 12
}

/**
 * What the household's loans cost and what they still owe, per year, aggregated
 * over the plan's whole list.
 *
 * Every series here is walked once rather than in each path, because every input
 * to them is deterministic — the balances, the rates, the terms, the
 * afdragsfrihed, the property events, the year a sale settles a loan. The 401
 * paths would each recompute one identical set, and N walks of one loan are N
 * chances to disagree about it. The interest has to be known before the paths
 * run in any case, so the household's tax can deduct it (see
 * {@link pensionNetIncomeByYear}).
 */
interface DebtCost {
  /**
   * The realkredit loans' modelled service per year of the projection (element 0
   * unused): afdrag, renter and bidrag. Follows the property list — a disposal
   * stops the billing on the loans that property secured, and a financed
   * purchase starts it on the loan it draws.
   *
   * Charged in both halves of the projection — reconciled against
   * {@link budgeted} while the household is working, in full once it retires.
   */
  realkreditServiceByYear: number[]
  /**
   * The bank loans' service per year (element 0 unused), charged only from the
   * retirement age. See {@link runPath} step 2c for why the two types differ.
   */
  bankServiceByYear: number[]
  /**
   * The deductible part of both — every loan's interest, plus the realkredit
   * loans' bidrag, and never the afdrag. One figure across the list, because
   * that is how kapitalindkomst is assessed: see {@link serviceYear} for why the
   * lender's bidrag is in here and why a banklån contributes none.
   */
  deductibleByYear: number[]
  /**
   * What the loans the household's property secures still owe at the close of
   * each year, the year's transfers included: a disposal has already taken its
   * loans off, and a financed purchase has already put its new one on at full
   * principal. {@link runPath} reads it once at the top of the year and uses it
   * throughout, which is right because it applies the same year's transfers to
   * {@link SimState.propertyValue} at the same point — so the equity it reports
   * is this year's houses against this year's debt. Element 0 is today's; no
   * property is acquired in year 0 (see {@link PropertySchedule.boughtByYear}),
   * so there is nothing for it to include.
   *
   * The *scheduled* loans and nothing else. Feeding equity borrowed in
   * retirement back into them would compound principal as well as interest — a
   * bigger balance charges a bigger service, which borrows more, which charges
   * more again — and that is why the borrowing lives on
   * {@link SimState.borrowedForSpending}, where it accrues interest alone and
   * never asks this schedule for anything.
   */
  securedBalanceByYear: number[]
  /**
   * What each property's own secured loans owed as each year *opened*, indexed
   * `[year][property]` — the properties in {@link PropertySchedule.items}' order.
   * This is the balance a sale settles against, which is why there is one figure
   * per property where {@link securedBalanceByYear} has one for the household:
   * equity is portfolio-wide, a sale is not, and selling the summer house must
   * leave the home's mortgage alone (issue #9).
   *
   * The opening balance rather than the closing one, because the close of a
   * disposal year is zero by construction: the walk settles a property's loans
   * before it services them, so that the household is billed nothing for a year
   * it no longer owned the house. The previous year's close would not do either —
   * a purchase draws its loan at the close of its acquisition year, and a
   * property bought one year and sold the next must be settled against the whole
   * of that principal. Element 0 is today's.
   */
  securedOpeningByProperty: number[][]
  /**
   * What the loans no property secures still owe at the close of each year;
   * element 0 is today's. Reported as the plan's `otherDebt` and subtracted from
   * net worth on its own, since it sits outside the home equity
   * {@link securedBalanceByYear} comes off.
   */
  unsecuredBalanceByYear: number[]
  /**
   * The payment the household's budget already deducted, per year — a reading of
   * `state.mortgageBudgetedMonthly` and never of the loans above. The working
   * household has already paid this much to its lender by the time the
   * contribution reaches the simulation, so it may only be charged what the
   * modelled service differs from it by. See {@link PlanningState.mortgageBudgetedMonthly}.
   *
   * One figure for the household rather than one per loan, because the budget
   * has a single housing line: what it withheld is a fact about the budget, not
   * a term of any contract, so {@link PlannedLoan} carries no such field. It is
   * handed back whole against the realkredit service — the aggregate of the
   * list, so a household with two realkreditlån has the one line it budgeted
   * set against the two payments it makes.
   *
   * Fixed for the whole projection: the budget was measured once, today, and
   * never learns that a sale discharged a loan, that a purchase drew one, or
   * that one matured.
   */
  budgeted: number
}

/**
 * Where a secured loan the plan attributes to no property comes due: the index
 * of the property the household lets go of last, or −1 when it owns none in the
 * years projected.
 *
 * Two plans reach here. One carries a realkredit with no pant named — see
 * {@link reducesHomeEquity} for why that is a real plan and not a malformed one
 * — and one names a property that has since been deleted from the list
 * (`hasDanglingSecurity` in `./loans`). Both describe a debt the household's
 * property answers for without saying which property, so it stays owed as long
 * as the household owns anything to answer with, and comes due when the last of
 * it is gone. Attributing it to the final disposal is that rule said in the one
 * vocabulary the settlement already speaks, which is what keeps this walk and
 * {@link runPath}'s step 2e from reaching different conclusions about the same
 * loan.
 *
 * For a plan with one property — every plan saved before the list arrived — this
 * is index 0, so such a plan settles exactly where it always did. `Infinity`
 * compares as the largest disposal year, so a property the household never sells
 * wins, and the loan is then never settled at all.
 *
 * Only properties the household owns at some point are candidates. A list may
 * hold one it never owns inside the projection — sold off before `currentAge`,
 * or bought after `endAge` — and such an entry is undated for want of a
 * transition, not because the household keeps it (see
 * {@link PropertySchedule.disposalYearByProperty}). Letting it win would hang
 * the loan on a property that never changes hands, so the sale the household
 * actually makes would neither clear the balance nor have it deducted from the
 * proceeds.
 */
function lastDisposedIndex(schedule: PropertySchedule): number {
  const { disposalYearByProperty: disposal, everOwned } = schedule
  let last = -1
  for (let i = 0; i < disposal.length; i++) {
    if (!everOwned[i]) continue
    if (last < 0 || disposal[i] > disposal[last]) last = i
  }
  return last
}

/**
 * Pure in `state` and `loans`, so the Monte Carlo paths all share one schedule.
 *
 * A financed purchase takes out a loan that does not exist yet and so has no
 * terms of its own to read: it is priced at those of the loan it replaces — see
 * `drawLoansAt`. The rate a lender charges does climb with LTV, so a move to a
 * more leveraged home understates its fee slightly — but the household's own
 * lender is better evidence about its next loan than a generic band average
 * would be, and the purchase's dominant effect, the change in balance, is
 * modelled either way.
 */
function debtCost(
  state: PlanningState,
  loans: readonly PlannedLoan[],
  years: number,
  schedule: PropertySchedule
): DebtCost {
  const length = Math.max(0, years) + 1
  const realkreditServiceByYear = new Array<number>(length).fill(0)
  const bankServiceByYear = new Array<number>(length).fill(0)
  const deductibleByYear = new Array<number>(length).fill(0)
  const securedBalanceByYear = new Array<number>(length).fill(0)
  const securedOpeningByProperty = Array.from({ length }, () =>
    new Array<number>(schedule.items.length).fill(0)
  )
  const unsecuredBalanceByYear = new Array<number>(length).fill(0)

  /** One loan as the walk has reached it: its terms, counted down. */
  interface LiveLoan {
    balance: number
    /**
     * What it owed as the current year opened, before that year's sale settled
     * it. Only {@link drawLoansAt} reads it, and only to decide which loan a new
     * one inherits its terms from — the mortgage a move discharges has been
     * zeroed by the time the move's own loan is drawn, and it is still the loan
     * being replaced.
     */
    opening: number
    rate: number
    monthsLeft: number
    /**
     * Years of the *projection* that are afdragsfri, not years of the loan:
     * {@link PlannedLoan.interestOnlyYears} is "years from now", so the window
     * is anchored to the plan's starting age and a loan drawn inside it is
     * afdragsfri for whatever is left of it.
     */
    interestOnlyYears: number
    bidragssats: number
    realkredit: boolean
    secured: boolean
    /**
     * Index into {@link PropertySchedule.items} of the property whose sale
     * settles this loan, or −1 for a loan no sale does: unsecured debt, and
     * secured debt in a plan the household owns no property under while it
     * runs.
     */
    propertyIndex: number
  }

  /**
   * Which property's sale settles the loan, as an index into the schedule.
   *
   * The pant the plan names, falling back to {@link lastDisposedIndex} for the
   * secured loan that names none the plan has.
   */
  const unattributed = lastDisposedIndex(schedule)
  const settlingIndex = (loan: PlannedLoan): number => {
    if (!reducesHomeEquity(loan)) return -1
    const named = schedule.items.findIndex((p) => settledBySaleOf(loan, p.id))
    return named >= 0 ? named : unattributed
  }

  /**
   * A contract as the walk starts it. The three derived fields are settled here
   * and nowhere else, so that a loan the projection mints mid-walk is classified
   * by the same rules as one the household arrived with.
   */
  const liveLoanOf = (loan: PlannedLoan): LiveLoan => ({
    balance: loan.principal,
    opening: loan.principal,
    rate: loan.rate,
    monthsLeft: loan.termMonths,
    interestOnlyYears: loan.interestOnlyYears,
    bidragssats: loan.bidragssats,
    realkredit: loan.type === "realkredit",
    secured: reducesHomeEquity(loan),
    propertyIndex: settlingIndex(loan),
  })

  const live: LiveLoan[] = loans.map(liveLoanOf)

  /** Add what is still owed to whichever of the two balances it counts in. */
  const recordBalance = (y: number, loan: LiveLoan) => {
    if (loan.secured) securedBalanceByYear[y] += loan.balance
    else unsecuredBalanceByYear[y] += loan.balance
  }

  /**
   * Charge what the loan owes as the year opens to the property that answers for
   * it — the balance a sale that year is settled against. A loan no sale settles
   * is charged to nothing, which is why this is not simply `recordBalance` read
   * a year earlier.
   */
  const recordOpening = (y: number, loan: LiveLoan) => {
    if (loan.propertyIndex >= 0)
      securedOpeningByProperty[y][loan.propertyIndex] += loan.balance
  }

  /**
   * Mint the loans the year's purchases are financed with — one fresh 30-year
   * realkredit per acquired property that states an LTV, secured on the property
   * that drew it.
   *
   * Nothing is taken off here. What a sale discharges is settled by the disposal
   * rule in the walk below, against the one property the loan names, so a
   * household that buys a second house keeps paying for the first. That is the
   * whole of issue #9: the move event this replaces deleted *every* secured loan
   * whatever property it named, because one event for the household could not
   * say which house had been sold, and a disposal age on each property can.
   *
   * Drawn at the close of the acquisition year, after that year's service has
   * been charged, so the household owes the full principal going into the first
   * year it pays for the loan — the mirror of a disposal, which is billed
   * nothing in the year it happens. `runPath` buys the property at the top of
   * the same year and reads the closing balance for the whole of it, so the two
   * land on one statement of what is owned and what is owed.
   *
   * The new loan's terms are the biggest replaced one's, measured by what was
   * still owed as the year opened rather than by what was borrowed, because that
   * is the loan the household is actually paying and so the best evidence about
   * the next one it will be offered. The *opening* balance because a move's sale
   * has already zeroed the mortgage it discharges by the time this runs, and
   * that mortgage is exactly the one being replaced. A blend would not help: two
   * rates average, but two afdragsfrihed windows do not. With nothing to
   * replace — the household owed nothing, or owed it all to a bank — the plan's
   * {@link PlanningAssumptions.equityBorrowingRate} stands in, which is the rate
   * it applies to the other debt it was never given terms for, and the loan
   * carries no afdragsfrihed and no bidrag rather than a guess at either.
   */
  const drawLoansAt = (y: number) => {
    for (const i of schedule.boughtByYear[y]) {
      const property = schedule.items[i]
      const principal = financedPrincipal(property)
      if (principal <= 0) continue
      let replaced: LiveLoan | undefined
      for (const loan of live)
        if (
          loan.secured &&
          loan.realkredit &&
          (!replaced || loan.opening > replaced.opening)
        )
          replaced = loan
      const drawn = liveLoanOf({
        id: `drawn-${property.id}`,
        propertyId: property.id,
        label: "Realkreditlån",
        type: "realkredit",
        principal,
        rate: replaced?.rate ?? state.assumptions.equityBorrowingRate,
        termMonths: MORTGAGE_TERM_MONTHS,
        interestOnlyYears: replaced?.interestOnlyYears ?? 0,
        bidragssats: replaced?.bidragssats ?? 0,
      })
      live.push(drawn)
      // After `recordBalance` for the year, which has already run: the loan is
      // drawn at the year's close, so this is what the household carries out of
      // the year rather than something it paid for during it.
      recordBalance(y, drawn)
    }
  }

  // No `drawLoansAt(0)`: ownership transitions are read between one year and the
  // next, so nothing is ever acquired in year 0 — a property the plan dates at
  // or before `currentAge` is simply held from the start, and its mortgage is a
  // {@link PlannedLoan} on the list below rather than one to mint here.
  for (const loan of live) {
    recordBalance(0, loan)
    recordOpening(0, loan)
  }
  for (let y = 1; y < length; y++) {
    for (const loan of live) {
      loan.opening = loan.balance
      recordOpening(y, loan)
      // Selling the property settles the loans it secured out of the proceeds
      // (`runPath`, step 2e), so the household is billed nothing for them from
      // that year on — and nothing for a loan on a property it still owns.
      // Fired once, at the sale, rather than in every later year: a purchase the
      // same year draws a new loan, and blanking that balance too would bill
      // nothing for a debt `runPath` does charge interest on.
      if (
        loan.propertyIndex >= 0 &&
        y === schedule.disposalYearByProperty[loan.propertyIndex]
      )
        loan.balance = 0
      const year = serviceYear(
        loan.balance,
        loan.rate,
        loan.monthsLeft,
        y <= loan.interestOnlyYears,
        loan.bidragssats
      )
      if (loan.realkredit) realkreditServiceByYear[y] += year.service
      else bankServiceByYear[y] += year.service
      deductibleByYear[y] += year.deductible
      loan.balance = year.balance
      loan.monthsLeft = Math.max(0, loan.monthsLeft - 12)
      recordBalance(y, loan)
    }
    drawLoansAt(y)
  }
  return {
    realkreditServiceByYear,
    bankServiceByYear,
    deductibleByYear,
    securedBalanceByYear,
    securedOpeningByProperty,
    unsecuredBalanceByYear,
    budgeted: state.mortgageBudgetedMonthly * 12,
  }
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
  /** The scheduled secured balance, for {@link fundShortfall}'s equity test. */
  securedDebt: number,
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
    const realised = fundShortfall({ ...s }, shortfall, taxCtx, securedDebt).gain
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
 * Apply a single life event to the running state (mutates `s`).
 *
 * Only the portfolio, never the houses: buying and selling property is stated in
 * {@link PlanningState.properties} and carried out by {@link runPath}'s step 2e
 * against {@link PropertySchedule}, so there is nothing here that needs to know
 * what the household owns or owes.
 */
function applyEvent(s: SimState, event: PlanningEvent): void {
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
  }
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

/** Shared stand-in for "nothing changed hands this year" — never mutated. */
const NO_TRANSFERS: readonly number[] = []

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
  /**
   * Whether each property is held at any point in the projection — at the
   * starting age or from a later acquisition.
   *
   * False for an entry the plan lists but the household never owns while it
   * runs: one disposed of before `currentAge`, or acquired after `endAge`.
   * Those are real rows — the ages are typed freely, and a flat sold years ago
   * is left in the list — and they change nothing about the years modelled
   * here, except that nothing can be settled against a sale that never happens.
   * {@link lastDisposedIndex} is the one reader, because `Infinity` in
   * {@link disposalYearByProperty} cannot tell them from a property kept.
   */
  everOwned: boolean[]
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
   * The year each property is disposed of, indexed like {@link items}, or
   * `Infinity` for one no year of the projection sells.
   *
   * Two plans leave it at `Infinity`, and nothing here separates them: a
   * property the household keeps to the end, and one it never owns in these
   * years at all — see {@link everOwned}, which exists because that difference
   * decides where an unattributed loan comes due.
   *
   * Read by {@link debtCost}, which from a property's own disposal year bills
   * nothing for the loans it secured and carries their balance forward at zero,
   * so that what {@link runPath} takes out of the sale proceeds is the balance
   * the household last paid for. One year per property rather than one for the
   * household: the loans are settled against the property they name, so the
   * summer house's sale must not stop the billing on the home's mortgage
   * (issue #9).
   *
   * Derived from the same ownership transitions as {@link soldByYear} rather
   * than from `disposalAge` directly, which is what keeps the two from
   * disagreeing about a property that is disposed of in the year it is bought.
   */
  disposalYearByProperty: number[]
}

function propertySchedule(
  state: PlanningState,
  years: number
): PropertySchedule {
  const items = state.properties
  const boughtByYear: (readonly number[])[] = new Array(years + 1).fill(
    NO_TRANSFERS
  )
  const soldByYear: (readonly number[])[] = new Array(years + 1).fill(
    NO_TRANSFERS
  )
  const nedslagByYear = new Array<number>(years + 1).fill(0)
  const ownedAtStart = items.map((p) => ownsAt(p, state.currentAge))
  const owned = [...ownedAtStart]
  const everOwned = [...ownedAtStart]
  const claiming: TaxableProperty[] = []
  const disposalYearByProperty = new Array<number>(items.length).fill(Infinity)

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
        everOwned[i] ||= now
        if (!now && disposalYearByProperty[i] === Infinity)
          disposalYearByProperty[i] = y
      }
    }
    claiming.length = 0
    for (let i = 0; i < items.length; i++) if (owned[i]) claiming.push(items[i])
    nedslagByYear[y] = pensionerNedslagInPlay(claiming, state.tax)
  }
  return {
    items,
    ownedAtStart,
    everOwned,
    boughtByYear,
    soldByYear,
    nedslagByYear,
    disposalYearByProperty,
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
 * debt. In retirement it charges the whole service — every loan on the list and
 * the borrowed-equity interest are all explicit outflows — because
 * `annualSpending` is the budget's expense total and excludes them. While the
 * household is still working it charges only what the modelled realkredit
 * service exceeds `debt.budgeted` by, and it charges no bank-loan service at
 * all: the budget already paid the rest out of salary. The deduction follows the
 * charge.
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
 * order, both need a proxy for the interest inside `debt.budgeted` that the
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
   * interest on every loan plus the realkreditlånenes bidrag (see
   * {@link DebtCost.deductibleByYear}).
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
   * Being exact costs ~13-16 ms per simulation on a plan that borrows through
   * retirement — measured twice on different fixtures, which agreed on the
   * milliseconds added and disagreed only on what to divide them by: +52 % of a
   * heavy 400-path plan, but ~8× a lean one that borrows every retired year
   * (2.4 ms → 18 ms). Quote the absolute figure, not the ratio.
   *
   * The cost tracks paths × years that actually borrow, not the plan's headline
   * settings, so a household whose *deterministic* path never borrows still pays
   * for the Monte Carlo draws that do (22.5 ms → 32.3 ms on such a plan). Only a
   * plan where no path ever borrows is free.
   *
   * That is affordable here — `simulatePlanning` runs in a `useMemo`, and the
   * >1 s figure is the contribution solver, which sits behind an explicit
   * button. If it ever stops being affordable, the fix is to price the
   * breakpoints once per year and interpolate, not to go back to extrapolating
   * one rate: the relief is piecewise linear in `extra`, so a few probes would
   * be exact within each segment.
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
  /**
   * What the household's whole loan list costs and owes per year, modelled and
   * as the budget already saw it. Shared by every path.
   */
  debt: DebtCost,
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
    housingReturn: p.housingReturn ?? state.assumptions.housingReturn,
    owned: schedule.ownedAtStart[i],
  }))
  let ownedValue = 0
  for (const p of properties) if (p.owned) ownedValue += p.value

  const s: SimState = {
    investments: state.startInvestments,
    investmentBasis: state.startInvestments,
    propertyValue: ownedValue,
    borrowedForSpending: 0,
    monthly: state.monthlyContribution,
    cash: state.cashBuffer,
  }

  /**
   * What the plan's secured loans owe as this path has reached them: read
   * straight from `debt` at the top of every year. One aggregate rather than a
   * balance per loan, because what reads it asks only what the household owes
   * against its property as a whole — home equity is portfolio-wide, and so is
   * the borrowing capacity derived from it. A *disposal* needs the one
   * property's share instead, and reads
   * {@link DebtCost.securedOpeningByProperty} rather than this.
   *
   * It is a local rather than a field of {@link SimState} because it is not path
   * state at all — no return draw can touch it — and a field is what would
   * invite it to be walked here a second time.
   */
  let secured = debt.securedBalanceByYear[0]

  // Apply any events registered at the starting age before recording year 0.
  for (const e of byAge.get(state.currentAge) ?? []) applyEvent(s, e)

  const liquid0 = s.investments + s.cash
  const investments: number[] = [Math.max(0, s.investments)]
  const homeEquitySeries: number[] = [homeEquityOf(s, secured)]
  const cashSeries: number[] = [s.cash]
  const otherDebtSeries: number[] = [debt.unsecuredBalanceByYear[0]]
  const netWorth: number[] = [
    liquid0 + homeEquityOf(s, secured) - debt.unsecuredBalanceByYear[0],
  ]
  const contributions: number[] = [0]
  const housingGains: number[] = [0]
  const investmentGains: number[] = [0]
  const securedDebtSeries: number[] = [secured]
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
    //
    // Measured against what the household owes as the year opens — the balance
    // last year closed on, the move it may have ended in included.
    const equityBefore = homeEquityOf(s, secured)
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
    // The loans have already had their year — once, in `debtCost`, for all 401
    // paths. That walk is where afdragsfrihed is applied and where each
    // property's disposal year leaves the loans it secured settled, so reading
    // the schedule is also what keeps the household from being billed for a
    // year's afdrag it never paid.
    secured = debt.securedBalanceByYear[y]

    // 2b) Cash buffer keeps its real value (grows with price inflation).
    s.cash *= 1 + state.assumptions.inflation

    // 2c) The bank loans follow their own schedule. While working the payment
    // comes out of salary; in retirement it's an explicit outflow — and its
    // interest is deducted there too, in `pensionNetIncomeByYear`, which is
    // handed the same schedule.
    //
    // Asymmetric with the realkredit service on purpose, and the asymmetry is
    // the budget's rather than the lender's: /budget carries the housing loan on
    // a line of its own that `budgetExpenses` leaves out and
    // `mortgageBudgetedMonthly` hands back, so the working household can be
    // charged what the modelled payment differs from the budgeted one by. A
    // banklån has no such line — the budget has one housing payment and folds
    // every other repayment into its expense total — so there is nothing to hand
    // back and nothing to reconcile against. Giving each loan its own budgeted
    // amount is what would let both types be treated alike, and the budget has
    // no input for it. Keyed on the loan's type rather than on whether a
    // property secures it, because it is a claim about which budget line paid
    // for it.
    const bankServiceThisYear = retired ? debt.bankServiceByYear[y] : 0

    // 2d) Interest on equity borrowed in earlier years, on the balance the year
    // opens with. An outflow like any other — funding it by borrowing again is
    // how the debt compounds, which is what a real loan does. Only interest:
    // nothing amortises this balance, so it cannot bill the household for a
    // repayment it never made.
    const borrowedInterestThisYear =
      s.borrowedForSpending * state.assumptions.equityBorrowingRate

    // 2e) Properties change hands. A disposal is settled at the value it has
    // just grown to, less what the plan says selling it costs; an acquisition is
    // paid at the value the plan states, which is the price in the year it is
    // bought, and starts appreciating from there. A helårsbolig sale is tax-free
    // under EBL § 8 and a fritidsbolig sale under stk. 2, so no gain is realised
    // either way.
    //
    // Both in one place, and one year, is what a move now is: the old house sold
    // and the new one bought in the year the plan says so. It used to be an
    // event of its own that fired at the year's end and settled every secured
    // loan whatever house it was lent against, because one event for the
    // household could not say which house had been sold (issue #9).
    let housingCash = 0
    for (const i of schedule.soldByYear[y]) {
      const p = properties[i]
      if (!p.owned) continue
      p.owned = false
      s.propertyValue -= p.value
      // Sale costs come off the proceeds and not off the value: what the
      // household stops owning is the whole house.
      housingCash += p.value * (1 - schedule.items[i].saleCostsPct)
      // The loans this property secures are settled out of its proceeds, and no
      // others — out of the balance the year opened with, because this is the
      // property's own disposal year by construction and `debtCost` neither
      // bills nor amortises it. Not floored at zero: a household selling for
      // less than it owes still owes the difference, and hiding that would
      // forgive a real debt.
      housingCash -= debt.securedOpeningByProperty[y][i]
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
      // Only the part the portfolio pays for. The rest is borrowed: `debtCost`
      // has drawn the same loan at the close of this year, and `secured` above
      // already carries it — so a leveraged purchase costs the household its
      // down payment and leaves the debt standing against the house, which is
      // what buying a house on a mortgage does.
      housingCash -= p.value - financedPrincipal(schedule.items[i])
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
      const funded = fundShortfall(s, need, taxCtx, secured)
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
        debt.budgeted -
        debt.realkreditServiceByYear[y] -
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
          secured,
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
      // tax. The *whole* realkredit payment, not the difference from today's:
      // `annualSpending` is the budget's expense total, which excludes the
      // realkredit payment (`lib/budget/state.ts`), so unlike the contribution
      // it has nothing netted out to hand back. Same shape as the bank-loan
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
        debt.realkreditServiceByYear[y] +
        bankServiceThisYear +
        borrowedInterestNet +
        housingNeed
      if (chargeGivenDrawdown) {
        propertyTaxThisYear = settleAgainstDrawdown(
          s,
          taxCtx,
          secured,
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
        // balance: the scheduled loans are paid down by their own schedule,
        // which the household is already charged for above.
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
    const housingGain = homeEquityOf(s, secured) - equityBefore + housingCash

    // 4) Life events at this age, after the year's cash flow has been settled.
    const beforeMonthly = s.monthly
    for (const e of byAge.get(age) ?? []) applyEvent(s, e)
    if (s.monthly !== beforeMonthly) contribution = s.monthly * 12

    const homeEquity = homeEquityOf(s, secured)
    investments.push(s.investments)
    homeEquitySeries.push(homeEquity)
    cashSeries.push(s.cash)
    otherDebtSeries.push(debt.unsecuredBalanceByYear[y])
    netWorth.push(
      s.investments + s.cash + homeEquity - debt.unsecuredBalanceByYear[y]
    )
    contributions.push(contribThisYear)
    housingGains.push(housingGain)
    investmentGains.push(gain)
    // Both balances: a household that borrowed against its house to eat is not
    // debt-free just because the scheduled loans matured.
    securedDebtSeries.push(secured + s.borrowedForSpending)
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
    securedDebt: securedDebtSeries,
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
  // about the year each property its loans are secured on is sold.
  const debt = debtCost(state, state.loans, years, schedule)

  // Retirement income per year (deterministic — shared by all paths). Computed
  // after the loan schedule because it deducts its interest: one figure per year
  // covering every loan, so the household gets one § 11 beløbsgrænse per person
  // rather than one per debt.
  const pension = pensionNetIncomeByYear(state, debt.deductibleByYear)

  // Bound once for the whole run rather than per path: the kommune lookup and
  // the default input behind each call are fixed for the household, and the
  // paths below ask tens of thousands of times between them.
  const holdingTax = createPropertyPortfolioTax(state.tax, !state.pension.single)

  // Deterministic path (median + growth sources).
  const deterministic = runPath(
    state,
    () => meanReturn,
    pension,
    debt,
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
      debt,
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

  /**
   * Debt-free: the first year the debt the household's property answers for —
   * the secured loans plus any equity borrowed for spending — hits ~0.
   *
   * Only the secured half, and only when the household starts out owing some.
   * The milestone is about the house: "gældfri bolig" is the thing a household
   * counts down to, and a student loan running alongside it neither postpones
   * that year nor makes it arrive. Gated on the opening balance rather than on
   * the list holding a secured loan, so a loan of nothing — a row the user has
   * added and not yet filled in — does not report the household debt-free from
   * next year.
   */
  let debtFreeAge: number | null = null
  if (debt.securedBalanceByYear[0] > 0) {
    for (let y = 1; y < deterministic.securedDebt.length; y++) {
      if (deterministic.securedDebt[y] <= 1) {
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
