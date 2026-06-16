/**
 * Compares a household's per-category spending against a "typical" Danish
 * household of the same composition, reusing {@link generateBudget} as the
 * peer baseline. Used by the results page to call out where the user spends
 * significantly more or less than peers.
 */

import { generateBudget } from "./generate-budget"

export interface PeerAssumptions {
  adults: number
  children: number
  cars: number
}

export interface PeerComparison {
  categoryId: string
  /** User's monthly spend in this category. */
  userMonthly: number
  /** Typical peer monthly spend in this category. */
  peerMonthly: number
  /** userMonthly / peerMonthly. */
  ratio: number
  direction: "more" | "less"
}

/**
 * Categories where a peer average is meaningful. Housing (rent/mortgage is
 * highly individual), savings and the catch-all are deliberately excluded.
 */
const COMPARABLE_CATEGORIES = new Set([
  "mad",
  "transport",
  "forsikring",
  "abonnementer",
  "personligt",
  "fritid",
  "boern",
])

/** Flag a deviation only when it's both relatively and absolutely meaningful. */
const MIN_RATIO_MORE = 1.3
const MIN_RATIO_LESS = 0.7
const MIN_ABS_DIFF = 300

/**
 * Peer monthly spend per category id, for a typical household of the given
 * composition (average vacation + lifestyle, housing excluded).
 */
export function peerMonthlyByCategory(
  a: PeerAssumptions
): Map<string, number> {
  const items = generateBudget({
    adults: a.adults,
    children: a.children,
    cars: a.cars,
    ownsHome: false,
    housingCost: 0,
    vacationLevel: "medium",
    lifestyle: 0,
  })
  const byCat = new Map<string, number>()
  for (const it of items) {
    byCat.set(it.category, (byCat.get(it.category) ?? 0) + it.amount)
  }
  return byCat
}

/**
 * Returns the categories where the user deviates significantly from peers,
 * largest absolute deviation first.
 */
export function comparePeers(
  a: PeerAssumptions,
  userByCategoryId: Map<string, number>
): PeerComparison[] {
  const peer = peerMonthlyByCategory(a)
  const out: PeerComparison[] = []

  for (const categoryId of COMPARABLE_CATEGORIES) {
    const peerMonthly = peer.get(categoryId) ?? 0
    const userMonthly = userByCategoryId.get(categoryId) ?? 0
    // Need spend on both sides for the comparison to be meaningful.
    if (peerMonthly <= 0 || userMonthly <= 0) continue
    if (Math.abs(userMonthly - peerMonthly) < MIN_ABS_DIFF) continue

    const ratio = userMonthly / peerMonthly
    if (ratio >= MIN_RATIO_MORE) {
      out.push({ categoryId, userMonthly, peerMonthly, ratio, direction: "more" })
    } else if (ratio <= MIN_RATIO_LESS) {
      out.push({ categoryId, userMonthly, peerMonthly, ratio, direction: "less" })
    }
  }

  return out.sort(
    (x, y) =>
      Math.abs(y.userMonthly - y.peerMonthly) -
      Math.abs(x.userMonthly - x.peerMonthly)
  )
}
