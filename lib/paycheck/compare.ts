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

  // Discrepancies
  const discrepancies = detectDiscrepancies(
    input,
    result,
    paycheck,
    monthsElapsed,
    projectedAnnualIncome,
    projectedAnnualTax,
    projectedAnnualAm
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
  }
}

function detectDiscrepancies(
  input: TaxInput,
  result: TaxResult,
  paycheck: PaycheckData,
  monthsElapsed: number,
  projectedAnnualIncome: number,
  projectedAnnualTax: number,
  projectedAnnualAm: number
): Discrepancy[] {
  const discrepancies: Discrepancy[] = []
  const threshold = 0.05

  // Income comparison
  const calculatorIncome = input.workIncome
  if (
    calculatorIncome > 0 &&
    projectedAnnualIncome > 0 &&
    Math.abs(projectedAnnualIncome - calculatorIncome) / calculatorIncome >
      threshold
  ) {
    discrepancies.push({
      field: "workIncome",
      label: "Lønindkomst",
      paycheckValue: projectedAnnualIncome,
      calculatorValue: calculatorIncome,
      difference: projectedAnnualIncome - calculatorIncome,
      suggestion:
        projectedAnnualIncome > calculatorIncome
          ? `Din faktiske indkomst ser ud til at være højere end din forskudsopgørelse. Overvej at opdatere lønindkomst til ${Math.round(projectedAnnualIncome).toLocaleString("da-DK")} kr.`
          : `Din faktiske indkomst ser ud til at være lavere end din forskudsopgørelse. Overvej at opdatere lønindkomst til ${Math.round(projectedAnnualIncome).toLocaleString("da-DK")} kr.`,
    })
  }

  // AM-bidrag comparison
  const calculatorAm = result.amBidragTotal
  if (
    calculatorAm > 0 &&
    projectedAnnualAm > 0 &&
    Math.abs(projectedAnnualAm - calculatorAm) / calculatorAm > threshold
  ) {
    discrepancies.push({
      field: "amBidrag",
      label: "AM-bidrag",
      paycheckValue: projectedAnnualAm,
      calculatorValue: calculatorAm,
      difference: projectedAnnualAm - calculatorAm,
      suggestion: `Forventet AM-bidrag (${Math.round(projectedAnnualAm).toLocaleString("da-DK")} kr.) afviger fra beregnet (${Math.round(calculatorAm).toLocaleString("da-DK")} kr.). Tjek om din AM-pligtige indkomst er korrekt.`,
    })
  }

  // Tax comparison
  const calculatorTax = result.totalIncomeTax
  if (
    calculatorTax > 0 &&
    projectedAnnualTax > 0 &&
    Math.abs(projectedAnnualTax - calculatorTax) / calculatorTax > threshold
  ) {
    discrepancies.push({
      field: "tax",
      label: "Indkomstskat",
      paycheckValue: projectedAnnualTax,
      calculatorValue: calculatorTax,
      difference: projectedAnnualTax - calculatorTax,
      suggestion:
        projectedAnnualTax > calculatorTax
          ? `Du betaler mere skat end forventet. Du kan ende med at få penge tilbage ved årsopgørelsen, eller din forskudsopgørelse mangler indkomst.`
          : `Du betaler mindre skat end forventet. Du kan ende med at skylde skat ved årsopgørelsen. Overvej at opdatere din forskudsopgørelse.`,
    })
  }

  // Pension comparison
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
      suggestion: `Din medarbejderpension afviger fra forskudsopgørelsen. Overvej at opdatere til ${Math.round(projectedEmployeePension).toLocaleString("da-DK")} kr.`,
    })
  }

  return discrepancies
}
