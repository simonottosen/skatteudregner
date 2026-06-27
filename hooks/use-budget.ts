"use client"

import { useEffect, useMemo, useState } from "react"
import { useRemoteSync } from "@/hooks/use-remote-sync"
import { useTax } from "@/components/tax-provider"
import { UNCATEGORIZED_ID } from "@/lib/budget/categories"
import type { MortgageState } from "@/lib/budget/mortgage"
import {
  computeBudgetSummary,
  defaultBudgetState,
  newBudgetId as newId,
  normalizeBudget,
  type BudgetAssumptions,
  type BudgetCategory,
  type BudgetItem,
  type BudgetMode,
  type BudgetState,
  type ExpenseList,
  type IncomeSource,
  type PersonConfig,
} from "@/lib/budget/state"

// Re-export the budget types so existing importers of "@/hooks/use-budget"
// keep working (the definitions now live in the pure "@/lib/budget/state").
export type {
  BudgetCategory,
  BudgetItem,
  BudgetMode,
  IncomeSource,
  ExpenseList,
  PersonConfig,
  BudgetAssumptions,
  BudgetState,
}

const STORAGE_KEY = "skatteberegner:budget-items"

/**
 * Owns the budget state. Use it once (via {@link BudgetProvider}) so the whole
 * app shares a single instance — don't call it directly in pages/components.
 */
export function useBudgetController() {
  const { monthlyNetIncome, person2MonthlyNetIncome } = useTax()
  const [state, setState] = useState<BudgetState>(defaultBudgetState)
  // Becomes true once the persisted value has been restored. Gating writes on
  // this prevents the initial default state from clobbering saved data before
  // the restore effect's setState has been applied.
  const [hydrated, setHydrated] = useState(false)

  // Sync to Supabase when signed in (debounced + flush on leave).
  useRemoteSync<BudgetState>("budget_items", state, (remote) =>
    setState(normalizeBudget(remote))
  )

  // Restore persisted state once on mount (migrating older shapes).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setState(normalizeBudget(JSON.parse(raw)))
    } catch {
      // Ignore malformed/unavailable storage.
    }
    setHydrated(true)
  }, [])

  // Persist after the persisted value has been restored.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Ignore storage write failures.
    }
  }, [state, hydrated])

  // --- list helpers -------------------------------------------------------
  function mapList(
    list: ExpenseList,
    fn: (items: BudgetItem[]) => BudgetItem[]
  ) {
    setState((prev) => {
      if (list === "shared") return { ...prev, sharedItems: fn(prev.sharedItems) }
      if (list === "p1")
        return { ...prev, person1: { ...prev.person1, items: fn(prev.person1.items) } }
      return { ...prev, person2: { ...prev.person2, items: fn(prev.person2.items) } }
    })
  }

  const addItem = (list: ExpenseList, categoryId: string = UNCATEGORIZED_ID) =>
    mapList(list, (items) => [
      ...items,
      { id: newId(), label: "", amount: 0, categoryId },
    ])

  const updateItem = (
    list: ExpenseList,
    id: string,
    field: "label" | "amount",
    value: string | number
  ) =>
    mapList(list, (items) =>
      items.map((i) => (i.id === id ? { ...i, [field]: value } : i))
    )

  const removeItem = (list: ExpenseList, id: string) =>
    mapList(list, (items) => items.filter((i) => i.id !== id))

  const setItemCategory = (list: ExpenseList, id: string, categoryId: string) =>
    mapList(list, (items) =>
      items.map((i) => (i.id === id ? { ...i, categoryId } : i))
    )

  const replaceItems = (
    list: ExpenseList,
    next: { label: string; amount: number; category?: string }[]
  ) =>
    mapList(list, () =>
      next.map((item) => ({
        id: newId(),
        label: item.label,
        amount: item.amount,
        categoryId: item.category ?? UNCATEGORIZED_ID,
      }))
    )

  // --- category helpers ---------------------------------------------------
  const addCategory = (name: string) =>
    setState((p) => ({
      ...p,
      categories: [...p.categories, { id: `cat-${newId()}`, name }],
    }))

  const renameCategory = (id: string, name: string) =>
    setState((p) => ({
      ...p,
      categories: p.categories.map((c) => (c.id === id ? { ...c, name } : c)),
    }))

  const removeCategory = (id: string) =>
    setState((p) => {
      if (id === UNCATEGORIZED_ID) return p
      const reassign = (items: BudgetItem[]) =>
        items.map((i) =>
          i.categoryId === id ? { ...i, categoryId: UNCATEGORIZED_ID } : i
        )
      return {
        ...p,
        categories: p.categories.filter((c) => c.id !== id),
        sharedItems: reassign(p.sharedItems),
        person1: { ...p.person1, items: reassign(p.person1.items) },
        person2: { ...p.person2, items: reassign(p.person2.items) },
      }
    })

  // --- config setters -----------------------------------------------------
  const setMode = (mode: BudgetMode) => setState((p) => ({ ...p, mode }))

  const setPersonField = <K extends keyof PersonConfig>(
    person: "person1" | "person2",
    field: K,
    value: PersonConfig[K]
  ) => setState((p) => ({ ...p, [person]: { ...p[person], [field]: value } }))

  const setAssumptions = (assumptions: BudgetAssumptions) =>
    setState((p) => ({ ...p, assumptions }))

  const setMortgage = (patch: Partial<MortgageState>) =>
    setState((p) => ({ ...p, mortgage: { ...p.mortgage, ...patch } }))

  // --- derived values -----------------------------------------------------
  const derived = useMemo(
    () => computeBudgetSummary(state, monthlyNetIncome, person2MonthlyNetIncome),
    [state, monthlyNetIncome, person2MonthlyNetIncome]
  )

  return {
    state,
    monthlyNetIncome,
    person2MonthlyNetIncome,
    ...derived,
    setMode,
    setPersonField,
    setAssumptions,
    setMortgage,
    addItem,
    updateItem,
    removeItem,
    setItemCategory,
    replaceItems,
    addCategory,
    renameCategory,
    removeCategory,
  }
}
