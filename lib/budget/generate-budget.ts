/**
 * Generates a realistic starting budget for a Danish household.
 *
 * Figures are monthly DKK, derived from Danish averages:
 *  - Danmarks Statistik Forbrugsundersøgelsen (food ~3.465 kr./md. for 2 adults,
 *    housing is the single heaviest post at ~34% of consumption).
 *  - Finanstilsynet's recommended "rådighedsbeløb" (single 5.000–6.000 kr.,
 *    couple 8.500–10.000 kr., +2.500 kr. per child).
 *  - A representative itemized family-of-4 budget (~35.000 kr./md. total).
 *
 * Everything scales with household size / cars and is rounded to the nearest
 * 50 kr. so it reads cleanly. Where the tax calculator already knows the
 * mortgage interest paid, that figure qualifies the housing estimate (split
 * into interest + afdrag) instead of a generic average. Property tax is left
 * out here — it lives in the budget as its own line, kept separate from the
 * loan payment.
 *
 * A "lifestyle" factor lets the user say how much more or less they spend than
 * a typical household. It only scales discretionary, choice-driven spending
 * (eating out, holidays, hobbies, clothes …). Fixed obligations — rent,
 * utilities, insurances, childcare, a-kasse — stay put, since a frugal or
 * lavish lifestyle doesn't change what the insurer or the bank charges.
 */

export type VacationLevel = "low" | "medium" | "high"

export interface BudgetEstimateParams {
  /** Number of adults in the household (typically 1–2). */
  adults: number
  /** Number of children living at home. */
  children: number
  /** Number of cars owned/leased. */
  cars: number
  /** Monthly rent or mortgage payment in DKK. */
  housingCost: number
  /** Whether the home is owned (adds a maintenance line). */
  ownsHome: boolean
  /** Typical vacation ambition, drives the monthly holiday savings. */
  vacationLevel: VacationLevel
  /**
   * How the household's lifestyle compares to a typical Danish one, from
   * -1 (much more frugal) through 0 (average) to +1 (much more lavish).
   * Scales discretionary spending by ±50% at the extremes.
   */
  lifestyle?: number
}

export interface GeneratedBudgetItem {
  label: string
  amount: number
  /** Category id (see lib/budget/categories). */
  category: string
}

/** A candidate line before rounding/filtering. */
interface Candidate {
  label: string
  amount: number
  category: string
  /** When true, the lifestyle factor scales this line. */
  lifestyle?: boolean
}

const VACATION_BASE: Record<VacationLevel, number> = {
  low: 500,
  medium: 1200,
  high: 2500,
}

function roundTo50(n: number): number {
  return Math.round(n / 50) * 50
}

