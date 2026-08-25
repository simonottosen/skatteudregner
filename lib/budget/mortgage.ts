/**
 * Danish realkredit mortgage helpers for the budget page.
 *
 * Splits a home loan into its three monthly components — renter (interest),
 * bidrag (contribution fee) and afdrag (principal repayment) — from a few
 * inputs: house value, borrowing percentage (LTV) and remaining years. The
 * result feeds both the budget (three line items) and the planning simulation
 * (precise loan balance + payoff term, so home equity grows as debt is repaid).
 *
 * Rate defaults reflect typical 2026 Danish figures (see lib note below).
 */

import {
  matchesKeywordTiers,
  type KeywordTiers,
} from "@/lib/budget/keyword-match"

/** Typical 2026 30-year fixed-rate realkredit coupon. */
export const DEFAULT_INTEREST_RATE = 0.041
/** Blended bidragssats for a standard 80 % LTV fixed amortizing loan (2026). */
export const DEFAULT_BIDRAGSSATS = 0.006

/**
 * Blended annual bidragssats for a given LTV, weighting the typical 2026
 * marginal band rates by the share of the loan in each band (0–40 % ≈ 0.15 %,
 * 40–60 % ≈ 0.40 %, 60–80 % ≈ 0.65 %). Used to pre-fill a sensible default.
 */
export function blendedBidragssats(ltv: number): number {
  const l = Math.min(0.8, Math.max(0, ltv))
  if (l <= 0) return 0
  const band = (lo: number, hi: number, rate: number) =>
    Math.max(0, Math.min(l, hi) - lo) * rate
  const weighted =
    band(0, 0.4, 0.0015) + band(0.4, 0.6, 0.004) + band(0.6, 0.8, 0.0065)
  return Math.round((weighted / l) * 10000) / 10000
}

export interface MortgageState {
  /** "Jeg ejer boligen og afdrager på et realkreditlån". */
  enabled: boolean
  /** Full house value in DKK. */
  homeValue: number
  /** Remaining years on the loan. */
  remainingYears: number
  /** Borrowing percentage / LTV (0–1): outstanding loan ÷ house value. */
  ltv: number
  /** Annual interest rate (coupon). */
  interestRate: number
  /** Annual bidragssats (contribution fee), as a fraction of the balance. */
  bidragssats: number
  /** Afdragsfrihed — interest-only, no principal repayment. */
  interestOnly: boolean
}

export const DEFAULT_MORTGAGE: MortgageState = {
  enabled: false,
  homeValue: 0,
  remainingYears: 30,
  ltv: 0.8,
  interestRate: DEFAULT_INTEREST_RATE,
  bidragssats: DEFAULT_BIDRAGSSATS,
  interestOnly: false,
}

export interface MortgageBreakdown {
  /** Outstanding loan = homeValue × LTV. */
  loan: number
  /** Monthly interest. */
  monthlyInterest: number
  /** Monthly bidrag (contribution fee). */
  monthlyBidrag: number
  /** Monthly afdrag (principal repayment); 0 with afdragsfrihed. */
  monthlyAfdrag: number
  /** Sum of the three components. */
  monthlyTotal: number
  /** Years until debt-free (Infinity with afdragsfrihed). */
  payoffYears: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Level annuity payment that repays `loan` over `months` at monthly rate `r`. */
function annuity(loan: number, r: number, months: number): number {
  if (loan <= 0 || months <= 0) return 0
  if (r <= 0) return loan / months
  return (loan * r) / (1 - Math.pow(1 + r, -months))
}

/** Compute the monthly mortgage components from the user's inputs. */
export function computeMortgage(m: MortgageState): MortgageBreakdown {
  const loan = Math.max(0, m.homeValue * clamp(m.ltv, 0, 1))
  const monthlyInterest = (loan * Math.max(0, m.interestRate)) / 12
  const monthlyBidrag = (loan * Math.max(0, m.bidragssats)) / 12
  const months = Math.max(1, Math.round(m.remainingYears * 12))
  const payment = m.interestOnly
    ? monthlyInterest
    : annuity(loan, m.interestRate / 12, months)
  const monthlyAfdrag = m.interestOnly
    ? 0
    : Math.max(0, payment - monthlyInterest)
  return {
    loan,
    monthlyInterest,
    monthlyBidrag,
    monthlyAfdrag,
    monthlyTotal: monthlyInterest + monthlyBidrag + monthlyAfdrag,
    payoffYears: m.interestOnly ? Infinity : m.remainingYears,
  }
}

/** Total monthly mortgage payment (0 when not enabled). */
export function mortgageMonthlyTotal(m: MortgageState): number {
  return m.enabled ? computeMortgage(m).monthlyTotal : 0
}

const MORTGAGE_KEYWORDS: KeywordTiers = {
  strong: [
    "realkredit",
    "boliglån",
    "boliglaan",
    "prioritet",
    "huslån",
    "huslaan",
    "ejerudgift",
    "husleje",
    "termin",
  ],
  // A vehicle or student loan is debt, but it is not the home loan.
  exclude: ["bil", "leasing", "billån", "billaan", "studie"],
  weak: ["afdrag", "afbetaling", "lån", "laan"],
}

/** Whether a budget item label looks like a mortgage/home-loan payment. */
export function looksLikeMortgage(label: string): boolean {
  return matchesKeywordTiers(label, MORTGAGE_KEYWORDS)
}
