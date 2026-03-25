import type { TaxInput, TaxResult } from "@/lib/tax/types"
import type {
  PaycheckData,
  ComparisonResult,
  MonthlyComparisonPoint,
  Discrepancy,
  ExpectedAdjustment,
} from "./types"

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "Maj", "Jun",
  "Jul", "Aug", "Sep", "Okt", "Nov", "Dec",
]

export function comparePaycheckToCalculation(
  input: TaxInput,
  result: TaxResult,
  paycheck: PaycheckData,
  adjustments: ExpectedAdjustment[] = []
): ComparisonResult {
  const monthsElapsed = paycheck.month

  // Calculator annual values (income tax = total tax minus stock/property)
  const calculatedAnnualTax = result.totalIncomeTax
  const calculatedAnnualAm = result.amBidragTotal
  const calculatedAnnualIncome =
    result.amBasis + result.insuranceBasis

  // YTD expected (pro-rata from annual calculator result)
  const ytdTaxExpected = Math.round(
    (calculatedAnnualTax / 12) * monthsElapsed
  )
  const ytdAmExpected = Math.round(
    (calculatedAnnualAm / 12) * monthsElapsed
  )

  // YTD actual from paycheck
  const ytdTaxPaid = paycheck.ytd.taxPaid
  const ytdAmPaid = paycheck.ytd.amContribution

  // Total expected adjustments (bonuses, etc.)
  const totalAdjustments = adjustments.reduce((sum, a) => sum + a.amount, 0)

  // Build a map of adjustment amounts by month for the chart
  const adjustmentByMonth = new Map<number, number>()
  for (const a of adjustments) {
    adjustmentByMonth.set(
      a.month,
      (adjustmentByMonth.get(a.month) ?? 0) + a.amount
    )
  }

  // Projections (extrapolate YTD to full year + adjustments)
  const projectedBaseIncome =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.amIncome * (12 / monthsElapsed))
      : 0
  const projectedAnnualIncome = projectedBaseIncome + totalAdjustments
  const projectedAnnualTax =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.taxPaid * (12 / monthsElapsed)) +
        Math.round(totalAdjustments * 0.38)
      : 0
  const projectedAnnualAm =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.amContribution * (12 / monthsElapsed)) +
        Math.round(totalAdjustments * 0.08)
      : 0

  // Monthly chart data
  const monthlyTaxPerMonth = calculatedAnnualTax / 12
  const actualTaxPerMonth =
    monthsElapsed > 0 ? paycheck.ytd.taxPaid / monthsElapsed : 0
  const projectedTaxPerMonth = actualTaxPerMonth

  const monthlyData: MonthlyComparisonPoint[] = MONTH_LABELS.map(
    (label, i) => {
      const month = i + 1
      const expectedCumulative = Math.round(monthlyTaxPerMonth * month)

      let actualCumulative: number | null = null
      if (month <= monthsElapsed) {
        actualCumulative = Math.round(actualTaxPerMonth * month)
      }

      let projectedCumulative: number | null = null
      if (month >= monthsElapsed) {
        // Start from actual YTD, add projected monthly tax for remaining months
        let base = paycheck.ytd.taxPaid +
          projectedTaxPerMonth * (month - monthsElapsed)

        // Add estimated tax on adjustments for months up to this point
        for (const [adjMonth, adjAmount] of adjustmentByMonth) {
          if (adjMonth <= month && adjMonth > monthsElapsed) {
            base += Math.round(adjAmount * 0.38)
          }
        }

        projectedCumulative = Math.round(base)
      }

      return {
        month,
        label,
        expectedCumulative,
        actualCumulative,
        projectedCumulative,
      }
    }
  )

  // Discrepancies — use BASE projections (without adjustments) so suggestions
  // reflect the recurring salary trajectory, not one-off bonuses
  const projectedBaseTax =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.taxPaid * (12 / monthsElapsed))
      : 0
  const projectedBaseAm =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.amContribution * (12 / monthsElapsed))
      : 0

  const discrepancies = detectDiscrepancies(
    input,
    result,
    paycheck,
    monthsElapsed,
    projectedBaseIncome,
    projectedBaseTax,
    projectedBaseAm,
    totalAdjustments
  )

  // ── Estimated restskat ──
  // Tax being withheld is based on the current forskudsopgørelse (calculatedAnnualIncome).
  // If actual income differs, extra tax is owed on the difference.
  //
  // taxOwed = calculatedTax + calculatedAm + marginalRate * incomeDifference
  // taxPaid = extrapolated withholdings from paycheck
  // restskat = taxOwed − taxPaid
  const incomeDiff = projectedAnnualIncome - calculatedAnnualIncome
  const marginalRate = result.marginalTaxRate // includes AM portion
  const taxOwedOnProjectedIncome =
    calculatedAnnualTax + calculatedAnnualAm + incomeDiff * marginalRate
  const taxBeingWithheld = projectedAnnualTax + projectedAnnualAm
  const estimatedRestskat = Math.round(
    taxOwedOnProjectedIncome - taxBeingWithheld
  )

  return {
    month: paycheck.month,
    monthsElapsed,
    ytdTaxPaid,
    ytdTaxExpected,
    ytdTaxDifference: ytdTaxPaid - ytdTaxExpected,
    ytdAmPaid,
    ytdAmExpected,
    ytdAmDifference: ytdAmPaid - ytdAmExpected,
    projectedAnnualIncome,
    projectedAnnualTax,
    projectedAnnualAm,
    calculatedAnnualTax,
    calculatedAnnualAm,
    calculatedAnnualIncome,
    monthlyData,
    discrepancies,
    estimatedRestskat,
  }
}

