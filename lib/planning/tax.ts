/**
 * Simplified Danish taxes for the planning simulation. Estimates only.
 *
 * - Investment gains realised when selling are taxed as aktieindkomst:
 *   27 % up to a yearly threshold and 43 % above it.
 * - Pension payouts (ratepension + livrente) and folkepension are taxed as
 *   personal income (no AM-bidrag). Aldersopsparing payouts are tax-free.
 */

// Aktieindkomst (share income) — 2026-style: 27 % up to the threshold, 43 % above.
export const SHARE_TAX_THRESHOLD = 100_000
export const SHARE_TAX_LOW_RATE = 0.27
export const SHARE_TAX_HIGH_RATE = 0.43

/** Tax on a year's realised investment gain. */
export function shareIncomeTax(gain: number): number {
  if (gain <= 0) return 0
  const low = Math.min(gain, SHARE_TAX_THRESHOLD) * SHARE_TAX_LOW_RATE
  const high = Math.max(0, gain - SHARE_TAX_THRESHOLD) * SHARE_TAX_HIGH_RATE
  return low + high
}

/**
 * Gross sale amount whose after-gains-tax proceeds equal `net`, when a fraction
 * `gainFraction` (0–1) of each krone sold is a taxable gain. Inverts
 * `shareIncomeTax` across its two brackets so a drawdown sells *exactly* enough
 * to cover a spending need — no more, no less. Returns `net` when there is no
 * embedded gain (nothing to tax).
 */
export function grossUpShareSale(net: number, gainFraction: number): number {
  if (net <= 0) return 0
  const g = Math.min(1, Math.max(0, gainFraction))
  if (g <= 0) return net
  // Low bracket: tax = LOW · sell · g  →  net = sell · (1 − LOW·g).
  const lowSell = net / (1 - SHARE_TAX_LOW_RATE * g)
  if (lowSell * g <= SHARE_TAX_THRESHOLD) return lowSell
  // High bracket: net = sell · (1 − HIGH·g) + (HIGH − LOW)·threshold.
  const offset = (SHARE_TAX_HIGH_RATE - SHARE_TAX_LOW_RATE) * SHARE_TAX_THRESHOLD
  return (net - offset) / (1 - SHARE_TAX_HIGH_RATE * g)
}

// Simplified personal income tax for pension payouts (no AM-bidrag).
export const PERSONFRADRAG = 51_600
/** Personal income above this is also hit by topskat. */
export const TOPSKAT_THRESHOLD = 611_800
/** Kommune + bundskat, roughly. */
export const INCOME_BASE_RATE = 0.37
export const TOPSKAT_RATE = 0.15

/** Approximate personal income tax on a year's taxable pension income. */
export function pensionIncomeTax(income: number): number {
  if (income <= PERSONFRADRAG) return 0
  let tax = (income - PERSONFRADRAG) * INCOME_BASE_RATE
  if (income > TOPSKAT_THRESHOLD) {
    tax += (income - TOPSKAT_THRESHOLD) * TOPSKAT_RATE
  }
  return tax
}
