/**
 * Types and defaults for the "Planlægning" future-economy simulation.
 *
 * The simulation projects total wealth (liquid investments + home equity) one
 * year at a time, from the user's current age to an end age. All money is in
 * nominal DKK; the UI can deflate to today's kroner using the inflation rate.
 */

/** Editable financial assumptions (all rates as fractions, e.g. 0.0577 = 5.77 %). */
export interface PlanningAssumptions {
  /** Annual appreciation of the home's value. */
  housingReturn: number
  /** Gross annual return on invested funds (before fees). */
  investmentReturn: number
  /** Annual investment management fee, subtracted from the return. */
  investmentFee: number
  /** Annual return volatility (std-dev) used for the confidence band. */
  volatility: number
  /** General price inflation, used for spending growth + real-terms view. */
  inflation: number
  /** Yearly growth of the monthly contribution (e.g. salary keeping pace). */
  contributionGrowth: number
  /** Safe withdrawal rate; FI is reached at 1/SWR × annual spending. */
  safeWithdrawalRate: number
}

export const DEFAULT_ASSUMPTIONS: PlanningAssumptions = {
  housingReturn: 0.02,
  investmentReturn: 0.0577,
  investmentFee: 0.006,
  volatility: 0.12,
  inflation: 0.02,
  contributionGrowth: 0.02,
  safeWithdrawalRate: 0.04,
}

/** A one-off cost (e.g. a wedding) deducted from investments at `age`. */
export interface ExpenseEvent {
  id: string
  type: "expense"
  label: string
  age: number
  /** Lump-sum amount in DKK. */
  amount: number
}

/** A one-off inflow (inheritance, bonus, sale proceeds) added at `age`. */
export interface WindfallEvent {
  id: string
  type: "windfall"
  label: string
  age: number
  amount: number
}

/** A step change to the monthly contribution from `age` onward. */
export interface RecurringEvent {
  id: string
  type: "recurring"
  label: string
  age: number
  /** Signed change to the monthly contribution (DKK/md.); can be negative. */
  monthlyDelta: number
}

/**
 * Sell the current home and buy a new one. Realised equity (homeValue −
 * mortgage) moves into investments; the down payment (newValue × (1 − ltv)) is
 * taken back out of investments; the new mortgage is newValue × ltv.
 */
export interface PropertyEvent {
  id: string
  type: "property"
  label: string
  age: number
  /** Purchase price of the new home in DKK. */
  newValue: number
  /** Loan-to-value of the new mortgage (0–1, e.g. 0.8 = 80 %). */
  mortgageLtv: number
  /** Optional housing return for the new home; falls back to the global rate. */
  housingReturnOverride?: number
}

export type PlanningEvent =
  | ExpenseEvent
  | WindfallEvent
  | RecurringEvent
  | PropertyEvent

export type PlanningEventType = PlanningEvent["type"]

type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never

/** A planning event without its id, preserving the per-type fields. */
export type NewPlanningEvent = DistributiveOmit<PlanningEvent, "id">

/** One person's pension pots, contributions and state-pension age. */
export interface PensionPerson {
  /** Current balances (DKK). */
  ratepensionBalance: number
  livrenteBalance: number
  aldersopsparingBalance: number
  /** Annual contributions while working (until retirement age). */
  ratepensionAnnual: number
  livrenteAnnual: number
  aldersopsparingAnnual: number
  /** Folkepensionsalder (state pension age). */
  folkepensionAge: number
}

export const DEFAULT_PENSION_PERSON: PensionPerson = {
  ratepensionBalance: 0,
  livrenteBalance: 0,
  aldersopsparingBalance: 0,
  ratepensionAnnual: 0,
  livrenteAnnual: 0,
  aldersopsparingAnnual: 0,
  folkepensionAge: 69,
}

