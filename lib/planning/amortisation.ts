/**
 * One year of loan amortization — the shared step behind both the mortgage and
 * the other-debt path in the planning simulation.
 *
 * Split out of `simulate.ts` so the schedule can be exercised directly: it is
 * the piece afdragsfrihed changes, and the one #8 will reuse once debt becomes
 * a list of loans rather than two hard-coded balances.
 */

export interface AmortisationYear {
  /** Outstanding balance after twelve months of payments. */
  balance: number
  /**
   * Interest accrued over those twelve months. Deductible as kapitalindkomst
   * against the *aggregate* across all loans (#8), so it leaves this function
   * rather than being re-derived, less precisely, by each caller.
   */
  interest: number
}

/**
 * Advance an annuity loan by one year.
 *
 * `interestOnly` marks a year inside an afdragsfrihed period: only interest
 * falls due, so the balance stands still. The caller keeps counting `monthsLeft`
 * down through those years — the loan's maturity does not move — which is what
 * makes the payment step up when the period ends: the untouched principal is
 * then squeezed into a term that is shorter by exactly the years skipped.
 */
export function amortizeYear(
  balance: number,
  rate: number,
  monthsLeft: number,
  interestOnly = false
): AmortisationYear {
  if (balance <= 0) return { balance: 0, interest: 0 }
  // Past the loan term there are no more scheduled payments — leave any balance
  // (e.g. equity borrowed during retirement) untouched. Same outcome as an
  // interest-only year: interest accrues, principal does not move.
  if (interestOnly || monthsLeft <= 0) return { balance, interest: balance * rate }

  const rMonth = rate / 12
  const annuity =
    rMonth > 0
      ? (balance * rMonth) / (1 - Math.pow(1 + rMonth, -monthsLeft))
      : balance / monthsLeft
  let remaining = balance
  let interest = 0
  for (let m = 0; m < 12 && remaining > 0; m++) {
    const monthInterest = remaining * rMonth
    interest += monthInterest
    remaining = Math.max(0, remaining - (annuity - monthInterest))
  }
  return { balance: remaining, interest }
}
