/**
 * Pure normalization/validation for the planning slice. Lives outside the React
 * hook so it can be reused by the MCP server (which reads the same JSONB blob
 * from Supabase) and by tests. No DOM/React/browser APIs.
 */

import { normalizeLoans } from "./loans"
import { clampHousingReturn, clampLtv, clampSaleCostsPct } from "./properties"
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PENSION,
  DEFAULT_PENSION_PERSON,
  DEFAULT_PLANNING_STATE,
  DEFAULT_TAX_PROFILE,
  type NewPlanningEvent,
  type PensionPerson,
  type PensionState,
  type PlanningAssumptions,
  type PlannedProperty,
  type PlanningEvent,
  type PlanningScenario,
  type PlanningState,
  type PlanningTaxProfile,
  type PropertyKind,
  type PropertyUse,
  type ScenarioChanges,
} from "./types"
import { getMunicipality } from "@/lib/tax/municipalities"
import type { TaxYear } from "@/lib/tax/types"

/**
 * Collision-resistant id for events/scenarios. Random rather than a counter and
 * the clock, which tie the id to the process that minted it — so the same list
 * built on the server and on the client comes out with different ids. Mint ids
 * on a user action or on already-loaded state only, never during render.
 */
export const newId = (prefix = "pe") =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`

export function clampNum(
  value: unknown,
  fallback: number,
  min = -Infinity,
  max = Infinity
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

/**
 * Always pass the shared default as `fallback`. A saved plan that predates a
 * flag has no opinion about it, so it has to land wherever a fresh plan lands —
 * spelling the fallback out here instead lets the two drift apart silently.
 */
function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

/**
 * `equityBorrowingRate` as a version-2 blob states it: the plan's old
 * `mortgageRate`, which is the field the engine charged this borrowing at before
 * the rate became an assumption of its own. Falls back to the shared default,
 * for a blob predating both.
 *
 * Read off the whole plan rather than the assumptions object it now lives in,
 * because that is where the old field sat — a sibling of `assumptions`, not a
 * member of it.
 */
function legacyEquityBorrowingRate(plan: unknown): number {
  const o = (plan ?? {}) as Record<string, unknown>
  return clampNum(
    o.mortgageRate,
    DEFAULT_ASSUMPTIONS.equityBorrowingRate,
    0,
    0.2
  )
}

export function normalizeAssumptions(
  value: unknown,
  /**
   * The plan the assumptions came from, for the one field that migrates out of
   * it. Optional because a caller with assumptions and no plan — a scenario's
   * `assumptionOverrides` — has nothing to migrate.
   */
  plan?: unknown
): PlanningAssumptions {
  const equityBorrowingFallback = legacyEquityBorrowingRate(plan)
  if (!value || typeof value !== "object")
    return {
      ...DEFAULT_ASSUMPTIONS,
      equityBorrowingRate: equityBorrowingFallback,
    }
  const o = value as Partial<PlanningAssumptions>
  return {
    housingReturn: clampNum(o.housingReturn, DEFAULT_ASSUMPTIONS.housingReturn, -1, 1),
    investmentReturn: clampNum(o.investmentReturn, DEFAULT_ASSUMPTIONS.investmentReturn, -1, 1),
    investmentFee: clampNum(o.investmentFee, DEFAULT_ASSUMPTIONS.investmentFee, 0, 1),
    volatility: clampNum(o.volatility, DEFAULT_ASSUMPTIONS.volatility, 0, 1),
    housingVolatility: clampNum(o.housingVolatility, DEFAULT_ASSUMPTIONS.housingVolatility, 0, 1),
    inflation: clampNum(o.inflation, DEFAULT_ASSUMPTIONS.inflation, -1, 1),
    contributionGrowth: clampNum(o.contributionGrowth, DEFAULT_ASSUMPTIONS.contributionGrowth, -1, 1),
    safeWithdrawalRate: clampNum(o.safeWithdrawalRate, DEFAULT_ASSUMPTIONS.safeWithdrawalRate, 0.01, 0.2),
    // Same 0–20 % bound the `mortgageRate` it migrates from was held to.
    equityBorrowingRate: clampNum(
      o.equityBorrowingRate,
      equityBorrowingFallback,
      0,
      0.2
    ),
  }
}

/** Normalize a single event; returns null if the type is unrecognized. */
function normalizeEvent(raw: unknown): PlanningEvent | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === "string" ? o.id : newId()
  const label = typeof o.label === "string" ? o.label : ""
  const age = clampNum(o.age, 0, 0, 120)
  if (o.type === "expense" || o.type === "windfall") {
    return { id, type: o.type, label, age, amount: clampNum(o.amount, 0, 0) }
  }
  if (o.type === "recurring") {
    return { id, type: "recurring", label, age, monthlyDelta: clampNum(o.monthlyDelta, 0) }
  }
  // `"property"` lands here and is dropped: a version-3 move is not an event any
  // more, and {@link foldPropertyEvents} has already replayed it into the
  // property list. Leaving it on `events` would describe the move twice over —
  // which is the half of issue #9 that was a live bug rather than a missing
  // feature.
  return null
}

export function normalizeEvents(value: unknown): PlanningEvent[] {
  if (!Array.isArray(value)) return []
  const out: PlanningEvent[] = []
  for (const raw of value) {
    const e = normalizeEvent(raw)
    if (e) out.push(e)
  }
  return out
}

/** Danish label a migrated or freshly added property starts out with. */
export const DEFAULT_PROPERTY_LABEL: Record<PropertyKind, string> = {
  helaarsbolig: "Bolig",
  fritidsbolig: "Sommerhus",
}

/** Normalize one property; returns null if it carries no value to model. */
function normalizeProperty(raw: unknown): PlannedProperty | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  const kind: PropertyKind =
    o.kind === "fritidsbolig" ? "fritidsbolig" : "helaarsbolig"
  // Absent on a plan saved before the field existed, or a use an MCP client
  // invented; both read as the one the projection models rather than claiming
  // something the user never said. Defaulted rather than version-gated, for the
  // reason `normalizeProperties` gives below.
  const use: PropertyUse =
    o.use === "vacant" || o.use === "rented" ? o.use : "own"
  const acquisitionAge = clampNum(o.acquisitionAge, 0, 0, 120)
  return {
    id: typeof o.id === "string" ? o.id : newId("prop"),
    label:
      typeof o.label === "string" && o.label.trim()
        ? o.label
        : DEFAULT_PROPERTY_LABEL[kind],
    kind,
    use,
    value: clampNum(o.value, 0, 0),
    landValue: clampNum(o.landValue, 0, 0),
    // Absent on a plan saved before the field existed, and 0 is what that plan
    // was projected with — see {@link PlannedProperty.saleCostsPct} for why the
    // default is a free sale rather than a realistic one. The bound is the
    // form's own, so a reload cannot change a figure the form accepted.
    saleCostsPct: clampSaleCostsPct(o.saleCostsPct),
    acquisitionAge,
    // A disposal before the purchase would describe a property that is never
    // owned, which is a typo rather than a plan; the floor reads it as a sale in
    // the year of the purchase.
    disposalAge:
      o.disposalAge === null || o.disposalAge === undefined
        ? null
        : clampNum(o.disposalAge, 0, acquisitionAge, 120),
    // Absent on every plan saved before the field existed, and an all-equity
    // purchase is what those plans were projected with — see
    // {@link PlannedProperty.financing}. The absence is the whole of the
    // all-equity reading: a `financing` block that *is* there with no usable
    // number in it asked to be financed and said nothing about how much, so
    // {@link clampLtv} answers with the realkreditlovens 80 %, which is the most
    // the household could have been lent rather than a guess at what it chose.
    financing:
      o.financing && typeof o.financing === "object"
        ? { ltv: clampLtv((o.financing as Record<string, unknown>).ltv) }
        : null,
    // Likewise: absent is "follow the plan's own appreciation", which is what
    // every entry did before the field existed. Held to a share per year that a
    // projection can survive — see {@link PlannedProperty.housingReturn}.
    housingReturn:
      typeof o.housingReturn === "number"
        ? clampHousingReturn(o.housingReturn)
        : null,
  }
}

/**
 * The household's own home as a list entry: a helårsbolig it already owns and
 * never sells. Both places that have a home but no list — a version-1 plan and
 * the budget — describe exactly this.
 */
export function homeProperty(value: number, landValue: number): PlannedProperty {
  return {
    id: newId("prop"),
    label: DEFAULT_PROPERTY_LABEL.helaarsbolig,
    kind: "helaarsbolig",
    use: "own",
    value,
    landValue,
    saleCostsPct: 0,
    acquisitionAge: 0,
    disposalAge: null,
    // Already owned, so there is nothing to finance: whatever is owed on it is a
    // {@link PlannedLoan} with its real terms.
    financing: null,
    housingReturn: null,
  }
}

/**
 * Read a plan blob's property list, migrating it if it predates one.
 *
 * Version 1 held a single property as `homeValue` + `landValue`. A blob without
 * a `properties` array is one of those, and its home becomes the first — and
 * loan-bearing — entry of the list.
 *
 * Keyed on the array being absent rather than on `version`, because a blob can
 * arrive from localStorage, Supabase or an MCP client with any version field it
 * likes, and the shape is the thing actually being asked about. That is also why
 * this takes the whole blob: the legacy amounts it falls back to are siblings of
 * the field it reads, not something a caller could pass separately.
 */
export function normalizeProperties(blob: unknown): PlannedProperty[] {
  const o = (blob ?? {}) as Record<string, unknown>
  if (Array.isArray(o.properties)) {
    const out: PlannedProperty[] = []
    for (const raw of o.properties) {
      const p = normalizeProperty(raw)
      if (p) out.push(p)
    }
    return out
  }
  const homeValue = clampNum(o.homeValue, 0, 0)
  if (homeValue <= 0) return []
  return [homeProperty(homeValue, clampNum(o.landValue, 0, 0))]
}

/** One version-3 move, as much of it as the migration needs. */
interface LegacyMove {
  age: number
  label: string
  newValue: number
  ltv: number
  housingReturn: number | null
}

/**
 * The version-3 moves in a raw `events` array, earliest first, each dated at a
 * year the property list can state a transaction in.
 *
 * Read off the blob rather than off {@link normalizeEvents}' output, which drops
 * them: `PropertyEvent` is no longer a type, so there is nothing left for it to
 * return. The bounds are the ones `normalizeEvent` held these fields to while it
 * still had a branch for them, so a move migrates to the figures it was last
 * projected with and not to the ones that were typed.
 *
 * The dates are the one thing that cannot migrate unchanged, because the two
 * vocabularies disagree about the current year:
 *
 * - A move *before* `currentAge` is dropped. The engine only ever looked up
 *   events from `currentAge` forward, so such a move has never fired and
 *   migrating it would invent a transaction the plan was not projected with.
 * - A move *at* `currentAge` is dated to `currentAge + 1`. The list reads
 *   `acquisitionAge <= currentAge` as "owned today" — part of the opening
 *   position, bought before the projection starts and so never paid for inside
 *   it — and a disposal in the same year as "never owned at all". Migrating a
 *   move to that year would therefore hand the household its new home for free
 *   and leave the old home's mortgage standing, which is strictly worse than the
 *   old projection. The projection's first year is the earliest one that can
 *   carry the sale, the settlement and the down payment the move describes, so
 *   that is where it goes.
 *
 * The cost of the second rule is that such a move lands a year later than the
 * old engine put it, which applied events at `currentAge` before it recorded
 * year 0 — i.e. treated an immediate move as an opening-position rewrite. The
 * alternative was to migrate it as one: fold the down payment into
 * `startInvestments`, mint a {@link PlannedLoan} for the new mortgage and delete
 * the old one. That is rejected on two counts. It would have to restate
 * `drawLoansAt`'s term-inheritance rule here, in a second place that can drift
 * from the engine; and taking the down payment off `startInvestments` is
 * precisely the untaxed, unrecorded withdrawal that issue #9 exists to remove —
 * the projection's own purchase routes it through the year's `fundShortfall`, so
 * it realises gains, pays the tax and shows up in `investmentsSold`. A year's
 * delay is the honest price of putting the money through the books.
 */
function legacyMoves(events: unknown, currentAge: number): LegacyMove[] {
  if (!Array.isArray(events)) return []
  const out: LegacyMove[] = []
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue
    const e = raw as Record<string, unknown>
    if (e.type !== "property") continue
    const age = clampNum(e.age, 0, 0, 120)
    if (age < currentAge) continue
    out.push({
      age: Math.max(age, currentAge + 1),
      label: typeof e.label === "string" ? e.label : "",
      newValue: clampNum(e.newValue, 0, 0),
      ltv: clampLtv(e.mortgageLtv),
      housingReturn:
        typeof e.housingReturnOverride === "number"
          ? clampNum(e.housingReturnOverride, 0, -1, 1)
          : null,
    })
  }
  // Stable, so two moves at one age fold in the order the plan listed them —
  // which is the order the engine used to apply them in.
  return out.sort((a, b) => a.age - b.age)
}

/**
 * Whether a blob's `events` still describe a move this migration has somewhere
 * to put — so a plan whose only move is dated in the household's past reads as
 * having none, which is how it was projected.
 */
export function hasPropertyEvents(
  events: unknown,
  currentAge: number
): boolean {
  return legacyMoves(events, currentAge).length > 0
}

/**
 * Replay a version-3 plan's moves into its property list (issue #9).
 *
 * A move said "sell the home, buy one worth `newValue` at `mortgageLtv`", where
 * "the home" was the list's first entry and the move rewrote it in place. The
 * list says the same thing in its own vocabulary: a `disposalAge` on the home
 * and a new entry acquired that same year, carrying the
 * {@link PlannedProperty.financing} the move's LTV becomes. So each move closes
 * the current home's window and appends its successor, and a chain of moves
 * walks that forward.
 *
 * Appended rather than inserted, so the first entry stays the first entry:
 * {@link normalizeLoans} secures a migrated mortgage on it, and reordering the
 * list here would move that pant to a house the household had not bought yet.
 *
 * Three details are what make the migrated plan project as the old one did:
 *
 * - `landValue` scales by the change in value, which is what the move itself
 *   did. Not an approximation: `simulate.ts` grows `value` and `landValue` by
 *   one factor, so their ratio is the same in the year of the move as it is
 *   today, and the figure can be computed here from today's numbers.
 * - `saleCostsPct` and `disposalAge` carry onto the successor. The move left the
 *   first entry's own fields standing and the engine read them at the sale, so
 *   "sold at 78" stated on a home that is moved out of at 52 was a sale of the
 *   *new* home at 78 — and what it cost to sell was the old entry's figure.
 * - a successor with `acquisitionAge === disposalAge` is dropped. Two moves at
 *   one age leave the first purchase owned for no year at all, and the engine
 *   reads such a window as never owned — so its value would hang on the list
 *   while every charge against it vanished. Dropping it is also exact: paying
 *   `(1 − ltv) · V` for it and taking `V − ltv · V` back the same year cancel,
 *   and `drawLoansAt` prices the next loan off the mortgage the household
 *   actually carries either way.
 *
 * When each move lands is {@link legacyMoves}' to explain: the current year is
 * the one date the two vocabularies disagree about.
 */
export function foldPropertyEvents(
  base: readonly PlannedProperty[],
  events: unknown,
  currentAge: number
): PlannedProperty[] {
  const moves = legacyMoves(events, currentAge)
  // Copied, not aliased: a move closes the window on the entry it replaces, and
  // {@link normalizeScenarioChanges} folds a scenario's move against the *plan's*
  // list — which must not come back carrying a disposal age the plan never had.
  const out = base.map((p) => ({ ...p }))
  if (moves.length === 0) return out
  // The entry a move replaces, and then the entry that replaced it. Null for a
  // plan that listed no property at all: there was no home to sell, and the
  // engine likewise reserved a slot worth nothing until the first move filled
  // it, so the first purchase is simply an acquisition.
  let home: PlannedProperty | null = out[0] ?? null
  const added: PlannedProperty[] = []
  for (const move of moves) {
    const next: PlannedProperty = {
      id: newId("prop"),
      label: move.label.trim() || DEFAULT_PROPERTY_LABEL.helaarsbolig,
      // A move left the household in a helårsbolig whatever the entry it
      // replaced had been, which is what the old engine's § 25 count assumed.
      kind: "helaarsbolig",
      use: "own",
      value: move.newValue,
      landValue:
        home && home.value > 0
          ? (home.landValue * move.newValue) / home.value
          : 0,
      saleCostsPct: home?.saleCostsPct ?? 0,
      acquisitionAge: move.age,
      disposalAge: home?.disposalAge ?? null,
      financing: { ltv: move.ltv },
      housingReturn: move.housingReturn,
    }
    if (home) home.disposalAge = move.age
    added.push(next)
    home = next
  }
  // Only now: a successor's own window is not closed until the move after it has
  // been folded, so whether it is held for no year at all cannot be known while
  // it is being built. Entries the plan itself listed are never dropped — a
  // window of the user's own that happens to be empty is theirs to state, and
  // the first entry in particular is what every migrated loan is secured on.
  for (const p of added)
    if (p.disposalAge === null || p.disposalAge > p.acquisitionAge) out.push(p)
  return out
}

export function normalizePensionPerson(value: unknown): PensionPerson {
  if (!value || typeof value !== "object") return { ...DEFAULT_PENSION_PERSON }
  const o = value as Partial<PensionPerson>
  return {
    ratepensionBalance: clampNum(o.ratepensionBalance, 0, 0),
    livrenteBalance: clampNum(o.livrenteBalance, 0, 0),
    aldersopsparingBalance: clampNum(o.aldersopsparingBalance, 0, 0),
    ratepensionAnnual: clampNum(o.ratepensionAnnual, 0, 0),
    livrenteAnnual: clampNum(o.livrenteAnnual, 0, 0),
    aldersopsparingAnnual: clampNum(o.aldersopsparingAnnual, 0, 0),
    folkepensionAge: clampNum(
      o.folkepensionAge,
      DEFAULT_PENSION_PERSON.folkepensionAge,
      60,
      75
    ),
  }
}

export function normalizePension(value: unknown): PensionState {
  if (!value || typeof value !== "object") return { ...DEFAULT_PENSION }
  const o = value as Partial<PensionState> & Record<string, unknown>
  // Migrate the legacy single-person (flat) shape into person 1.
  const legacyPerson1 =
    o.person1 ?? ("ratepensionBalance" in o ? o : undefined)
  return {
    person1: normalizePensionPerson(legacyPerson1),
    person2: normalizePensionPerson(o.person2),
    pensionReturn: clampNum(o.pensionReturn, DEFAULT_PENSION.pensionReturn, -1, 1),
    ratepensionYears: clampNum(o.ratepensionYears, DEFAULT_PENSION.ratepensionYears, 1, 40),
    single: boolOr(o.single, DEFAULT_PENSION.single),
    includeFolkepension: boolOr(
      o.includeFolkepension,
      DEFAULT_PENSION.includeFolkepension
    ),
  }
}

const TAX_YEARS: TaxYear[] = [2024, 2025, 2026]

export function normalizeTaxProfile(value: unknown): PlanningTaxProfile {
  if (!value || typeof value !== "object") return { ...DEFAULT_TAX_PROFILE }
  const o = value as Partial<PlanningTaxProfile>
  const year = TAX_YEARS.includes(o.year as TaxYear)
    ? (o.year as TaxYear)
    : DEFAULT_TAX_PROFILE.year
  // Fall back to the default kommune if the saved one is unknown for that year.
  const municipality =
    typeof o.municipality === "string" && getMunicipality(o.municipality, year)
      ? o.municipality
      : DEFAULT_TAX_PROFILE.municipality
  return {
    year,
    municipality,
    churchMember: boolOr(o.churchMember, DEFAULT_TAX_PROFILE.churchMember),
  }
}

/**
 * Validate the optional pieces of a scenario's change-set.
 *
 * `baseProperties` is the plan the scenario is layered on, already normalized —
 * needed because a loan override is resolved against a property list (see
 * {@link normalizeLoans}) and a scenario rarely restates one. "What if I
 * refinanced" overrides the loans alone, and its realkredit is secured on the
 * same home the base plan's is: `applyScenario` swaps the list out and leaves
 * `properties` standing, so that is the home the scenario's loans really meet.
 * Resolving against nothing instead would read the mortgage as securing no
 * particular property and move its settlement to the household's last disposal.
 *
 * Optional because the caller may hold no plan — a change-set validated on its
 * own, as in an MCP client's input before it is applied to anything. Such a
 * caller has no home to offer and cannot be given one here: `propertyId` has no
 * "unresolved" value to defer with, since null is already the user's deliberate
 * "uden pant", so the only honest reading of an absent list is an empty one.
 *
 * `currentAge` is the plan's, for the same reason and with the same caveat: a
 * scenario's `addEvents` fire on the plan's timeline, so a version-3 move among
 * them is dated against it (see {@link legacyMoves}). 0 for a caller with no
 * plan, which is the age that drops nothing.
 */
export function normalizeScenarioChanges(
  value: unknown,
  baseProperties: readonly PlannedProperty[] = [],
  currentAge = 0
): ScenarioChanges {
  if (!value || typeof value !== "object") return {}
  const o = value as Partial<ScenarioChanges>
  const changes: ScenarioChanges = {}
  // Hoisted out of the block below, because `addEvents` can write to it too: a
  // scenario that carries nothing but a version-3 move still comes out of here
  // overriding the property list.
  const out: NonNullable<ScenarioChanges["overrides"]> = {}

  if (o.overrides && typeof o.overrides === "object") {
    const ov = o.overrides as Record<string, unknown>
    if ("monthlyContribution" in ov) out.monthlyContribution = clampNum(ov.monthlyContribution, 0, 0)
    if ("annualSpending" in ov) out.annualSpending = clampNum(ov.annualSpending, 0, 0)
    if ("retirementAge" in ov) out.retirementAge = clampNum(ov.retirementAge, 65, 0, 120)
    if ("startInvestments" in ov) out.startInvestments = clampNum(ov.startInvestments, 0, 0)
    if ("cashBuffer" in ov) out.cashBuffer = clampNum(ov.cashBuffer, 0, 0)
    if (
      ov.investmentTaxMode === "lager" ||
      ov.investmentTaxMode === "ask" ||
      ov.investmentTaxMode === "realisation"
    )
      out.investmentTaxMode = ov.investmentTaxMode
    // A scenario may also say "what if I also owned a summer house", so the
    // legacy scalars are read here too — the same migration the base plan gets.
    if ("properties" in ov || "homeValue" in ov)
      out.properties = normalizeProperties(ov)
    if (typeof ov.includePropertyTax === "boolean") out.includePropertyTax = ov.includePropertyTax
    if (typeof ov.propertyTaxInBudget === "boolean")
      out.propertyTaxInBudget = ov.propertyTaxInBudget
    // "What if I refinanced" is a whole list too, for the same reason: a partial
    // one cannot say which loan it means. The legacy balances are read here as
    // well, so a scenario saved against the old scalars keeps its meaning.
    //
    // Against the scenario's own properties where it states them — "what if I
    // also owned a summer house, and borrowed for it" describes one household —
    // and against the base plan's where it does not.
    if ("loans" in ov || "mortgageBalance" in ov || "otherDebtBalance" in ov)
      out.loans = normalizeLoans(ov, out.properties ?? baseProperties)
  }

  if (o.assumptionOverrides && typeof o.assumptionOverrides === "object") {
    const full = normalizeAssumptions({
      ...DEFAULT_ASSUMPTIONS,
      ...(o.assumptionOverrides as object),
    })
    const ao = o.assumptionOverrides as Record<string, unknown>
    const out: Partial<PlanningAssumptions> = {}
    for (const k of Object.keys(ao) as (keyof PlanningAssumptions)[]) {
      if (k in full) out[k] = full[k]
    }
    if (Object.keys(out).length > 0) changes.assumptionOverrides = out
  }

  if (o.pensionOverrides && typeof o.pensionOverrides === "object") {
    const po = o.pensionOverrides as Record<string, unknown>
    const out: NonNullable<ScenarioChanges["pensionOverrides"]> = {}
    if ("pensionReturn" in po)
      out.pensionReturn = clampNum(po.pensionReturn, DEFAULT_PENSION.pensionReturn, -1, 1)
    if ("ratepensionYears" in po)
      out.ratepensionYears = clampNum(po.ratepensionYears, DEFAULT_PENSION.ratepensionYears, 1, 40)
    if (typeof po.single === "boolean") out.single = po.single
    if (typeof po.includeFolkepension === "boolean")
      out.includeFolkepension = po.includeFolkepension
    if (Object.keys(out).length > 0) changes.pensionOverrides = out
  }

  if (o.taxOverrides && typeof o.taxOverrides === "object") {
    const to = o.taxOverrides as Record<string, unknown>
    // Reuse normalizeTaxProfile (validates kommune for the year) on a merged
    // object, then keep only the keys the caller actually provided.
    const full = normalizeTaxProfile({ ...DEFAULT_TAX_PROFILE, ...to })
    const out: Partial<PlanningTaxProfile> = {}
    if ("year" in to) out.year = full.year
    if ("municipality" in to) out.municipality = full.municipality
    if ("churchMember" in to) out.churchMember = full.churchMember
    if (Object.keys(out).length > 0) changes.taxOverrides = out
  }

  if (Array.isArray(o.addEvents)) {
    const events = normalizeEvents(o.addEvents).map((e): NewPlanningEvent => {
      const { id, ...rest } = e
      void id
      return rest as NewPlanningEvent
    })
    if (events.length > 0) changes.addEvents = events
    // "What if I moved" could be saved as a scenario, and `normalizeEvents` no
    // longer has anywhere to put it. Folded into the list the scenario presents
    // — its own override where it states one, the base plan's where it does not
    // — because that override is what `applyScenario` lays over the plan, so a
    // top-level `properties` here would be read by nothing and the move would be
    // lost in silence.
    if (hasPropertyEvents(o.addEvents, currentAge))
      out.properties = foldPropertyEvents(
        out.properties ?? baseProperties,
        o.addEvents,
        currentAge
      )
  }
  if (Object.keys(out).length > 0) changes.overrides = out

  return changes
}

export function normalizeScenarios(
  value: unknown,
  /** The plan these scenarios belong to — see {@link normalizeScenarioChanges}. */
  baseProperties: readonly PlannedProperty[] = [],
  currentAge = 0
): PlanningScenario[] {
  if (!Array.isArray(value)) return []
  const out: PlanningScenario[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    out.push({
      id: typeof o.id === "string" ? o.id : newId("sc"),
      name: typeof o.name === "string" && o.name.trim() ? o.name : "Scenarie",
      createdAt:
        typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
      changes: normalizeScenarioChanges(o.changes, baseProperties, currentAge),
    })
  }
  return out
}

export function normalizePlanning(raw: unknown): PlanningState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PLANNING_STATE }
  const o = raw as Partial<PlanningState>
  const currentAge = clampNum(o.currentAge, DEFAULT_PLANNING_STATE.currentAge, 0, 100)
  const endAge = clampNum(o.endAge, DEFAULT_PLANNING_STATE.endAge, currentAge + 1, 120)
  // The loans — the plan's own and every scenario's — are secured against the
  // *normalized* list, not the blob's own: a property that arrives without an id
  // gets a fresh one, so a second normalization of the same blob would mint ids
  // this plan does not keep.
  // A version-3 plan states its moves on `events`; the list is where they live
  // now, so they are replayed into it before anything is secured against it.
  const properties = foldPropertyEvents(
    normalizeProperties(o),
    o.events,
    currentAge
  )
  return {
    version: 4,
    currentAge,
    endAge,
    retirementAge: clampNum(
      o.retirementAge,
      DEFAULT_PLANNING_STATE.retirementAge,
      currentAge,
      endAge
    ),
    startInvestments: clampNum(o.startInvestments, 0, 0),
    investmentTaxMode:
      o.investmentTaxMode === "lager" || o.investmentTaxMode === "ask"
        ? o.investmentTaxMode
        : "realisation",
    cashBuffer: clampNum(o.cashBuffer, 0, 0),
    properties,
    includePropertyTax: boolOr(
      o.includePropertyTax,
      DEFAULT_PLANNING_STATE.includePropertyTax
    ),
    propertyTaxInBudget: boolOr(
      o.propertyTaxInBudget,
      DEFAULT_PLANNING_STATE.propertyTaxInBudget
    ),
    loans: normalizeLoans(o, properties),
    // A plan saved before this field existed has no opinion about it, and the
    // safe reading of silence is "nothing was deducted": crediting a payment the
    // budget may never have made is the failure this field was added to stop.
    mortgageBudgetedMonthly: clampNum(
      o.mortgageBudgetedMonthly,
      DEFAULT_PLANNING_STATE.mortgageBudgetedMonthly,
      0
    ),
    monthlyContribution: clampNum(o.monthlyContribution, 0, 0),
    annualSpending: clampNum(o.annualSpending, 0, 0),
    // The whole blob, so `equityBorrowingRate` can migrate out of the plan's old
    // `mortgageRate` — a sibling of `assumptions`, not a member of it.
    assumptions: normalizeAssumptions(o.assumptions, o),
    pension: normalizePension(o.pension),
    tax: normalizeTaxProfile(o.tax),
    events: normalizeEvents(o.events),
    scenarios: normalizeScenarios(o.scenarios, properties, currentAge),
  }
}
