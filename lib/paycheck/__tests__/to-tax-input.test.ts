import { describe, it, expect } from "vitest"
import { parseLoenseddelFromText } from "@/lib/pdf/parse-loenseddel"
import { createDefaultInput } from "@/lib/tax/defaults"
import { calculateTax } from "@/lib/tax/calculator"
import { payslipToTaxInput } from "../to-tax-input"
import { ASSUMED_FIELDS, assumedFields, withImport, EMPTY_PROVENANCE } from "@/lib/tax/provenance"
import { comparePaycheckToCalculation } from "../compare"
import type { PaycheckData } from "../types"

/** A March payslip: three months elapsed, so year-to-date is scaled by 4. */
const MARCH_PAYCHECK = `
Pay specification

Pay period: 01-03-2026 - 31-03-2026

Paytype  Description  Units  Rate  Balance  Amount
1000  Salary  173,33  102.083,34
8500  Net salary  48.838,05

Opening balance  Period  Year to date
(13) AM-income  91.731,89  331.764,49
(15) TAX-contribution  34.627,00  126.781,00
(16) AM-contribution  7.339,00  26.542,00
(46) ATP  297,00  891,00
(147) Employee's pension  2.552,08  7.656,24
(148) Employer's pension  581,88  1.745,64
`

function makePaycheck(overrides: Partial<PaycheckData> = {}): PaycheckData {
  return {
    payPeriod: { from: "2026-06-01", to: "2026-06-30" },
    month: 6,
    year: 2026,
    grossSalary: 50_000,
    amContribution: 4_000,
    taxPaid: 17_000,
    employeePension: 2_500,
    employerPension: 5_000,
    atp: 99,
    netSalary: 26_500,
    ytd: {
      amIncome: 300_000,
      taxPaid: 102_000,
      amContribution: 24_000,
      atp: 594,
      employeePension: 15_000,
      employerPension: 30_000,
    },
    ...overrides,
  }
}

