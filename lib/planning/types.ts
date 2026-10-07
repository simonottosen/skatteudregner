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
  /**
   * Rate charged on equity borrowed to fund spending the household's assets
   * could not otherwise cover.
   *
   * An assumption rather than a term of any {@link PlannedLoan}, because this
   * debt is not on the list: the projection raises it mid-retirement, path by
   * path, against whatever equity is left (see `SimState.borrowedForSpending`).
   * The list can be empty, hold three loans at three rates, or hold none secured
   * on a property at all, so there is no entry the engine could read it off —
   * which is what it used to do, reading `mortgageRate` and silently pricing the
   * borrowing at nothing for a household that owed nothing today.
   */
  equityBorrowingRate: number
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
  // What a realkreditlån cost when the plan held one rate for every loan it did
  // not get from the user, so a plan that never touches this prices its
  // borrowing as it always has.
  equityBorrowingRate: 0.041,
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
 * Moving house is not an event.
 *
 * It used to be: a `PropertyEvent` sold "the home" — the first entry of
 * {@link PlanningState.properties} — and bought another, settling *every*
 * secured loan whatever property it named as security and leaving one fresh
 * 30-year mortgage behind. Alongside it, the property list could already say
 * when a property was acquired and when it was disposed of. Two mechanisms for
 * one subject, neither able to say what the other said: the event could finance
 * a purchase but could not keep the old house, the list could keep both houses
 * but could only buy for cash. A plan could even state both about the same
 * property, and the projection would apply both (issue #9).
 *
 * So the event is gone and the list carries all of it:
 * {@link PlannedProperty.disposalAge} says whether and when a property is sold
 * — for any number of properties, not just the first — and
 * {@link PlannedProperty.financing} says how the purchase is paid for. A move is
 * one property disposed of and another acquired the same year, which is what a
 * move is. Plans holding the old events are folded into that list by
 * `foldPropertyEvents` in `./normalize`.
 */
export type PlanningEvent = ExpenseEvent | WindfallEvent | RecurringEvent

/**
 * What a dwelling counts as under ejendomsskatteloven. These are the two kinds
 * § 25 names — the pensionistnedslag is up to 6.000 kr. for a helårsbolig and
 * 2.000 kr. for a fritidsbolig — and the two the tax engine's input models.
 */
export type PropertyKind = "helaarsbolig" | "fritidsbolig"

/**
 * What the household does with a property it owns — lives in it, leaves it
 * empty, or lets it out.
 *
 * **The projection ignores this field.** It exists because owning a property and
 * using it are different questions, and until now the plan could only ask the
 * first: a household that keeps its old house and rents it out could describe
 * the keeping but not the renting, so the plan read as if they had simply
 * acquired a second home (issue #9).
 *
 * Nothing is modelled on purpose. Danish rental taxation is deductible
 * operating costs, the bundfradrag scheme against the regnskabsmæssige one, and
 * an interaction with kapitalindkomst; half of that produces a confident number
 * the user has no reason to distrust. So `"rented"` stores the intent and
 * `rentalExclusionNotice` says out loud that lejeindtægt, driftsudgifter and
 * skat are all left out. `"vacant"` likewise changes no cash flow — ejendomsskat
 * is owed on an empty house exactly as on a lived-in one.
 *
 * For whoever wires this into the engine: `RunProperty` in `./simulate` is the
 * per-property struct a path actually carries, and it deliberately does not
 * copy `use` across. Rental cash flow belongs there, next to the housing
 * return, and it needs a taxation decision made first — not a default guessed
 * here.
 */
export type PropertyUse = "own" | "vacant" | "rented"

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
  /**
   * What the household uses it for. Stored, shown, and ignored by the
   * projection — see {@link PropertyUse} for why that is deliberate.
   */
  use: PropertyUse
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
   * portfolio, less whatever {@link financing} borrows against it.
   */
  acquisitionAge: number
  /** Age it is sold at; null means held for the whole projection. */
  disposalAge: number | null
  /**
   * How a purchase after `currentAge` is paid for: a loan of
   * `value × ltv` drawn in the acquisition year, leaving `value × (1 − ltv)` to
   * come out of the portfolio. Null is an all-equity purchase, and is also what
   * a property already owned at `currentAge` carries — its mortgage is a
   * {@link PlannedLoan} the household can state the real terms of, so
   * synthesising a second one from an LTV would double the debt.
   *
   * The LTV lives here rather than as a draw date on {@link PlannedLoan} because
   * the loan does not exist until the purchase does. A loan with a start age
   * would be a loan five call sites have to ask "has it been drawn yet?" about,
   * the `debtFreeAge` gate among them; an LTV is a number the engine turns into
   * a loan at the moment it is borrowed, and only then.
   *
   * What that loan costs is inherited rather than asked for: the rate,
   * bidragssats and afdragsfrihed of the largest realkreditlån it replaces, over
   * a fresh 30-year term. A household moving house keeps its lender's terms far
   * more often than it renegotiates them, and the alternative is four more
   * inputs on a form that already has to be filled in correctly.
   */
  financing: { ltv: number } | null
  /**
   * Yearly appreciation for this property, as a share (0.03 = 3 %), or null for
   * {@link PlanningAssumptions.housingReturn}. Per-property because a
   * Copenhagen flat and a summer house on Mors do not appreciate alike, and a
   * household moving between them is making exactly that bet.
   */
  housingReturn: number | null
  /**
   * What selling it costs, as a share of the price it fetches: salær,
   * tilstandsrapport, elinstallationsrapport, energimærke, and the seller's
   * half of the ejerskifteforsikring. 0.03 is 3 %. Taken off the proceeds the
   * sale pays into the portfolio, and off nothing else — the household stops
   * owning the whole house, not the house less the agent's fee.
   *
   * Not tinglysningsafgift, which this doc and the helper text both named until
   * the default made the figure matter. The afgift on the skødet is the buyer's
   * by kutyme — both parties are liable to the state and a købsaftale can move
   * it, but the household reading a fremskrivning is the one selling. Worth
   * writing down because it is a tempting thing to add back: it is the one sale
   * cost with a published rate, so it looks like the easy half of the figure,
   * and at 0,6 % of the price it is a fifth of a typical 3 % charge.
   *
   * Defaults to `DEFAULT_SALE_COSTS_PCT` (`./properties`). It shipped
   * defaulting to 0 instead — a sale that costs nothing, which no real sale is —
   * because the mechanism arrived in the same commit that reorganised the
   * settlement the recorded fixtures lock, and a default worth having would have
   * moved every recorded number alongside a refactor that was supposed to move
   * none, leaving no way to tell the two apart. The condition set then was that
   * a default could be chosen later against numbers known to be unchanged.
   *
   * That condition was met, and checked rather than assumed: every property in
   * `EVERY_LOAN_BRANCH`, `CHAINED_MOVES` and `LIST_ONLY` states its own share
   * literally and none of them is read through `normalizeProperty`, so all three
   * fixtures are byte-identical across the change. What moved is what should
   * have — a plan saved before the field existed now sells at what a Danish sale
   * actually nets, which on one worked household is a year of runway.
   */
  saleCostsPct: number
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
 * loan on this list is drawn today and repaid over
 * {@link PlannedLoan.termMonths}. Financing a property bought at 60 needs a loan
 * that does not exist yet, and that belongs with the purchase —
 * {@link PlannedProperty.financing} states the LTV and the engine draws the loan
 * in the acquisition year.
 */
export interface PlannedLoan {
  id: string
  /**
   * The {@link PlannedProperty} the loan is secured on; null for unsecured debt
   * (car, student, consumer). Interest is deductible either way — the link says
   * which property's equity the debt sits behind, not how it is taxed.
   *
   * Also which sale discharges it: selling that property settles this balance
   * out of the proceeds and stops the billing, and selling any other property
   * leaves it alone. A `realkredit` with no property named is the one debt that
   * is secured without naming its security — there is no unsecured kind — and it
   * comes due when the household's last property is gone.
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
   * Not among the fields issue #8 lists, but the scalars this list replaced
   * charged it — fed from the budget's own figure, which is also what
   * {@link PlanningState.mortgageBudgetedMonthly} is measured inclusive of. A
   * loan that could not carry the fee would either hand back a payment larger
   * than the one it charges, or invent a fee the budget never paid.
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
      | "loans"
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
   *
   * 3 replaced the eight `mortgage*`/`otherDebt*` scalars with {@link loans}.
   * `normalizeLoans` migrates a version-2 blob into a list of up to two entries,
   * and `normalizeAssumptions` takes the old `mortgageRate` as the plan's
   * {@link PlanningAssumptions.equityBorrowingRate}, which used to read it.
   *
   * 4 removed the `PropertyEvent` — "sell the home, buy another" as an
   * {@link events} entry — in favour of saying the same thing in
   * {@link properties}: a disposal age on the old home and a new entry acquired
   * the same year, financed by its {@link PlannedProperty.financing}.
   * `foldPropertyEvents` migrates a version-3 blob by replaying its property
   * events into that list.
   */
  version: 4
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
  /**
   * Every property the household owns or plans to own; empty if renting.
   *
   * The whole of the household's housing plan, moves included: each entry says
   * when it is acquired, when it is disposed of, and how the purchase is
   * financed. Order carries no meaning to the projection — the first entry is
   * merely where `homeProperty` puts the budget's home and what
   * `normalizeLoans` attaches a migrated mortgage to.
   *
   * A {@link PlannedLoan} names the entry that secures it, and selling that
   * entry settles that loan and no other. Secured balances are still subtracted
   * from the portfolio's equity as a whole, because that is what the household
   * can borrow against; it is the *settlement* that is per property.
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
  /**
   * Every debt the household carries, secured or not; empty if it owes nothing.
   *
   * One list rather than the eight scalars it replaces, because a household with
   * two realkreditlån at two rates, or a car loan beside a student loan, could
   * not state either as a single balance-rate-term triple and had to blend them
   * by hand (issue #8). The projection aggregates the list — see `debtCost` in
   * `./simulate` — so what it costs and what it owes is the sum of the entries,
   * whatever their number.
   */
  loans: PlannedLoan[]
  /**
   * The monthly realkredit payment the household's budget already subtracted
   * before reporting the surplus that becomes `monthlyContribution`
   * (`remaining = income − expenses − mortgage`, `lib/budget/state.ts`). Bidrag
   * included, because the budget's figure includes it.
   *
   * Carried in from the budget rather than reconstructed from {@link loans}. The
   * budget's mortgage module is off by default and then deducts nothing, while a
   * realkredit balance can still reach the list from the interest entered on
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
  version: 4,
  currentAge: 30,
  endAge: 90,
  retirementAge: 65,
  startInvestments: 0,
  investmentTaxMode: "realisation",
  cashBuffer: 0,
  properties: [],
  includePropertyTax: false,
  // Charge it unless the user says their budget already covers it: a projection
  // that silently drops a real, lifelong expense reads as too optimistic.
  propertyTaxInBudget: false,
  loans: [],
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
  /**
   * Median home equity: every property's value, less every secured loan's
   * balance and any equity borrowed for spending (nominal DKK).
   */
  homeEquity: number
  /** Liquid cash buffer (nominal DKK). */
  cash: number
  /**
   * Outstanding balance of the loans no property secures (nominal DKK) — the
   * debt that sits beside home equity rather than inside it.
   */
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
  /**
   * Age the household's *secured* debt is fully repaid — "gældfri bolig" — or
   * null when it starts out owing none, or never clears it. Unsecured loans
   * neither postpone the year nor bring it forward; see `simulatePlanning`.
   */
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
