import { describe, it, expect } from "vitest"
import {
  newPlannedProperty,
  ownershipSummary,
  pensionerNedslagNotice,
  propertySummary,
  removeProperty,
  replaceProperty,
} from "../properties"
import type { PlannedProperty } from "../types"

const at = (fields: Partial<PlannedProperty> = {}): PlannedProperty => ({
  id: "p1",
  label: "Bolig",
  kind: "helaarsbolig",
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

describe("pensionerNedslagNotice", () => {
  const home = () => at({ kind: "helaarsbolig" })
  const summer = () => at({ kind: "fritidsbolig" })

  it("says nothing about the portfolios § 25 covers in full", () => {
    // One of each kind is exactly what § 25 grants a nedslag to, so there is
    // nothing being understated to warn about.
    expect(pensionerNedslagNotice([])).toBeNull()
    expect(pensionerNedslagNotice([home()])).toBeNull()
    expect(pensionerNedslagNotice([summer()])).toBeNull()
    expect(pensionerNedslagNotice([home(), summer()])).toBeNull()
  })

  it("warns when a second dwelling of a kind has no nedslag to claim", () => {
    // The known limitation, said out loud: a household that owns two flats
    // would otherwise see a charge it cannot account for.
    for (const list of [
      [home(), home()],
      [summer(), summer()],
      [home(), summer(), summer()],
    ]) {
      expect(pensionerNedslagNotice(list)).toContain("§ 25")
    }
  })
})
