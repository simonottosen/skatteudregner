import { describe, it, expect } from "vitest"
import {
  PROPERTY_USES,
  PROPERTY_USE_LABEL,
  newPlannedProperty,
  ownershipSummary,
  pensionerNedslagNotice,
  propertySummary,
  removeProperty,
  rentalExclusionNotice,
  replaceProperty,
} from "../properties"
import type { PlannedProperty } from "../types"

const at = (fields: Partial<PlannedProperty> = {}): PlannedProperty => ({
  id: "p1",
  label: "Bolig",
  kind: "helaarsbolig",
  use: "own",
  value: 4_000_000,
  landValue: 1_500_000,
  acquisitionAge: 0,
  disposalAge: null,
  ...fields,
})

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
