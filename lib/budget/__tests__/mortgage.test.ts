import { describe, it, expect } from "vitest"
import {
  blendedBidragssats,
  computeMortgage,
  looksLikeMortgage,
  DEFAULT_MORTGAGE,
} from "../mortgage"

describe("computeMortgage", () => {
  it("splits the payment into interest, bidrag and afdrag on the loan", () => {
    const b = computeMortgage({
      ...DEFAULT_MORTGAGE,
      enabled: true,
      homeValue: 3_000_000,
      ltv: 0.8, // loan = 2.4M
      remainingYears: 30,
      interestRate: 0.04,
      bidragssats: 0.006,
      interestOnly: false,
    })
    expect(b.loan).toBe(2_400_000)
    expect(b.monthlyInterest).toBeCloseTo((2_400_000 * 0.04) / 12, 0) // 8000
    expect(b.monthlyBidrag).toBeCloseTo((2_400_000 * 0.006) / 12, 0) // 1200
    expect(b.monthlyAfdrag).toBeGreaterThan(0)
    expect(b.monthlyTotal).toBeCloseTo(
      b.monthlyInterest + b.monthlyBidrag + b.monthlyAfdrag,
      0
    )
    expect(b.payoffYears).toBe(30)
  })

  it("has no afdrag with afdragsfrihed (interest-only)", () => {
    const b = computeMortgage({
      ...DEFAULT_MORTGAGE,
      enabled: true,
      homeValue: 2_000_000,
      ltv: 0.5,
      interestOnly: true,
    })
    expect(b.monthlyAfdrag).toBe(0)
    expect(b.payoffYears).toBe(Infinity)
  })

  it("blendedBidragssats rises with LTV and is 0 at no debt", () => {
    expect(blendedBidragssats(0)).toBe(0)
    expect(blendedBidragssats(0.8)).toBeGreaterThan(blendedBidragssats(0.4))
  })
})

describe("looksLikeMortgage", () => {
  it("matches common mortgage descriptions", () => {
    for (const label of [
      "Husleje / boliglån",
      "Realkredit",
      "Afdrag på lån",
      "Afbetaling hus",
      "Prioritetslån",
    ]) {
      expect(looksLikeMortgage(label)).toBe(true)
    }
  })
  it("does not match unrelated descriptions or vehicle loans", () => {
    expect(looksLikeMortgage("Dagligvarer")).toBe(false)
    expect(looksLikeMortgage("Forsikring")).toBe(false)
    expect(looksLikeMortgage("Bil (afdrag/leasing)")).toBe(false)
    expect(looksLikeMortgage("Billån")).toBe(false)
  })
})
