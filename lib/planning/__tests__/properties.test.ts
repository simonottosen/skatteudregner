import { describe, it, expect } from "vitest"
import {
  DEFAULT_LTV,
  DEFAULT_SALE_COSTS_PCT,
  PROPERTY_USES,
  PROPERTY_USE_LABEL,
  SALE_COSTS_HELPER_TEXT,
  clampHousingReturn,
  clampLtv,
  clampSaleCostsPct,
  newPlannedProperty,
  offersFinancing,
  ownershipSummary,
  pensionerNedslagNotice,
  propertySummary,
  removeProperty,
  rentalExclusionNotice,
  replaceProperty,
  withAcquisitionAge,
} from "../properties"
import { normalizeProperties } from "../normalize"
import type { PlannedProperty } from "../types"

const at = (fields: Partial<PlannedProperty> = {}): PlannedProperty => ({
  id: "p1",
  label: "Bolig",
  kind: "helaarsbolig",
  use: "own",
  value: 4_000_000,
  landValue: 1_500_000,
  saleCostsPct: 0,
  acquisitionAge: 0,
  disposalAge: null,
  financing: null,
  housingReturn: null,
  ...fields,
})

/**
 * A stored plan from before `saleCostsPct` existed. The field is deleted rather
 * than set to anything, because its absence is the whole point: `clampNum`
 * falls back only on a value that is not a number, so absent and 0 are read
 * differently and no literal could stand in for "not there".
 */
const planSavedWithoutSaleCosts = (): unknown => {
  const saved: Record<string, unknown> = { ...at() }
  delete saved.saleCostsPct
  return { properties: [saved] }
}

describe("newPlannedProperty", () => {
  it("starts at nothing rather than at a guess", () => {
    // A value the user did not type is one they would have to notice to
    // correct; zero kroner is charged no tax in the meantime.
    const p = newPlannedProperty("fritidsbolig", 42)
    expect(p.value).toBe(0)
    expect(p.landValue).toBe(0)
    expect(p.kind).toBe("fritidsbolig")
    expect(p.label).toBe("Sommerhus")
  })

  it("is owned from today and never sold", () => {
    const p = newPlannedProperty("helaarsbolig", 42)
    expect(p.acquisitionAge).toBe(42)
    expect(p.disposalAge).toBeNull()
  })

  it("starts out owner-occupied, the one use the projection models", () => {
    // Any other default would have a fresh property carrying an assumption the
    // user never made — and for "rented" an unmodelled one at that.
    expect(newPlannedProperty("helaarsbolig", 42).use).toBe("own")
    expect(newPlannedProperty("fritidsbolig", 42).use).toBe("own")
  })

  it("gives every entry an identity of its own", () => {
    const a = newPlannedProperty("helaarsbolig", 40)
    const b = newPlannedProperty("helaarsbolig", 40)
    expect(a.id).not.toBe(b.id)
  })

  it("rounds an age the simulation compares against whole years", () => {
    expect(newPlannedProperty("helaarsbolig", 41.6).acquisitionAge).toBe(42)
    expect(newPlannedProperty("helaarsbolig", -3).acquisitionAge).toBe(0)
  })
})

describe("replaceProperty", () => {
  it("swaps the entry with that id and leaves the rest alone", () => {
    const list = [at({ id: "a" }), at({ id: "b" })]
    const next = replaceProperty(list, at({ id: "b", value: 9_000_000 }))
    expect(next.map((p) => p.value)).toEqual([4_000_000, 9_000_000])
    expect(list[1].value).toBe(4_000_000) // the input is untouched
  })

  it("leaves the list alone when the entry is already gone", () => {
    // A stale edit racing a removal must not resurrect the property.
    const list = [at({ id: "a" })]
    expect(replaceProperty(list, at({ id: "gone" }))).toEqual(list)
  })
})

describe("removeProperty", () => {
  it("drops only the entry with that id", () => {
    const list = [at({ id: "a" }), at({ id: "b" }), at({ id: "c" })]
    expect(removeProperty(list, "b").map((p) => p.id)).toEqual(["a", "c"])
  })
})

