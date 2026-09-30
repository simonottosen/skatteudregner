/**
 * Types and defaults for the "Planlægning" future-economy simulation.
 *
 * The simulation projects total wealth (liquid investments + home equity) one
 * year at a time, from the user's current age to an end age. All money is in
 * nominal DKK; the UI can deflate to today's kroner using the inflation rate.
 */

import type { TaxYear } from "@/lib/tax/types"

/**
 * How the liquid investment portfolio is taxed:
 * - `realisation`: aktier on the realisationsprincip — gains taxed only when
 *   sold (27 %/42 %). Cost basis tracked.
 * - `lager`: ETFs/investeringsforeninger on the lagerprincip — the year's gain
 *   is taxed annually as aktieindkomst (27 %/42 %), losses give a credit.
 * - `ask`: aktiesparekonto — the year's gain taxed annually at a flat 17 %.
 */
export type InvestmentTaxMode = "realisation" | "lager" | "ask"

/**
 * Profile used to tax pension payouts and realised investment gains with the
 * real Danish tax engine (`@/lib/tax`). The rules year is held constant across
 * the projection; brackets are applied to real (today's-kroner) income so they
 * stay meaningful decades out (no bracket creep). Seeded from the /skat page.
 */
export interface PlanningTaxProfile {
  /** Tax-rules year held constant across the projection. */
  year: TaxYear
  /** Municipality of residence (drives kommuneskat + kirkeskat). */
  municipality: string
  /** Whether the household pays kirkeskat. */
  churchMember: boolean
}

export const DEFAULT_TAX_PROFILE: PlanningTaxProfile = {
  year: 2026,
  municipality: "København",
  churchMember: false,
}

