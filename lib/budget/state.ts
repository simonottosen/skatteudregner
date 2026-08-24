/**
 * Pure budget state: types, normalization and summary math. Lives outside the
 * React hook (`hooks/use-budget.ts`) so the same logic can run on the server
 * (the MCP tools) against the `budget_items` JSONB blob. No DOM/React.
 */

import {
  DEFAULT_CATEGORIES,
  UNCATEGORIZED_ID,
  guessCategory,
  type BudgetCategory,
} from "@/lib/budget/categories"
import {
  DEFAULT_MORTGAGE,
  mortgageMonthlyTotal,
  type MortgageState,
} from "@/lib/budget/mortgage"

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

/** Household composition used to benchmark spending against typical peers. */
export interface BudgetAssumptions {
  adults: number
  children: number
  cars: number
}

export interface BudgetState {
  version: 5
  mode: BudgetMode
  person1: PersonConfig
  person2: PersonConfig
  /** Shared expense list, used in "single" and "shared" modes. */
  sharedItems: BudgetItem[]
  /** Category definitions, shared across all expense lists. */
  categories: BudgetCategory[]
  /** Household assumptions for the peer comparison on the results page. */
  assumptions: BudgetAssumptions
  /** Realkredit mortgage — kept separate from the categorised expenses. */
  mortgage: MortgageState
}

export const DEFAULT_ASSUMPTIONS: BudgetAssumptions = {
  adults: 2,
  children: 0,
  cars: 1,
}

const DEFAULT_SHARED_ITEMS: Omit<BudgetItem, "id">[] = [
  { label: "Husleje / boliglån", amount: 0, categoryId: "bolig" },
  { label: "Mad og dagligvarer", amount: 0, categoryId: "mad" },
  { label: "Transport", amount: 0, categoryId: "transport" },
  { label: "Abonnementer", amount: 0, categoryId: "abonnementer" },
  { label: "Forsikringer", amount: 0, categoryId: "forsikring" },
]

let nextId = 1
export const newBudgetId = () => `b-${nextId++}-${Date.now()}`

function defaultPerson(name: string, incomeSource: IncomeSource): PersonConfig {
  return { name, incomeSource, manualIncome: 0, items: [] }
}

