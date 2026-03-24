import { describe, it, expect } from "vitest"
import { calculatePropertyTax } from "@/lib/tax/calculations/property-tax"
import { getRates } from "@/lib/tax/rates"
import { getMunicipality } from "@/lib/tax/municipalities"
import { makeInput } from "./helpers"

const rates = getRates(2026)
const kbh = getMunicipality("København", 2026)!

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
    const result = calculatePropertyTax(
      makeInput({
        property: {
          propertyValue: 12000000,
          assessmentBasis: 12000000,
          landValue: 3000000,
          landAssessmentBasis: 3000000,
          purchasedBefore19980701: false,
          isCondo: false,
          ownershipShare: 1,
          personalTaxDiscount: 0,
        },
      }),
      rates,
      kbh,
    )
    const expected = 0.0051 * 12000000 + 0.014 * (12000000 - 9007000)
    expect(result.ejendomsvaerdiSkatPrimary).toBe(Math.round(expected))
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
