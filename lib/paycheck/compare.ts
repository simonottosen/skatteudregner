import type { TaxInput, TaxResult } from "@/lib/tax/types"
import { getRates } from "@/lib/tax/rates"
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
  const rates = getRates(input.year)

  // Calculator (forskudsopgørelse) annual values — based on the REGISTERED income
  const calculatedAnnualTax = result.totalIncomeTax
  const calculatedAnnualAm = result.amBidragTotal
  const calculatedAnnualIncome = result.amBasis + result.insuranceBasis

  // YTD actual from paycheck
  const ytdTaxPaid = paycheck.ytd.taxPaid
  const ytdAmPaid = paycheck.ytd.amContribution

  // Marginal income-tax rate (excludes the 8% AM portion).
  const incomeMarginalRate = Math.max(
    0,
    result.marginalTaxRate - rates.amBidragRate
  )

  // Expected changes for the rest of the year, split by kind.
  const typeOf = (a: ExpectedAdjustment) => a.type ?? "income"
  const incomeAdjustmentsTotal = adjustments
    .filter((a) => typeOf(a) === "income")
    .reduce((s, a) => s + a.amount, 0)
  const pensionAdjustmentsTotal = adjustments
    .filter((a) => typeOf(a) === "pension")
    .reduce((s, a) => s + a.amount, 0)

  // Signed effect of one adjustment on the income tax owed:
  //   income       → +amount × marginal (more tax)
  //   pension/ded. → −amount × marginal (less tax via bortseelse/fradrag)
  const owedDeltaOf = (a: ExpectedAdjustment) =>
    (typeOf(a) === "income" ? 1 : -1) * a.amount * incomeMarginalRate

  // Projections (extrapolate the YTD paycheck to a full year)
  const projectedBaseIncome =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.amIncome * (12 / monthsElapsed))
      : 0
  // Only extra income raises gross income / AM; pension & deductions don't.
  const projectedAnnualIncome = projectedBaseIncome + incomeAdjustmentsTotal
  const projectedAnnualAm =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.amContribution * (12 / monthsElapsed)) +
        Math.round(incomeAdjustmentsTotal * rates.amBidragRate)
      : 0
  const projectedAnnualTax =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.taxPaid * (12 / monthsElapsed)) +
        Math.round(incomeAdjustmentsTotal * 0.38)
      : 0

  // Income tax owed on your actual income: the calculator's income tax,
  // adjusted by the marginal rate for (a) base income differing from the
  // registered income and (b) each expected change. This single "owed" figure
  // drives the KPIs, the chart and the restskat so they all reconcile.
  const baseOwedIncomeTax =
    calculatedAnnualTax +
    (projectedBaseIncome - calculatedAnnualIncome) * incomeMarginalRate
  const adjustmentsOwedDelta = adjustments.reduce(
    (s, a) => s + owedDeltaOf(a),
    0
  )
  const expectedAnnualIncomeTax = Math.max(
    0,
    Math.round(baseOwedIncomeTax + adjustmentsOwedDelta)
  )

  // YTD expected — pro-rata from the tax owed on ACTUAL income
  const ytdTaxExpected = Math.round((expectedAnnualIncomeTax / 12) * monthsElapsed)
  const ytdAmExpected = Math.round((projectedAnnualAm / 12) * monthsElapsed)

  // Monthly chart data. The owed line accrues the base income tax evenly and
  // STEPS at the month of each expected change (a bonus steps up, an extra
  // pension payment steps down), so e.g. a December bonus is visible. The plan
  // line is the forskudsopgørelse (even withholding); actual is paid-to-date.
  const planTaxPerMonth = calculatedAnnualTax / 12
  const actualTaxPerMonth =
    monthsElapsed > 0 ? paycheck.ytd.taxPaid / monthsElapsed : 0

  const monthlyData: MonthlyComparisonPoint[] = MONTH_LABELS.map(
    (label, i) => {
      const month = i + 1
      const adjAccrued = adjustments
        .filter((a) => a.month <= month)
        .reduce((s, a) => s + owedDeltaOf(a), 0)
      return {
        month,
        label,
        expectedCumulative: Math.round(
          Math.max(0, baseOwedIncomeTax * (month / 12) + adjAccrued)
        ),
        actualCumulative:
          month <= monthsElapsed
            ? Math.round(actualTaxPerMonth * month)
            : null,
        planCumulative: Math.round(planTaxPerMonth * month),
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
    incomeAdjustmentsTotal,
    pensionAdjustmentsTotal
  )

  // ── Estimated restskat (Model B) ──
  // Your employer withholds according to your forskudsopgørelse (including on a
  // bonus), so the year-end result is the tax+AM you actually OWE on your real
  // income minus what your forskudsopgørelse is built to collect.
  //   positive → restskat (you earn more than registered)
  //   negative → overskydende skat (you earn less than registered)
  // A bonus that brings your income up to the registered amount therefore drives
  // this toward 0.
  const owedTaxAndAm = expectedAnnualIncomeTax + projectedAnnualAm
  const plannedTaxAndAm = calculatedAnnualTax + calculatedAnnualAm
  const estimatedRestskat = Math.round(owedTaxAndAm - plannedTaxAndAm)

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
    expectedAnnualIncomeTax,
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
  totalAdjustments: number,
  pensionAdjustmentsTotal: number
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

  // ── Medarbejderpension (eget bidrag) ──
  // Payslip-projected own contribution + any planned extra pension payments.
  const projectedEmployeePension =
    (monthsElapsed > 0
      ? Math.round(paycheck.ytd.employeePension * (12 / monthsElapsed))
      : 0) + pensionAdjustmentsTotal
  const calculatorEmployeePension = input.employeePension
  if (
    projectedEmployeePension > 0 &&
    (calculatorEmployeePension === 0 ||
      Math.abs(projectedEmployeePension - calculatorEmployeePension) /
        Math.max(calculatorEmployeePension, 1) >
        threshold)
  ) {
    discrepancies.push({
      field: "employeePension",
      label: "Pension (eget bidrag)",
      paycheckValue: projectedEmployeePension,
      calculatorValue: calculatorEmployeePension,
      difference: projectedEmployeePension - calculatorEmployeePension,
      suggestion: calculatorEmployeePension === 0
        ? `Du indbetaler ${fmt(projectedEmployeePension)} kr./år til pension. Tilføj dette under "Pension (eget bidrag)" på skat.dk.`
        : `Opdatér "Pension (eget bidrag)" på skat.dk til ${fmt(projectedEmployeePension)} kr.`,
    })
  }

  // ── Arbejdsgiverpension ──
  const projectedEmployerPension =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.employerPension * (12 / monthsElapsed))
      : 0
  const calculatorEmployerPension = input.employerPension
  if (
    projectedEmployerPension > 0 &&
    (calculatorEmployerPension === 0 ||
      Math.abs(projectedEmployerPension - calculatorEmployerPension) /
        Math.max(calculatorEmployerPension, 1) >
        threshold)
  ) {
    discrepancies.push({
      field: "employerPension",
      label: "Pension (arbejdsgiver)",
      paycheckValue: projectedEmployerPension,
      calculatorValue: calculatorEmployerPension,
      difference: projectedEmployerPension - calculatorEmployerPension,
      suggestion: calculatorEmployerPension === 0
        ? `Din arbejdsgiver indbetaler ${fmt(projectedEmployerPension)} kr./år til pension. Tilføj dette under "Pension (arbejdsgiver)" på skat.dk.`
        : `Opdatér "Pension (arbejdsgiver)" på skat.dk til ${fmt(projectedEmployerPension)} kr.`,
    })
  }

  // ── ATP ──
  const projectedAtp =
    monthsElapsed > 0
      ? Math.round(paycheck.ytd.atp * (12 / monthsElapsed))
      : 0
  const calculatorAtp = input.atpEmployee
  if (
    projectedAtp > 0 &&
    (calculatorAtp === 0 ||
      Math.abs(projectedAtp - calculatorAtp) /
        Math.max(calculatorAtp, 1) >
        threshold)
  ) {
    discrepancies.push({
      field: "atpEmployee",
      label: "ATP-bidrag",
      paycheckValue: projectedAtp,
      calculatorValue: calculatorAtp,
      difference: projectedAtp - calculatorAtp,
      suggestion: calculatorAtp === 0
        ? `Du betaler ${fmt(projectedAtp)} kr./år i ATP. Tilføj dette under "ATP" på skat.dk.`
        : `Opdatér "ATP" på skat.dk til ${fmt(projectedAtp)} kr.`,
    })
  }

  return discrepancies
}