/** Editable financial assumptions (all rates as fractions, e.g. 0.0577 = 5.77 %). */
export interface PlanningAssumptions {
  /** Annual appreciation of the home's value. */
  housingReturn: number
  /** Gross annual return on invested funds (before fees). */
  investmentReturn: number
  /** Annual investment management fee, subtracted from the return. */
  investmentFee: number
  /** Annual investment return volatility (std-dev) used for the confidence band. */
  volatility: number
  /** Annual home-price volatility (std-dev) — adds housing risk to the band. */
  housingVolatility: number
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
  housingVolatility: 0.08,
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
 * Sell the home and buy a new one. Realised equity (its value − mortgage) moves
 * into investments; the down payment (newValue × (1 − ltv)) is taken back out of
 * investments; the new mortgage is newValue × ltv.
 *
 * "The home" is the first entry of {@link PlanningState.properties} — the one the
 * scheduled loan is secured on. Any other property the household owns is left
 * alone, and which of them a move sells is issue #9's question, not this one's.
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

/**
 * What a dwelling counts as under ejendomsskatteloven. These are the two kinds
 * § 25 names — the pensionistnedslag is up to 6.000 kr. for a helårsbolig and
 * 2.000 kr. for a fritidsbolig — and the two the tax engine's input models.
 */
export type PropertyKind = "helaarsbolig" | "fritidsbolig"

/**
 * One property the household owns, or comes to own, during the projection.
 *
 * Ownership is the half-open age interval `[acquisitionAge, disposalAge)`: owned
 * from the year the household reaches `acquisitionAge`, and no longer owned in
 * the year it reaches `disposalAge`.
 */
export interface PlannedProperty {
  id: string
  /** Name shown in the UI ("Hus i Odense", "Sommerhus"). */
  label: string
  kind: PropertyKind
  /** Market value in DKK, nominal in the year it is acquired. */
  value: number
  /**
   * Grundværdi in DKK, which grundskyld is charged on. Absolute rather than a
   * share of {@link value}: an apartment and a summer house have nothing like
   * the same land-to-building ratio, so one ratio across a portfolio would be
   * meaningless. It tracks the property's own value through the projection.
   */
  landValue: number
  /**
   * Age the household acquires it. At or below `currentAge` it is already owned
   * and costs nothing; later, it is bought that year and paid for out of the
   * portfolio — all-equity, since the plan has only one loan (issue #8).
   */
  acquisitionAge: number
  /** Age it is sold at; null means held for the whole projection. */
  disposalAge: number | null
}

/**
 * Realkredit or bank — the two the household itself distinguishes.
 *
 * They differ in rate, in typical term, in whether the debt can be refinanced,
 * and in whether a bidrag is charged at all. A single "loan" type would ask the
 * user for a rate and a term with nothing to anchor either against, which is the
 * form getting harder to fill in correctly rather than easier (issue #8).
 */
export type LoanType = "realkredit" | "bank"

/**
 * One debt the household carries through the projection.
 *
 * No acquisition/disposal ages of the kind {@link PlannedProperty} carries: every
 * loan is drawn today and repaid over {@link PlannedLoan.termMonths}. Financing a
 * property bought at 60 needs the simulation to hold a loan that does not exist
 * yet, and a start age it ignored would let a plan describe borrowing that is
 * silently dropped — worse than the all-equity purchase the projection admits to
 * today. That belongs with the purchase itself.
 */
export interface PlannedLoan {
  id: string
  /**
   * The {@link PlannedProperty} the loan is secured on; null for unsecured debt
   * (car, student, consumer). Interest is deductible either way — the link says
   * which property's equity the debt sits behind, not how it is taxed.
   */
  propertyId: string | null
  /** Name shown in the UI ("Realkreditlån", "Billån"). */
  label: string
  type: LoanType
  /** Outstanding balance in DKK. */
  principal: number
  /** Annual nominal interest rate as a fraction (0.041 = 4,1 %). */
  rate: number
  /**
   * Remaining term in months — what the annuity step counts down (`amortizeYear`),
   * and the only unit that can say a loan is four years and three months from
   * maturity.
   */
  termMonths: number
  /**
   * Afdragsfrihed: years from now with interest only and no principal repayment.
   * The loan keeps its maturity, so the principal skipped here is repaid over a
   * correspondingly shorter remainder — the payment cliff when the period ends is
   * the reason to model it at all.
   */
  interestOnlyYears: number
  /**
   * Annual bidragssats — the realkredit fee charged on the outstanding balance on
   * top of interest and afdrag. Zero for a banklån, which carries no such fee.
   *
   * Not among the fields issue #8 lists, but the model this list replaces charges
   * it ({@link PlanningState.mortgageBidragssats}, fed from the budget's own
   * figure), and the same issue asks for the old fields to be absorbed rather
   * than left running in parallel. A loan that could not carry the fee would
   * force one or the other.
   */
  bidragssats: number
}

export type PlanningEventType = PlanningEvent["type"]

type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never

/** A planning event without its id, preserving the per-type fields. */
export type NewPlanningEvent = DistributiveOmit<PlanningEvent, "id">

/**
 * A set of changes a scenario layers on top of the base plan. All parts are
 * optional: scalar overrides replace base fields, assumption overrides are
 * merged into the assumptions, and `addEvents` are appended to the base events.
 */
export interface ScenarioChanges {
  overrides?: Partial<
    Pick<
      PlanningState,
      | "monthlyContribution"
      | "annualSpending"
      | "retirementAge"
      | "startInvestments"
      | "cashBuffer"
      | "investmentTaxMode"
      | "properties"
      | "includePropertyTax"
      | "propertyTaxInBudget"
      | "mortgageBalance"
      | "mortgageRate"
      | "mortgageTermYears"
      | "otherDebtBalance"
      | "otherDebtRate"
      | "otherDebtTermYears"
    >
  >
  assumptionOverrides?: Partial<PlanningAssumptions>
  /** Shared pension fields (return, payout years, household, folkepension flag). */
  pensionOverrides?: Partial<
    Pick<
      PensionState,
      "pensionReturn" | "ratepensionYears" | "single" | "includeFolkepension"
    >
  >
  /** Tax profile (kommune, kirkeskat, rules year). */
  taxOverrides?: Partial<PlanningTaxProfile>
  addEvents?: NewPlanningEvent[]
}

/** A named, saved what-if layered on top of the base plan. */
export interface PlanningScenario {
  id: string
  name: string
  /** ISO timestamp of when it was created. */
  createdAt: string
  changes: ScenarioChanges
}

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
  /**
   * 2 replaced the single `homeValue`/`landValue` pair with {@link properties}.
   * `normalizePlanning` migrates a version-1 blob into a one-element list.
   */
  version: 2
  /** User's current age (simulation start). */
  currentAge: number
  /** Age the simulation runs to (inclusive). */
  endAge: number
  /** Retirement age — monthly contributions stop here; drawn as a marker. */
  retirementAge: number
  /** Starting liquid investment portfolio in DKK. */
  startInvestments: number
  /** How the investment portfolio is taxed (realisation / lager / ASK). */
  investmentTaxMode: InvestmentTaxMode
  /**
   * Liquid cash buffer (emergency fund) in DKK. Earns no real return (grows with
   * price inflation) and is spent before investments are sold in retirement.
   */
  cashBuffer: number
  /** Outstanding non-mortgage debt in DKK (student/car/consumer, aggregated). */
  otherDebtBalance: number
  /** Annual interest rate on the other debt. */
  otherDebtRate: number
  /** Remaining term in years over which the other debt is paid off. */
  otherDebtTermYears: number
  /**
   * Every property the household owns or plans to own; empty if renting.
   *
   * The first entry is "the home": the one {@link mortgageBalance} is secured on
   * and the one a {@link PropertyEvent} move replaces. Giving each further loan
   * its own property is issue #8.
   */
  properties: PlannedProperty[]
  /** Whether to model ongoing property tax (ejendomsværdiskat + grundskyld). */
  includePropertyTax: boolean
  /**
   * Whether the budget's expense lines already include ejendomsskat. This
   * describes the *budget*, and both halves of the projection are derived from
   * it — the working-years contribution from the surplus, `annualSpending` from
   * the expense total (`hooks/use-planning.ts`) — so the flag gates the property
   * tax before and after retirement alike. Charging it in either period on top
   * of a budget that already lists it counts it twice.
   */
  propertyTaxInBudget: boolean
  /** Outstanding mortgage principal in DKK. */
  mortgageBalance: number
  /** Annual interest rate used to amortize the mortgage. */
  mortgageRate: number
  /**
   * Annual bidragssats — the realkredit fee, charged on the outstanding balance
   * on top of interest and afdrag.
   *
   * Modelled so the payment the simulation charges is the *same quantity* as
   * {@link mortgageBudgetedMonthly}, which the budget reports inclusive of
   * bidrag. Leaving it out would hand back a fee that was never charged, every
   * year, and lose it again at maturity.
   *
   * Zero by default because /planlaegning never asks for a bidragssats: the real
   * one arrives with the budget's own figure, which is the only place the fee
   * and the deduction it is reconciled against are guaranteed to describe one
   * loan. A hand-entered loan therefore models interest + afdrag only — an
   * omission the projection states rather than a fee it invents.
   */
  mortgageBidragssats: number
  /** Remaining years on the mortgage (drives the debt-free age). */
  mortgageTermYears: number
  /**
   * Afdragsfrihed: years from now with interest only and no principal repayment.
   * The loan keeps its maturity, so the principal skipped here is repaid over a
   * correspondingly shorter remainder — the payment cliff when the period ends
   * is the reason to model it at all.
   */
  mortgageInterestOnlyYears: number
  /**
   * The monthly realkredit payment the household's budget already subtracted
   * before reporting the surplus that becomes `monthlyContribution`
   * (`remaining = income − expenses − mortgage`, `lib/budget/state.ts`). Bidrag
   * included, because the budget's figure includes it.
   *
   * Carried in from the budget rather than reconstructed from the loan above.
   * The budget's mortgage module is off by default and then deducts nothing,
   * while `mortgageBalance` can still be inferred from the interest entered on
   * /skat — so the two describe different loans at least as often as the same
   * one, and reconstructing this would credit payments no one ever made.
   *
   * An explicit 0 means "the budget deducted nothing", and the whole modelled
   * payment is charged. That is what the stated inputs imply, but it is also a
   * plan describing itself two ways at once, so `mortgageBudgetNotice`
   * (`./summary`) says so instead of letting the arithmetic pass unremarked.
   *
   * Deliberately absent from `ScenarioChanges["overrides"]`: it measures the
   * budget, not the plan. A what-if about a larger loan should still be priced
   * against the payment the household actually makes today.
   */
  mortgageBudgetedMonthly: number
  /** Monthly amount saved/invested in DKK (defaults to budget "til rådighed"). */
  monthlyContribution: number
  /** Annual household spending in DKK, used for the FI threshold. */
  annualSpending: number
  assumptions: PlanningAssumptions
  pension: PensionState
  /** Tax profile (kommune, kirkeskat, rules year) for the real tax engine. */
  tax: PlanningTaxProfile
  events: PlanningEvent[]
  /** Named what-if scenarios layered on top of the base plan for comparison. */
  scenarios: PlanningScenario[]
}

