import { describe, it, expect } from "vitest"
import { calculateTax } from "@/lib/tax/calculator"
import { makeInput } from "./helpers"

describe("Full calculator integration", () => {
  it("8.1 - simple employee 500k, København, 2026", () => {
    const result = calculateTax(
      makeInput({ workIncome: 500000, municipality: "København" }),
    )
    expect(result.amBidrag).toBe(40000)
    expect(result.personalIncome).toBe(460000)
    expect(result.totalTax).toBeGreaterThan(0)
    expect(result.netIncome).toBeLessThan(500000)
    expect(result.effectiveTaxRate).toBeGreaterThan(0.2)
    expect(result.effectiveTaxRate).toBeLessThan(0.5)
  })

  it("8.2 - employee with pension", () => {
    const withPension = calculateTax(
      makeInput({
        workIncome: 600000,
        privatePensionRatepension: 30000,
        municipality: "København",
      }),
    )
    const withoutPension = calculateTax(
      makeInput({ workIncome: 600000, municipality: "København" }),
    )
    // Ratepension does NOT reduce personal income (already deducted from salary)
    expect(withPension.personalIncome).toBe(withoutPension.personalIncome)
    // But it increases ekstra pensionsfradrag
    expect(withPension.ekstraPensionsFradrag).toBeGreaterThan(0)
    expect(withoutPension.ekstraPensionsFradrag).toBe(0)
  })

  it("8.3 - employee with commute", () => {
    const withCommute = calculateTax(
      makeInput({
        workIncome: 500000,
        commuteDistanceKm: 40,
        workDaysPerYear: 220,
        employeePension: 50000,
        municipality: "København",
      }),
    )
    expect(withCommute.befordringsFradrag).toBeGreaterThan(0)
    const withoutCommute = calculateTax(
      makeInput({
        workIncome: 500000,
        employeePension: 50000,
        municipality: "København",
      }),
    )
    expect(withCommute.totalTax).toBeLessThan(withoutCommute.totalTax)
  })

  it("8.4 - high earner hitting mellemskat", () => {
    const result = calculateTax(
      makeInput({ workIncome: 800000, municipality: "København" }),
    )
    expect(result.mellemSkat).toBeGreaterThan(0)
  })

  it("8.5 - very high earner hitting all brackets", () => {
    const result = calculateTax(
      makeInput({ workIncome: 3500000, municipality: "København" }),
    )
    expect(result.bundSkat).toBeGreaterThan(0)
    expect(result.mellemSkat).toBeGreaterThan(0)
    expect(result.topSkat).toBeGreaterThan(0)
    expect(result.topTopSkat).toBeGreaterThan(0)
  })

  it("8.6 - SU student", () => {
    const result = calculateTax(
      makeInput({ suIncome: 75000, municipality: "København" }),
    )
    // SU has no AM-bidrag
    expect(result.amBidrag).toBe(0)
    // Very low tax due to personfradrag
    expect(result.totalTax).toBeLessThan(10000)
  })

  it("8.7 - transfer income only", () => {
    const result = calculateTax(
      makeInput({ transferIncome: 250000, municipality: "København" }),
    )
    expect(result.amBidrag).toBe(0)
    expect(result.beskaeftigelsesFradrag).toBe(0)
    expect(result.totalTax).toBeGreaterThan(0)
  })

  it("8.8 - employee + property", () => {
    const result = calculateTax(
      makeInput({
        workIncome: 600000,
        municipality: "København",
        property: {
          propertyValue: 4000000,
          assessmentBasis: 4000000,
          landValue: 1500000,
          landAssessmentBasis: 1500000,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 1,
          personalTaxDiscount: 0,
        },
      }),
    )
    expect(result.totalPropertyTax).toBeGreaterThan(0)
    expect(result.ejendomsvaerdiSkatPrimary).toBeGreaterThan(0)
    expect(result.grundskyldPrimary).toBeGreaterThan(0)
  })

  it("8.9 - employee + stocks", () => {
    const result = calculateTax(
      makeInput({
        workIncome: 500000,
        stockSaleGains: 200000,
        municipality: "København",
      }),
    )
    expect(result.totalStockTax).toBeGreaterThan(0)
    expect(result.totalTax).toBeGreaterThan(
      calculateTax(makeInput({ workIncome: 500000, municipality: "København" }))
        .totalTax,
    )
  })

  it("8.10 - church member vs non-member", () => {
    const member = calculateTax(
      makeInput({
        workIncome: 500000,
        churchMember: true,
        municipality: "København",
      }),
    )
    const nonMember = calculateTax(
      makeInput({
        workIncome: 500000,
        churchMember: false,
        municipality: "København",
      }),
    )
    expect(member.kirkeSkat).toBeGreaterThan(0)
    expect(nonMember.kirkeSkat).toBe(0)
    expect(member.totalTax).toBeGreaterThan(nonMember.totalTax)
  })

  it("8.11 - all deductions maxed", () => {
    const result = calculateTax(
      makeInput({
        workIncome: 500000,
        municipality: "København",
        unionFees: 50000,
        charitableDonations: 50000,
        serviceDeduction: 50000,
        greenRenovation: 50000,
        otherEmployeeExpenses: 50000,
        doubleHousehold: 50000,
      }),
    )
    expect(result.unionFeesDeduction).toBe(7000)
    expect(result.charitableDonationsDeduction).toBe(20000)
    expect(result.serviceDeductionAmount).toBe(18300)
    expect(result.greenRenovationDeduction).toBe(9000)
    expect(result.doubleHouseholdDeduction).toBe(34400)
    expect(result.otherEmployeeExpensesDeduction).toBe(50000 - 7600)
  })

  it("8.12 - zero income", () => {
    const result = calculateTax(makeInput({ municipality: "København" }))
    expect(result.totalTax).toBe(0)
    expect(result.netIncome).toBe(0)
  })

  it("8.13 - different municipalities", () => {
    const kbh = calculateTax(
      makeInput({ workIncome: 500000, municipality: "København" }),
    )
    const langeland = calculateTax(
      makeInput({ workIncome: 500000, municipality: "Langeland" }),
    )
    expect(kbh.kommuneSkat).not.toBe(langeland.kommuneSkat)
  })

  it("8.14 - year comparison 2024 vs 2026", () => {
    const y2024 = calculateTax(
      makeInput({ workIncome: 500000, municipality: "København", year: 2024 }),
    )
    const y2026 = calculateTax(
      makeInput({ workIncome: 500000, municipality: "København", year: 2026 }),
    )
    // Different rates should produce different results
    expect(y2024.totalTax).not.toBe(y2026.totalTax)
    // 2024 has no top-topskat
    expect(y2024.topTopSkat).toBe(0)
  })

  it("throws for unknown municipality", () => {
    expect(() =>
      calculateTax(makeInput({ municipality: "Narnia" })),
    ).toThrow()
  })

  it("effective tax rate is reasonable for typical salary", () => {
    const result = calculateTax(
      makeInput({ workIncome: 500000, municipality: "København" }),
    )
    // Typical Danish effective rate: 35-40% for 500k salary
    expect(result.effectiveTaxRate).toBeGreaterThan(0.3)
    expect(result.effectiveTaxRate).toBeLessThan(0.45)
  })

  it("net income + total tax = gross income", () => {
    const result = calculateTax(
      makeInput({ workIncome: 500000, municipality: "København" }),
    )
    expect(result.netIncome + result.totalTax).toBeCloseTo(500000, 0)
  })
})
