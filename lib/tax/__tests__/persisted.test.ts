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

  it("reads a row saved before the længstlevende-ægtefælle fields", () => {
    // The merge copies stored keys verbatim, so a row written by an older build
    // simply has no answer for these three. Absent must mean "no succession":
    // ejendomsskatteloven § 25, stk. 3 is a nedslag, and inventing one for every
    // saved row would undertax them.
    const [old] = readPersistedTaxInputs({
      persons: [
        {
          year: 2026,
          municipality: "København",
          property: { assessmentBasis: 3_000_000 },
        },
      ],
    })
    expect(old.remarriageDate).toBeUndefined()
    expect(old.property?.retainedFromSpouse).toBeUndefined()
    expect(old.property?.spouseAcquiredBefore19980701).toBeUndefined()
    expect(safeCalculateTax(old)!.totalEjendomsvaerdiSkat).toBe(
      Math.round(0.0051 * 3_000_000),
    )
  })

  it("carries a stored succession through the merge", () => {
    const [saved] = readPersistedTaxInputs({
      persons: [
        {
          year: 2026,
          municipality: "København",
          remarriageDate: "2030-01-01",
          property: { assessmentBasis: 3_000_000, retainedFromSpouse: true },
        },
      ],
    })
    expect(saved.remarriageDate).toBe("2030-01-01")
    expect(saved.property?.retainedFromSpouse).toBe(true)
    expect(safeCalculateTax(saved)!.totalEjendomsvaerdiSkat).toBe(
      Math.round(0.0051 * 3_000_000) - 6_000,
    )
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
