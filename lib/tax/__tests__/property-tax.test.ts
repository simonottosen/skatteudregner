import { describe, it, expect } from "vitest"
import { calculatePropertyTax } from "@/lib/tax/calculations/property-tax"
import { getRates } from "@/lib/tax/rates"
import { getMunicipality } from "@/lib/tax/municipalities"
import { makeInput } from "./helpers"

const rates = getRates(2026)
const kbh = getMunicipality("København", 2026)!

/** Ejendomsværdiskat alone: no land, so grundskyld stays out of the figure. */
const evs = (assessmentBasis: number, isCondo = false) =>
  calculatePropertyTax(
    makeInput({
      property: {
        propertyValue: assessmentBasis,
        assessmentBasis,
        landValue: 0,
        landAssessmentBasis: 0,
        purchasedBefore19980701: false,
        isCondo,
        ownershipShare: 1,
        personalTaxDiscount: 0,
      },
    }),
    rates,
    kbh,
  ).ejendomsvaerdiSkatPrimary

describe("Property tax", () => {
  it("7.1 - basic ejendomsværdiskat", () => {
    const result = calculatePropertyTax(
      makeInput({
        property: {
          propertyValue: 3000000,
          assessmentBasis: 3000000,
          landValue: 1000000,
          landAssessmentBasis: 1000000,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 1,
          personalTaxDiscount: 0,
        },
      }),
      rates,
      kbh,
    )
    expect(result.ejendomsvaerdiSkatPrimary).toBe(Math.round(0.0051 * 3000000))
  })

  it("7.2 - progressive ejendomsværdiskat", () => {
    // Ejendomsskatteloven § 22, stk. 2: 5,1 ‰ of the part not exceeding the
    // progression limit, 14 ‰ of the rest. 2026: 9.007.000 × 0,51 % = 45.935,70
    // plus 2.993.000 × 1,4 % = 41.902,00. Pinned as an absolute so the test
    // cannot drift along with the implementation.
    expect(evs(12_000_000)).toBe(87_838)
  })

  /**
   * Reproduces Vurderingsstyrelsen's own worked example for 2026:
   * 12.000.000 kr. valuation → 9.600.000 kr. basis → 9.007.000 × 0,51 % +
   * 593.000 × 1,4 % = 54.237,70 kr.
   * https://www.vurderingsportalen.dk/ejerbolig/boligskat/forstaa-din-boligskat/ejendomsvaerdiskat/
   */
  it("7.2a - matches Vurderingsstyrelsen's published example", () => {
    expect(evs(9_600_000)).toBe(54_238)
  })

  it("7.2b - taxes the top bracket at 14 ‰, not 5,1 + 14 ‰", () => {
    const limit = rates.ejendomsvaerdiSkatThreshold
    const excess = 1_000_000
    // The marginal krone above the limit must move rate, not gain a second one.
    // Stacking would add another 5.100 kr. here, far outside the ±5 kr. that
    // differencing two rounded kroner figures can cost.
    expect(evs(limit + excess) - evs(limit)).toBeCloseTo(
      rates.ejendomsvaerdiSkatHighRate * excess,
      -1,
    )
  })

  it("7.2c - pins the boundary from both sides", () => {
    const limit = rates.ejendomsvaerdiSkatThreshold
    const low = rates.ejendomsvaerdiSkatLowRate
    const high = rates.ejendomsvaerdiSkatHighRate
    expect(evs(limit - 1_000)).toBe(Math.round(low * (limit - 1_000)))
    expect(evs(limit)).toBe(Math.round(low * limit))
    expect(evs(limit + 1_000)).toBe(Math.round(low * limit + high * 1_000))
  })

  /**
   * Condos run both rates through the same reduction, so the brackets have to
   * stay disjoint there too. This pins the bracket structure only — whether the
   * reduction itself belongs on a condo at all is tracked separately.
   */
  it("7.2d - keeps the brackets disjoint for a condo", () => {
    const limit = rates.ejendomsvaerdiSkatThreshold
    const low = rates.ejendomsvaerdiSkatLowRate - rates.ejendomsvaerdiSkatPre1998Rate
    const high = rates.ejendomsvaerdiSkatHighRate - rates.ejendomsvaerdiSkatPre1998Rate
    const excess = 12_000_000 - limit
    expect(evs(limit, true)).toBe(Math.round(low * limit))
    expect(evs(12_000_000, true)).toBe(Math.round(low * limit + high * excess))
    // Marginal rate above the limit is the condo high rate on its own.
    expect(evs(12_000_000, true) - evs(limit, true)).toBeCloseTo(high * excess, -1)
  })

  it("7.3 - with ownership share 50%", () => {
    const result = calculatePropertyTax(
      makeInput({
        property: {
          propertyValue: 3000000,
          assessmentBasis: 3000000,
          landValue: 1000000,
          landAssessmentBasis: 1000000,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 0.5,
          personalTaxDiscount: 0,
        },
      }),
      rates,
      kbh,
    )
    expect(result.ejendomsvaerdiSkatPrimary).toBe(
      Math.round(0.0051 * 3000000 * 0.5),
    )
  })

  it("7.4 - grundskyld", () => {
    const result = calculatePropertyTax(
      makeInput({
        property: {
          propertyValue: 3000000,
          assessmentBasis: 3000000,
          landValue: 1000000,
          landAssessmentBasis: 1000000,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 1,
          personalTaxDiscount: 0,
        },
      }),
      rates,
      kbh,
    )
    // København grundskyld 2026: 5.1 promille -> but it's stored as 5.1
    // 5.1/1000 * 1000000 = 5100
    expect(result.grundskyldPrimary).toBe(Math.round((kbh.grundskyldRate / 1000) * 1000000))
  })

  it("7.5 - no property", () => {
    const result = calculatePropertyTax(makeInput({}), rates, kbh)
    expect(result.totalPropertyTax).toBe(0)
  })

  it("7.6 - both primary and summer house", () => {
    const odsherred = getMunicipality("Odsherred", 2026)!
    const result = calculatePropertyTax(
      makeInput({
        property: {
          propertyValue: 3000000,
          assessmentBasis: 3000000,
          landValue: 1000000,
          landAssessmentBasis: 1000000,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 1,
          personalTaxDiscount: 0,
        },
        summerHouse: {
          propertyValue: 2000000,
          assessmentBasis: 2000000,
          landValue: 500000,
          landAssessmentBasis: 500000,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 1,
          personalTaxDiscount: 0,
          municipality: "Odsherred",
        },
      }),
      rates,
      kbh,
      odsherred,
    )
    expect(result.ejendomsvaerdiSkatPrimary).toBeGreaterThan(0)
    expect(result.ejendomsvaerdiSkatSummer).toBeGreaterThan(0)
    expect(result.grundskyldPrimary).toBeGreaterThan(0)
    expect(result.grundskyldSummer).toBeGreaterThan(0)
  })
})