describe("payslipToTaxInput", () => {
  it("annualises a real parsed payslip from year-to-date over months elapsed", () => {
    const parsed = parseLoenseddelFromText(MARCH_PAYCHECK)
    expect(parsed.data).not.toBeNull()

    const { data, filledLabels } = payslipToTaxInput(parsed.data!)

    // March → ×12/3.
    expect(data.workIncome).toBe(1_327_058) // 331.764,49 × 4
    expect(data.employeePension).toBe(30_625) // 7.656,24 × 4
    expect(data.employerPension).toBe(6_983) // 1.745,64 × 4
    expect(data.atpEmployee).toBe(3_564) // 891 × 4
    expect(data.year).toBe(2026)
    expect(filledLabels).toContain("Arbejdsindkomst (A-indkomst)")
  })

  it("projects the same income the comparison view would suggest", () => {
    // Both features read the same payslip, so an import must not land the user
    // on a figure the comparison view then tells them to change.
    const paycheck = makePaycheck()
    const { data } = payslipToTaxInput(paycheck)

    const input = { ...createDefaultInput(), ...data }
    const comparison = comparePaycheckToCalculation(
      input,
      calculateTax(input),
      paycheck
    )
    expect(comparison.projectedAnnualIncome).toBe(data.workIncome)
    // …and with the imported figures in place it has nothing left to flag.
    expect(comparison.discrepancies).toEqual([])
  })

  it("maps AM-income to workIncome without netting out pension", () => {
    // AM-bidrag is charged on the salary including the employee's own pension
    // contribution, and calculatePersonalIncome subtracts that contribution
    // itself — so pre-subtracting it here would deduct it twice.
    const input = { ...createDefaultInput(), ...payslipToTaxInput(makePaycheck()).data }
    expect(input.workIncome).toBe(600_000) // 300.000 × 12/6
    expect(input.employeePension).toBe(30_000) // 15.000 × 12/6
    // AM-bidrag lands on the full 600.000, not on 600.000 − 30.000.
    expect(calculateTax(input).amBidragTotal).toBe(48_000)
  })

  it("leaves the fields a payslip cannot carry exactly as the user had them", () => {
    const before = {
      ...createDefaultInput(),
      municipality: "Aarhus",
      churchMember: true,
      birthDate: "1991-07-02",
    }
    // The reducer merges only defined keys, so an absent key is a no-op.
    const after = { ...before, ...payslipToTaxInput(makePaycheck()).data }

    expect(after.municipality).toBe("Aarhus")
    expect(after.churchMember).toBe(true)
    expect(after.birthDate).toBe("1991-07-02")
  })

  it("leaves every field the form assumes for the notice to flag", () => {
    // The notice is derived from what the import filled, so this pins the other
    // half of the contract: a payslip supplies none of the assumed fields.
    const provenance = withImport(
      EMPTY_PROVENANCE,
      payslipToTaxInput(makePaycheck()).data,
      "loenseddel"
    )
    expect(assumedFields(provenance)).toEqual([...ASSUMED_FIELDS])
  })

  it("leaves a December payslip's totals unscaled", () => {
    const base = makePaycheck()
    const { data, warnings } = payslipToTaxInput({
      ...base,
      month: 12,
      ytd: { ...base.ytd, amIncome: 600_000 },
    })
    expect(data.workIncome).toBe(600_000)
    expect(warnings.some((w) => w.includes("fremskrevet"))).toBe(false)
  })

  it("warns that a part-year payslip has been projected", () => {
    const { warnings } = payslipToTaxInput(makePaycheck({ month: 1 }))
    expect(warnings.some((w) => w.includes("1 måned til et helt år"))).toBe(true)
  })

  it("falls back to the current period × 12 when the payslip has no year-to-date block", () => {
    // Dropping these would not be neutral: a missing pension contribution
    // overstates the tax owed, so every field falls back, not just income.
    const { data, filledLabels, warnings } = payslipToTaxInput(
      makePaycheck({
        grossSalary: 45_000,
        ytd: {
          amIncome: 0,
          taxPaid: 0,
          amContribution: 0,
          atp: 0,
          employeePension: 0,
          employerPension: 0,
        },
      })
    )
    expect(data.workIncome).toBe(540_000) // 45.000 × 12
    expect(data.employeePension).toBe(30_000) // 2.500 × 12
    expect(data.employerPension).toBe(60_000) // 5.000 × 12
    expect(data.atpEmployee).toBe(1_188) // 99 × 12
    expect(filledLabels).toContain("Arbejdsindkomst (A-indkomst)")
    expect(warnings.some((w) => w.includes("gange 12"))).toBe(true)
    // Nothing came from a year-to-date total, so nothing was projected.
    expect(warnings.some((w) => w.includes("fremskrevet"))).toBe(false)
  })

  it("falls back per field, keeping the year-to-date figures it does have", () => {
    // A payslip can carry an år-til-dato total for income but report pension
    // only for the current period — the two must not share a fallback decision.
    const base = makePaycheck()
    const { data, warnings } = payslipToTaxInput({
      ...base,
      ytd: { ...base.ytd, employeePension: 0 },
    })
    expect(data.workIncome).toBe(600_000) // 300.000 × 12/6, from year-to-date
    expect(data.employeePension).toBe(30_000) // 2.500 × 12, from this period
    // Both caveats apply, because both paths were taken.
    expect(warnings.some((w) => w.includes("gange 12"))).toBe(true)
    expect(warnings.some((w) => w.includes("fremskrevet"))).toBe(true)
  })

  it("keeps the current tax year when the payslip predates the supported rates", () => {
    const { data, warnings } = payslipToTaxInput(
      makePaycheck({ year: 2019, payPeriod: { from: "2019-06-01", to: "2019-06-30" } })
    )
    expect(data.year).toBeUndefined()
    expect(warnings.some((w) => w.includes("2019"))).toBe(true)
    // The money still imports — only the year is refused.
    expect(data.workIncome).toBe(600_000)
  })

  it("imports nothing from a payslip with an unreadable pay period", () => {
    const { data, filledLabels, warnings } = payslipToTaxInput(
      makePaycheck({ month: 0 })
    )
    expect(data).toEqual({})
    // The upload UI treats an empty label list as a failure and shows warnings[0].
    expect(filledLabels).toEqual([])
    expect(warnings[0]).toContain("Lønperioden kunne ikke tolkes")
  })
})
