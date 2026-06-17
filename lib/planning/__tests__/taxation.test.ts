import { describe, it, expect } from "vitest"
import {
  grossUpStockSale,
  pensionIncomeTax,
  stockGainTax,
  type TaxContext,
} from "../taxation"
import { DEFAULT_TAX_PROFILE } from "../types"
import { getRates } from "@/lib/tax/rates"

const ctx: TaxContext = {
  t: 0,
  inflation: 0,
  profile: DEFAULT_TAX_PROFILE,
  married: false,
}
const rates = getRates(DEFAULT_TAX_PROFILE.year)

describe("stockGainTax", () => {
  it("is zero for no gain and ~27 % up to the progression limit", () => {
    expect(stockGainTax(0, ctx)).toBe(0)
    expect(stockGainTax(rates.stockProgressionLimit, ctx)).toBeCloseTo(
      rates.stockProgressionLimit * rates.stockTaxLowRate,
      -1
    )
  })
  it("is the high rate on the part above the limit", () => {
    const gain = rates.stockProgressionLimit + 100_000
    const expected =
      rates.stockProgressionLimit * rates.stockTaxLowRate +
      100_000 * rates.stockTaxHighRate
    expect(stockGainTax(gain, ctx)).toBeCloseTo(expected, -1)
  })
  it("doubles the low-rate band for a couple", () => {
    const gain = rates.stockProgressionLimit * 2
    const single = stockGainTax(gain, ctx)
    const couple = stockGainTax(gain, { ...ctx, married: true })
    // The couple keeps the whole gain in the low bracket → less tax.
    expect(couple).toBeLessThan(single)
    expect(couple).toBeCloseTo(gain * rates.stockTaxLowRate, -1)
  })
})

describe("grossUpStockSale", () => {
  it("returns the net amount when there is no embedded gain", () => {
    expect(grossUpStockSale(100_000, 0, ctx)).toBeCloseTo(100_000, 4)
  })
  it("sells exactly enough to net the target after stock tax", () => {
    for (const [net, g, married] of [
      [50_000, 0.5, false],
      [200_000, 0.8, false],
      [500_000, 1, true],
      [1_000_000, 0.95, true],
    ] as const) {
      const c = { ...ctx, married }
      const sell = grossUpStockSale(net, g, c)
      const proceeds = sell - stockGainTax(sell * g, c)
      expect(proceeds).toBeCloseTo(net, -1)
    }
  })
})

describe("pensionIncomeTax", () => {
  it("is ~zero at or below the personfradrag", () => {
    expect(pensionIncomeTax(0, ctx)).toBe(0)
    expect(pensionIncomeTax(rates.personFradrag, ctx)).toBeLessThan(1500)
  })
  it("rises with income and is steeper above the topskat threshold", () => {
    expect(pensionIncomeTax(300_000, ctx)).toBeGreaterThan(0)
    // Topskat kicks in above topSkatThreshold (2026: 777.900).
    const below = rates.topSkatThreshold - 100_000
    const above = rates.topSkatThreshold + 100_000
    const marginalBelow =
      (pensionIncomeTax(below, ctx) - pensionIncomeTax(below - 100_000, ctx)) /
      100_000
    const marginalAbove =
      (pensionIncomeTax(above, ctx) - pensionIncomeTax(rates.topSkatThreshold, ctx)) /
      100_000
    expect(marginalAbove).toBeGreaterThan(marginalBelow)
  })
  it("indexes brackets to inflation so real income pays constant real tax", () => {
    const real = pensionIncomeTax(300_000, ctx)
    // The same income 20 years out, inflated, should pay the same *real* tax.
    const t = 20
    const f = Math.pow(1.02, t)
    const nominal = pensionIncomeTax(300_000 * f, {
      ...ctx,
      t,
      inflation: 0.02,
    })
    expect(nominal / f).toBeCloseTo(real, 0)
  })
})