export function defaultBudgetState(): BudgetState {
  return {
    version: 5,
    mode: "single",
    person1: defaultPerson("Person 1", "skat"),
    person2: defaultPerson("Person 2", "manual"),
    sharedItems: DEFAULT_SHARED_ITEMS.map((i) => ({ ...i, id: newBudgetId() })),
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    mortgage: { ...DEFAULT_MORTGAGE },
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
        id: typeof o.id === "string" ? o.id : newBudgetId(),
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

function normalizeAssumptions(value: unknown): BudgetAssumptions {
  if (!value || typeof value !== "object") return { ...DEFAULT_ASSUMPTIONS }
  const o = value as Partial<BudgetAssumptions>
  const clamp = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(max, Math.max(min, Math.round(v)))
      : fallback
  return {
    adults: clamp(o.adults, DEFAULT_ASSUMPTIONS.adults, 1, 2),
    children: clamp(o.children, DEFAULT_ASSUMPTIONS.children, 0, 10),
    cars: clamp(o.cars, DEFAULT_ASSUMPTIONS.cars, 0, 4),
  }
}

function normalizeMortgage(value: unknown): MortgageState {
  if (!value || typeof value !== "object") return { ...DEFAULT_MORTGAGE }
  const o = value as Partial<MortgageState>
  const numOr = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(max, Math.max(min, v))
      : fallback
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : false,
    homeValue: numOr(o.homeValue, 0, 0, 1e9),
    remainingYears: numOr(o.remainingYears, DEFAULT_MORTGAGE.remainingYears, 1, 40),
    ltv: numOr(o.ltv, DEFAULT_MORTGAGE.ltv, 0, 1),
    interestRate: numOr(o.interestRate, DEFAULT_MORTGAGE.interestRate, 0, 0.2),
    bidragssats: numOr(o.bidragssats, DEFAULT_MORTGAGE.bidragssats, 0, 0.05),
    interestOnly: typeof o.interestOnly === "boolean" ? o.interestOnly : false,
  }
}

/** Accepts the legacy array shape, the v2 object shape, and v3–v5. */
export function normalizeBudget(raw: unknown): BudgetState {
  const base = defaultBudgetState()
  if (Array.isArray(raw)) {
    return { ...base, sharedItems: asItems(raw) }
  }
  if (raw && typeof raw === "object") {
    const o = raw as Partial<BudgetState>
    return {
      version: 5,
      mode: o.mode === "shared" || o.mode === "separate" ? o.mode : "single",
      person1: normalizePerson(o.person1, base.person1),
      person2: normalizePerson(o.person2, base.person2),
      sharedItems: o.sharedItems ? asItems(o.sharedItems) : base.sharedItems,
      categories: normalizeCategories(o.categories),
      assumptions: normalizeAssumptions(o.assumptions),
      mortgage: normalizeMortgage(o.mortgage),
    }
  }
  return base
}

// --- summary math (shared by the hook + the MCP) --------------------------

const sumItems = (items: BudgetItem[]) => items.reduce((s, i) => s + (i.amount || 0), 0)

const incomeOf = (person: PersonConfig, skatNet: number) =>
  person.incomeSource === "skat" ? skatNet : person.manualIncome

export interface BudgetSummary {
  mode: BudgetMode
  p1Income: number
  p2Income: number
  sharedTotal: number
  p1Total: number
  p2Total: number
  mortgageMonthly: number
  /** Household monthly income (both people unless single). */
  budgetIncome: number
  /** Household monthly expenses (per the mode), excluding the mortgage. */
  budgetExpenses: number
  /** Income − expenses − mortgage (monthly); negative when overspending. */
  remaining: number
  /** remaining / income; negative when overspending. */
  savingsRate: number
}

/**
 * Monthly budget figures. `p1Net`/`p2Net` are each person's monthly take-home
 * (used when their income source is the tax page rather than a manual amount).
 */
export function computeBudgetSummary(
  state: BudgetState,
  p1Net: number,
  p2Net: number
): BudgetSummary {
  const p1Income = incomeOf(state.person1, p1Net)
  const p2Income = incomeOf(state.person2, p2Net)
  const sharedTotal = sumItems(state.sharedItems)
  const p1Total = sumItems(state.person1.items)
  const p2Total = sumItems(state.person2.items)
  const mortgageMonthly = mortgageMonthlyTotal(state.mortgage)

  const twoPeople = state.mode !== "single"
  const budgetIncome = twoPeople ? p1Income + p2Income : p1Income
  const budgetExpenses = state.mode === "separate" ? p1Total + p2Total : sharedTotal
  // The realkredit payment sits outside the categorised expense lines but is a
  // real outflow, so it comes off the surplus. /planlaegning has always netted
  // it out; /resultat used to not, and the two pages disagreed by exactly this.
  const remaining = budgetIncome - budgetExpenses - mortgageMonthly
  const savingsRate = budgetIncome > 0 ? remaining / budgetIncome : 0

  return {
    mode: state.mode,
    p1Income,
    p2Income,
    sharedTotal,
    p1Total,
    p2Total,
    mortgageMonthly,
    budgetIncome,
    budgetExpenses,
    remaining,
    savingsRate,
  }
}

/** Per-category expense totals for the active expense list(s). */
export function expensesByCategory(
  state: BudgetState
): { categoryId: string; name: string; total: number }[] {
  const items =
    state.mode === "separate"
      ? [...state.person1.items, ...state.person2.items]
      : state.sharedItems
  const byId = new Map<string, number>()
  for (const i of items) byId.set(i.categoryId, (byId.get(i.categoryId) ?? 0) + (i.amount || 0))
  return state.categories
    .map((c) => ({ categoryId: c.id, name: c.name, total: byId.get(c.id) ?? 0 }))
    .filter((c) => c.total !== 0)
}

// --- result (Resultat page) math ------------------------------------------

interface TaxResultLike {
  amBasis: number
  insuranceBasis: number
  nonAmIncome: number
  totalTax: number
  netIncome: number
}

export interface ResultSummary {
  grossYear: number
  taxYear: number
  netYear: number
  effectiveRate: number
  grossMonthly: number
  taxMonthly: number
  netMonthly: number
}

/** Combined annual/monthly tax figures across the household's people. */
export function computeResultSummary(taxResults: TaxResultLike[]): ResultSummary {
  const grossYear = taxResults.reduce(
    (s, r) => s + r.amBasis + r.insuranceBasis + r.nonAmIncome,
    0
  )
  const taxYear = taxResults.reduce((s, r) => s + r.totalTax, 0)
  const netYear = taxResults.reduce((s, r) => s + r.netIncome, 0)
  const effectiveRate = grossYear > 0 ? taxYear / grossYear : 0
  return {
    grossYear,
    taxYear,
    netYear,
    effectiveRate,
    grossMonthly: grossYear / 12,
    taxMonthly: taxYear / 12,
    netMonthly: netYear / 12,
  }
}
