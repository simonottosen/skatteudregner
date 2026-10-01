import { describe, it, expect } from "vitest"
import { newId, normalizePlanning } from "../normalize"
import { DEFAULT_ASSUMPTIONS, DEFAULT_PLANNING_STATE } from "../types"

describe("normalizePlanning", () => {
  describe("loans", () => {
    /**
     * The entries themselves are `normalizeLoans`' business and are tested in
     * `loans.test.ts`. What is tested here is the plan-level join: that a
     * version-2 blob's scalars reach the list at all, that a list already there
     * is not migrated a second time, and — the one thing neither side can check
     * alone — that the migrated mortgage is secured on the *same* property
     * object the plan keeps.
     */
    it("migrates a version-2 plan's two debts into the list", () => {
      const migrated = normalizePlanning({
        version: 2,
        properties: [{ id: "prop-home", value: 4_000_000 }],
        mortgageBalance: 2_000_000,
        mortgageRate: 0.038,
        mortgageTermYears: 25,
        mortgageBidragssats: 0.006,
        otherDebtBalance: 150_000,
        otherDebtRate: 0.07,
        otherDebtTermYears: 10,
      })
      expect(migrated.version).toBe(3)
      expect(migrated.loans).toHaveLength(2)
      expect(migrated.loans[0]).toMatchObject({
        type: "realkredit",
        propertyId: "prop-home",
        principal: 2_000_000,
        rate: 0.038,
        termMonths: 300,
        bidragssats: 0.006,
      })
      expect(migrated.loans[1]).toMatchObject({
        type: "bank",
        propertyId: null,
        principal: 150_000,
      })
    })

    it("secures the migrated mortgage on the home the plan keeps", () => {
      // The ids are minted here: a version-1 home arrives without one, and
      // normalizing the properties twice would mint two. A loan secured against
      // the throwaway id would be a loan on a property the plan does not have —
      // which `missingSecurityNotice` would then ask the user about.
      const migrated = normalizePlanning({
        version: 1,
        homeValue: 3_500_000,
        mortgageBalance: 2_000_000,
      })
      expect(migrated.loans[0].propertyId).toBe(migrated.properties[0].id)
    })

    it("leaves a renter's inferred loan secured on nothing", () => {
      // Reachable on the default path: /skat's renteudgifter imply a balance
      // before any boligværdi has been entered.
      const migrated = normalizePlanning({ mortgageBalance: 2_000_000 })
      expect(migrated.properties).toEqual([])
      expect(migrated.loans[0].propertyId).toBeNull()
    })

    it("ignores the legacy scalars once a list is present", () => {
      // Keyed on the shape rather than on `version`, because a blob reaches this
      // from localStorage, Supabase or an MCP client with any version field it
      // likes. Migrating an already-migrated plan would double its debt on
      // every load.
      const both = normalizePlanning({
        version: 2,
        mortgageBalance: 9_000_000,
        loans: [{ type: "bank", principal: 50_000 }],
      })
      expect(both.loans).toHaveLength(1)
      expect(both.loans[0]).toMatchObject({ type: "bank", principal: 50_000 })
    })

    it("secures a listed loan that names no property on the home", () => {
      // The keystone of per-property settlement. The engine used to settle the
      // whole secured balance against the first property whatever each loan
      // named, so a plan saved before `propertyId` decided anything has to come
      // out saying what that plan always meant — otherwise the same household
      // would suddenly carry its mortgage until the summer house went too.
      //
      // Keyed on the key being absent rather than on `version`, because a blob
      // reaches this from localStorage, Supabase or an MCP client with any
      // version field it likes. And the version is *not* bumped: the migration
      // writes down an assumption the old engine made, so a plan is worth the
      // same before and after it, and an older build reading the plan back
      // finds a `propertyId` it already understood.
      const migrated = normalizePlanning({
        properties: [
          { id: "prop-home", value: 4_000_000 },
          { id: "prop-summer", kind: "fritidsbolig", value: 2_000_000 },
        ],
        loans: [
          { id: "l1", type: "realkredit", principal: 2_000_000 },
          { id: "l2", type: "bank", principal: 150_000 },
          {
            id: "l3",
            type: "realkredit",
            principal: 500_000,
            propertyId: null,
          },
        ],
      })
      expect(migrated.loans[0].propertyId).toBe("prop-home")
      expect(migrated.version).toBe(3)
      // A banklån is no one's pant and no sale settled it before either.
      expect(migrated.loans[1].propertyId).toBeNull()
      // An explicit null is the user's own answer — `loan-list.tsx` offers
      // "Uden pant" — and has to survive the plan being loaded again.
      expect(migrated.loans[2].propertyId).toBeNull()
    })

    it("has no home to secure a renter's listed loan on", () => {
      // The one plan where the fallback is reached on purpose: nothing to name,
      // so the loan comes due when the household's last property goes — and it
      // has none, so never.
      const migrated = normalizePlanning({
        loans: [{ type: "realkredit", principal: 2_000_000 }],
      })
      expect(migrated.properties).toEqual([])
      expect(migrated.loans[0].propertyId).toBeNull()
    })

    it("owes nothing on a plan that says nothing about debt", () => {
      expect(normalizePlanning({}).loans).toEqual([])
      expect(DEFAULT_PLANNING_STATE.loans).toEqual([])
    })
  })

  describe("assumptions.equityBorrowingRate", () => {
    /**
     * The rate the projection charges on equity borrowed mid-retirement. It used
     * to read the plan's `mortgageRate`, which is gone — and an unmigrated plan
     * would fall to the shared default, silently repricing the borrowing of
     * every household whose own rate was not 4,1 %.
     */
    it("takes the old mortgage rate as the plan's own", () => {
      const s = normalizePlanning({ version: 2, mortgageRate: 0.052 })
      expect(s.assumptions.equityBorrowingRate).toBe(0.052)
    })

    it("takes it even from a plan that already has an assumptions object", () => {
      // The old field is a sibling of `assumptions`, not a member of it, so a
      // plan with assumptions saved and no `equityBorrowingRate` among them
      // still has a rate to migrate.
      const s = normalizePlanning({
        version: 2,
        mortgageRate: 0.052,
        assumptions: { inflation: 0.02 },
      })
      expect(s.assumptions.equityBorrowingRate).toBe(0.052)
      expect(s.assumptions.inflation).toBe(0.02)
    })

    it("keeps a rate the plan states for itself", () => {
      // A migrated plan is saved with both fields: the assumption wins, or
      // editing it would be undone by the legacy sibling on the next load.
      const s = normalizePlanning({
        mortgageRate: 0.052,
        assumptions: { equityBorrowingRate: 0.06 },
      })
      expect(s.assumptions.equityBorrowingRate).toBe(0.06)
    })

    it("falls back to the default for a plan that states neither", () => {
      expect(normalizePlanning({}).assumptions.equityBorrowingRate).toBe(
        DEFAULT_ASSUMPTIONS.equityBorrowingRate
      )
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
      expect(s.loans[0].principal).toBe(2_000_000)
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
      expect(migrated.version).toBe(3)
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
          use: "own",
          value: 4_000_000,
          landValue: 1_500_000,
          saleCostsPct: 0,
          acquisitionAge: 0,
          disposalAge: 80,
        },
        {
          id: "prop-b",
          label: "Sommerhuset",
          kind: "fritidsbolig",
          use: "own",
          value: 1_800_000,
          landValue: 900_000,
          saleCostsPct: 0,
          acquisitionAge: 55,
          disposalAge: null,
        },
      ])
    })

    it("reads a plan saved before `use` existed as owner-occupied", () => {
      // The field is additive with a default, so the migration is keyed on the
      // property's own shape rather than on `version` — same reason as the
      // list migration above. Anything else would claim a use the user never
      // chose, and `"rented"` in particular is not modelled at all.
      const [p] = normalizePlanning({
        properties: [{ value: 3_000_000 }],
      }).properties
      expect(p.use).toBe("own")
    })

    it("reads a use it does not know as owner-occupied", () => {
      // An MCP client can send any string it likes; an unrecognised one must
      // not leave the property with a use nothing in the app can render.
      const [p] = normalizePlanning({
        properties: [{ value: 3_000_000, use: "garage" }],
      }).properties
      expect(p.use).toBe("own")
    })

    it("keeps a use it does know", () => {
      const [rented] = normalizePlanning({
        properties: [{ value: 3_000_000, use: "rented" }],
      }).properties
      expect(rented.use).toBe("rented")
      const [vacant] = normalizePlanning({
        properties: [{ value: 3_000_000, use: "vacant" }],
      }).properties
      expect(vacant.use).toBe("vacant")
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
      version: 3,
      properties: [
        { id: "prop-4f2a9c1d", label: "Rækkehuset", kind: "helaarsbolig", value: 4_000_000 },
        { id: "prop-b7e05a33", label: "Sommerhuset", kind: "fritidsbolig", value: 1_800_000 },
      ],
      loans: [
        { id: "loan-6b1f3d08", propertyId: "prop-4f2a9c1d", type: "realkredit", principal: 2_400_000 },
        { id: "loan-08c4e2b5", propertyId: null, type: "bank", principal: 180_000 },
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
      expect(s.loans.map((l) => l.id)).toEqual(["loan-6b1f3d08", "loan-08c4e2b5"])
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
