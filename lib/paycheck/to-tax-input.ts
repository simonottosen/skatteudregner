/**
 * Map a parsed lønseddel onto the tax calculator's input fields, so a payslip
 * alone is enough to get started — no forskudsopgørelse required.
 *
 * A payslip is monthly and `TaxInput` is annual, so every figure is a
 * projection: the year-to-date total scaled up by the months elapsed. That is
 * the annualisation `comparePaycheckToCalculation` already applies to the same
 * fields, so an import agrees with the change the comparison view suggests for
 * the same document — a test pins that.
 *
 * The field mapping follows the calculator's model, not the payslip's layout:
 * `workIncome` is AM-bidragspligtig indkomst *before* eget pensionsbidrag is
 * taken out (`calculations/am-bidrag.ts` charges AM on it, and
 * `calculations/personal-income.ts` subtracts the contribution itself), which is
 * exactly what payroll code (13) reports. Setting both fields is therefore not
 * a double deduction.
 */

import { TAX_RATES } from "@/lib/tax/rates"
import type { TaxInput, TaxYear } from "@/lib/tax/types"
import type { PaycheckData } from "./types"

/**
 * The three fields the calculator needs that no payslip carries. Named as the
 * form labels them, because the UI shows these to say "still assumptions".
 */
export const PAYSLIP_ASSUMED_FIELDS = [
  "Kommune",
  "Medlem af folkekirken",
  "Fødselsdato",
] as const

/** The subset of `TaxInput` a payslip can populate. */
export type PayslipTaxInput = Pick<
  Partial<TaxInput>,
  "year" | "workIncome" | "employeePension" | "employerPension" | "atpEmployee"
>

export interface PayslipImportResult {
  data: PayslipTaxInput
  /** Form labels of the fields that were filled, for the import receipt. */
  filledLabels: string[]
  warnings: string[]
}

function isSupportedYear(year: number): year is TaxYear {
  return year in TAX_RATES
}

/** Scale a year-to-date total up to a full year. */
export function annualize(ytd: number, monthsElapsed: number): number {
  return Math.round(ytd * (12 / monthsElapsed))
}

export function payslipToTaxInput(paycheck: PaycheckData): PayslipImportResult {
  const months = paycheck.month
  const data: PayslipTaxInput = {}
  const filledLabels: string[] = []
  const warnings: string[] = []

  if (!Number.isInteger(months) || months < 1 || months > 12) {
    return {
      data,
      filledLabels,
      warnings: [
        "Lønperioden kunne ikke tolkes, så beløbene kan ikke omregnes til årsbeløb.",
      ],
    }
  }

  if (isSupportedYear(paycheck.year)) {
    data.year = paycheck.year
    filledLabels.push("Indkomstår")
  } else {
    warnings.push(
      `Lønsedlen er fra ${paycheck.year}, som beregneren ikke dækker. Indkomståret er uændret.`
    )
  }

  // Year-to-date over months elapsed averages out variable months and counts
  // bonuses already paid, so it projects better than this month's figures × 12.
  let annualized = false
  if (paycheck.ytd.amIncome > 0) {
    data.workIncome = annualize(paycheck.ytd.amIncome, months)
    filledLabels.push("Arbejdsindkomst (A-indkomst)")
    annualized = true
  } else if (paycheck.grossSalary > 0) {
    // No år-til-dato block on this payslip. The salary line alone misses
    // variable pay the year-to-date total would have included, so warn.
    data.workIncome = Math.round(paycheck.grossSalary * 12)
    filledLabels.push("Arbejdsindkomst (A-indkomst)")
    warnings.push(
      "Lønsedlen har ingen år-til-dato-felter, så lønindkomsten er anslået som denne måneds løn gange 12. Bonus og tillæg er ikke talt med — tjek beløbet."
    )
  } else {
    warnings.push(
      "Ingen lønindkomst kunne læses af lønsedlen. Udfyld den manuelt."
    )
  }

  if (paycheck.ytd.employeePension > 0) {
    data.employeePension = annualize(paycheck.ytd.employeePension, months)
    filledLabels.push("Eget pensionsbidrag")
    annualized = true
  }
  if (paycheck.ytd.employerPension > 0) {
    data.employerPension = annualize(paycheck.ytd.employerPension, months)
    filledLabels.push("Arbejdsgivers pensionsbidrag")
    annualized = true
  }
  if (paycheck.ytd.atp > 0) {
    data.atpEmployee = annualize(paycheck.ytd.atp, months)
    filledLabels.push("ATP-bidrag (arbejdsgiver)")
    annualized = true
  }

  if (annualized && months < 12) {
    warnings.push(
      `Beløbene er fremskrevet fra ${months} måned${months === 1 ? "" : "er"} til et helt år.`
    )
  }

  return { data, filledLabels, warnings }
}
