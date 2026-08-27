"use client"

import { useEffect, useMemo, useState } from "react"
import { useRemoteSync } from "@/hooks/use-remote-sync"
import { useTax } from "@/components/tax-provider"
import { useBudget } from "@/components/budget-provider"
import { estimateMortgage } from "@/lib/budget/generate-budget"
import { computeMortgage } from "@/lib/budget/mortgage"
import { planningContribution } from "@/lib/budget/state"
import {
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
} from "@/lib/planning/types"
import {
  applyDerivedDefaults,
  mortgageFromBudget,
  type PlanningDerivedDefaults,
} from "@/lib/planning/from-budget"
import { newId, normalizePlanning } from "@/lib/planning/normalize"
import { planningSavingsSplit } from "@/lib/planning/summary"
import { folkepensionAge } from "@/lib/planning/pension"
import { getMunicipality } from "@/lib/tax/municipalities"

const STORAGE_KEY = "skatteberegner:planning"

const newEventId = () => newId("pe")

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

  // Values inferred from the tax + budget pages. The surplus and the expense
  // total come off the shared budget summary rather than being derived a second
  // time here — /resultat reads that same object, and re-deriving it is how the
  // two pages came to disagree in the first place (issue #2).
  const {
    budgetExpenses,
    remaining: budgetRemaining,
    savingsAttribution,
    mortgageMonthly,
  } = budget

  const mortgage = budget.state.mortgage

  // Annotated so the returned literal is checked against the plan's own fields:
  // a key that is not one (`home` and `pension` aside) is a compile error here
  // rather than a stray property that reaches localStorage.
  const derivedDefaults = useMemo<PlanningDerivedDefaults>(() => {
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
      monthlyContribution: planningContribution(budgetRemaining),
      annualSpending: Math.round(budgetExpenses * 12),
      home: { value: homeValue, landValue },
      mortgageBalance,
      mortgageRate: mortgage.enabled
        ? mortgage.interestRate
        : DEFAULT_PLANNING_STATE.mortgageRate,
      mortgageTermYears: mortgage.enabled
        ? mortgage.remainingYears
        : DEFAULT_PLANNING_STATE.mortgageTermYears,
      // What the budget really held back, straight off the shared summary — not
      // what the loan above would cost. The module is off by default, and then
      // `remaining` is gross of whatever the household pays its lender even
      // though `mortgageBalance` was inferred from the /skat interest.
      ...mortgageFromBudget(mortgage, mortgageMonthly),
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
    budgetRemaining,
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

  // Divides the projection's input; it never triggers a second simulation. See
  // `planningSavingsSplit` for why the split is displayed rather than projected.
  const savingsSplit = useMemo(
    () =>
      planningSavingsSplit({
        attribution: savingsAttribution,
        mode: budget.state.mode,
        p1Name: budget.state.person1.name,
        p2Name: budget.state.person2.name,
        mortgageMonthly,
        monthlyContribution: state.monthlyContribution,
      }),
    [
      savingsAttribution,
      budget.state.mode,
      budget.state.person1.name,
      budget.state.person2.name,
      mortgageMonthly,
      state.monthlyContribution,
    ]
  )

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
    setState((p) => applyDerivedDefaults(p, derivedDefaults))
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

  // --- scenarios ----------------------------------------------------------
  const addScenario = (name: string, changes: ScenarioChanges) => {
    setTouched(true)
    const scenario: PlanningScenario = {
      id: newId("sc"),
      name: name.trim() || "Scenarie",
      createdAt: new Date().toISOString(),
      changes,
    }
    setState((prev) => ({ ...prev, scenarios: [...prev.scenarios, scenario] }))
    return scenario
  }

  const updateScenario = (
    id: string,
    patch: Partial<Pick<PlanningScenario, "name" | "changes">>
  ) => {
    setTouched(true)
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    }))
  }

  const removeScenario = (id: string) => {
    setTouched(true)
    setState((prev) => ({
      ...prev,
      scenarios: prev.scenarios.filter((s) => s.id !== id),
    }))
  }

  /** Re-pull the linked fields from the current tax/budget data. */
  const pullFromSources = () => {
    setTouched(true)
    setState((prev) => applyDerivedDefaults(prev, derivedDefaults))
  }

  return {
    state,
    /** True while the linked fields still mirror tax/budget. */
    linked: !touched,
    derivedDefaults,
    /**
     * The budget's monthly surplus, unclamped — negative when the household
     * overspends. `derivedDefaults.monthlyContribution` floors at zero for the
     * simulator, so this is the only place a deficit survives for the UI to
     * report. Without it a household in the red would be shown a projection
     * built on a saving of zero and no hint that the premise is impossible.
     */
    budgetRemaining,
    /** The joint/personal savings breakdown; null when there is none to show. */
    savingsSplit,
    patch,
    setAssumption,
    setPension,
    setPensionPerson,
    setTax,
    addEvent,
    updateEvent,
    removeEvent,
    addScenario,
    updateScenario,
    removeScenario,
    pullFromSources,
  }
}
