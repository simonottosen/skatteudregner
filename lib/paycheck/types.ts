export interface PaycheckData {
  payPeriod: { from: string; to: string }
  month: number
  year: number

  // Current period amounts
  grossSalary: number
  amContribution: number
  taxPaid: number
  employeePension: number
  employerPension: number
  atp: number
  netSalary: number

  // Year-to-date
  ytd: {
    amIncome: number
    taxPaid: number
    amContribution: number
    atp: number
    employeePension: number
    employerPension: number
  }

  // Addresses parsed from payslip (may be empty)
  employeeAddress?: string
  employerAddress?: string
}

export interface PaycheckParseResult {
  data: PaycheckData | null
  warnings: string[]
  fieldsFound: string[]
}

export interface ComparisonResult {
  month: number
  monthsElapsed: number

  // YTD actual vs expected
  ytdTaxPaid: number
  ytdTaxExpected: number
  ytdTaxDifference: number

  ytdAmPaid: number
  ytdAmExpected: number
  ytdAmDifference: number

  // Annual projections based on paycheck data
  projectedAnnualIncome: number
  projectedAnnualTax: number
  projectedAnnualAm: number

  // From the calculator (forskudsopgørelse — registered income)
  calculatedAnnualTax: number
  calculatedAnnualAm: number
  calculatedAnnualIncome: number

  /**
   * Income tax you'll actually owe on your *projected* income (the calculator's
   * income tax adjusted by the marginal income-tax rate for the income
   * difference). This is the figure that reconciles the YTD comparison with the
   * estimated restskat.
   */
  expectedAnnualIncomeTax: number

  // Per-month chart data
  monthlyData: MonthlyComparisonPoint[]

  // Discrepancy indicators
  discrepancies: Discrepancy[]

  /**
   * Estimated restskat (positive = user owes, negative = user gets refund).
   * Computed as: tax owed on projected income − tax being withheld.
   */
  estimatedRestskat: number
}

export interface MonthlyComparisonPoint {
  month: number
  label: string
  /** Tax owed on your actual (projected) income. */
  expectedCumulative: number
  /** Tax actually paid so far (null for future months). */
  actualCumulative: number | null
  /** Tax your forskudsopgørelse is built to collect. */
  planCumulative: number
}

export interface Discrepancy {
  field: string
  label: string
  paycheckValue: number
  calculatorValue: number
  difference: number
  suggestion: string
}

/** User-supplied expected income adjustments for the rest of the year */
/**
 * Kind of expected change:
 *  - "income"    extra taxable income (bonus, raise) → increases tax
 *  - "pension"   extra pension contribution (bortseelse) → reduces tax
 *  - "deduction" other deductible expense → reduces tax
 */
export type AdjustmentType = "income" | "pension" | "deduction"

export interface ExpectedAdjustment {
  id: string
  label: string
  amount: number
  /** 1-12, the month the adjustment is expected */
  month: number
  /** Defaults to "income" when missing (back-compat with saved data). */
  type?: AdjustmentType
}
