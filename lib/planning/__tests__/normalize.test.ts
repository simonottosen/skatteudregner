import { describe, it, expect } from "vitest"
import { newId, normalizePlanning } from "../normalize"
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

  describe("mortgageBudgetedMonthly", () => {
    /**
     * This is the payment the *budget* withheld, and the simulation hands it
     * back before charging the modelled one. Guessing it is the failure the
     * field exists to prevent, so every unreadable input has to land on zero —
     * "the budget deducted nothing" — and never on a plausible-looking payment.
     */
    it("reads zero for a plan saved before the field existed", () => {
      // The old shape carries a loan and no deduction. Silence is not consent:
      // a plan that never recorded a deduction did not make one.
      const s = normalizePlanning({ mortgageBalance: 2_000_000 })
      expect(s.mortgageBudgetedMonthly).toBe(0)
      expect(s.mortgageBalance).toBe(2_000_000)
    })

    it("keeps a real deduction", () => {
      expect(
        normalizePlanning({ mortgageBudgetedMonthly: 12_119 })
          .mortgageBudgetedMonthly
      ).toBe(12_119)
    })

    it("floors a negative deduction at zero", () => {
      // A negative hand-back would be a payment the household received.
      expect(
        normalizePlanning({ mortgageBudgetedMonthly: -5_000 })
          .mortgageBudgetedMonthly
      ).toBe(0)
    })

    it("falls back to the default when absent or unusable", () => {
      for (const raw of [
        {},
        { mortgageBudgetedMonthly: "12119" },
        { mortgageBudgetedMonthly: NaN },
      ]) {
        expect(normalizePlanning(raw).mortgageBudgetedMonthly).toBe(
          DEFAULT_PLANNING_STATE.mortgageBudgetedMonthly
        )
      }
    })
  })

  describe("mortgageBidragssats", () => {
    it("keeps a rate the budget would accept", () => {
      // Same bound as the budget's own field, so a plan seeded from a budget
      // survives the round trip with the fee it was priced with.
      expect(
        normalizePlanning({ mortgageBidragssats: 0.006 }).mortgageBidragssats
      ).toBe(0.006)
    })

    it("clamps a rate outside the budget's range", () => {
      expect(
        normalizePlanning({ mortgageBidragssats: 0.5 }).mortgageBidragssats
      ).toBe(0.05)
      expect(
        normalizePlanning({ mortgageBidragssats: -0.01 }).mortgageBidragssats
      ).toBe(0)
    })

    it("falls back to the default when absent or unusable", () => {
      // Zero, not a market average: /planlaegning never asks for a bidragssats,
      // and an invented fee would be charged against the saving every year.
      for (const raw of [
        {},
        { mortgageBidragssats: "0.006" },
        { mortgageBidragssats: NaN },
      ]) {
        expect(normalizePlanning(raw).mortgageBidragssats).toBe(
          DEFAULT_PLANNING_STATE.mortgageBidragssats
        )
      }
      expect(DEFAULT_PLANNING_STATE.mortgageBidragssats).toBe(0)
    })
  })
})

describe("newId", () => {
  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()))
    expect(ids.size).toBe(1000)
  })

  it("keeps the caller's prefix", () => {
    expect(newId("sc").startsWith("sc-")).toBe(true)
    expect(newId().startsWith("pe-")).toBe(true)
  })
})
