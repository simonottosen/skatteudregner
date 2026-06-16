import { describe, it, expect } from "vitest"
import {
  FOLKEPENSION_GRUNDBELOEB,
  TILLAEG_SINGLE,
  annuityPayment,
  folkepensionAfterModregning,
  folkepensionAge,
} from "../pension"

describe("folkepensionAge", () => {
  it("follows the birth-year schedule", () => {
    expect(folkepensionAge(1960)).toBe(67)
    expect(folkepensionAge(1965)).toBe(68)
    expect(folkepensionAge(1968)).toBe(69)
    expect(folkepensionAge(1972)).toBe(70)
    expect(folkepensionAge(1990)).toBe(71)
  })
})

describe("folkepensionAfterModregning", () => {
  it("pays full grundbeløb + tillæg with no other income", () => {
    expect(folkepensionAfterModregning(0, true)).toBeCloseTo(
      FOLKEPENSION_GRUNDBELOEB + TILLAEG_SINGLE,
      0
    )
  })

  it("reduces only the tillæg above the threshold (single)", () => {
    // otherIncome 100.000 → reduce by 30,9 % of (100.000 − 95.800).
    const expected =
      FOLKEPENSION_GRUNDBELOEB + (TILLAEG_SINGLE - 0.309 * (100000 - 95800))
    expect(folkepensionAfterModregning(100000, true)).toBeCloseTo(expected, 0)
  })

  it("never reduces the tillæg below zero (grundbeløb remains)", () => {
    expect(folkepensionAfterModregning(5_000_000, true)).toBeCloseTo(
      FOLKEPENSION_GRUNDBELOEB,
      0
    )
  })
})

describe("annuityPayment", () => {
  it("splits evenly with no return", () => {
    expect(annuityPayment(100000, 0, 10)).toBeCloseTo(10000, 0)
  })
  it("is higher than the even split with a positive return", () => {
    expect(annuityPayment(100000, 0.05, 10)).toBeGreaterThan(10000)
  })
})
