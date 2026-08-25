/**
 * Figures and copy for the budget page's savings breakdown.
 *
 * Lives here rather than in `components/budget/budget-planner.tsx` because the
 * test setup only collects `.ts` — anything with branching in it has to be
 * reachable by a test.
 */

import { formatDKK } from "@/lib/format"
import type { CategoryKind } from "@/lib/budget/categories"
import type { BudgetSummary } from "@/lib/budget/state"

/** Labels for the per-category kind picker. Exhaustive by construction. */
export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  expense: "Forbrug",
  savings: "Opsparing",
  sinking: "Hensættelse",
}

export interface SavingsFigure {
  label: string
  amount: number
  /** The headline of the block. */
  highlight?: boolean
}

export interface SavingsBreakdownView {
  figures: SavingsFigure[]
  notes: string[]
}

/**
 * Returns `null` when nothing is tagged as savings or a sinking fund: the
 * breakdown would then just restate "Til rådighed" under new labels, and a
 * household that never told us what its savings line is should not be shown a
 * number implying we know.
 */
export function savingsBreakdownView(
  s: BudgetSummary
): SavingsBreakdownView | null {
  if (s.allocatedSavings <= 0 && s.sinkingFunds <= 0) return null

  const figures: SavingsFigure[] = [
    {
      label: s.mortgageMonthly > 0 ? "Forbrug (inkl. lån)" : "Forbrug",
      amount: s.consumptionExpenses + s.mortgageMonthly,
    },
  ]
  if (s.sinkingFunds > 0)
    figures.push({ label: "Hensat til kendte udgifter", amount: s.sinkingFunds })
  if (s.allocatedSavings > 0)
    figures.push({ label: "Afsat til opsparing", amount: s.allocatedSavings })
  figures.push({
    label: "Reel opsparing / md.",
    amount: s.totalSavings,
    highlight: true,
  })

  const notes = [
    "Opsparing er ikke forbrug. Den tælles derfor ikke med i forbruget, men " +
      "lægges til det, du har tilbage — «Reel opsparing» er det beløb, du " +
      "faktisk lægger til side hver måned.",
  ]
  if (s.sinkingFunds > 0)
    notes.push(
      `Af de ${formatDKK(s.surplus)}, du ikke bruger, er ` +
        `${formatDKK(s.sinkingFunds)} hensat til kendte udgifter (fx ` +
        "bilreparation og tandlæge). De er hverken forbrug eller opsparing."
    )
  if (s.allocatedSavings > 0)
    notes.push(
      "Opsparingsraten på Resultat regner fortsat opsparing som en udgift og " +
        "er derfor lavere end den reelle opsparing."
    )
  return { figures, notes }
}
