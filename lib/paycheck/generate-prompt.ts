import type { TaxInput, TaxResult } from "@/lib/tax/types"
import type { PaycheckData, ComparisonResult, ExpectedAdjustment } from "./types"

function fmt(n: number): string {
  return Math.round(n).toLocaleString("da-DK")
}

export function generateOptimizationPrompt(
  input: TaxInput,
  result: TaxResult,
  paycheck: PaycheckData,
  comparison: ComparisonResult,
  adjustments: ExpectedAdjustment[] = []
): string {
  const lines: string[] = []

  lines.push("# Danish Tax Schema Optimization Request")
  lines.push("")
  lines.push(
    "I need help optimizing my Danish tax prepayment schema (forskudsopgørelse). " +
    "Below is my current tax schema, actual paycheck data, and a comparison showing discrepancies. " +
    "Please suggest specific changes to my forskudsopgørelse fields to minimize year-end tax surprises."
  )
  lines.push("")

  // Current tax schema
  lines.push("## Current Tax Schema (Forskudsopgørelse)")
  lines.push(`- Year: ${input.year}`)
  lines.push(`- Municipality: ${input.municipality}`)
  lines.push(`- Church member: ${input.churchMember ? "Yes" : "No"}`)
  if (input.workIncome > 0) lines.push(`- Work income (lønindkomst): ${fmt(input.workIncome)} kr.`)
  if (input.honorarIncome > 0) lines.push(`- Honorar income (B-indkomst): ${fmt(input.honorarIncome)} kr.`)
  if (input.employeePension > 0) lines.push(`- Employee pension: ${fmt(input.employeePension)} kr.`)
  if (input.employerPension > 0) lines.push(`- Employer pension: ${fmt(input.employerPension)} kr.`)
  if (input.privatePensionRatepension > 0) lines.push(`- Private ratepension: ${fmt(input.privatePensionRatepension)} kr.`)
  if (input.mortgageInterest > 0) lines.push(`- Mortgage interest: ${fmt(input.mortgageInterest)} kr.`)
  if (input.bankInterest > 0) lines.push(`- Bank interest expenses: ${fmt(input.bankInterest)} kr.`)
  if (input.unionFees > 0) lines.push(`- Union fees: ${fmt(input.unionFees)} kr.`)
  if (input.aKasse > 0) lines.push(`- A-kasse: ${fmt(input.aKasse)} kr.`)
  if (input.transferIncome > 0) lines.push(`- Transfer income: ${fmt(input.transferIncome)} kr.`)
  if (input.bondGains > 0) lines.push(`- Bond gains: ${fmt(input.bondGains)} kr.`)
  if (input.danishDividends > 0) lines.push(`- Danish dividends: ${fmt(input.danishDividends)} kr.`)
  if (input.foreignDividends > 0) lines.push(`- Foreign dividends: ${fmt(input.foreignDividends)} kr.`)
  if (input.stockSaleGains > 0) lines.push(`- Stock sale gains: ${fmt(input.stockSaleGains)} kr.`)
  lines.push("")

  // Calculator results
  lines.push("## Calculator Results (Annual Estimates)")
  lines.push(`- Personal income: ${fmt(result.personalIncome)} kr.`)
  lines.push(`- Taxable income: ${fmt(result.taxableIncome)} kr.`)
  lines.push(`- AM-bidrag: ${fmt(result.amBidragTotal)} kr.`)
  lines.push(`- Income tax: ${fmt(result.totalIncomeTax)} kr.`)
  lines.push(`- Total tax: ${fmt(result.totalTax)} kr.`)
  lines.push(`- Effective tax rate: ${(result.effectiveTaxRate * 100).toFixed(1)}%`)
  lines.push(`- Net income: ${fmt(result.netIncome)} kr.`)
  lines.push("")

  // Paycheck data
  lines.push("## Latest Paycheck Data")
  lines.push(`- Pay period: ${paycheck.payPeriod.from} to ${paycheck.payPeriod.to}`)
  lines.push(`- Month: ${paycheck.month} of 12`)
  lines.push(`- Gross salary (monthly): ${fmt(paycheck.grossSalary)} kr.`)
  lines.push(`- AM-contribution (monthly): ${fmt(paycheck.amContribution)} kr.`)
  lines.push(`- Tax paid (monthly): ${fmt(paycheck.taxPaid)} kr.`)
  lines.push(`- Net salary (monthly): ${fmt(paycheck.netSalary)} kr.`)
  lines.push("")
  lines.push("### Year-to-Date (YTD)")
  lines.push(`- AM-income YTD: ${fmt(paycheck.ytd.amIncome)} kr.`)
  lines.push(`- Tax paid YTD: ${fmt(paycheck.ytd.taxPaid)} kr.`)
  lines.push(`- AM-contribution YTD: ${fmt(paycheck.ytd.amContribution)} kr.`)
  lines.push(`- Employee pension YTD: ${fmt(paycheck.ytd.employeePension)} kr.`)
  lines.push(`- Employer pension YTD: ${fmt(paycheck.ytd.employerPension)} kr.`)
  lines.push("")

  // Comparison
  lines.push("## Comparison (YTD Actual vs Expected)")
  lines.push(`- Months elapsed: ${comparison.monthsElapsed}`)
  lines.push(
    `- Tax paid YTD: ${fmt(comparison.ytdTaxPaid)} kr. (expected: ${fmt(comparison.ytdTaxExpected)} kr., difference: ${comparison.ytdTaxDifference >= 0 ? "+" : ""}${fmt(comparison.ytdTaxDifference)} kr.)`
  )
  lines.push(
    `- AM-bidrag paid YTD: ${fmt(comparison.ytdAmPaid)} kr. (expected: ${fmt(comparison.ytdAmExpected)} kr., difference: ${comparison.ytdAmDifference >= 0 ? "+" : ""}${fmt(comparison.ytdAmDifference)} kr.)`
  )
  lines.push("")
  lines.push("### Annual Projections (based on YTD paycheck data)")
  lines.push(`- Projected annual income: ${fmt(comparison.projectedAnnualIncome)} kr. (calculator: ${fmt(comparison.calculatedAnnualIncome)} kr.)`)
  lines.push(`- Projected annual tax: ${fmt(comparison.projectedAnnualTax)} kr. (calculator: ${fmt(comparison.calculatedAnnualTax)} kr.)`)
  lines.push(`- Projected annual AM-bidrag: ${fmt(comparison.projectedAnnualAm)} kr. (calculator: ${fmt(comparison.calculatedAnnualAm)} kr.)`)
  lines.push("")

  // Discrepancies
  if (comparison.discrepancies.length > 0) {
    lines.push("## Discrepancies Found")
    for (const d of comparison.discrepancies) {
      lines.push(
        `- **${d.label}**: Paycheck projects ${fmt(d.paycheckValue)} kr., calculator shows ${fmt(d.calculatorValue)} kr. (${d.difference >= 0 ? "+" : ""}${fmt(d.difference)} kr.)`
      )
    }
    lines.push("")
  }

  // Expected adjustments
  if (adjustments.length > 0) {
    const totalAdj = adjustments.reduce((sum, a) => sum + a.amount, 0)
    lines.push("## Expected Income Adjustments (Rest of Year)")
    lines.push(
      "The user expects the following additional income changes for the remainder of the year:"
    )
    for (const a of adjustments) {
      lines.push(
        `- **${a.label}**: ${fmt(a.amount)} kr. in month ${a.month}`
      )
    }
    lines.push(`- **Total additional income**: ${fmt(totalAdj)} kr.`)
    lines.push(
      "These adjustments are already factored into the projected annual figures above."
    )
    lines.push("")
  }

  lines.push("## Request")
  lines.push(
    "Based on the data above, please suggest specific changes to my forskudsopgørelse fields. " +
    "For each suggestion, explain: (1) which field to change and to what value, (2) why, and " +
    "(3) the expected impact on my monthly tax payments. " +
    "Also flag if I am likely to receive a tax refund or owe additional tax at year-end based on current trajectory."
  )
  if (adjustments.length > 0) {
    lines.push(
      "Pay special attention to the expected income adjustments (e.g. bonuses) and how they should " +
      "be reflected in the forskudsopgørelse to avoid a large year-end tax bill."
    )
  }

  return lines.join("\n")
}
