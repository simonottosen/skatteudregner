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

interface AnnualFigure {
  value: number
  /** True when this came from the current period rather than year-to-date. */
  estimated: boolean
}

/**
 * Annualise one figure, preferring the year-to-date total: scaled over the
 * months elapsed it averages out variable months and counts bonuses already
 * paid.
 *
 * A payslip with no år-til-dato block still reports the current period, and
 * `parse-loenseddel.ts` fills those fields from the description lines
 * independently of the `(147)/(148)/(46)` codes — so falling back to them beats
 * dropping the figure. Dropping is not a neutral omission: a missing pension
 * contribution silently overstates the tax the user owes.
 */
function annualizeFigure(
  ytd: number,
  current: number,
  monthsElapsed: number
): AnnualFigure | null {
  if (ytd > 0) return { value: annualize(ytd, monthsElapsed), estimated: false }
  if (current > 0) return { value: Math.round(current * 12), estimated: true }
  return null
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

  // Every field falls back independently: a payslip can carry a year-to-date
  // total for one figure and only the current period for another.
  let projected = false
  let estimated = false

  const fields: {
    /** The money fields only — `year` is not a figure to annualise. */
    key: Exclude<keyof PayslipTaxInput, "year">
    label: string
    ytd: number
    current: number
  }[] = [
    {
      key: "workIncome",
      label: "Arbejdsindkomst (A-indkomst)",
      ytd: paycheck.ytd.amIncome,
      current: paycheck.grossSalary,
    },
    {
      key: "employeePension",
      label: "Eget pensionsbidrag",
      ytd: paycheck.ytd.employeePension,
      current: paycheck.employeePension,
    },
    {
      key: "employerPension",
      label: "Arbejdsgivers pensionsbidrag",
      ytd: paycheck.ytd.employerPension,
      current: paycheck.employerPension,
    },
    {
      key: "atpEmployee",
      label: "ATP-bidrag (arbejdsgiver)",
      ytd: paycheck.ytd.atp,
      current: paycheck.atp,
    },
  ]

  for (const field of fields) {
    const figure = annualizeFigure(field.ytd, field.current, months)
    if (!figure) continue
    data[field.key] = figure.value
    filledLabels.push(field.label)
    if (figure.estimated) estimated = true
    else if (months < 12) projected = true
  }

  if (data.workIncome == null) {
    warnings.push(
      "Ingen lønindkomst kunne læses af lønsedlen. Udfyld den manuelt."
    )
  }

  if (estimated) {
    // The current period alone misses variable pay a year-to-date total would
    // have included.
    warnings.push(
      "Lønsedlen mangler år-til-dato-felter, så nogle beløb er anslået som denne måneds tal gange 12. Bonus og tillæg er ikke talt med — tjek beløbene."
    )
  }
  if (projected) {
    warnings.push(
      `Beløbene er fremskrevet fra ${months} måned${months === 1 ? "" : "er"} til et helt år.`
    )
  }

  return { data, filledLabels, warnings }
}