/**
 * Detect discrepancies — only for ACTIONABLE fields the user can change
 * on skat.dk (lønindkomst, pension). AM-bidrag and indkomstskat are
 * consequences and not directly editable, so they're omitted.
 */
function detectDiscrepancies(
  input: TaxInput,
  _result: TaxResult,
  paycheck: PaycheckData,
  monthsElapsed: number,
  projectedBaseIncome: number,
  _projectedBaseTax: number,
  _projectedBaseAm: number,
  totalAdjustments: number
): Discrepancy[] {
  const discrepancies: Discrepancy[] = []
  const threshold = 0.05
  const fmt = (n: number) => Math.round(n).toLocaleString("da-DK")
  const hasAdjustments = totalAdjustments > 0
  const recommendedIncome = projectedBaseIncome + totalAdjustments

  // ── Lønindkomst ──
  // This is the main field the user controls on skat.dk
  const calculatorIncome = input.workIncome
  if (calculatorIncome > 0 && recommendedIncome > 0) {
    const diff = recommendedIncome - calculatorIncome
    const pctDiff = Math.abs(diff) / calculatorIncome

    if (pctDiff > threshold) {
      let suggestion: string
      if (hasAdjustments) {
        suggestion =
          `Din grundløn fremskrives til ${fmt(projectedBaseIncome)} kr.`
        if (projectedBaseIncome !== recommendedIncome) {
          suggestion += ` Med forventede tillæg på ${fmt(totalAdjustments)} kr. bliver den samlede forventede indkomst ${fmt(recommendedIncome)} kr.`
        }
        suggestion += ` Opdatér "Lønindkomst" på skat.dk til ${fmt(recommendedIncome)} kr.`
      } else {
        suggestion = `Opdatér "Lønindkomst" på skat.dk til ${fmt(recommendedIncome)} kr.`
      }

      discrepancies.push({
        field: "workIncome",
        label: "Lønindkomst",
        paycheckValue: recommendedIncome,
        calculatorValue: calculatorIncome,
        difference: diff,
        suggestion,
      })
    }
  }

  // ── Medarbejderpension ──
  // Also an editable field on skat.dk
  const projectedEmployeePension =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.employeePension * (12 / monthsElapsed))
      : 0
  const calculatorPension = input.employeePension
  if (
    calculatorPension > 0 &&
    projectedEmployeePension > 0 &&
    Math.abs(projectedEmployeePension - calculatorPension) /
      calculatorPension >
      threshold
  ) {
    discrepancies.push({
      field: "employeePension",
      label: "Medarbejderpension",
      paycheckValue: projectedEmployeePension,
      calculatorValue: calculatorPension,
      difference: projectedEmployeePension - calculatorPension,
      suggestion: `Opdatér "Pension (eget bidrag)" på skat.dk til ${fmt(projectedEmployeePension)} kr.`,
    })
  }

  return discrepancies
}
