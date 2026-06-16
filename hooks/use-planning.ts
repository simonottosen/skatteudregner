"use client"

import { useEffect, useMemo, useState } from "react"
import { useRemoteSync } from "@/hooks/use-remote-sync"
import { useTax } from "@/components/tax-provider"
import { useBudget } from "@/components/budget-provider"
import { estimateMortgage } from "@/lib/budget/generate-budget"
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PENSION,
  DEFAULT_PLANNING_STATE,
  type NewPlanningEvent,
  type PensionState,
  type PlanningAssumptions,
  type PlanningEvent,
  type PlanningState,
} from "@/lib/planning/types"
import { folkepensionAge } from "@/lib/planning/pension"

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

function normalizePension(value: unknown): PensionState {
  if (!value || typeof value !== "object") return { ...DEFAULT_PENSION }
  const o = value as Partial<PensionState>
  return {
    ratepensionBalance: clampNum(o.ratepensionBalance, 0, 0),
    livrenteBalance: clampNum(o.livrenteBalance, 0, 0),
    aldersopsparingBalance: clampNum(o.aldersopsparingBalance, 0, 0),
    ratepensionAnnual: clampNum(o.ratepensionAnnual, 0, 0),
    livrenteAnnual: clampNum(o.livrenteAnnual, 0, 0),
    aldersopsparingAnnual: clampNum(o.aldersopsparingAnnual, 0, 0),
    pensionReturn: clampNum(o.pensionReturn, DEFAULT_PENSION.pensionReturn, -1, 1),
    ratepensionYears: clampNum(o.ratepensionYears, DEFAULT_PENSION.ratepensionYears, 1, 40),
    folkepensionAge: clampNum(o.folkepensionAge, DEFAULT_PENSION.folkepensionAge, 60, 75),
    single: typeof o.single === "boolean" ? o.single : DEFAULT_PENSION.single,
    includeFolkepension:
      typeof o.includeFolkepension === "boolean"
        ? o.includeFolkepension
        : DEFAULT_PENSION.includeFolkepension,
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
    homeValue: clampNum(o.homeValue, 0, 0),
    mortgageBalance: clampNum(o.mortgageBalance, 0, 0),
    monthlyContribution: clampNum(o.monthlyContribution, 0, 0),
    annualSpending: clampNum(o.annualSpending, 0, 0),
    assumptions: normalizeAssumptions(o.assumptions),
    pension: normalizePension(o.pension),
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

  const derivedDefaults = useMemo(() => {
    const remaining = Math.max(0, Math.round(budgetIncome - budgetExpenses))
    const currentAge =
      ageFromBirthDate(input.birthDate) ?? DEFAULT_PLANNING_STATE.currentAge
    const birthYear = new Date().getFullYear() - currentAge
    return {
      monthlyContribution: remaining,
      annualSpending: Math.round(budgetExpenses * 12),
      homeValue: Math.round(input.property?.propertyValue ?? 0),
      mortgageBalance: Math.round(
        estimateMortgage(input.mortgageInterest || 0).principal
      ),
      currentAge,
      pension: {
        ratepensionAnnual: Math.round(input.privatePensionRatepension || 0),
        livrenteAnnual: Math.round(input.privatePensionLivrente || 0),
        single: budget.state.mode === "single",
        folkepensionAge: folkepensionAge(birthYear),
      },
    }
  }, [
    budgetIncome,
    budgetExpenses,
    input.property?.propertyValue,
    input.mortgageInterest,
    input.birthDate,
    input.privatePensionRatepension,
    input.privatePensionLivrente,
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
    setState((p) => ({ ...p, ...rest, pension: { ...p.pension, ...pension } }))
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
      pension: { ...prev.pension, ...pension },
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
    addEvent,
    updateEvent,
    removeEvent,
    pullFromSources,
  }
}
