import { describe, it, expect } from "vitest"
import {
  foldPropertyEvents,
  newId,
  normalizePlanning,
  normalizeProperties,
} from "../normalize"
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PLANNING_STATE,
  type PlannedProperty,
} from "../types"
// The migration's whole claim is about what a plan *projects* to, so the one
// test that can check it has to run the projection. Stating the expected list
// alone would lock the shape of the migration without ever asking whether the
// household it describes still sells its house, settles its mortgage and pays
// for the next one.
import { simulatePlanning } from "../simulate"
import { applyScenario } from "../scenario"
import { DEFAULT_LTV } from "../properties"

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
      expect(migrated.version).toBe(4)
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
      // version field it likes — this one carries none at all and still comes
      // back stamped with the current one.
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
      expect(migrated.version).toBe(4)
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
      expect(migrated.version).toBe(4)
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
          // Both are additive fields with a default, and the default is what the
          // plan was projected with before they existed: paid for in full, and
          // appreciating at the projection's own rate.
          financing: null,
          housingReturn: null,
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
          financing: null,
          housingReturn: null,
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

    it("carries a purchase's financing and its own return back out again", () => {
      // Every saved plan goes out through `JSON.stringify` and comes back in
      // through here, so a field this drops is a field the user types once and
      // loses on reload — and both of these are what the deleted move event used
      // to carry, which makes dropping them the quiet way to undo issue #9.
      const [p] = normalizePlanning({
        properties: [
          {
            value: 3_000_000,
            acquisitionAge: 55,
            financing: { ltv: 0.8 },
            housingReturn: 0.015,
          },
        ],
      }).properties
      expect(p.financing).toEqual({ ltv: 0.8 })
      expect(p.housingReturn).toBe(0.015)
    })

    it("reads no financing block at all as an all-equity purchase", () => {
      // The absence is what every plan saved before the field existed says, and
      // all-equity is how those plans were projected. A block that *is* there
      // with nothing usable in it asked to be financed, so it gets the
      // realkreditlovens 80 % rather than nothing — the two cases are only a
      // key apart in a blob, so this is the boundary worth stating.
      const ltvOf = (financing: unknown) =>
        normalizePlanning({ properties: [{ value: 3_000_000, financing }] })
          .properties[0].financing
      expect(ltvOf(undefined)).toBeNull()
      expect(ltvOf(null)).toBeNull()
      expect(ltvOf("80%")).toBeNull()
      expect(ltvOf({})).toEqual({ ltv: DEFAULT_LTV })
      // And a share, bounded: lov om realkreditlån § 5 caps a helårsbolig at
      // 80 %, but a household can carry a boligkredit on top, so the bound here
      // is only the one that keeps the arithmetic a purchase.
      expect(ltvOf({ ltv: 2 })).toEqual({ ltv: 1 })
      expect(ltvOf({ ltv: -1 })).toEqual({ ltv: 0 })
    })
  })

  /**
   * A version-3 plan said "I move house at 52" with a `PropertyEvent`; the list
   * says it with a disposal age and a second entry. Replaying one into the other
   * is what lets issue #9 delete the event type outright instead of leaving two
   * mechanisms that do not know about each other.
   */
  describe("replaying version-3 moves into the property list", () => {
    it("walks a chain of moves forward through the list", () => {
      const s = normalizePlanning({
        version: 3,
        currentAge: 40,
        properties: [
          {
            id: "prop-home",
            label: "Huset",
            value: 3_000_000,
            landValue: 900_000,
            saleCostsPct: 0.03,
            disposalAge: 70,
          },
        ],
        events: [
          {
            id: "m1",
            type: "property",
            label: "Rækkehus",
            age: 50,
            newValue: 4_000_000,
            mortgageLtv: 0.8,
          },
          {
            id: "m2",
            type: "property",
            label: "Lejlighed",
            age: 60,
            newValue: 2_500_000,
            mortgageLtv: 0.4,
            housingReturnOverride: 0.01,
          },
        ],
      })
      // The events are gone: a move is not a life event any more, and leaving
      // one on the list would have the household move twice.
      expect(s.events).toEqual([])
      expect(s.properties).toEqual([
        {
          id: "prop-home",
          label: "Huset",
          kind: "helaarsbolig",
          use: "own",
          value: 3_000_000,
          landValue: 900_000,
          saleCostsPct: 0.03,
          acquisitionAge: 0,
          // Closed by the first move, where the plan said 70 before.
          disposalAge: 50,
          financing: null,
          housingReturn: null,
        },
        {
          id: expect.any(String),
          label: "Rækkehus",
          kind: "helaarsbolig",
          use: "own",
          value: 4_000_000,
          // The grundværdi follows the home, scaled by the change in value —
          // which is what the move event itself did to it.
          landValue: 1_200_000,
          // What it costs to sell is the entry's own figure, and the move left
          // that standing.
          saleCostsPct: 0.03,
          acquisitionAge: 50,
          disposalAge: 60,
          financing: { ltv: 0.8 },
          housingReturn: null,
        },
        {
          id: expect.any(String),
          label: "Lejlighed",
          kind: "helaarsbolig",
          use: "own",
          value: 2_500_000,
          landValue: 750_000,
          saleCostsPct: 0.03,
          acquisitionAge: 60,
          // "Sold at 70" was stated on the home the household moves out of at
          // 50, and the engine read it at the sale — so it was always a sale of
          // whatever the household was living in by then.
          disposalAge: 70,
          financing: { ltv: 0.4 },
          housingReturn: 0.01,
        },
      ])
    })

    it("leaves a disposal that has already fired where the plan put it", () => {
      // The carry forward is for a disposal the move has not reached yet. One
      // dated *before* the move describes a home the household has already
      // sold, and handing it to the successor dated the new purchase's sale
      // before its own acquisition — so the purchase was dropped as a window
      // owned for no year, while the old home's own sale was pushed out to the
      // year of the move. The plan lost a house and kept one five years too
      // long, both at once.
      const s = normalizePlanning({
        version: 3,
        currentAge: 40,
        properties: [
          {
            id: "prop-home",
            label: "Huset",
            value: 3_000_000,
            landValue: 900_000,
            saleCostsPct: 0.03,
            disposalAge: 45,
          },
        ],
        events: [
          {
            id: "m1",
            type: "property",
            label: "Lejlighed",
            age: 50,
            newValue: 2_000_000,
            mortgageLtv: 0.6,
          },
        ],
      })
      expect(s.properties).toEqual([
        expect.objectContaining({ id: "prop-home", disposalAge: 45 }),
        expect.objectContaining({
          label: "Lejlighed",
          value: 2_000_000,
          // Still scaled off the entry the move replaces, and still sold on
          // that entry's terms: only the *date* of the sale fails to carry.
          landValue: 600_000,
          saleCostsPct: 0.03,
          acquisitionAge: 50,
          disposalAge: null,
          financing: { ltv: 0.6 },
        }),
      ])
    })

    it("drops a move the household has already made", () => {
      // The engine only ever looked up events from `currentAge` forward, so a
      // move dated in the past never fired. Migrating it would invent a
      // transaction the plan was never projected with — and, worse, one dated
      // before the projection starts, which the list reads as the household's
      // opening position.
      const s = normalizePlanning({
        version: 3,
        currentAge: 40,
        properties: [{ id: "prop-home", value: 3_000_000 }],
        events: [
          {
            id: "m1",
            type: "property",
            label: "Gammel flytning",
            age: 35,
            newValue: 9_000_000,
            mortgageLtv: 0.8,
          },
        ],
      })
      expect(s.properties).toHaveLength(1)
      expect(s.properties[0]).toMatchObject({
        id: "prop-home",
        value: 3_000_000,
        disposalAge: null,
      })
    })

    /**
     * The one date the two vocabularies disagree about. A move at `currentAge`
     * cannot migrate to an acquisition at `currentAge`: the list reads that as
     * part of the opening position — bought before the projection starts, and so
     * never paid for inside it — and reads a disposal in the same year as never
     * owned at all. The household would be handed its new home for free and keep
     * the old home's mortgage. The projection's first year is the earliest one
     * that can carry all three halves of the transaction, so that is where it
     * goes, and these are the three.
     */
    describe("a move dated at the household's own age", () => {
      const moved = (mortgageLtv: number, startInvestments = 0) =>
        normalizePlanning({
          version: 3,
          currentAge: 40,
          endAge: 42,
          retirementAge: 65,
          startInvestments,
          monthlyContribution: 0,
          properties: [{ id: "prop-home", value: 2_000_000 }],
          loans: [
            {
              id: "l1",
              type: "realkredit",
              propertyId: "prop-home",
              principal: 500_000,
              rate: 0.04,
              termMonths: 360,
            },
          ],
          assumptions: {
            investmentReturn: 0,
            investmentFee: 0,
            housingReturn: 0,
            volatility: 0,
            housingVolatility: 0,
            inflation: 0,
            contributionGrowth: 0,
          },
          events: [
            {
              id: "m1",
              type: "property",
              label: "Nyt hus",
              age: 40,
              newValue: 3_000_000,
              mortgageLtv,
            },
          ],
        })

      it("lands in the projection's first year", () => {
        const s = moved(0.8)
        expect(s.properties).toHaveLength(2)
        expect(s.properties[0]).toMatchObject({
          id: "prop-home",
          disposalAge: 41,
        })
        expect(s.properties[1]).toMatchObject({
          value: 3_000_000,
          acquisitionAge: 41,
          financing: { ltv: 0.8 },
        })
      })

      it("still realises the equity, settles the mortgage and pays the down payment", () => {
        const points = simulatePlanning(moved(0.8)).points
        // Year 0 is the opening position, unchanged: the old home, the old
        // mortgage, an empty portfolio.
        expect(points[0].age).toBe(40)
        expect(points[0].investments).toBe(0)
        expect(points[0].homeEquity).toBeCloseTo(1_500_000, 6)

        const at41 = points.find((p) => p.age === 41)!
        // 2.000.000 of house sold, less the 500.000 mortgage it secured, less
        // the 600.000 down payment on a 3.000.000 home financed at 80 %. Each
        // of the three is the difference between this figure and a projection
        // that skipped that half of the transaction.
        expect(at41.investments).toBeCloseTo(2_000_000 - 500_000 - 600_000, 6)
        // And the new mortgage — and only it — stands against the new house: an
        // unsettled old loan would leave 100.000 here instead.
        expect(at41.homeEquity).toBeCloseTo(3_000_000 - 2_400_000, 6)
      })

      it("costs the price of the house when the move borrows nothing", () => {
        // At an LTV of zero the down payment is the whole price, so the
        // portfolio has to carry it: 3.000.000 in, plus the 1.500.000 the sale
        // realised, less the 3.000.000 the house cost. That the figure moves
        // with the LTV at all is what says the down payment above was really
        // paid out rather than netted off the price.
        const at41 = simulatePlanning(moved(0, 3_000_000)).points.find(
          (p) => p.age === 41
        )!
        expect(at41.investments).toBeCloseTo(1_500_000, 6)
        // Nothing is owed on the house, so it is worth its price.
        expect(at41.homeEquity).toBeCloseTo(3_000_000, 6)
      })
    })

    it("folds a scenario's move into the properties it overrides", () => {
      // "What if I moved" could be saved as a scenario, and `applyScenario`
      // spreads `changes.overrides` over the plan and reads nothing else — so a
      // migrated move has to land *inside* `overrides`, or it would be dropped
      // without a word.
      const s = normalizePlanning({
        version: 3,
        currentAge: 40,
        properties: [{ id: "prop-home", value: 3_000_000 }],
        scenarios: [
          {
            id: "sc-1",
            name: "Mindre hus",
            createdAt: "2026-01-01T00:00:00.000Z",
            changes: {
              addEvents: [
                {
                  type: "property",
                  label: "Lejlighed",
                  age: 55,
                  newValue: 2_000_000,
                  mortgageLtv: 0.6,
                },
              ],
            },
          },
        ],
      })
      const { changes } = s.scenarios[0]
      expect(changes.addEvents).toBeUndefined()
      expect(changes.overrides?.properties).toEqual([
        expect.objectContaining({ id: "prop-home", disposalAge: 55 }),
        expect.objectContaining({
          label: "Lejlighed",
          value: 2_000_000,
          acquisitionAge: 55,
          financing: { ltv: 0.6 },
        }),
      ])
      // The plan itself keeps its one house: the scenario's list is a copy, so
      // asking "what if I moved" must not close the window on the home the
      // household actually has.
      expect(s.properties).toEqual([
        expect.objectContaining({ id: "prop-home", disposalAge: null }),
      ])
      // And the override really reaches the plan the scenario projects.
      expect(applyScenario(s, changes).properties).toHaveLength(2)
    })

    it("dates a scenario's move on the plan's own timeline", () => {
      // A scenario's `addEvents` fire on the plan's clock, so the current-year
      // rule has to be applied against the *plan's* `currentAge` and not against
      // the 0 a caller with no plan falls back to — which would date this move
      // at 40 and hand the household the new flat for nothing.
      const s = normalizePlanning({
        version: 3,
        currentAge: 40,
        properties: [{ id: "prop-home", value: 3_000_000 }],
        scenarios: [
          {
            id: "sc-1",
            name: "Flyt nu",
            createdAt: "2026-01-01T00:00:00.000Z",
            changes: {
              addEvents: [
                {
                  type: "property",
                  label: "Lejlighed",
                  age: 40,
                  newValue: 2_000_000,
                  mortgageLtv: 0.6,
                },
              ],
            },
          },
        ],
      })
      expect(s.scenarios[0].changes.overrides?.properties).toEqual([
        expect.objectContaining({ id: "prop-home", disposalAge: 41 }),
        expect.objectContaining({ label: "Lejlighed", acquisitionAge: 41 }),
      ])
    })

    /**
     * A plan that moves and a scenario that moves again. The list the scenario
     * is folded against is the plan's, with the plan's own move already
     * replayed into it — so its first entry is a house the household sold years
     * before the scenario's move lands, and starting the second chain there
     * reopened that sale, left the first successor never sold, and dropped the
     * scenario's own purchase for having a disposal older than its acquisition.
     */
    describe("a scenario that moves again after the plan already moved", () => {
      const moving = (scenarioAge: number) =>
        normalizePlanning({
          version: 3,
          currentAge: 40,
          properties: [
            { id: "prop-home", value: 3_000_000, landValue: 900_000 },
          ],
          events: [
            {
              id: "m1",
              type: "property",
              label: "Rækkehus",
              age: 50,
              newValue: 4_000_000,
              mortgageLtv: 0.8,
            },
          ],
          scenarios: [
            {
              id: "sc-1",
              name: "Flyt igen",
              createdAt: "2026-01-01T00:00:00.000Z",
              changes: {
                addEvents: [
                  {
                    type: "property",
                    label: "Lejlighed",
                    age: scenarioAge,
                    newValue: 2_500_000,
                    mortgageLtv: 0.4,
                  },
                ],
              },
            },
          ],
        })

      it("sells the house the plan's own move bought", () => {
        const s = moving(60)
        expect(s.scenarios[0].changes.overrides?.properties).toEqual([
          // The plan's move still ends here, not ten years later.
          expect.objectContaining({ id: "prop-home", disposalAge: 50 }),
          // And the house it bought is the one the scenario sells.
          expect.objectContaining({
            label: "Rækkehus",
            acquisitionAge: 50,
            disposalAge: 60,
          }),
          expect.objectContaining({
            label: "Lejlighed",
            value: 2_500_000,
            landValue: 750_000,
            acquisitionAge: 60,
            disposalAge: null,
            financing: { ltv: 0.4 },
          }),
        ])
        // The plan itself keeps the household its own move left it with.
        expect(s.properties).toEqual([
          expect.objectContaining({ id: "prop-home", disposalAge: 50 }),
          expect.objectContaining({ label: "Rækkehus", disposalAge: null }),
        ])
      })

      /**
       * What makes folding twice legitimate at all. `applyScenario` *appends*
       * `addEvents` to the plan's own, so in the old vocabulary the plan's move
       * and the scenario's fired as one chain on one timeline — and the only
       * honest test of a second fold is that it lands the household where
       * folding that one chain against the untouched list would have.
       *
       * Compared as a set of windows rather than as a list: the second fold
       * appends the scenario's purchase after the plan's, so a scenario move
       * dated *before* the plan's comes out in a different order. Nothing reads
       * that order except `normalizeLoans`, which reads the first entry — the
       * household's own home, first in both.
       */
      it("lands where folding the two chains as one would", () => {
        const window = (p: {
          value: number
          landValue: number
          saleCostsPct: number
          acquisitionAge: number
          disposalAge: number | null
          financing: { ltv: number } | null
        }) => ({
          value: p.value,
          landValue: p.landValue,
          saleCostsPct: p.saleCostsPct,
          acquisitionAge: p.acquisitionAge,
          disposalAge: p.disposalAge,
          financing: p.financing,
        })
        const windows = (list: readonly PlannedProperty[]) =>
          list
            .map(window)
            .sort((a, b) => a.acquisitionAge - b.acquisitionAge)

        const plansMove = {
          id: "m1",
          type: "property",
          label: "Rækkehus",
          age: 50,
          newValue: 4_000_000,
          mortgageLtv: 0.8,
        }
        const scenariosMove = (age: number) => ({
          id: "m2",
          type: "property",
          label: "Lejlighed",
          age,
          newValue: 2_500_000,
          mortgageLtv: 0.4,
        })
        // The one chain, folded once against the list the plan states.
        const asOneChain = (age: number) =>
          foldPropertyEvents(
            normalizeProperties({
              properties: [
                { id: "prop-home", value: 3_000_000, landValue: 900_000 },
              ],
            }),
            [plansMove, scenariosMove(age)],
            40
          )

        for (const age of [60, 45]) {
          expect(
            windows(moving(age).scenarios[0].changes.overrides!.properties!)
          ).toEqual(windows(asOneChain(age)))
        }
      })
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
