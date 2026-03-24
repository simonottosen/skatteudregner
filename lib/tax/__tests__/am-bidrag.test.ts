import { describe, it, expect } from "vitest"
import { calculateAmBidrag } from "@/lib/tax/calculations/am-bidrag"
import { getRates } from "@/lib/tax/rates"
import { makeInput } from "./helpers"

const rates = getRates(2026)

describe("AM-bidrag", () => {
  it("2.1 - simple salary", () => {
    const result = calculateAmBidrag(makeInput({ workIncome: 500000 }), rates)
    expect(result.amBasis).toBe(500000)
    expect(result.amBidrag).toBe(40000)
  })

  it("2.2 - salary + honorar", () => {
    const result = calculateAmBidrag(
      makeInput({ workIncome: 400000, honorarIncome: 100000 }),
      rates,
    )
    expect(result.amBasis).toBe(500000)
    expect(result.amBidrag).toBe(40000)
  })

  it("2.3 - zero income", () => {
    const result = calculateAmBidrag(makeInput({}), rates)
    expect(result.amBasis).toBe(0)
    expect(result.amBidrag).toBe(0)
  })

  it("2.4 - transfer income excluded from AM", () => {
    const result = calculateAmBidrag(
      makeInput({ transferIncome: 200000 }),
      rates,
    )
    expect(result.amBasis).toBe(0)
    expect(result.amBidrag).toBe(0)
  })

  it("2.2b - salary + other AM income", () => {
    const result = calculateAmBidrag(
      makeInput({ workIncome: 300000, honorarIncome: 50000, otherAmIncome: 25000 }),
      rates,
    )
    expect(result.amBasis).toBe(375000)
    expect(result.amBidrag).toBe(30000)
  })

  it("includes insurance in AM basis", () => {
    const result = calculateAmBidrag(
      makeInput({ workIncome: 500000, insuranceCostsFromSkat: 5000 }),
      rates,
    )
    expect(result.amBasis).toBe(500000)
    expect(result.insuranceBasis).toBeGreaterThan(5000)
    expect(result.totalAmBasis).toBeGreaterThan(500000)
  })
})
