/**
 * Three-tier keyword matching for free-text budget labels.
 *
 * Danish labels are ambiguous enough that a flat substring list gets them
 * wrong: "Billån" is not a mortgage and "Spar Nord" is not savings, yet both
 * contain a word that otherwise settles the question. Tiering the keywords —
 * and checking the exclusions *before* the weak signals — is what separates the
 * two cases. That ordering is the whole mechanism, so it lives in one place.
 */

export interface KeywordTiers {
  /** Decisive on its own — matches even alongside an excluded word. */
  strong: readonly string[]
  /** Rules the label out. Checked before {@link weak}. */
  exclude: readonly string[]
  /** Only counts when nothing ruled the label out. */
  weak: readonly string[]
}

export function matchesKeywordTiers(label: string, tiers: KeywordTiers): boolean {
  const l = label.toLowerCase()
  if (tiers.strong.some((kw) => l.includes(kw))) return true
  if (tiers.exclude.some((kw) => l.includes(kw))) return false
  return tiers.weak.some((kw) => l.includes(kw))
}
