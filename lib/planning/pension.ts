/**
 * Danish pension helpers for the planning simulation.
 *
 * Figures are 2025 (gross, before tax). Sources: borger.dk, STAR, Ældre Sagen.
 * These are estimates for projection only — not advice.
 */

// Folkepension 2025 (annual, before tax).
export const FOLKEPENSION_GRUNDBELOEB = 86_376
export const TILLAEG_SINGLE = 99_948
export const TILLAEG_COUPLE = 51_144
/** Pensionstillæg is reduced against "other income" above these thresholds. */
export const TILLAEG_THRESHOLD_SINGLE = 95_800
export const TILLAEG_THRESHOLD_COUPLE = 192_000
export const TILLAEG_RATE_SINGLE = 0.309
export const TILLAEG_RATE_COUPLE = 0.16 // per person

/** Earliest private-pension payout is folkepensionsalder − 3 (2018+ schemes). */
export const PRIVATE_PAYOUT_OFFSET = 3

/**
 * Folkepensionsalder by birth year. Fixed in law through 1970; later cohorts
 * are current projections (subject to future Folketing approval).
 */
export function folkepensionAge(birthYear: number): number {
  if (birthYear <= 1962) return 67
  if (birthYear <= 1966) return 68
  if (birthYear <= 1970) return 69
  if (birthYear <= 1974) return 70
  return 71
}

/**
 * Annual folkepension after means-testing (modregning). In retirement there's
 * no work income, so grundbeløb is paid in full; only pensionstillæg is reduced
 * against "other income" (private ratepension + livrente payouts — aldersopsparing
 * is exempt).
 */
export function folkepensionAfterModregning(
  otherIncome: number,
  single: boolean
): number {
  const tillaegFull = single ? TILLAEG_SINGLE : TILLAEG_COUPLE
  const threshold = single ? TILLAEG_THRESHOLD_SINGLE : TILLAEG_THRESHOLD_COUPLE
  const rate = single ? TILLAEG_RATE_SINGLE : TILLAEG_RATE_COUPLE
  const tillaeg = Math.max(
    0,
    tillaegFull - rate * Math.max(0, otherIncome - threshold)
  )
  return FOLKEPENSION_GRUNDBELOEB + tillaeg
}

/** Level annuity payment that depletes `balance` over `years` at rate `r`. */
export function annuityPayment(balance: number, r: number, years: number): number {
  if (balance <= 0 || years <= 0) return 0
  if (r <= 0) return balance / years
  return (balance * r) / (1 - Math.pow(1 + r, -years))
}
