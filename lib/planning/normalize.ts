/**
 * Pure normalization/validation for the planning slice. Lives outside the React
 * hook so it can be reused by the MCP server (which reads the same JSONB blob
 * from Supabase) and by tests. No DOM/React/browser APIs.
 */

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
  type PlanningEvent,
  type PlanningScenario,
  type PlanningState,
  type PlanningTaxProfile,
  type ScenarioChanges,
} from "./types"
import { getMunicipality } from "@/lib/tax/municipalities"
import type { TaxYear } from "@/lib/tax/types"

let nextId = 1
/** Monotonic, collision-resistant id for events/scenarios. */
export const newId = (prefix = "pe") => `${prefix}-${nextId++}-${Date.now()}`

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

export function normalizeAssumptions(value: unknown): PlanningAssumptions {
  if (!value || typeof value !== "object") return { ...DEFAULT_ASSUMPTIONS }
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
  if (o.type === "property") {
    return {
      id,
      type: "property",
      label,
      age,
      newValue: clampNum(o.newValue, 0, 0),
      mortgageLtv: clampNum(o.mortgageLtv, 0.8, 0, 1),
      housingReturnOverride:
        typeof o.housingReturnOverride === "number"
          ? clampNum(o.housingReturnOverride, 0, -1, 1)
          : undefined,
    }
  }
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
    single: typeof o.single === "boolean" ? o.single : DEFAULT_PENSION.single,
    includeFolkepension:
      typeof o.includeFolkepension === "boolean"
        ? o.includeFolkepension
        : DEFAULT_PENSION.includeFolkepension,
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
    churchMember:
      typeof o.churchMember === "boolean"
        ? o.churchMember
        : DEFAULT_TAX_PROFILE.churchMember,
  }
}

/** Validate the optional pieces of a scenario's change-set. */
export function normalizeScenarioChanges(value: unknown): ScenarioChanges {
  if (!value || typeof value !== "object") return {}
  const o = value as Partial<ScenarioChanges>
  const changes: ScenarioChanges = {}

  if (o.overrides && typeof o.overrides === "object") {
    const ov = o.overrides as Record<string, unknown>
    const out: NonNullable<ScenarioChanges["overrides"]> = {}
    if ("monthlyContribution" in ov) out.monthlyContribution = clampNum(ov.monthlyContribution, 0, 0)
    if ("annualSpending" in ov) out.annualSpending = clampNum(ov.annualSpending, 0, 0)
    if ("retirementAge" in ov) out.retirementAge = clampNum(ov.retirementAge, 65, 0, 120)
    if ("startInvestments" in ov) out.startInvestments = clampNum(ov.startInvestments, 0, 0)
    if ("cashBuffer" in ov) out.cashBuffer = clampNum(ov.cashBuffer, 0, 0)
    if (Object.keys(out).length > 0) changes.overrides = out
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

  if (Array.isArray(o.addEvents)) {
    const events = normalizeEvents(o.addEvents).map((e): NewPlanningEvent => {
      const { id, ...rest } = e
      void id
      return rest as NewPlanningEvent
    })
    if (events.length > 0) changes.addEvents = events
  }

  return changes
}

export function normalizeScenarios(value: unknown): PlanningScenario[] {
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
      changes: normalizeScenarioChanges(o.changes),
    })
  }
  return out
}

export function normalizePlanning(raw: unknown): PlanningState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PLANNING_STATE }
  const o = raw as Partial<PlanningState>
  const currentAge = clampNum(o.currentAge, DEFAULT_PLANNING_STATE.currentAge, 0, 100)
  const endAge = clampNum(o.endAge, DEFAULT_PLANNING_STATE.endAge, currentAge + 1, 120)
  return {
    version: 1,
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
    otherDebtBalance: clampNum(o.otherDebtBalance, 0, 0),
    otherDebtRate: clampNum(o.otherDebtRate, DEFAULT_PLANNING_STATE.otherDebtRate, 0, 0.5),
    otherDebtTermYears: clampNum(
      o.otherDebtTermYears,
      DEFAULT_PLANNING_STATE.otherDebtTermYears,
      1,
      40
    ),
    homeValue: clampNum(o.homeValue, 0, 0),
    landValue: clampNum(o.landValue, 0, 0),
    includePropertyTax:
      typeof o.includePropertyTax === "boolean" ? o.includePropertyTax : false,
    mortgageBalance: clampNum(o.mortgageBalance, 0, 0),
    mortgageRate: clampNum(o.mortgageRate, DEFAULT_PLANNING_STATE.mortgageRate, 0, 0.2),
    mortgageTermYears: clampNum(
      o.mortgageTermYears,
      DEFAULT_PLANNING_STATE.mortgageTermYears,
      1,
      40
    ),
    monthlyContribution: clampNum(o.monthlyContribution, 0, 0),
    annualSpending: clampNum(o.annualSpending, 0, 0),
    assumptions: normalizeAssumptions(o.assumptions),
    pension: normalizePension(o.pension),
    tax: normalizeTaxProfile(o.tax),
    events: normalizeEvents(o.events),
    scenarios: normalizeScenarios(o.scenarios),
  }
}
