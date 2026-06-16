"use client"

import { useEffect, useMemo, useState } from "react"
import { useRemoteSync } from "@/hooks/use-remote-sync"
import { useTax } from "@/components/tax-provider"
import { useBudget } from "@/components/budget-provider"
import { estimateMortgage } from "@/lib/budget/generate-budget"
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PLANNING_STATE,
  type NewPlanningEvent,
  type PlanningAssumptions,
  type PlanningEvent,
  type PlanningState,
} from "@/lib/planning/types"

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

function normalizePlanning(raw: unknown): PlanningState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PLANNING_STATE }
  const o = raw as Partial<PlanningState>
  const currentAge = clampNum(o.currentAge, DEFAULT_PLANNING_STATE.currentAge, 0, 100)
  const endAge = clampNum(o.endAge, DEFAULT_PLANNING_STATE.endAge, currentAge + 1, 120)
  return {
    version: 1,
    currentAge,
    endAge,
    goalAge: clampNum(o.goalAge, DEFAULT_PLANNING_STATE.goalAge, currentAge, endAge),
    startInvestments: clampNum(o.startInvestments, 0, 0),
    homeValue: clampNum(o.homeValue, 0, 0),
    mortgageBalance: clampNum(o.mortgageBalance, 0, 0),
    monthlyContribution: clampNum(o.monthlyContribution, 0, 0),
    annualSpending: clampNum(o.annualSpending, 0, 0),
    assumptions: normalizeAssumptions(o.assumptions),
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
    return {
      monthlyContribution: remaining,
      annualSpending: Math.round(budgetExpenses * 12),
      homeValue: Math.round(input.property?.propertyValue ?? 0),
      mortgageBalance: Math.round(
        estimateMortgage(input.mortgageInterest || 0).principal
      ),
      currentAge: ageFromBirthDate(input.birthDate) ?? DEFAULT_PLANNING_STATE.currentAge,
    }
  }, [
    budgetIncome,
    budgetExpenses,
    input.property?.propertyValue,
    input.mortgageInterest,
    input.birthDate,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((p) => ({ ...p, ...derivedDefaults }))
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
    setState((prev) => ({ ...prev, ...derivedDefaults }))
  }

  return {
    state,
    /** True while the linked fields still mirror tax/budget. */
    linked: !touched,
    derivedDefaults,
    patch,
    setAssumption,
    addEvent,
    updateEvent,
    removeEvent,
    pullFromSources,
  }
}
