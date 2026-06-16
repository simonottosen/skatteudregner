import { describe, it, expect } from "vitest"
import {
  PERSONFRADRAG,
  SHARE_TAX_THRESHOLD,
  grossUpShareSale,
  pensionIncomeTax,
  shareIncomeTax,
} from "../tax"

describe("shareIncomeTax", () => {
  it("is 27 % up to the threshold", () => {
    expect(shareIncomeTax(0)).toBe(0)
    expect(shareIncomeTax(50_000)).toBeCloseTo(50_000 * 0.27, 4)
    expect(shareIncomeTax(SHARE_TAX_THRESHOLD)).toBeCloseTo(
      SHARE_TAX_THRESHOLD * 0.27,
      4
    )
  })
  it("is 43 % on the part above the threshold", () => {
    const gain = 150_000
    const expected =
      SHARE_TAX_THRESHOLD * 0.27 + (gain - SHARE_TAX_THRESHOLD) * 0.43
    expect(shareIncomeTax(gain)).toBeCloseTo(expected, 4)
  })
})

describe("grossUpShareSale", () => {
  it("returns the net amount when there is no embedded gain", () => {
    expect(grossUpShareSale(100_000, 0)).toBeCloseTo(100_000, 4)
  })
  it("sells exactly enough to net the target after gains tax", () => {
    for (const [net, g] of [
      [50_000, 0.5],
      [200_000, 0.8],
      [500_000, 1],
      [1_000_000, 0.95],
    ] as const) {
      const sell = grossUpShareSale(net, g)
      const proceeds = sell - shareIncomeTax(sell * g)
      expect(proceeds).toBeCloseTo(net, 2)
    }
  })
})

describe("pensionIncomeTax", () => {
  it("is zero up to the personfradrag", () => {
    expect(pensionIncomeTax(PERSONFRADRAG)).toBe(0)
    expect(pensionIncomeTax(0)).toBe(0)
  })
  it("rises with income and applies topskat above the threshold", () => {
    const low = pensionIncomeTax(300_000)
    const high = pensionIncomeTax(800_000)
    expect(low).toBeGreaterThan(0)
    // Marginal rate above the topskat threshold exceeds the base rate.
    const marginalTop = (high - pensionIncomeTax(611_800)) / (800_000 - 611_800)
    expect(marginalTop).toBeGreaterThan(0.37)
  })
})