function roundTo100(n: number): number {
  return Math.round(n / 100) * 100
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Assumed Danish realkredit annuity terms used to back out the loan. */
const MORTGAGE_RATE = 0.04
const MORTGAGE_TERM_MONTHS = 30 * 12

export interface MortgageEstimate {
  /** Monthly interest portion (from the annual interest paid). */
  interest: number
  /** Monthly principal repayment — the afdrag. */
  afdrag: number
  /** Total monthly housing payment (interest + afdrag). */
  total: number
  /** Implied outstanding loan principal. */
  principal: number
}

/**
 * Approximates a Danish realkredit annuity loan from the annual interest the
 * user pays. At a ~4% effective rate the implied principal is
 * `annualInterest / 0.04`; repaying that over 30 years as a standard annuity
 * gives the monthly payment, which is split into its interest and afdrag
 * (principal repayment) parts. The afdrag is therefore derived from the
 * interest rate rather than guessed.
 */
export function estimateMortgage(annualInterest: number): MortgageEstimate {
  const annual = Math.max(0, annualInterest)
  if (annual <= 0) return { interest: 0, afdrag: 0, total: 0, principal: 0 }
  const principal = annual / MORTGAGE_RATE
  const r = MORTGAGE_RATE / 12
  const monthlyInterest = annual / 12
  const annuity =
    (principal * r) / (1 - Math.pow(1 + r, -MORTGAGE_TERM_MONTHS))
  return {
    interest: Math.round(monthlyInterest),
    afdrag: Math.round(annuity - monthlyInterest),
    total: roundTo100(annuity),
    principal: Math.round(principal),
  }
}

/** Convenience: the full monthly mortgage payment (interest + afdrag). */
export function estimateMortgagePayment(annualInterest: number): number {
  return estimateMortgage(annualInterest).total
}

export function generateBudget(
  params: BudgetEstimateParams
): GeneratedBudgetItem[] {
  const adults = Math.max(0, Math.floor(params.adults))
  const children = Math.max(0, Math.floor(params.children))
  const cars = Math.max(0, Math.floor(params.cars))
  const housingCost = Math.max(0, Math.round(params.housingCost))
  const persons = adults + children

  // Lifestyle multiplier for discretionary lines: -1..+1 → 0.5x..1.5x.
  const lifestyleFactor = 1 + clamp(params.lifestyle ?? 0, -1, 1) * 0.5

  const candidates: Candidate[] = [
    { label: "Husleje / boliglån", amount: housingCost, category: "bolig" },
    {
      label: "Vedligehold af bolig",
      amount: params.ownsHome ? 900 : 0,
      category: "bolig",
    },
    { label: "El og varme", amount: 600 + 250 * persons, category: "bolig" },
    { label: "Vand og afledning", amount: 150 + 80 * persons, category: "bolig" },
    {
      label: "Internet og telefon",
      amount: 300 + 120 * adults + 30 * children,
      category: "bolig",
    },
    {
      label: "TV og streaming",
      amount: 300 + 50 * children,
      category: "abonnementer",
      lifestyle: true,
    },
    {
      label: "Dagligvarer",
      amount: 1750 * adults + 1400 * children,
      category: "mad",
      lifestyle: true,
    },
    {
      label: "Husholdning og rengøring",
      amount: 150 + 60 * persons,
      category: "mad",
    },
    {
      label: "Restaurant og takeaway",
      amount: 400 + 150 * adults + 100 * children,
      category: "mad",
      lifestyle: true,
    },
    { label: "Bil (afdrag/leasing)", amount: 2500 * cars, category: "transport" },
    { label: "Brændstof", amount: 1200 * cars, category: "transport" },
    { label: "Bilforsikring og vedligehold", amount: 700 * cars, category: "transport" },
    {
      label: "Offentlig transport",
      amount: (cars > 0 ? 300 : 600) * adults,
      category: "transport",
    },
    {
      label: "Indbo- og ulykkesforsikring",
      amount: 200 + 120 * adults,
      category: "forsikring",
    },
    {
      label: "Sundhedsforsikring og medicin",
      amount: 120 + 90 * adults + 40 * children,
      category: "forsikring",
    },
    { label: "A-kasse og fagforening", amount: 500 * adults, category: "personligt" },
    {
      label: "Børnepasning (institution/SFO)",
      amount: 2000 * children,
      category: "boern",
    },
    { label: "Børn: tøj, fritid og skole", amount: 650 * children, category: "boern" },
    {
      label: "Tøj og sko",
      amount: 400 * adults,
      category: "personligt",
      lifestyle: true,
    },
    {
      label: "Personlig pleje",
      amount: 250 * adults + 80 * children,
      category: "personligt",
      lifestyle: true,
    },
    {
      label: "Fritid og fornøjelser",
      amount: 400 + 150 * adults,
      category: "fritid",
      lifestyle: true,
    },
    {
      label: "Gaver og fester",
      amount: 200 + 80 * adults + 50 * children,
      category: "fritid",
      lifestyle: true,
    },
    {
      label: "Abonnementer (fitness, apps, aviser)",
      amount: 200 + 100 * adults,
      category: "abonnementer",
      lifestyle: true,
    },
    {
      label: "Ferie (opsparing)",
      amount: VACATION_BASE[params.vacationLevel] + 200 * children,
      category: "fritid",
      lifestyle: true,
    },
    { label: "Opsparing og buffer", amount: 1000, category: "opsparing" },
  ]

  return candidates
    .map((item) => ({
      label: item.label,
      amount: item.lifestyle ? item.amount * lifestyleFactor : item.amount,
      category: item.category,
    }))
    .filter((item) => item.amount > 0)
    .map((item) => ({
      label: item.label,
      amount: roundTo50(item.amount),
      category: item.category,
    }))
}