/**
 * The form writes this field straight into the plan the projection reads, so the
 * bound has to hold there and not only on the way back out of storage. An
 * unbounded share pays the household *more* than the house sold for at −3 %, or
 * takes half of it at 50 %, and the figure then comes back changed on the next
 * reload — two projections of one saved plan.
 */
describe("clampSaleCostsPct", () => {
  it("holds the share at both ends and leaves a real figure alone", () => {
    expect(clampSaleCostsPct(-0.03, DEFAULT_SALE_COSTS_PCT)).toBe(0)
    expect(clampSaleCostsPct(0.5, DEFAULT_SALE_COSTS_PCT)).toBe(0.2)
    // A typical Danish sale, untouched.
    expect(clampSaleCostsPct(0.03, DEFAULT_SALE_COSTS_PCT)).toBe(0.03)
  })

  it("leaves an unreadable field on the figure the row already carries", () => {
    // This said "half-typed" and claimed a mid-keystroke snap until the review
    // that converted clampLtv checked: PercentField's `num` substitutes the
    // field's own value first, so an emptied field never arrives here. ±Infinity
    // does — `parseFloat("1e999")` is not NaN — and so does anything the
    // normalizer reads out of a blob. See the function's own doc for why the
    // fallback stays the caller's regardless of what the .tsx happens to do.
    expect(clampSaleCostsPct(Infinity, 0.04)).toBe(0.04)
    expect(clampSaleCostsPct(NaN, 0.04)).toBe(0.04)
    expect(clampSaleCostsPct(undefined, 0)).toBe(0)
  })

  it("agrees with what a reload makes of the same figure", () => {
    // One bound with one owner: the live clamp and the normalizer have to reach
    // the same number, or the plan on screen is not the plan that was saved.
    // Only finite values here — the fallback is deliberately *not* shared, so
    // what this locks is the bound.
    for (const typed of [-0.03, 0, 0.025, 0.2, 0.5]) {
      const reloaded = normalizeProperties({
        properties: [at({ saleCostsPct: typed })],
      })[0].saleCostsPct
      expect(reloaded).toBe(clampSaleCostsPct(typed, DEFAULT_SALE_COSTS_PCT))
    }
  })

  it("asks for the figure in the range a real sale lands in", () => {
    // The bound is not a hint — 20 % passes and ruins the projection — so the
    // copy has to name the range the user is actually looking for.
    expect(SALE_COSTS_HELPER_TEXT).toContain("2–4 %")
    expect(SALE_COSTS_HELPER_TEXT).toContain("salgsprisen")
  })

  it("names costs the seller actually carries, and says whose the afgift is", () => {
    // The share is charged on the seller's proceeds, so every cost the copy
    // names has to be the seller's. It read "Mægler, advokat og tinglysning"
    // until the default made the figure matter, and tinglysningsafgiften på
    // skødet is the buyer's by kutyme — so of the three things the sentence
    // told the user to add up, one belonged to the other party.
    //
    // Asserted rather than left to review because the afgift is the one sale
    // cost with a published rate, which makes it the obvious thing to put back.
    expect(SALE_COSTS_HELPER_TEXT).toContain("Mægler")
    expect(SALE_COSTS_HELPER_TEXT).toContain("tilstandsrapport")
    expect(SALE_COSTS_HELPER_TEXT).toMatch(/[Tt]inglysning\S*\s+betaler\s+køber/)
  })
})

/**
 * What a sale costs when the plan does not say. The field shipped defaulting to
 * 0 — a sale that costs nothing, which no real sale is — because the mechanism
 * arrived alongside a refactor the recorded fixtures lock, and a default worth
 * having would have moved every recorded number in the same commit. These tests
 * are what that deferred decision came back as.
 */