export const DEFAULT_PLANNING_STATE: PlanningState = {
  version: 2,
  currentAge: 30,
  endAge: 90,
  retirementAge: 65,
  startInvestments: 0,
  investmentTaxMode: "realisation",
  cashBuffer: 0,
  otherDebtBalance: 0,
  otherDebtRate: 0.07,
  otherDebtTermYears: 10,
  properties: [],
  includePropertyTax: false,
  // Charge it unless the user says their budget already covers it: a projection
  // that silently drops a real, lifelong expense reads as too optimistic.
  propertyTaxInBudget: false,
  mortgageBalance: 0,
  mortgageRate: 0.041,
  mortgageBidragssats: 0,
  mortgageTermYears: 30,
  mortgageInterestOnlyYears: 0,
  mortgageBudgetedMonthly: 0,
  monthlyContribution: 0,
  annualSpending: 0,
  assumptions: { ...DEFAULT_ASSUMPTIONS },
  pension: { ...DEFAULT_PENSION },
  tax: { ...DEFAULT_TAX_PROFILE },
  events: [],
  scenarios: [],
}

/** One year of the projected trajectory. */
export interface PlanningPoint {
  age: number
  /** Median liquid investments (nominal DKK). */
  investments: number
  /** Median home equity = every property's value − mortgage (nominal DKK). */
  homeEquity: number
  /** Liquid cash buffer (nominal DKK). */
  cash: number
  /** Outstanding non-mortgage debt (nominal DKK). */
  otherDebt: number
  /** Median total wealth = investments + cash + home equity − other debt. */
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
  /** Total tax paid this year (pension income + investment gains + ejendomsskat). */
  taxPaid: number
  /** Inflation-grown annual spending drawn this year (0 before retirement). */
  spending: number
  /** Gross amount sold from investments to cover the spending gap this year. */
  investmentsSold: number
  /** Amount borrowed against home equity to cover spending this year. */
  borrowed: number
  /** Property tax paid this year (ejendomsværdiskat + grundskyld). */
  propertyTax: number
}

export interface PlanningResult {
  points: PlanningPoint[]
  /** First age where liquid investments reach 1/SWR × annual spending. */
  fiAge: number | null
  /** Age at which the mortgage is fully repaid (null if none / never). */
  debtFreeAge: number | null
  /**
   * Age the deterministic (median) path runs out of money — investments and
   * home equity exhausted while spending continues. Null if it never happens.
   */
  ruinAge: number | null
  /**
   * Share (0–1) of Monte Carlo runs that funded spending for the whole horizon
   * without running out — the plan's "success probability".
   */
  successProbability: number
}