/** Pension pots, contributions and payout settings for retirement income. */
export interface PensionState {
  person1: PensionPerson
  /** Second person — used only when the household is a couple. */
  person2: PensionPerson
  /** Expected annual return on the pension pots (shared). */
  pensionReturn: number
  /** Ratepension/aldersopsparing payout duration in years (10–30). */
  ratepensionYears: number
  /** Single vs. couple — affects pensionstillæg + modregning, and person 2. */
  single: boolean
  /** Whether to include folkepension in the retirement income. */
  includeFolkepension: boolean
}

export const DEFAULT_PENSION: PensionState = {
  person1: { ...DEFAULT_PENSION_PERSON },
  person2: { ...DEFAULT_PENSION_PERSON },
  pensionReturn: 0.0577,
  ratepensionYears: 10,
  single: true,
  includeFolkepension: true,
}

/** Persisted state for the planning page. */
export interface PlanningState {
  version: 1
  /** User's current age (simulation start). */
  currentAge: number
  /** Age the simulation runs to (inclusive). */
  endAge: number
  /** Retirement age — monthly contributions stop here; drawn as a marker. */
  retirementAge: number
  /** Starting liquid investment portfolio in DKK. */
  startInvestments: number
  /** Current home value in DKK (0 if renting). */
  homeValue: number
  /** Outstanding mortgage principal in DKK. */
  mortgageBalance: number
  /** Annual interest rate used to amortize the mortgage. */
  mortgageRate: number
  /** Remaining years on the mortgage (drives the debt-free age). */
  mortgageTermYears: number
  /** Monthly amount saved/invested in DKK (defaults to budget "til rådighed"). */
  monthlyContribution: number
  /** Annual household spending in DKK, used for the FI threshold. */
  annualSpending: number
  assumptions: PlanningAssumptions
  pension: PensionState
  events: PlanningEvent[]
}

export const DEFAULT_PLANNING_STATE: PlanningState = {
  version: 1,
  currentAge: 30,
  endAge: 90,
  retirementAge: 65,
  startInvestments: 0,
  homeValue: 0,
  mortgageBalance: 0,
  mortgageRate: 0.041,
  mortgageTermYears: 30,
  monthlyContribution: 0,
  annualSpending: 0,
  assumptions: { ...DEFAULT_ASSUMPTIONS },
  pension: { ...DEFAULT_PENSION },
  events: [],
}

/** One year of the projected trajectory. */
export interface PlanningPoint {
  age: number
  /** Median liquid investments (nominal DKK). */
  investments: number
  /** Median home equity = home value − mortgage (nominal DKK). */
  homeEquity: number
  /** Median total wealth = investments + home equity (nominal DKK). */
  netWorth: number
  /** [p10, p90] of total wealth for the confidence band. */
  band: [number, number]
  /** [p10, p90] of liquid investments (home equity is deterministic). */
  investmentsBand: [number, number]

  // Growth-source breakdown (deterministic path, nominal DKK).
  /** Cumulative money paid into investments so far. */
  contributionsTotal: number
  /** Cumulative gain from home appreciation + mortgage paydown. */
  housingGainsTotal: number
  /** Cumulative investment returns earned. */
  investmentGainsTotal: number
  /** Money paid in this year. */
  contributionYoY: number
  /** Housing equity gained this year (appreciation + afdrag). */
  housingGainYoY: number
  /** Investment return earned this year. */
  investmentGainYoY: number
  /** Net annual retirement income after tax (pensions + folkepension). */
  retirementIncome: number
  /** Total tax paid this year (pension income tax + realised investment gains). */
  taxPaid: number
  /** Inflation-grown annual spending drawn this year (0 before retirement). */
  spending: number
  /** Gross amount sold from investments to cover the spending gap this year. */
  investmentsSold: number
  /** Amount borrowed against home equity to cover spending this year. */
  borrowed: number
}

export interface PlanningResult {
  points: PlanningPoint[]
  /** First age where liquid investments reach 1/SWR × annual spending. */
  fiAge: number | null
  /** Age at which the mortgage is fully repaid (null if none / never). */
  debtFreeAge: number | null
}