describe("DEFAULT_SALE_COSTS_PCT", () => {
  it("reads a plan that predates the field as the default, and an explicit 0 as 0", () => {
    // The distinction this whole default turns on. `clampNum` falls back only
    // on a value that is not a number, so a plan saved before the field existed
    // — which had no way to say anything — is read as the typical sale, while a
    // household that saw the input and chose a free sale keeps it.
    //
    // Stated against the constant and not against 3 %: what has to hold here is
    // that absent and zero are told apart, which stays true whatever the
    // default becomes. The figure itself is locked by the range test below.
    expect(
      normalizeProperties(planSavedWithoutSaleCosts())[0].saleCostsPct
    ).toBe(DEFAULT_SALE_COSTS_PCT)
    expect(
      normalizeProperties({ properties: [at({ saleCostsPct: 0 })] })[0]
        .saleCostsPct
    ).toBe(0)
  })

  it("reads a plan with no figure the way a fresh entry starts", () => {
    // `boolOr` in ./normalize states the rule: a saved plan that predates a
    // field has no opinion about it, so it has to land wherever a fresh plan
    // lands. Spelling the two defaults out separately is how they drift.
    expect(
      normalizeProperties(planSavedWithoutSaleCosts())[0].saleCostsPct
    ).toBe(newPlannedProperty("helaarsbolig", 40).saleCostsPct)
  })

  it("sits in the range the form asks for the figure in", () => {
    // The copy named 2–4 % before the engine agreed with it. Now that the
    // default is a figure rather than a free sale, the two have to stay in
    // step: a helper text promising 2–4 % over an engine assuming something
    // outside it would be the form contradicting the projection again.
    expect(DEFAULT_SALE_COSTS_PCT).toBeGreaterThanOrEqual(0.02)
    expect(DEFAULT_SALE_COSTS_PCT).toBeLessThanOrEqual(0.04)
  })
})

describe("clampLtv", () => {
  it("holds the share at both ends and leaves a real figure alone", () => {
    // Above 1 the purchase hands the household a house and change besides;
    // below 0 it pays the household for buying one.
    expect(clampLtv(-0.2, DEFAULT_LTV)).toBe(0)
    expect(clampLtv(1.5, DEFAULT_LTV)).toBe(1)
    // Over the realkreditlovens 80 % but reachable with a boligkredit on top,
    // which is why the bound is 1 and not the law's limit.
    expect(clampLtv(0.85, DEFAULT_LTV)).toBe(0.85)
  })

  it("leaves an unreadable belåningsgrad on the share the row already carries", () => {
    // The function used to answer every unreadable value with DEFAULT_LTV, so a
    // form passing one got 80 % back whatever the row said. Reachable through
    // PercentField only as ±Infinity — `parseFloat("1e999")` is not NaN, so its
    // `num` guard passes it through — but the point of the fallback is that the
    // lib does not depend on that guard, which lives in a .tsx no test here can
    // collect.
    expect(clampLtv(Infinity, 0.85)).toBe(0.85)
    expect(clampLtv(NaN, 0.85)).toBe(0.85)
    // And a share the plan stated as something unreadable keeps whatever the
    // caller says it had, including a 0 nobody would guess.
    expect(clampLtv(undefined, 0)).toBe(0)
  })

  it("agrees with what a reload makes of the same figure", () => {
    // One bound with one owner, as for the sale-cost share above. Finite values
    // only: the fallback is deliberately not shared, so what this locks is the
    // bound. The normalizer's own side of the bargain — that a financing block
    // naming no share at all is read as DEFAULT_LTV — is stated in
    // ./normalize.test, next to the absent-block case it is a key apart from.
    for (const typed of [-0.2, 0, 0.8, 0.85, 1.5]) {
      const reloaded = normalizeProperties({
        properties: [at({ financing: { ltv: typed } })],
      })[0].financing?.ltv
      expect(reloaded).toBe(clampLtv(typed, DEFAULT_LTV))
    }
  })
})

describe("clampHousingReturn", () => {
  it("holds the rate at both ends and leaves a real figure alone", () => {
    // Past −1 the house is worth less than nothing after one year; past 1 it
    // doubles every year until it is the whole of the household's net worth.
    expect(clampHousingReturn(-2, 0)).toBe(-1)
    expect(clampHousingReturn(3, 0)).toBe(1)
    expect(clampHousingReturn(0.03, 0)).toBe(0.03)
  })

  it("leaves an unreadable rate on the rate the row already carries", () => {
    // Sharper than for either share above, because 0 — what this function used
    // to bake in — is a rate a household might mean. A row forced to it reads
    // as a deliberate "this bolig does not appreciate" rather than as an
    // unreadable input, and the fremskrivning would believe it.
    expect(clampHousingReturn(Infinity, 0.05)).toBe(0.05)
    expect(clampHousingReturn(NaN, 0.05)).toBe(0.05)
    expect(clampHousingReturn(undefined, -0.01)).toBe(-0.01)
  })

  it("agrees with what a reload makes of the same figure", () => {
    // Same bargain as the sale-cost share above: the field writes into the plan
    // the projection reads, so the live clamp and the normalizer have to reach
    // the same number or one saved plan projects two ways.
    for (const typed of [-2, -0.05, 0, 0.03, 1, 3]) {
      const reloaded = normalizeProperties({
        properties: [at({ housingReturn: typed })],
      })[0].housingReturn
      expect(reloaded).toBe(clampHousingReturn(typed, 0))
    }
  })
})

