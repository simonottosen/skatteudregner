/**
 * How a couple's savings is attributed between joint and personal goals.
 *
 * A separate axis from `BudgetState.mode` on purpose. That governs how the
 * *budget* is shared, and the two are changed independently: a couple can split
 * every bill down the middle and still save entirely towards one joint goal, or
 * keep separate accounts and still run a shared holiday fund. Overloading
 * `mode` would force one choice to imply the other.
 *
 * The attribution only ever divides the household figure the summary already
 * produced — it never changes it. That is what lets the /planlaegning page
 * report per-person numbers off a single Monte Carlo run instead of simulating
 * each person separately, which would double the cost of a `useMemo` that fires
 * on every keystroke.
 */

import type { BudgetItem, BudgetState, BudgetSummary } from "@/lib/budget/state"

export type SavingsSplit = "with-expenses" | "shared" | "individual"

export const SAVINGS_SPLITS: readonly SavingsSplit[] = [
  "with-expenses",
  "shared",
  "individual",
]

/**
 * Reproduces the behaviour from before the block existed, so a budget that
 * never carried one is unaffected.
 */
export const DEFAULT_SAVINGS_SPLIT: SavingsSplit = "with-expenses"

export function isSavingsSplit(value: unknown): value is SavingsSplit {
  return (
    typeof value === "string" &&
    (SAVINGS_SPLITS as readonly string[]).includes(value)
  )
}

/** A monthly kroner amount per person. */
export interface SavingsAllocation {
  p1: number
  p2: number
}

export interface SavingsConfig {
  split: SavingsSplit
  /** Monthly amount put towards joint goals under the "individual" split. */
  sharedPortion?: number
  /** Each person's own monthly saving. Only read once {@link manual} is set. */
  allocation?: SavingsAllocation
  /**
   * True once the couple has stated two separate amounts. Until then the
   * non-shared part is halved, so the figures keep following the budget rather
   * than freezing at whatever they happened to be when the split was picked.
   */
  manual?: boolean
}

const amountOr = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback

/**
 * Builds a config from a partially-trusted object. Optional keys are only
 * written when present, so a budget that has never used them persists the same
 * minimal blob it did before.
 */
function readSavings(raw: Partial<SavingsConfig>): SavingsConfig {
  const config: SavingsConfig = {
    split: isSavingsSplit(raw.split) ? raw.split : DEFAULT_SAVINGS_SPLIT,
  }
  if (typeof raw.sharedPortion === "number" && Number.isFinite(raw.sharedPortion))
    config.sharedPortion = Math.max(0, raw.sharedPortion)
  if (raw.allocation && typeof raw.allocation === "object")
    config.allocation = {
      p1: amountOr(raw.allocation.p1),
      p2: amountOr(raw.allocation.p2),
    }
  if (raw.manual === true) config.manual = true
  return config
}

/**
 * Absent stays absent: writing a default block for every budget on load would
 * rewrite the persisted blob of households that never asked for one, for no
 * change in any figure.
 */
export function normalizeSavings(raw: unknown): SavingsConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined
  return readSavings(raw as Partial<SavingsConfig>)
}

/** Applies a UI edit to the (possibly absent) block. */
export function withSavingsPatch(
  current: SavingsConfig | undefined,
  patch: Partial<SavingsConfig>
): SavingsConfig {
  return readSavings({ split: DEFAULT_SAVINGS_SPLIT, ...current, ...patch })
}

export interface SavingsAttribution {
  split: SavingsSplit
  /** True when the per-person amounts were stated rather than derived. */
  manual: boolean
  /** The pot being divided — always `BudgetSummary.totalSavings`. */
  total: number
  /** Saved towards joint goals. */
  shared: number
  p1: number
  p2: number
  /**
   * `total − shared − p1 − p2`. Positive when the couple has not earmarked
   * everything they save, negative when they have promised more than the
   * budget produces. Never silently absorbed into one of the other buckets:
   * hiding it is how a plan comes to claim savings the household has not got.
   */
  unallocated: number
}

/**
 * The edit behind "we each put aside a different amount".
 *
 * Turning it on seeds the two fields from the even split the couple was
 * already being shown, rather than from zero — starting at zero would read as
 * if the savings had just vanished. Amounts already stated once are kept, so
 * toggling the box off and on again does not discard them.
 */
export function statedSavingsPatch(
  current: SavingsConfig | undefined,
  enabled: boolean,
  attribution: SavingsAttribution
): Partial<SavingsConfig> {
  if (!enabled) return { manual: false }
  return {
    manual: true,
    allocation: current?.allocation ?? {
      p1: amountOr(Math.round(attribution.p1)),
      p2: amountOr(Math.round(attribution.p2)),
    },
  }
}

/** Consumption + sinking funds — everything that is not tagged as savings. */
function nonSavingsOutflow(items: BudgetItem[], savingsCategories: Set<string>) {
  return items.reduce(
    (sum, i) => (savingsCategories.has(i.categoryId) ? sum : sum + (i.amount || 0)),
    0
  )
}

/**
 * Divides `summary.totalSavings` into a joint share and one per person.
 *
 * `shared + p1 + p2 + unallocated` always equals `total`, whichever split is
 * active — that invariant is what keeps the per-person figures reconcilable
 * with the household ones on the same page.
 */
export function attributeSavings(
  state: BudgetState,
  summary: BudgetSummary
): SavingsAttribution {
  const total = summary.totalSavings
  const split = state.savings?.split ?? DEFAULT_SAVINGS_SPLIT
  const manual = state.savings?.manual === true
  const base = { split, manual, total }

  // One person has nobody to share with, whatever the block happens to say.
  if (state.mode === "single")
    return { ...base, shared: 0, p1: total, p2: 0, unallocated: 0 }

  if (split === "individual") {
    const shared = amountOr(state.savings?.sharedPortion)
    if (manual) {
      const p1 = amountOr(state.savings?.allocation?.p1)
      const p2 = amountOr(state.savings?.allocation?.p2)
      return { ...base, shared, p1, p2, unallocated: total - shared - p1 - p2 }
    }
    const each = (total - shared) / 2
    return { ...base, shared, p1: each, p2: each, unallocated: 0 }
  }

  // "shared", and "with-expenses" over a shared expense list: one joint pot.
  if (split === "shared" || state.mode === "shared")
    return { ...base, shared: total, p1: 0, p2: 0, unallocated: 0 }

  // "with-expenses" over separate expense lists: each keeps their own leftover.
  const savingsCategories = new Set(
    state.categories.filter((c) => c.kind === "savings").map((c) => c.id)
  )
  // The realkredit payment is a joint obligation with no stated split, so half
  // is charged to each person here. The per-person expense cards deliberately
  // leave it unallocated instead; a savings figure cannot do the same, because
  // then the two people's savings would not add up to the household's.
  const half = summary.mortgageMonthly / 2
  const p1 =
    summary.p1Income - nonSavingsOutflow(state.person1.items, savingsCategories) - half
  const p2 =
    summary.p2Income - nonSavingsOutflow(state.person2.items, savingsCategories) - half
  return { ...base, shared: 0, p1, p2, unallocated: total - p1 - p2 }
}
