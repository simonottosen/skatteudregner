/**
 * Figures and copy for the budget page's savings breakdown.
 *
 * Lives here rather than in `components/budget/budget-planner.tsx` because the
 * test setup only collects `.ts` — anything with branching in it has to be
 * reachable by a test.
 */

import { formatDKK } from "@/lib/format"
import type { CategoryKind } from "@/lib/budget/categories"
import {
  DEFAULT_SAVINGS_SPLIT,
  savingsResidual,
  type SavingsAttribution,
  type SavingsSplit,
} from "@/lib/budget/savings-split"
import type { BudgetMode, BudgetSummary } from "@/lib/budget/state"

/** Labels for the per-category kind picker. Exhaustive by construction. */
export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  expense: "Forbrug",
  savings: "Opsparing",
  sinking: "Hensættelse",
}

/** Labels for the savings-split picker. Exhaustive by construction. */
export const SAVINGS_SPLIT_LABELS: Record<SavingsSplit, string> = {
  "with-expenses": "Følg udgiftsfordelingen",
  shared: "Alt er fælles",
  individual: "Fælles beløb + hver sit",
}

/**
 * Which row this is, independent of what it says.
 *
 * Labels are not identities: both partners can share a display name, and a name
 * can equal a fixed row label such as "Fælles opsparing". Keying the rendered
 * list on the label would collide, letting React reuse the wrong row as the
 * amounts change.
 */
export type SavingsFigureId =
  // savingsBreakdownView
  | "consumption"
  | "sinking"
  | "allocated"
  | "real"
  // savingsSplitView
  | "shared"
  | "p1"
  | "p2"
  | "slack"
  | "over"
  | "deficit"
  | "total"

export interface SavingsFigure {
  id: SavingsFigureId
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
      id: "consumption",
      label: s.mortgageMonthly > 0 ? "Forbrug (inkl. lån)" : "Forbrug",
      amount: s.consumptionExpenses + s.mortgageMonthly,
    },
  ]
  if (s.sinkingFunds > 0)
    figures.push({
      id: "sinking",
      label: "Hensat til kendte udgifter",
      amount: s.sinkingFunds,
    })
  if (s.allocatedSavings > 0)
    figures.push({
      id: "allocated",
      label: "Afsat til opsparing",
      amount: s.allocatedSavings,
    })
  figures.push({
    id: "real",
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

export interface SavingsSplitView {
  figures: SavingsFigure[]
  notes: string[]
  /** Shown as an error: more is earmarked than the budget actually produces. */
  warning?: string
  /** Each person's display name, with a fallback for a blank one. */
  p1Label: string
  p2Label: string
}

/** Below a krone is rounding noise, not an amount worth its own line. */
const KRONE = 0.5

const personLabel = (name: string, fallback: string) => name.trim() || fallback

/**
 * The joint/personal savings breakdown for a couple.
 *
 * Returns `null` for a one-person household — there is nobody to share with —
 * and for a couple that saves nothing and has not chosen a split, where every
 * figure would be zero.
 */
export function savingsSplitView(input: {
  attribution: SavingsAttribution
  mode: BudgetMode
  p1Name: string
  p2Name: string
  mortgageMonthly: number
}): SavingsSplitView | null {
  const { attribution: a, mode, mortgageMonthly } = input
  if (mode === "single") return null
  if (a.split === DEFAULT_SAVINGS_SPLIT && a.total === 0) return null

  const p1Label = personLabel(input.p1Name, "Person 1")
  const p2Label = personLabel(input.p2Name, "Person 2")

  // A joint row whenever the couple chose a split, so a stated shared amount is
  // visible even at zero; otherwise only when the budget produced one.
  const components: SavingsFigure[] = []
  if (a.shared !== 0 || a.split !== DEFAULT_SAVINGS_SPLIT)
    components.push({ id: "shared", label: "Fælles opsparing", amount: a.shared })
  // Likewise the two personal rows: on an explicit "hver sit" split, "0 kr."
  // each is the answer to the question the couple asked, and dropping the rows
  // would leave a joint amount larger than the total with nothing beside it.
  if (a.p1 !== 0 || a.p2 !== 0 || a.split === "individual") {
    components.push({ id: "p1", label: p1Label, amount: a.p1 })
    components.push({ id: "p2", label: p2Label, amount: a.p2 })
  }
  // One row per reason the attribution does not add up to the total, because
  // "you have shared out too much" and "you are spending more than you earn"
  // need different answers from the reader.
  const residual = savingsResidual(a)
  if (residual.slack >= KRONE)
    components.push({ id: "slack", label: "Ikke fordelt", amount: residual.slack })
  if (residual.overCommitted <= -KRONE)
    components.push({
      id: "over",
      label: "Fordelt for meget",
      amount: residual.overCommitted,
    })
  if (residual.deficit <= -KRONE)
    components.push({
      id: "deficit",
      label: "Underskud i budgettet",
      amount: residual.deficit,
    })

  // A single component *is* the total, so restating it under a second label
  // would only invite the reader to add the two together.
  const figures: SavingsFigure[] =
    components.length > 1
      ? [
          ...components,
          {
            id: "total",
            label: "Opsparing i alt / md.",
            amount: a.total,
            highlight: true,
          },
        ]
      : components.map((f) => ({ ...f, highlight: true }))

  const notes: string[] = []
  if (a.split === "with-expenses")
    notes.push(
      mode === "shared"
        ? "Opsparingen følger udgifterne: udgifterne er fælles, så opsparingen " +
            "er det også."
        : "Opsparingen følger udgifterne: I har hver jeres udgiftsliste, så " +
            "hver især sparer sit eget overskud op."
    )
  if (a.split === "shared")
    notes.push(
      "Hele opsparingen regnes som fælles, uanset hvordan udgifterne er fordelt."
    )
  if (a.split === "individual")
    notes.push(
      a.manual
        ? "I har selv angivet, hvad hver især lægger til side. Forskellen op " +
            "til husstandens samlede opsparing står som «Ikke fordelt»."
        : "Det fælles beløb trækkes fra først, og resten deles ligeligt mellem jer."
    )
  if (a.split === "with-expenses" && mode === "separate" && mortgageMonthly > 0)
    notes.push(
      `Realkreditydelsen (${formatDKK(mortgageMonthly)}/md.) er en fælles ` +
        "udgift. Her er den delt 50/50, så jeres to beløb summer til " +
        "husstandens samlede opsparing."
    )

  // Only the part they actually shared out too much. A month in deficit is not
  // something "sæt beløbene ned" can fix, and it is already reported as its own
  // figure — telling them here as well would put the blame in the wrong place.
  const warning =
    residual.overCommitted <= -KRONE
      ? `I har fordelt ${formatDKK(-residual.overCommitted)} mere om måneden, ` +
        "end husstanden sparer op. Sæt beløbene ned, eller find plads i budgettet."
      : undefined

  return { figures, notes, warning, p1Label, p2Label }
}