describe("offersFinancing", () => {
  it("offers to finance a purchase the projection still has to make", () => {
    expect(offersFinancing(at({ acquisitionAge: 60 }), 45)).toBe(true)
  })

  it("stops at the current year, which it does not count as a purchase", () => {
    // The boundary, both sides of it. `acquisitionAge === currentAge` is the
    // opening position — `simulatePlanning` reads ownership transitions from
    // year 1 on, so nothing is ever bought in year 0 — and what is owed on a
    // house the household already lives in is a `PlannedLoan` with real terms.
    // An LTV offered here would mint a second mortgage beside it.
    expect(offersFinancing(at({ acquisitionAge: 45 }), 45)).toBe(false)
    expect(offersFinancing(at({ acquisitionAge: 44 }), 45)).toBe(false)
    expect(offersFinancing(at({ acquisitionAge: 46 }), 45)).toBe(true)
  })
})

describe("withAcquisitionAge", () => {
  it("keeps the financing on a purchase that is still a purchase", () => {
    const p = at({ acquisitionAge: 60, financing: { ltv: 0.8 } })
    expect(withAcquisitionAge(p, 55, 45)).toMatchObject({
      acquisitionAge: 55,
      financing: { ltv: 0.8 },
    })
  })

  it("drops financing the entry can no longer carry", () => {
    // Pulled back to today, the purchase becomes part of the opening position
    // and the LTV is read by nothing — but it would still be *there*, inert
    // until the age is pushed out again and then silently back in force. The
    // form shows what the plan says, so the plan has to stop saying it.
    const p = at({ acquisitionAge: 60, financing: { ltv: 0.8 } })
    expect(withAcquisitionAge(p, 45, 45).financing).toBeNull()
    expect(withAcquisitionAge(p, 30, 45).financing).toBeNull()
  })
})

describe("ownershipSummary", () => {
  it("says a property already held is held", () => {
    expect(ownershipSummary(at({ acquisitionAge: 30 }), 45)).toBe("Ejes i dag")
  })

  it("names the age a future purchase happens at", () => {
    expect(ownershipSummary(at({ acquisitionAge: 60 }), 45)).toBe(
      "Købes som 60-årig"
    )
  })

  it("names the sale as the first untaxed year, not the last taxed one", () => {
    // Ownership is the half-open interval `[acquisitionAge, disposalAge)`, so
    // "sælges som 70-årig" has to mean what the simulation does with it.
    expect(ownershipSummary(at({ acquisitionAge: 30, disposalAge: 70 }), 45)).toBe(
      "Ejes i dag · sælges som 70-årig"
    )
  })

  it("names the sale costs only where there are any to name", () => {
    // Since the default became a figure this stands on nearly every row that is
    // sold, which is the point: the share is an assumption the projection makes
    // for the household and it costs real money. What stays quiet is the row
    // that typed 0 — reporting that back as "0,00% i salgsomkostninger" would
    // dress a household's claim that its sale is free up as a charge.
    expect(
      ownershipSummary(at({ disposalAge: 70, saleCostsPct: 0.03 }), 45)
    ).toBe("Ejes i dag · sælges som 70-årig · 3,00% i salgsomkostninger")
    expect(
      ownershipSummary(at({ disposalAge: 70, saleCostsPct: 0 }), 45)
    ).not.toContain("salgsomkostninger")
    // And nothing at all on a property the plan never sells: there is no sale
    // for the percentage to be charged on.
    expect(
      ownershipSummary(at({ disposalAge: null, saleCostsPct: 0.03 }), 45)
    ).not.toContain("salgsomkostninger")
  })
})

