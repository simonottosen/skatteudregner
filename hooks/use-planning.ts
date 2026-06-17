"use client"

import { useEffect, useMemo, useState } from "react"
import { useRemoteSync } from "@/hooks/use-remote-sync"
import { useTax } from "@/components/tax-provider"
import { useBudget } from "@/components/budget-provider"
import { estimateMortgage } from "@/lib/budget/generate-budget"
import { computeMortgage } from "@/lib/budget/mortgage"
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
  type PlanningState,
  type PlanningTaxProfile,
} from "@/lib/planning/types"
import { folkepensionAge } from "@/lib/planning/pension"
import { getMunicipality } from "@/lib/tax/municipalities"
import type { TaxYear } from "@/lib/tax/types"

const STORAGE_KEY = "skatteberegner:planning"

let nextId = 1
const newEventId = () => `pe-${nextId++}-${Date.now()}`

function clampNum(
  value: unknown,
  fallback: number,
  min = -Infinity,
  max = Infinity
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function normalizeAssumptions(value: unknown): PlanningAssumptions {
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

function normalizeEvents(value: unknown): PlanningEvent[] {
  if (!Array.isArray(value)) return []
  const out: PlanningEvent[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const id = typeof o.id === "string" ? o.id : newEventId()
    const label = typeof o.label === "string" ? o.label : ""
    const age = clampNum(o.age, 0, 0, 120)
    if (o.type === "expense" || o.type === "windfall") {
      out.push({ id, type: o.type, label, age, amount: clampNum(o.amount, 0, 0) })
    } else if (o.type === "recurring") {
      out.push({ id, type: "recurring", label, age, monthlyDelta: clampNum(o.monthlyDelta, 0) })
    } else if (o.type === "property") {
      out.push({
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
      })
    }
  }
  return out
}

function normalizePensionPerson(value: unknown): PensionPerson {
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

function normalizePension(value: unknown): PensionState {
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

function normalizeTaxProfile(value: unknown): PlanningTaxProfile {
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

function normalizePlanning(raw: unknown): PlanningState {
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
  }
}

/** Best-effort age from a birth date string; null if unparseable. */
function ageFromBirthDate(birthDate: string | undefined): number | null {
  if (!birthDate) return null
  const dob = new Date(birthDate)
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--
  return age >= 0 && age <= 120 ? age : null
}

/**
 * Owns the planning state for the /planlaegning page. Until the user edits
 * anything (or a saved value is restored), the home value, mortgage, monthly
 * contribution, annual spending and current age stay linked to the tax/budget
 * data; the first manual edit (or remote restore) "unlinks" them.
 */
export function usePlanning() {
  const { input } = useTax()
  const budget = useBudget()

  const [state, setState] = useState<PlanningState>(DEFAULT_PLANNING_STATE)
  const [hydrated, setHydrated] = useState(false)
  const [touched, setTouched] = useState(false)

  // Values inferred from the tax + budget pages.
  const twoPeople = budget.state.mode !== "single"
  const budgetIncome = twoPeople ? budget.p1Income + budget.p2Income : budget.p1Income
  const budgetExpenses =
    budget.state.mode === "separate"
      ? budget.p1Total + budget.p2Total
      : budget.sharedTotal

  const mortgage = budget.state.mortgage
  const mortgageMonthly = budget.mortgageMonthly

  const derivedDefaults = useMemo(() => {
    // Savings rate nets out the mortgage payment (it's a real cash outflow);
    // the mortgage itself is modelled separately, so it's excluded from forbrug.
    const remaining = Math.max(
      0,
      Math.round(budgetIncome - budgetExpenses - mortgageMonthly)
    )
    const currentAge =
      ageFromBirthDate(input.birthDate) ?? DEFAULT_PLANNING_STATE.currentAge
    const birthYear = new Date().getFullYear() - currentAge

    // Prefer the precise mortgage from the budget page when enabled.
    const homeValue = mortgage.enabled
      ? Math.round(mortgage.homeValue)
      : Math.round(input.property?.propertyValue ?? 0)
    const mortgageBalance = mortgage.enabled
      ? Math.round(computeMortgage(mortgage).loan)
      : Math.round(estimateMortgage(input.mortgageInterest || 0).principal)

    // Land value (grundværdi) for grundskyld; default to ~40 % of home value.
    const landValue = Math.round(
      input.property?.landValue || homeValue * 0.4
    )

    return {
      monthlyContribution: remaining,
      annualSpending: Math.round(budgetExpenses * 12),
      homeValue,
      landValue,
      mortgageBalance,
      mortgageRate: mortgage.enabled
        ? mortgage.interestRate
        : DEFAULT_PLANNING_STATE.mortgageRate,
      mortgageTermYears: mortgage.enabled
        ? mortgage.remainingYears
        : DEFAULT_PLANNING_STATE.mortgageTermYears,
      currentAge,
      tax: {
        year: input.year,
        municipality: getMunicipality(input.municipality, input.year)
          ? input.municipality
          : DEFAULT_TAX_PROFILE.municipality,
        churchMember: input.churchMember,
      },
      pension: {
        single: budget.state.mode === "single",
        // Seed person 1 from the tax page; person 2 only its folkepensionsalder.
        person1: {
          ratepensionAnnual: Math.round(input.privatePensionRatepension || 0),
          livrenteAnnual: Math.round(input.privatePensionLivrente || 0),
          folkepensionAge: folkepensionAge(birthYear),
        },
        person2: {
          folkepensionAge: folkepensionAge(birthYear),
        },
      },
    }
  }, [
    budgetIncome,
    budgetExpenses,
    mortgageMonthly,
    mortgage,
    input.property?.propertyValue,
    input.property?.landValue,
    input.mortgageInterest,
    input.birthDate,
    input.privatePensionRatepension,
    input.privatePensionLivrente,
    input.year,
    input.municipality,
    input.churchMember,
    budget.state.mode,
  ])

  // Sync to Supabase when signed in (debounced + flush on leave).
  useRemoteSync<PlanningState>("planning", state, (remote) => {
    setTouched(true)
    setState(normalizePlanning(remote))
  })

  // Restore persisted state once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw) {
        /* eslint-disable react-hooks/set-state-in-effect */
        setState(normalizePlanning(JSON.parse(raw)))
        setTouched(true)
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {
      // Ignore malformed/unavailable storage.
    }
    setHydrated(true)
  }, [])

  // While untouched, keep the linked fields mirroring tax/budget.
  useEffect(() => {
    if (!hydrated || touched) return
    const { pension, ...rest } = derivedDefaults
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((p) => ({
      ...p,
      ...rest,
      pension: {
        ...p.pension,
        single: pension.single,
        person1: { ...p.pension.person1, ...pension.person1 },
        person2: { ...p.pension.person2, ...pension.person2 },
      },
    }))
  }, [hydrated, touched, derivedDefaults])

  // Persist once the user (or a restore) has taken ownership of the state.
  useEffect(() => {
    if (!hydrated || !touched) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Ignore storage write failures.
    }
  }, [state, hydrated, touched])

  // --- setters ------------------------------------------------------------
  const patch = (p: Partial<PlanningState>) => {
    setTouched(true)
    setState((prev) => ({ ...prev, ...p }))
  }

  const setAssumption = <K extends keyof PlanningAssumptions>(
    key: K,
    value: PlanningAssumptions[K]
  ) => {
    setTouched(true)
    setState((prev) => ({
      ...prev,
      assumptions: { ...prev.assumptions, [key]: value },
    }))
  }

  // Shared pension fields (return, payout years, household, folkepension flag).
  const setPension = <K extends keyof PensionState>(
    key: K,
    value: PensionState[K]
  ) => {
    setTouched(true)
    setState((prev) => ({
      ...prev,
      pension: { ...prev.pension, [key]: value },
    }))
  }

  // Tax profile (kommune, kirkeskat, rules year).
  const setTax = <K extends keyof PlanningTaxProfile>(
    key: K,
    value: PlanningTaxProfile[K]
  ) => {
    setTouched(true)
    setState((prev) => ({ ...prev, tax: { ...prev.tax, [key]: value } }))
  }

  // A single person's pension pot/contribution field.
  const setPensionPerson = <K extends keyof PensionPerson>(
    who: "person1" | "person2",
    key: K,
    value: PensionPerson[K]
  ) => {
    setTouched(true)
    setState((prev) => ({
      ...prev,
      pension: {
        ...prev.pension,
        [who]: { ...prev.pension[who], [key]: value },
      },
    }))
  }

  const addEvent = (event: NewPlanningEvent) => {
    setTouched(true)
    setState((prev) => ({
      ...prev,
      events: [...prev.events, { ...event, id: newEventId() } as PlanningEvent],
    }))
  }

  const updateEvent = (event: PlanningEvent) => {
    setTouched(true)
    setState((prev) => ({
      ...prev,
      events: prev.events.map((e) => (e.id === event.id ? event : e)),
    }))
  }

  const removeEvent = (id: string) => {
    setTouched(true)
    setState((prev) => ({ ...prev, events: prev.events.filter((e) => e.id !== id) }))
  }

  /** Re-pull the linked fields from the current tax/budget data. */
  const pullFromSources = () => {
    setTouched(true)
    const { pension, ...rest } = derivedDefaults
    setState((prev) => ({
      ...prev,
      ...rest,
      pension: {
        ...prev.pension,
        single: pension.single,
        person1: { ...prev.pension.person1, ...pension.person1 },
        person2: { ...prev.pension.person2, ...pension.person2 },
      },
    }))
  }

  return {
    state,
    /** True while the linked fields still mirror tax/budget. */
    linked: !touched,
    derivedDefaults,
    patch,
    setAssumption,
    setPension,
    setPensionPerson,
    setTax,
    addEvent,
    updateEvent,
    removeEvent,
    pullFromSources,
  }
}
