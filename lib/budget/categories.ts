/**
 * Budget expense categories. Shared between the budget hook (state + migration)
 * and the start-budget generator so generated items land in the right group.
 */

export interface BudgetCategory {
  id: string
  name: string
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
  { id: "opsparing", name: "Opsparing" },
  { id: UNCATEGORIZED_ID, name: "Øvrigt" },
]

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
  if (has("opsparing", "buffer", "spar"))
    return "opsparing"

  return UNCATEGORIZED_ID
}
