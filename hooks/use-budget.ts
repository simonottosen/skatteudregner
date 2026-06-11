"use client"

import { useEffect, useMemo, useState } from "react"
import { useRemoteSync } from "@/hooks/use-remote-sync"
import { useTax } from "@/components/tax-provider"
import {
  DEFAULT_CATEGORIES,
  UNCATEGORIZED_ID,
  guessCategory,
  type BudgetCategory,
} from "@/lib/budget/categories"

export type { BudgetCategory }

export interface BudgetItem {
  id: string
  label: string
  amount: number
  categoryId: string
}

/** Household layout. */
export type BudgetMode = "single" | "shared" | "separate"
/** Where a person's monthly net income comes from. */
export type IncomeSource = "skat" | "manual"
/** Which expense list an action targets. */
export type ExpenseList = "shared" | "p1" | "p2"

export interface PersonConfig {
  name: string
  incomeSource: IncomeSource
  manualIncome: number
  /** Used only in "separate" mode. */
  items: BudgetItem[]
}

export interface BudgetState {
  version: 3
  mode: BudgetMode
  person1: PersonConfig
  person2: PersonConfig
  /** Shared expense list, used in "single" and "shared" modes. */
  sharedItems: BudgetItem[]
  /** Category definitions, shared across all expense lists. */
  categories: BudgetCategory[]
}

const STORAGE_KEY = "skatteberegner:budget-items"

const DEFAULT_SHARED_ITEMS: Omit<BudgetItem, "id">[] = [
  { label: "Husleje / boliglån", amount: 0, categoryId: "bolig" },
  { label: "Mad og dagligvarer", amount: 0, categoryId: "mad" },
  { label: "Transport", amount: 0, categoryId: "transport" },
  { label: "Abonnementer", amount: 0, categoryId: "abonnementer" },
  { label: "Forsikringer", amount: 0, categoryId: "forsikring" },
]

let nextId = 1
const newId = () => `b-${nextId++}-${Date.now()}`

function defaultPerson(name: string, incomeSource: IncomeSource): PersonConfig {
  return { name, incomeSource, manualIncome: 0, items: [] }
}

function defaultState(): BudgetState {
  return {
    version: 3,
    mode: "single",
    person1: defaultPerson("Person 1", "skat"),
    person2: defaultPerson("Person 2", "manual"),
    sharedItems: DEFAULT_SHARED_ITEMS.map((i) => ({ ...i, id: newId() })),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  }
}

function asItems(value: unknown): BudgetItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((i) => i && typeof i === "object")
    .map((i) => {
      const o = i as Partial<BudgetItem>
      const label = typeof o.label === "string" ? o.label : ""
      return {
        id: typeof o.id === "string" ? o.id : newId(),
        label,
        amount: typeof o.amount === "number" ? o.amount : 0,
        categoryId:
          typeof o.categoryId === "string" ? o.categoryId : guessCategory(label),
      }
    })
}

function normalizePerson(value: unknown, fallback: PersonConfig): PersonConfig {
  if (!value || typeof value !== "object") return fallback
  const o = value as Partial<PersonConfig>
  return {
    name: typeof o.name === "string" ? o.name : fallback.name,
    incomeSource: o.incomeSource === "skat" ? "skat" : "manual",
    manualIncome: typeof o.manualIncome === "number" ? o.manualIncome : 0,
    items: asItems(o.items),
  }
}

function normalizeCategories(value: unknown): BudgetCategory[] {
  let cats: BudgetCategory[] = Array.isArray(value)
    ? value
        .filter(
          (c): c is BudgetCategory =>
            !!c &&
            typeof c === "object" &&
            typeof (c as BudgetCategory).id === "string" &&
            typeof (c as BudgetCategory).name === "string"
        )
        .map((c) => ({ id: c.id, name: c.name }))
    : []
  if (cats.length === 0) cats = DEFAULT_CATEGORIES.map((c) => ({ ...c }))
  // The catch-all must always exist.
  if (!cats.some((c) => c.id === UNCATEGORIZED_ID)) {
    cats = [...cats, { id: UNCATEGORIZED_ID, name: "Øvrigt" }]
  }
  return cats
}

/** Accepts the legacy array shape, the v2 object shape, and v3. */
function normalizeBudget(raw: unknown): BudgetState {
  const base = defaultState()
  if (Array.isArray(raw)) {
    return { ...base, sharedItems: asItems(raw) }
  }
  if (raw && typeof raw === "object") {
    const o = raw as Partial<BudgetState>
    return {
      version: 3,
      mode: o.mode === "shared" || o.mode === "separate" ? o.mode : "single",
      person1: normalizePerson(o.person1, base.person1),
      person2: normalizePerson(o.person2, base.person2),
      sharedItems: o.sharedItems ? asItems(o.sharedItems) : base.sharedItems,
      categories: normalizeCategories(o.categories),
    }
  }
  return base
}

/**
 * Owns the budget state. Use it once (via {@link BudgetProvider}) so the whole
 * app shares a single instance — don't call it directly in pages/components.
 */
export function useBudgetController() {
  const { monthlyNetIncome, person2MonthlyNetIncome } = useTax()
  const [state, setState] = useState<BudgetState>(defaultState)
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

  // --- derived values -----------------------------------------------------
  const incomeOf = (person: PersonConfig, skatNet: number) =>
    person.incomeSource === "skat" ? skatNet : person.manualIncome

  const derived = useMemo(() => {
    const p1Income = incomeOf(state.person1, monthlyNetIncome)
    const p2Income = incomeOf(state.person2, person2MonthlyNetIncome)
    const sumItems = (items: BudgetItem[]) =>
      items.reduce((s, i) => s + (i.amount || 0), 0)

    const sharedTotal = sumItems(state.sharedItems)
    const p1Total = sumItems(state.person1.items)
    const p2Total = sumItems(state.person2.items)

    return { p1Income, p2Income, sharedTotal, p1Total, p2Total }
  }, [state, monthlyNetIncome, person2MonthlyNetIncome])

  return {
    state,
    monthlyNetIncome,
    person2MonthlyNetIncome,
    ...derived,
    setMode,
    setPersonField,
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
