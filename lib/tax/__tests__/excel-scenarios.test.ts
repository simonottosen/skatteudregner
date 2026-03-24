import { describe, it, expect } from "vitest"
import { calculateTax } from "@/lib/tax/calculator"
import { makeInput } from "./helpers"

describe("Excel cross-verification scenarios", () => {
  it("Scenario A: Simple employee 500k, København, 2026, no church", () => {
    const result = calculateTax(
      makeInput({
        workIncome: 500000,
        municipality: "København",
        year: 2026,
        churchMember: false,
      }),
    )

    // AM-bidrag: 8% * 500000 = 40000
    expect(result.amBidrag).toBe(40000)
    // Personal income: 500000 - 40000 = 460000
    expect(result.personalIncome).toBe(460000)
    // fradragBasis = AM basis (500000) + employer pension (0) + ratepension grossed up (0) = 500000
    expect(result.fradragBasis).toBe(500000)
    // Beskæftigelsesfradrag: min(12.75% * 500000, 63300) = 63300
    expect(result.beskaeftigelsesFradrag).toBe(63300)
    // Bundskat: 12.01% * 460000 = 55246
    expect(result.bundSkat).toBe(55246)
    // No mellemskat (460000 < 641200)
    expect(result.mellemSkat).toBe(0)
    // Personfradrag stat: 12.01% * 54100 = 6497
    expect(result.personFradragStatCredit).toBe(6497)
    // Personfradrag kommune: 23.39% * 54100 = 12654
    expect(result.personFradragKommuneCredit).toBe(12654)

    // Total tax should be reasonable (30-38% effective after deductions)
    expect(result.effectiveTaxRate).toBeGreaterThan(0.28)
    expect(result.effectiveTaxRate).toBeLessThan(0.40)
    // Net + tax = gross
    expect(result.netIncome + result.totalTax).toBeCloseTo(500000, 0)
  })

  it("Scenario B: Employee 600k with pension, Aarhus, church member", () => {
    const result = calculateTax(
      makeInput({
        workIncome: 600000,
        municipality: "Aarhus",
        year: 2026,
        churchMember: true,
        employeePension: 30000,
        employerPension: 30000,
      }),
    )

    expect(result.amBidrag).toBe(48000)
    // fradragBasis = AM basis (600000) + employer pension (30000) + ratepension grossed up (0) = 630000
    expect(result.fradragBasis).toBe(630000)
    // Beskæftigelsesfradrag: min(12.75% * 630000, 63300) = 63300 (capped)
    expect(result.beskaeftigelsesFradrag).toBe(63300)
    // Employer pension adds to personal income: 600000 - 48000 + 30000 = 582000
    expect(result.personalIncome).toBe(582000)
    expect(result.kirkeSkat).toBeGreaterThan(0)
    expect(result.netIncome + result.totalTax).toBeCloseTo(600000, 0)
  })

  it("Scenario C: High earner 1.2M, Gentofte, with property", () => {
    const result = calculateTax(
      makeInput({
        workIncome: 1200000,
        municipality: "Gentofte",
        year: 2026,
        churchMember: false,
        property: {
          propertyValue: 8000000,
          assessmentBasis: 8000000,
          landValue: 3000000,
          landAssessmentBasis: 3000000,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 1,
          personalTaxDiscount: 0,
        },
      }),
    )

    // AM: 96000
    expect(result.amBidrag).toBe(96000)
    // Personal income: 1200000 - 96000 = 1104000
    expect(result.personalIncome).toBe(1104000)
    // Should hit mellemskat (1104000 > 641200)
    expect(result.mellemSkat).toBeGreaterThan(0)
    // Should hit topskat (1104000 > 777900)
    expect(result.topSkat).toBeGreaterThan(0)
    // Should NOT hit top-topskat (1104000 < 2592700)
    expect(result.topTopSkat).toBe(0)
    // Property tax
    expect(result.ejendomsvaerdiSkatPrimary).toBeGreaterThan(0)
    expect(result.grundskyldPrimary).toBeGreaterThan(0)
    expect(result.netIncome + result.totalTax).toBeCloseTo(1200000, 0)
  })

  it("Scenario D: SU student 75k, Odense", () => {
    const result = calculateTax(
      makeInput({
        suIncome: 75000,
        municipality: "Odense",
        year: 2026,
      }),
    )

    expect(result.amBidrag).toBe(0) // SU has no AM
    expect(result.personalIncome).toBe(75000)
    // Personfradrag (54100) covers most of the 75000 income
    // So only ~20900 is actually taxed
    expect(result.totalTax).toBeLessThan(15000)
    expect(result.netIncome).toBeGreaterThan(60000)
  })

  it("Scenario E: Transfer income 250k, Aalborg", () => {
    const result = calculateTax(
      makeInput({
        transferIncome: 250000,
        municipality: "Aalborg",
        year: 2026,
      }),
    )

    expect(result.amBidrag).toBe(0) // No AM on transfers
    expect(result.beskaeftigelsesFradrag).toBe(0) // No employment deduction
    expect(result.personalIncome).toBe(250000)
    expect(result.totalTax).toBeGreaterThan(0)
    expect(result.netIncome + result.totalTax).toBeCloseTo(250000, 0)
  })

  it("Scenario F: Stock investor, 500k salary + 300k stocks, married", () => {
    const result = calculateTax(
      makeInput({
        workIncome: 500000,
        stockSaleGains: 300000,
        married: true,
        spouseStockIncome: 0,
        municipality: "København",
        year: 2026,
      }),
    )

    expect(result.totalStockTax).toBeGreaterThan(0)
    // With married + spouse unused threshold, effective limit = 158800
    // 27% * 158800 + 42% * (300000-158800)
    expect(result.stockTaxLow).toBe(Math.round(0.27 * 158800))
    expect(result.stockTaxHigh).toBe(Math.round(0.42 * (300000 - 158800)))
  })

  it("Scenario G: Very high earner 4M, all brackets", () => {
    const result = calculateTax(
      makeInput({
        workIncome: 4000000,
        municipality: "København",
        year: 2026,
      }),
    )

    expect(result.amBidrag).toBe(320000)
    expect(result.personalIncome).toBe(3680000)
    expect(result.bundSkat).toBeGreaterThan(0)
    expect(result.mellemSkat).toBeGreaterThan(0)
    expect(result.topSkat).toBeGreaterThan(0)
    expect(result.topTopSkat).toBeGreaterThan(0)
    // Top-topskat: 5% * (3680000 - 2592700) = 5% * 1087300 = 54365
    expect(result.topTopSkat).toBe(Math.round(0.05 * (3680000 - 2592700)))
    expect(result.effectiveTaxRate).toBeGreaterThan(0.45)
  })

  it("Different years produce different results for same input", () => {
    const base = { workIncome: 600000, municipality: "København" }
    const r2024 = calculateTax(makeInput({ ...base, year: 2024 }))
    const r2025 = calculateTax(makeInput({ ...base, year: 2025 }))
    const r2026 = calculateTax(makeInput({ ...base, year: 2026 }))

    // All should produce valid results
    expect(r2024.totalTax).toBeGreaterThan(0)
    expect(r2025.totalTax).toBeGreaterThan(0)
    expect(r2026.totalTax).toBeGreaterThan(0)

    // Different years should give different taxes
    const taxes = [r2024.totalTax, r2025.totalTax, r2026.totalTax]
    expect(new Set(taxes).size).toBeGreaterThan(1)
  })
})