describe("propertySummary", () => {
  it("puts the kind, both amounts and the window on one line", () => {
    const line = propertySummary(
      at({ kind: "fritidsbolig", value: 1_800_000, landValue: 900_000 }),
      45
    )
    expect(line).toContain("Sommerhus")
    expect(line).toContain("grund")
    expect(line).toContain("Ejes i dag")
    // Both amounts, so a plan that owes grundskyld on a large plot says so.
    expect(line).toMatch(/1[.\s ]?800[.\s ]?000/)
    expect(line).toMatch(/900[.\s ]?000/)
  })
})

describe("propertySummary use", () => {
  it("says nothing about the use every property has by default", () => {
    // "Egen brug" on every row is noise that buries the one row which is not.
    expect(propertySummary(at({ use: "own" }), 45)).not.toContain("Egen brug")
  })

  it("names a use that is not the default", () => {
    expect(propertySummary(at({ use: "rented" }), 45)).toContain("Udlejet")
    expect(propertySummary(at({ use: "vacant" }), 45)).toContain("Står tom")
  })
})

describe("PROPERTY_USE_LABEL", () => {
  it("has Danish for every use the form can select", () => {
    // The dropdown renders straight from this map, so a use missing an entry
    // would show up as a blank row the user cannot tell apart from the others.
    for (const use of PROPERTY_USES) {
      expect(PROPERTY_USE_LABEL[use]).toBeTruthy()
    }
    expect(PROPERTY_USES).toHaveLength(Object.keys(PROPERTY_USE_LABEL).length)
  })
})

describe("rentalExclusionNotice", () => {
  it("says nothing when nothing is let out", () => {
    // Owner-occupied and empty are both modelled as far as they go: the house
    // is worth what it is worth and owes the ejendomsskat it owes.
    expect(rentalExclusionNotice([])).toBeNull()
    expect(rentalExclusionNotice([at({ use: "own" })])).toBeNull()
    expect(rentalExclusionNotice([at({ use: "vacant" })])).toBeNull()
    expect(
      rentalExclusionNotice([at({ use: "own" }), at({ use: "vacant" })])
    ).toBeNull()
  })

  it("names all three things a let-out property leaves out", () => {
    // Rent in, costs out, tax on the surplus — all three, or the user cannot
    // tell which way the projection is wrong.
    const notice =
      rentalExclusionNotice([at({ use: "own" }), at({ use: "rented" })]) ?? ""
    expect(notice).toContain("lejeindtægt")
    expect(notice).toContain("driftsudgifter")
    // The whole phrase, not "skat": the notice closes on "ejendomsskat", so the
    // bare word is in the string whether or not the tax on the surplus is.
    expect(notice).toContain("skat af overskuddet")
  })
})

describe("pensionerNedslagNotice", () => {
  const home = () => at({ kind: "helaarsbolig" })
  const summer = () => at({ kind: "fritidsbolig" })

  /** Every portfolio the projection has to admit something about. */
  const understated = [
    [home(), home()],
    [summer(), summer()],
    [home(), summer(), summer()],
  ]

  it("says nothing about the portfolios it models in full", () => {
    // One of each kind is what the two engine slots hold, so nothing is being
    // understated and there is no limitation to admit.
    expect(pensionerNedslagNotice([])).toBeNull()
    expect(pensionerNedslagNotice([home()])).toBeNull()
    expect(pensionerNedslagNotice([summer()])).toBeNull()
    expect(pensionerNedslagNotice([home(), summer()])).toBeNull()
  })

  it("warns when a second dwelling of a kind is taxed without nedslag", () => {
    for (const list of understated) {
      const notice = pensionerNedslagNotice(list)
      expect(notice).toContain("Beregningen")
      expect(notice).toContain("uden nedslag")
    }
  })

  it("blames the projection, never the statute", () => {
    // § 25 grants the nedslag per boligenhed and caps no household at one of
    // each kind. The limit is ours — the engine has two property slots — so
    // citing the law for it tells the user it says something it does not.
    for (const list of understated) {
      const notice = pensionerNedslagNotice(list) ?? ""
      expect(notice).not.toMatch(/§/)
      expect(notice).not.toMatch(/ejendomsskattelov/i)
    }
  })
})
