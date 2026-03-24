import { describe, it, expect } from "vitest"
import { calculateIncomeTax } from "@/lib/tax/calculations/income-tax"
import { getRates } from "@/lib/tax/rates"
import { getMunicipality } from "@/lib/tax/municipalities"

const rates = getRates(2026)
const kbh = getMunicipality("København", 2026)!
// København 2026: taxRate=23.39, churchTaxRate=0.8

describe("Income tax", () => {
  it("4.4 - bundskat simple", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 40000,
      460000, 0, 398000, false,
    )
    expect(result.bundSkat).toBe(Math.round(0.1201 * 460000))
  })

  it("4.5 - mellemskat below threshold", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 40000,
      460000, 0, 398000, false,
    )
    expect(result.mellemSkat).toBe(0)
  })

  it("4.6 - mellemskat above threshold", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 0,
      700000, 0, 700000, false,
    )
    expect(result.mellemSkat).toBe(Math.round(0.075 * (700000 - 641200)))
  })

  it("4.7 - topskat below threshold", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 0,
      700000, 0, 700000, false,
    )
    expect(result.topSkat).toBe(0)
  })

  it("4.8 - topskat above threshold", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 0,
      900000, 0, 900000, false,
    )
    expect(result.topSkat).toBeGreaterThan(0)
  })

  it("4.9 - top-topskat", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 0,
      3000000, 0, 3000000, false,
    )
    expect(result.topTopSkat).toBe(Math.round(0.05 * (3000000 - 2592700)))
  })

  it("4.10 - kommuneskat", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 0,
      460000, 0, 398000, false,
    )
    expect(result.kommuneSkat).toBe(Math.round(0.2339 * 398000))
  })

  it("4.11 - kirkeskat member", () => {
    const result = calculateIncomeTax(
      rates, kbh, true, 0,
      460000, 0, 398000, false,
    )
    expect(result.kirkeSkat).toBe(Math.round(0.008 * 398000))
  })

  it("4.12 - kirkeskat non-member", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 0,
      460000, 0, 398000, false,
    )
    expect(result.kirkeSkat).toBe(0)
  })

  it("4.13 - personfradrag stat credit", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 0,
      460000, 0, 398000, false,
    )
    expect(result.personFradragStatCredit).toBe(Math.round(0.1201 * 54100))
  })

  it("4.14 - personfradrag kommune credit (with church)", () => {
    const result = calculateIncomeTax(
      rates, kbh, true, 0,
      460000, 0, 398000, false,
    )
    expect(result.personFradragKommuneCredit).toBe(
      Math.round((0.2339 + 0.008) * 54100),
    )
  })

  it("4.15 - mellemskat on capital income", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 0,
      460000, 80000, 460000, false,
    )
    expect(result.mellemSkatCapital).toBe(
      Math.round(0.0459 * Math.max(0, 80000 - 55000)),
    )
  })

  it("no mellemskat on capital below threshold", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 0,
      460000, 30000, 460000, false,
    )
    expect(result.mellemSkatCapital).toBe(0)
  })

  it("marginal rate for typical salary", () => {
    const result = calculateIncomeTax(
      rates, kbh, false, 40000,
      460000, 0, 398000, false,
    )
    // Below mellemskat: AM + (1-AM) * (bundskat + kommune)
    const expected = 0.08 + 0.92 * (0.1201 + 0.2339)
    expect(result.marginalTaxRate).toBeCloseTo(expected, 3)
  })

  it("2024 uses legacy topskat structure", () => {
    const rates2024 = getRates(2024)
    const result = calculateIncomeTax(
      rates2024, kbh, false, 0,
      700000, 0, 700000, false,
    )
    // 2024: mellemSkatRate=0.15, threshold=588900
    expect(result.mellemSkat).toBe(Math.round(0.15 * (700000 - 588900)))
    expect(result.topSkat).toBe(0) // no separate topskat in 2024
    expect(result.topTopSkat).toBe(0)
  })
})
