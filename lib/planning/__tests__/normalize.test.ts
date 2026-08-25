import { describe, it, expect } from "vitest"
import { normalizePlanning } from "../normalize"
import { DEFAULT_PLANNING_STATE } from "../types"

describe("normalizePlanning", () => {
  describe("mortgageInterestOnlyYears", () => {
    /**
     * Afdragsfrihed sits inside the loan term, so a longer period than the loan
     * itself describes a loan that is never repaid. The simulation copes with
     * that on its own — past maturity it only charges interest either way — so
     * the reason to bound it here is the stored plan and the input, which offers
     * the term as its maximum. Without this, a saved plan can hold a value the
     * user cannot re-enter and cannot see is wrong.
     */
    it("caps the period at the loan term", () => {
      const s = normalizePlanning({
        mortgageTermYears: 20,
        mortgageInterestOnlyYears: 30,
      })
      expect(s.mortgageInterestOnlyYears).toBe(20)
    })

    it("clamps against the term after that term is itself clamped", () => {
      // The raw term is out of range, so capping against it rather than against
      // the value actually stored would let 45 through.
      const s = normalizePlanning({
        mortgageTermYears: 60,
        mortgageInterestOnlyYears: 45,
      })
      expect(s.mortgageTermYears).toBe(40)
      expect(s.mortgageInterestOnlyYears).toBe(40)
    })

    it("leaves a period inside the term alone", () => {
      const s = normalizePlanning({
        mortgageTermYears: 30,
        mortgageInterestOnlyYears: 10,
      })
      expect(s.mortgageInterestOnlyYears).toBe(10)
    })

    it("falls back to the default when absent or unusable", () => {
      for (const raw of [{}, { mortgageInterestOnlyYears: "5" }, { mortgageInterestOnlyYears: NaN }]) {
        expect(normalizePlanning(raw).mortgageInterestOnlyYears).toBe(
          DEFAULT_PLANNING_STATE.mortgageInterestOnlyYears
        )
      }
    })

    it("floors a negative period at zero", () => {
      expect(
        normalizePlanning({ mortgageInterestOnlyYears: -5 })
          .mortgageInterestOnlyYears
      ).toBe(0)
    })
  })
})
