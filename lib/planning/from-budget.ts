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

import type { BudgetSummary } from "@/lib/budget/state"
import { planningContribution } from "@/lib/budget/state"
import type { MortgageState } from "@/lib/budget/mortgage"
import { homeProperty } from "./normalize"
import { ASSESSMENT_FACTOR } from "./taxation"
import type { PensionPerson, PlannedProperty, PlanningState } from "./types"

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

/**
 * The parts of the budget summary the two plan figures below are read off.
 * Picked from {@link BudgetSummary} so they keep whatever meaning that file
 * gives them; re-deriving any of them here is how /planlaegning and /resultat
 * came to disagree before (issue #2).
 */
export type BudgetPlanFigureSource = Pick<
  BudgetSummary,
  "budgetExpenses" | "allocatedSavings" | "totalSavings"
>

/**
 * What the household puts away each month and what it lives on each year, as
 * its budget states them.
 *
 * A line in a `kind: "savings"` category is money the household saves, so the
 * budget has already taken it out of `remaining`. Reading the contribution off
 * `remaining` and the spending off `budgetExpenses` therefore charged the same
 * kroner twice — once as a saving the plan refused to credit, once as
 * consumption it did — and since the FI target is 25× the spending, the date
 * moved out from both ends at once (issue #36).
 *
 * Sinking funds (`kind: "sinking"`) deliberately stay in the spending. They are
 * deferred consumption: money set aside for a new roof is money that will be
 * spent, so netting them out — which is what `consumptionExpenses` does — would
 * price the household's whole retirement on the assumption that the roof is
 * never replaced. That is also why the contribution is `totalSavings` and not
 * `surplus`, the same figure with the sinking funds added back in.
 *
 * The pair reconciles by construction: contribution + spending/12 + the
 * mortgage is the household's income, whatever it tags its categories.
 */
export function planFiguresFromBudget(
  summary: BudgetPlanFigureSource
): Pick<PlanningState, "monthlyContribution" | "annualSpending"> {
  return {
    monthlyContribution: planningContribution(summary.totalSavings),
    // Floored for the same reason the contribution is: a negative spending would
    // put the 25× FI target below zero and report a household already there.
    annualSpending: Math.max(
      0,
      Math.round((summary.budgetExpenses - summary.allocatedSavings) * 12)
    ),
  }
}

/** Grundværdi assumed for a home /skat states no land value for. */
const LAND_VALUE_SHARE = 0.4

/** The two beskatningsgrundlag /skat's Bolig tab collects for a dwelling. */
export interface TaxPropertyBases {
  assessmentBasis?: number
  landAssessmentBasis?: number
}

/**
 * The market value behind a beskatningsgrundlag, or 0 for a blank one.
 *
 * The inverse of what the projection does with the number it is given:
 * `createPropertyPortfolioTax` multiplies a plan's value by
 * {@link ASSESSMENT_FACTOR} to get a basis, so dividing here hands the tax back
 * exactly the grundlag the user typed on /skat rather than a re-estimate of it.
 */
function valueFromBasis(basis: number | undefined): number {
  return basis && basis > 0 ? basis / ASSESSMENT_FACTOR : 0
}

/**
 * The household's home as /skat and /budget between them describe it.
 *
 * /skat's Bolig tab collects the ~80 % beskatningsgrundlag and nothing else —
 * `PropertyInput.propertyValue` and `.landValue` are written as a literal 0
 * everywhere and were the only things this used to read, so a home reached a
 * plan solely through /budget's realkredit module and its grundværdi was always
 * the {@link LAND_VALUE_SHARE} guess (issue #50). Converting the basis back is
 * what makes the Bolig tab reach the plan without asking for the value twice.
 *
 * The mortgage module still wins when it states a value, because there the user
 * gave the market value outright instead of a basis it has to be recovered from.
 * The whole dwelling is carried either way: `ownershipShare` scales the tax on
 * /skat, but a plan's property is the house, not a stake in one, and the
 * mortgage branch has always carried the undivided `homeValue`.
 */
export function homeFromSources(
  mortgage: Pick<MortgageState, "enabled" | "homeValue">,
  property: TaxPropertyBases | undefined
): { value: number; landValue: number } {
  const fromMortgage = mortgage.enabled ? Math.max(0, mortgage.homeValue) : 0
  const value = fromMortgage || valueFromBasis(property?.assessmentBasis)
  const landFromTax = valueFromBasis(property?.landAssessmentBasis)
  return {
    value: Math.round(value),
    landValue: Math.round(landFromTax || value * LAND_VALUE_SHARE),
  }
}

/**
 * Carry the household's own home — as /skat and /budget describe it — into a
 * plan's property list.
 *
 * Only the home is linked, and only its two amounts. /skat knows about the
 * ejendom the household is taxed on and /budget about the one it has a loan on;
 * neither has ever heard of the summer house the user added on /planlaegning, so
 * replacing the list wholesale is how that summer house would disappear the next
 * time either page changed. The home is `current[0]`, the entry the plan's loan
 * is secured on — see {@link PlanningState.properties} — and only when that entry
 * is a helårsbolig, since a plan that leads with a fritidsbolig has no home for
 * these amounts to land on and needs one made.
 *
 * A budget with no home to describe leaves the list alone rather than emptying
 * it: "/skat has nothing to say about a property" and "the household sold up"
 * are different claims, and only the user can make the second one.
 */
export function propertiesFromBudget(
  current: readonly PlannedProperty[],
  home: { value: number; landValue: number }
): PlannedProperty[] {
  if (home.value <= 0) return [...current]
  const value = Math.max(0, Math.round(home.value))
  const landValue = Math.max(0, Math.round(home.landValue))
  const first = current[0]
  if (first && first.kind === "helaarsbolig") {
    return [{ ...first, value, landValue }, ...current.slice(1)]
  }
  return [homeProperty(value, landValue), ...current]
}

/**
 * Everything a plan reads off /skat and /budget rather than asking the user for.
 *
 * The linked half is `Partial<PlanningState>` rather than a restatement of the
 * fields, so a key that is not a plan field cannot be declared here at all —
 * `home` used to travel in this object unannounced and reach persisted state as
 * a key `PlanningState` has never had. `home` and `pension` are named separately
 * because neither *is* a plan field: the home is two amounts that have to be
 * merged into a list the user also edits, and the pension is only the few person
 * fields the other pages happen to know.
 */
export type PlanningDerivedDefaults = Partial<
  Omit<PlanningState, "properties" | "pension">
> & {
  /** The household's own home as /skat and /budget describe it. */
  home: { value: number; landValue: number }
  pension: {
    single: boolean
    person1: Partial<PensionPerson>
    person2: Partial<PensionPerson>
  }
}

/**
 * Fold the derived defaults into a plan.
 *
 * One function because there are two callers — the effect that keeps an
 * untouched plan mirroring the other pages, and "Hent fra skat & budget" — and
 * as two copies of this merge they drifted. The effect never set `properties`,
 * so a fresh visit gave a homeowner the mortgage with neither the home as an
 * asset nor its ejendomsskat. Whether the plan counts as touched afterwards is
 * the caller's business and stays there; the merge is the same either way.
 */
export function applyDerivedDefaults(
  prev: PlanningState,
  defaults: PlanningDerivedDefaults
): PlanningState {
  const { home, pension, ...linked } = defaults
  return {
    ...prev,
    ...linked,
    properties: propertiesFromBudget(prev.properties, home),
    pension: {
      ...prev.pension,
      single: pension.single,
      person1: { ...prev.pension.person1, ...pension.person1 },
      person2: { ...prev.pension.person2, ...pension.person2 },
    },
  }
}
