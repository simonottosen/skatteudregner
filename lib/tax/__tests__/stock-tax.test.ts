import { describe, it, expect } from "vitest"
import { calculateStockTax } from "@/lib/tax/calculations/stock-tax"
import { getRates } from "@/lib/tax/rates"
import { makeInput } from "./helpers"

const rates = getRates(2026)

describe("Stock tax", () => {
  it("6.1 - below limit", () => {
    const result = calculateStockTax(
      makeInput({ stockSaleGains: 50000 }),
      rates,
    )
    expect(result.stockIncome).toBe(50000)
    expect(result.totalStockTax).toBe(Math.round(0.27 * 50000))
  })

  it("6.2 - above limit", () => {
    const result = calculateStockTax(
      makeInput({ stockSaleGains: 150000 }),
      rates,
    )
    expect(result.stockTaxLow).toBe(Math.round(0.27 * 79400))
    expect(result.stockTaxHigh).toBe(Math.round(0.42 * (150000 - 79400)))
  })

  it("6.3 - zero stock income", () => {
    const result = calculateStockTax(makeInput({}), rates)
    expect(result.totalStockTax).toBe(0)
  })

  it("6.4 - prior year losses", () => {
    const result = calculateStockTax(
      makeInput({
        stockSaleGains: 100000,
        negativeStockIncomePriorYears: 30000,
      }),
      rates,
    )
    expect(result.stockIncome).toBe(70000)
    expect(result.totalStockTax).toBe(Math.round(0.27 * 70000))
  })

  it("6.5 - married spouse sharing (full unused)", () => {
    const result = calculateStockTax(
      makeInput({
        stockSaleGains: 150000,
        married: true,
        spouseStockIncome: 0,
      }),
      rates,
    )
    // Double threshold: 158800
    expect(result.stockTaxLow).toBe(Math.round(0.27 * 150000))
    expect(result.stockTaxHigh).toBe(0)
  })

  it("6.5b - married spouse partially used", () => {
    const result = calculateStockTax(
      makeInput({
        stockSaleGains: 150000,
        married: true,
        spouseStockIncome: 50000,
      }),
      rates,
    )
    // Spouse unused: 79400-50000=29400, total threshold: 79400+29400=108800
    const expectedLow = Math.round(0.27 * 108800)
    const expectedHigh = Math.round(0.42 * (150000 - 108800))
    expect(result.stockTaxLow).toBe(expectedLow)
    expect(result.stockTaxHigh).toBe(expectedHigh)
  })

  it("negative stock income floors at zero", () => {
    const result = calculateStockTax(
      makeInput({
        stockSaleGains: 0,
        negativeStockIncomePriorYears: 50000,
      }),
      rates,
    )
    expect(result.stockIncome).toBe(0)
    expect(result.totalStockTax).toBe(0)
  })
})
