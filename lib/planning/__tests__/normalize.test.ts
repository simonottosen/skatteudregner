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

  describe("properties", () => {
    it("migrates a version-1 plan's single home into the list", () => {
      // Everything saved before this field existed is a household with one
      // owner-occupied home, and it has to come back owning it: both amounts,
      // held from today, never sold.
      const migrated = normalizePlanning({
        version: 1,
        homeValue: 3_500_000,
        landValue: 1_200_000,
      })
      expect(migrated.version).toBe(2)
      expect(migrated.properties).toHaveLength(1)
      expect(migrated.properties[0]).toMatchObject({
        kind: "helaarsbolig",
        value: 3_500_000,
        landValue: 1_200_000,
        acquisitionAge: 0,
        disposalAge: null,
      })
      expect(migrated.properties[0].id).toBeTruthy()
      expect(migrated.properties[0].label).toBe("Bolig")
    })

    it("migrates a home with no grundværdi behind it", () => {
      // /skat can describe an ejendom without a separate grundværdi, and a plan
      // saved from one still owns a house.
      const migrated = normalizePlanning({ version: 1, homeValue: 2_000_000 })
      expect(migrated.properties).toEqual([
        expect.objectContaining({ value: 2_000_000, landValue: 0 }),
      ])
    })

    it("leaves a version-1 plan with no home owning nothing", () => {
      // A renter's plan, not a plan missing its house — inventing a property
      // here would charge them a tax they never owed.
      expect(normalizePlanning({ version: 1, homeValue: 0 }).properties).toEqual(
        []
      )
      expect(normalizePlanning({ version: 1 }).properties).toEqual([])
    })

    it("keeps the list a version-2 plan already has", () => {
      const saved = normalizePlanning({
        version: 2,
        properties: [
          {
            id: "prop-a",
            label: "Rækkehuset",
            kind: "helaarsbolig",
            value: 4_000_000,
            landValue: 1_500_000,
            acquisitionAge: 0,
            disposalAge: 80,
          },
          {
            id: "prop-b",
            label: "Sommerhuset",
            kind: "fritidsbolig",
            value: 1_800_000,
            landValue: 900_000,
            acquisitionAge: 55,
            disposalAge: null,
          },
        ],
      })
      expect(saved.properties).toEqual([
        {
          id: "prop-a",
          label: "Rækkehuset",
          kind: "helaarsbolig",
          value: 4_000_000,
          landValue: 1_500_000,
          acquisitionAge: 0,
          disposalAge: 80,
        },
        {
          id: "prop-b",
          label: "Sommerhuset",
          kind: "fritidsbolig",
          value: 1_800_000,
          landValue: 900_000,
          acquisitionAge: 55,
          disposalAge: null,
        },
      ])
    })

    it("ignores the legacy amounts once a list is present", () => {
      // The migration is keyed on the shape rather than on `version`, because a
      // blob reaches this from localStorage, Supabase or an MCP client with any
      // version field it likes. A list present is a list already migrated.
      const both = normalizePlanning({
        version: 1,
        homeValue: 9_000_000,
        properties: [{ kind: "fritidsbolig", value: 1_000_000 }],
      })
      expect(both.properties).toHaveLength(1)
      expect(both.properties[0]).toMatchObject({
        kind: "fritidsbolig",
        value: 1_000_000,
      })
    })

    it("reads a disposal before the purchase as a sale in the year of it", () => {
      // A typo rather than a plan: a property owned for no year at all. The
      // floor keeps the half-open interval well-formed for `propertySchedule`.
      const [p] = normalizePlanning({
        properties: [{ value: 1_000_000, acquisitionAge: 60, disposalAge: 40 }],
      }).properties
      expect(p.acquisitionAge).toBe(60)
      expect(p.disposalAge).toBe(60)
    })

    it("drops entries that describe no property at all", () => {
      expect(
        normalizePlanning({ properties: [null, "hus", 3, {}] }).properties
      ).toHaveLength(1) // only the object survives, defaulted to a 0 kr. home
      expect(normalizePlanning({ properties: "hus" }).properties).toEqual([])
    })

    it("never carries a negative amount into the tax", () => {
      const [p] = normalizePlanning({
        properties: [{ value: -1, landValue: -1 }],
      }).properties
      expect(p.value).toBe(0)
      expect(p.landValue).toBe(0)
    })
  })

  /**
   * What actually made #47's hydration fix hold, which the id format alone does
   * not: a *random* id minted during render mismatches just as badly as the old
   * counter did, so the guarantee is about where ids come from, not what they
   * look like. Restoring a saved plan is the half of that boundary reachable
   * from a test — the persisted blob is what both sides render from, so reading
   * it has to hand back the ids it already carries and mint nothing.
   *
   * The mirror half — that only a user action mints a new id — lives at the
   * call sites instead (`hooks/use-planning.ts` normalizes inside `useEffect`,
   * never during render) and is *not* covered here: the repo carries no
   * `@testing-library`, so a React hook cannot be rendered in a test at all.
   */
  describe("restoring a saved plan", () => {
    const saved = {
      version: 2,
      properties: [
        { id: "prop-4f2a9c1d", label: "Rækkehuset", kind: "helaarsbolig", value: 4_000_000 },
        { id: "prop-b7e05a33", label: "Sommerhuset", kind: "fritidsbolig", value: 1_800_000 },
      ],
      events: [
        { id: "pe-1c8d0e42", type: "expense", label: "Nyt tag", age: 45, amount: 250_000 },
        { id: "pe-9a3b6f70", type: "recurring", label: "Deltid", age: 60, monthlyDelta: -8_000 },
      ],
      scenarios: [
        {
          id: "sc-2d61ae94",
          name: "Sommerhus",
          createdAt: "2026-01-01T00:00:00.000Z",
          changes: {
            overrides: {
              properties: [{ id: "prop-e5c7801b", kind: "fritidsbolig", value: 2_000_000 }],
            },
          },
        },
      ],
    }

    it("hands back every id the blob already carries", () => {
      const s = normalizePlanning(saved)
      expect(s.properties.map((p) => p.id)).toEqual(["prop-4f2a9c1d", "prop-b7e05a33"])
      expect(s.events.map((e) => e.id)).toEqual(["pe-1c8d0e42", "pe-9a3b6f70"])
      expect(s.scenarios.map((sc) => sc.id)).toEqual(["sc-2d61ae94"])
      // A scenario's own property list is normalized down the same path.
      expect(s.scenarios[0].changes.overrides?.properties?.map((p) => p.id)).toEqual([
        "prop-e5c7801b",
      ])
    })

    it("reads the same blob into the same plan twice", () => {
      // Two independent reads of one blob — a remote sync echoing back what was
      // just saved, or the MCP server reading the row the browser wrote — have
      // to agree. Whole-state equality rather than the ids alone, because
      // anything else minted per call (a `createdAt` defaulting to now) would
      // put the two renders out of step exactly as an id does.
      expect(normalizePlanning(saved)).toEqual(normalizePlanning(saved))
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

  it("carries neither a counter nor the clock", () => {
    // Both tie the id to the process that minted it, so a list built once and
    // built again elsewhere comes out with different ids. A counter never
    // repeats either, so "does not repeat" above cannot see one coming back.
    const ids = Array.from({ length: 50 }, () => newId("prop"))
    for (const id of ids) {
      // The regression that shipped was `prop-3-1712345678901`: an extra
      // segment, and a millisecond clock reading inside it.
      expect(id.split("-")).toHaveLength(2)
      expect(id).not.toMatch(/\d{10,}/)
    }
    // A bare `prop-1` passes both checks above, so the format alone does not
    // rule out a counter. What does is that every counter suffix is digits
    // only. Asserted of the batch rather than of each id because a base-36
    // random suffix comes out digits-only about once in 28_000 — rare enough
    // to be worth ruling out, common enough to flake as a per-id assertion.
    expect(ids.some((id) => /[a-z]/.test(id.split("-")[1]))).toBe(true)
  })
})
