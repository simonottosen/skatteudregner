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

  // From the calculator
  calculatedAnnualTax: number
  calculatedAnnualAm: number
  calculatedAnnualIncome: number

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
  expectedCumulative: number
  actualCumulative: number | null
  projectedCumulative: number | null
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
export interface ExpectedAdjustment {
  id: string
  label: string
  amount: number
  /** 1-12, the month the adjustment is expected */
  month: number
}
