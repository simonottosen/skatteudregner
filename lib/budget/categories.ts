/**
 * Budget expense categories. Shared between the budget hook (state + migration)
 * and the start-budget generator so generated items land in the right group.
 */

import {
  matchesKeywordTiers,
  type KeywordTiers,
} from "@/lib/budget/keyword-match"

/**
 * What a category's money actually does.
 *
 * - `expense` — consumed this month.
 * - `savings` — put aside. Savings is the leftover after expenses, so counting
 *   it as an expense too subtracts it on both sides of the equation; this tag
 *   is what lets the summary undo that double count.
 * - `sinking` — set aside for a known future expense (bilreparation, tandlæge).
 *   Neither consumption nor long-term savings, so it gets its own bucket
 *   instead of distorting one of the other two.
 *
 * Optional on {@link BudgetCategory}: an untagged category behaves exactly as
 * it did before v6.
 */
export type CategoryKind = "expense" | "savings" | "sinking"

export const CATEGORY_KINDS: readonly CategoryKind[] = [
  "expense",
  "savings",
  "sinking",
]

export function isCategoryKind(value: unknown): value is CategoryKind {
  return (
    typeof value === "string" &&
    (CATEGORY_KINDS as readonly string[]).includes(value)
  )
}

export interface BudgetCategory {
  id: string
  name: string
  kind?: CategoryKind
}

/** Catch-all category; always present and cannot be deleted. */
export const UNCATEGORIZED_ID = "oevrigt"

export const DEFAULT_CATEGORIES: BudgetCategory[] = [
  { id: "bolig", name: "Bolig" },
  { id: "forsikring", name: "Forsikringer" },
  { id: "transport", name: "Transport" },
  { id: "mad", name: "Mad og dagligvarer" },
  { id: "abonnementer", name: "Abonnementer" },
  { id: "boern", name: "Børn" },
  { id: "personligt", name: "Personligt" },
  { id: "fritid", name: "Fritid og ferie" },
  { id: "opsparing", name: "Opsparing", kind: "savings" },
  { id: UNCATEGORIZED_ID, name: "Øvrigt" },
]

const SAVINGS_KEYWORDS: KeywordTiers = {
  strong: ["opsparing", "opspar", "buffer"],
  // Spar Nord and sparekasser are banks — an income or transfer line, not
  // savings — and spareribs is dinner.
  exclude: ["nord", "kasse", "ribs"],
  weak: ["spar", "investering"],
}

/** Whether a label looks like money the household puts aside. */
export function looksLikeSavings(label: string): boolean {
  return matchesKeywordTiers(label, SAVINGS_KEYWORDS)
}

// Wording that says the money is being set aside, whatever it is earmarked for.
const RESERVE_KEYWORDS = ["hensæt", "hensat", "uforudset"]

// Bills a household typically saves up for — but these words name the bill, not
// the saving, so on their own they describe ordinary consumption just as often.
const EARMARKED_BILL_KEYWORDS = [
  "reparation",
  "tandlæge",
  "tandlaege",
  "selvrisiko",
  "vedligehold",
]

/**
 * Whether a label looks like a sinking fund for a known future expense.
 *
 * Naming the bill is not enough: "Tandlæge" is usually this month's bill, and
 * tagging it `sinking` would move it out of consumption and inflate the
 * surplus — the same overstatement this whole feature exists to remove. So an
 * earmarked bill only counts once the label also says the money is put aside.
 */
export function looksLikeSinkingFund(label: string): boolean {
  const l = label.toLowerCase()
  if (RESERVE_KEYWORDS.some((kw) => l.includes(kw))) return true
  return (
    EARMARKED_BILL_KEYWORDS.some((kw) => l.includes(kw)) && looksLikeSavings(l)
  )
}

/**
 * The kind a category name suggests, or `undefined` when nothing is
 * recognisable. Sinking funds win over savings: "Bilreparation (opsparing)" is
 * earmarked for a specific bill, not long-term saving.
 *
 * A suggestion only — callers must let an explicit choice override it.
 */
export function suggestCategoryKind(name: string): CategoryKind | undefined {
  if (looksLikeSinkingFund(name)) return "sinking"
  if (looksLikeSavings(name)) return "savings"
  return undefined
}

/**
 * Best-effort categorisation of a free-text expense label, used when migrating
 * older budgets that have no category yet. Order matters (car-related before
 * the generic "forsikring" rule so "bilforsikring" lands under Transport).
 */
export function guessCategory(label: string): string {
  const s = label.toLowerCase()
  const has = (...words: string[]) => words.some((w) => s.includes(w))

  if (has("bil", "brændstof", "benzin", "transport", "offentlig", "pendl", "bus", "tog"))
    return "transport"
  if (has("forsikr")) return "forsikring"
  if (
    has(
      "husleje", "boliglån", "bolig", "lån", "ejendom", "grundskyld",
      "el ", "el og", "varme", "vand", "internet", "telefon", "antenne",
      "vedligehold"
    )
  )
    return "bolig"
  if (has("tv", "streaming", "abonnement", "fitness", "avis", "spotify", "netflix"))
    return "abonnementer"
  if (has("mad", "dagligvar", "restaurant", "takeaway", "husholdning", "rengøring"))
    return "mad"
  if (has("børn", "institution", "sfo", "dagpleje", "vuggestue", "børnehave"))
    return "boern"
  if (has("tøj", "sko", "frisør", "pleje", "personlig", "a-kasse", "fagforening", "kontingent"))
    return "personligt"
  if (has("ferie", "fritid", "fornøjelse", "hobby", "sport", "rejse"))
    return "fritid"
  // Shares the deny list with the kind tagging, so a "Spar Nord" line is not
  // bucketed as savings here while being left untagged there.
  if (looksLikeSavings(s)) return "opsparing"

  return UNCATEGORIZED_ID
}
