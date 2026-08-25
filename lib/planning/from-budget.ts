/**
 * The seam between /budget and /planlaegning: the parts of a plan that describe
 * the household's budget rather than its own assumptions.
 *
 * Pure and here rather than inline in `usePlanning`, because a hook is outside
 * the test runner's reach (`vitest.config.ts` has no jsdom) and this is the
 * exact join that went wrong — the simulation reconstructed the budget's
 * mortgage payment from the plan's loan and credited households a payment they
 * had never made.
 */

import type { MortgageState } from "@/lib/budget/mortgage"
import type { PlanningState } from "./types"

/**
 * The mortgage fields a plan reads off the budget instead of deriving. Picked
 * from `PlanningState` rather than restated, so the two cannot drift apart.
 */
export type BudgetMortgageLink = Pick<
  PlanningState,
  "mortgageBidragssats" | "mortgageBudgetedMonthly"
>

/**
 * Carry the budget's mortgage deduction, and the fee rate it was priced with,
 * into a plan.
 *
 * The two travel together because they have to agree. The projection charges
 * interest + bidrag + afdrag and hands `mortgageBudgetedMonthly` back: a plan
 * holding the rate without the deduction would charge a fee its budget never
 * paid, and one holding the deduction without the rate would hand back more
 * than it charges. Both read the same `enabled` flag so they cannot drift.
 *
 * `budgetedMonthly` is the figure off the shared budget summary
 * (`BudgetSummary.mortgageMonthly`) rather than a second computation from
 * `mortgage`, so the payment handed back is the same krone the surplus was
 * reduced by — re-deriving it is how /planlaegning and /resultat came to
 * disagree before (issue #2).
 */
export function mortgageFromBudget(
  mortgage: MortgageState,
  budgetedMonthly: number
): BudgetMortgageLink {
  // Nothing deducted, so no fee to model either. /planlaegning never asks for a
  // bidragssats, and a market-average one would be charged against the saving
  // every year for a loan the budget has not accounted for — an omission the
  // plan states (`mortgageBudgetNotice`) rather than a fee it invents.
  if (!mortgage.enabled) {
    return { mortgageBidragssats: 0, mortgageBudgetedMonthly: 0 }
  }
  return {
    mortgageBidragssats: mortgage.bidragssats,
    mortgageBudgetedMonthly: Math.max(0, budgetedMonthly),
  }
}
