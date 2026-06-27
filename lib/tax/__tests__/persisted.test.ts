import { describe, it, expect } from "vitest"
import { readPersistedTaxInputs, safeCalculateTax } from "../persisted"
import { createDefaultInput } from "../defaults"

describe("readPersistedTaxInputs", () => {
  it("reads the { persons } shape (max 2) and fills defaults", () => {
    const inputs = readPersistedTaxInputs({
      persons: [
        { workIncome: 600000, municipality: "København", year: 2026 },
        { workIncome: 400000, municipality: "København", year: 2026 },
        { workIncome: 1, municipality: "København", year: 2026 }, // dropped (max 2)
      ],
    })
    expect(inputs).toHaveLength(2)
    expect(inputs[0].workIncome).toBe(600000)
    expect(inputs[0].churchMember).toBe(false) // default filled
  })
  it("reads the legacy single-object shape", () => {
    const inputs = readPersistedTaxInputs({
      year: 2026,
      workIncome: 100000,
      municipality: "København",
    })
    expect(inputs).toHaveLength(1)
  })
  it("returns [] for junk", () => {
    expect(readPersistedTaxInputs(null)).toEqual([])
    expect(readPersistedTaxInputs({})).toEqual([])
  })
})

describe("safeCalculateTax", () => {
  it("computes a plausible net income for a normal salary", () => {
    const r = safeCalculateTax({
      ...createDefaultInput(),
      workIncome: 500000,
      municipality: "København",
      year: 2026,
    })
    expect(r).not.toBeNull()
    expect(r!.netIncome).toBeGreaterThan(0)
    expect(r!.netIncome).toBeLessThan(500000)
  })
  it("returns null on an unknown municipality instead of throwing", () => {
    const r = safeCalculateTax({
      ...createDefaultInput(),
      municipality: "Nowhere",
      workIncome: 100000,
    })
    expect(r).toBeNull()
  })
})
