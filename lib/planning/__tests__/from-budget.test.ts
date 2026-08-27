import { describe, it, expect } from "vitest"
import {
  applyDerivedDefaults,
  mortgageFromBudget,
  propertiesFromBudget,
  type PlanningDerivedDefaults,
} from "../from-budget"
import { DEFAULT_PLANNING_STATE, type PlannedProperty } from "../types"
import {
  DEFAULT_MORTGAGE,
  computeMortgage,
  mortgageMonthlyTotal,
  type MortgageState,
} from "@/lib/budget/mortgage"

const enabled: MortgageState = {
  ...DEFAULT_MORTGAGE,
  enabled: true,
  homeValue: 2_500_000,
  ltv: 0.8, // a 2 mio. loan
  interestRate: 0.04,
  remainingYears: 20,
  bidragssats: 0.006,
}

describe("mortgageFromBudget", () => {
  it("carries the budget's own deduction and the rate that priced it", () => {
    const link = mortgageFromBudget(enabled, mortgageMonthlyTotal(enabled))
    expect(link.mortgageBudgetedMonthly).toBeCloseTo(
      computeMortgage(enabled).monthlyTotal,
      6
    )
    expect(link.mortgageBidragssats).toBe(0.006)
  })

  it("takes the summary's figure, not a second computation of it", () => {
    // The surplus the plan starts from was reduced by *this* number. Recomputing
    // it from the module would let the two drift the moment either page changes
    // how it rounds or what it includes — the shape of issue #2.
    const link = mortgageFromBudget(enabled, 9_999)
    expect(link.mortgageBudgetedMonthly).toBe(9_999)
  })

  it("carries nothing at all when the module is off", () => {
    // The default state of /budget. It deducts nothing, so the plan is told
    // nothing was deducted — and gets no bidragssats either, because a fee
    // without a deduction is charged against the saving for free.
    const off: MortgageState = { ...enabled, enabled: false }
    expect(mortgageFromBudget(off, 0)).toEqual({
      mortgageBidragssats: 0,
      mortgageBudgetedMonthly: 0,
    })
    // Even handed a payment, a disabled module cannot vouch for it.
    expect(mortgageFromBudget(off, 12_119).mortgageBudgetedMonthly).toBe(0)
    expect(mortgageFromBudget(off, 12_119).mortgageBidragssats).toBe(0)
  })

  it("never reports a negative deduction", () => {
    // A hand-back below zero would be a payment the household received; the
    // simulation would add it to the saving every year.
    expect(mortgageFromBudget(enabled, -5_000).mortgageBudgetedMonthly).toBe(0)
  })
})

const summerHouse: PlannedProperty = {
  id: "prop-summer",
  label: "Sommerhuset",
  kind: "fritidsbolig",
  value: 1_800_000,
  landValue: 900_000,
  acquisitionAge: 55,
  disposalAge: null,
}
const theHome: PlannedProperty = {
  id: "prop-home",
  label: "Rækkehuset",
  kind: "helaarsbolig",
  value: 3_000_000,
  landValue: 1_000_000,
  acquisitionAge: 0,
  disposalAge: 80,
}

describe("propertiesFromBudget", () => {
  it("re-prices the home in place, keeping what only the plan knows", () => {
    // /skat and /budget know the two amounts and nothing else. The label, the
    // ownership window and the identity the loan is keyed on are the plan's own
    // and have to survive the next time either page changes.
    const [home, ...rest] = propertiesFromBudget([theHome, summerHouse], {
      value: 4_250_000,
      landValue: 1_400_000,
    })
    expect(home).toEqual({
      ...theHome,
      value: 4_250_000,
      landValue: 1_400_000,
    })
    expect(rest).toEqual([summerHouse])
  })

  it("leaves the summer house alone that neither page has heard of", () => {
    // Replacing the list wholesale is how it would disappear.
    const next = propertiesFromBudget([summerHouse], {
      value: 3_000_000,
      landValue: 0,
    })
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual(summerHouse)
  })

  it("makes the loan-bearing home the plan does not lead with", () => {
    // The plan's loan is secured on `properties[0]`, so a list that starts with
    // a fritidsbolig has no home for the budget's amounts to land on.
    const [home] = propertiesFromBudget([summerHouse], {
      value: 3_000_000,
      landValue: 800_000,
    })
    expect(home).toMatchObject({
      kind: "helaarsbolig",
      label: "Bolig",
      value: 3_000_000,
      landValue: 800_000,
      acquisitionAge: 0,
      disposalAge: null,
    })
    expect(home.id).toBeTruthy()
  })

  it("leaves the list alone when the budget describes no home", () => {
    // "/skat has nothing to say about a property" and "the household sold up"
    // are different claims, and only the user can make the second one.
    const list = [theHome, summerHouse]
    expect(propertiesFromBudget(list, { value: 0, landValue: 0 })).toEqual(list)
    expect(propertiesFromBudget([], { value: 0, landValue: 0 })).toEqual([])
  })

  it("returns a new list rather than the one it was handed", () => {
    const list = [theHome]
    expect(propertiesFromBudget(list, { value: 0, landValue: 0 })).not.toBe(list)
  })

  it("carries whole, non-negative kroner into the tax", () => {
    const [home] = propertiesFromBudget([], {
      value: 3_000_000.6,
      landValue: -1,
    })
    expect(home.value).toBe(3_000_001)
    expect(home.landValue).toBe(0)
  })
})

describe("applyDerivedDefaults", () => {
  const defaults = (
    over: Partial<PlanningDerivedDefaults> = {}
  ): PlanningDerivedDefaults => ({
    monthlyContribution: 7_500,
    annualSpending: 240_000,
    currentAge: 41,
    home: { value: 2_500_000, landValue: 900_000 },
    mortgageBalance: 1_900_000,
    mortgageRate: 0.04,
    mortgageTermYears: 20,
    mortgageBidragssats: 0.006,
    mortgageBudgetedMonthly: 12_119,
    tax: { year: 2026, municipality: "Aarhus", churchMember: true },
    pension: {
      single: false,
      person1: { ratepensionAnnual: 30_000, folkepensionAge: 70 },
      person2: { folkepensionAge: 70 },
    },
    ...over,
  })

  it("gives a fresh plan the home it is linked to, not an empty list", () => {
    // The path every first visit takes: nothing is touched, so the defaults are
    // folded into a plan that owns no property yet. It has to come out owning
    // one, or the projection charges no ejendomsskat and counts no home equity.
    const next = applyDerivedDefaults(DEFAULT_PLANNING_STATE, defaults())
    expect(next.properties).toHaveLength(1)
    expect(next.properties[0]).toMatchObject({
      kind: "helaarsbolig",
      value: 2_500_000,
      landValue: 900_000,
    })
  })

  it("lands the debt and the home it is secured on in the same call", () => {
    // The shipped bug in one line: `mortgageBalance` rode in on the spread
    // while `properties` was never set, so a fresh homeowner carried the loan
    // against nothing and their net worth was short a whole house.
    for (const value of [1, 750_000, 2_500_000, 12_000_000]) {
      const next = applyDerivedDefaults(
        DEFAULT_PLANNING_STATE,
        defaults({
          home: { value, landValue: Math.round(value * 0.4) },
          mortgageBalance: Math.round(value * 0.8),
        })
      )
      expect(next.mortgageBalance).toBe(Math.round(value * 0.8))
      expect(next.properties).toHaveLength(1)
      expect(next.properties[0].value).toBe(value)
    }
  })

  it("does not invent a property out of a home worth nothing", () => {
    // A renter. The rest of the link still has to arrive.
    const next = applyDerivedDefaults(
      DEFAULT_PLANNING_STATE,
      defaults({ home: { value: 0, landValue: 0 } })
    )
    expect(next.properties).toEqual([])
    expect(next.monthlyContribution).toBe(7_500)
    expect(next.mortgageBalance).toBe(1_900_000)
  })

  it("re-prices the home the plan already has instead of adding a second", () => {
    // `propertiesFromBudget` owns this rule and tests it; asserted here only so
    // the merge is known to route the home through it rather than past it.
    const next = applyDerivedDefaults(
      { ...DEFAULT_PLANNING_STATE, properties: [theHome, summerHouse] },
      defaults()
    )
    expect(next.properties).toEqual([
      { ...theHome, value: 2_500_000, landValue: 900_000 },
      summerHouse,
    ])
  })

  it("leaves behind no key a plan does not declare", () => {
    // `home` is two amounts to merge into a list, not a field of the plan. It
    // reached localStorage as one when the merge spread the defaults wholesale,
    // and TypeScript cannot see it: a spread gets no excess-property check.
    const next = applyDerivedDefaults(DEFAULT_PLANNING_STATE, defaults())
    expect(next).not.toHaveProperty("home")
    expect(Object.keys(next).sort()).toEqual(
      Object.keys(DEFAULT_PLANNING_STATE).sort()
    )
  })

  it("seeds the pension without emptying the pots already in the plan", () => {
    // The other pages know the contributions and the folkepensionsalder; the
    // balances are the plan's own and are not theirs to clear.
    const prev = {
      ...DEFAULT_PLANNING_STATE,
      pension: {
        ...DEFAULT_PLANNING_STATE.pension,
        person1: {
          ...DEFAULT_PLANNING_STATE.pension.person1,
          ratepensionBalance: 800_000,
        },
      },
    }
    const next = applyDerivedDefaults(prev, defaults())
    expect(next.pension.person1.ratepensionBalance).toBe(800_000)
    expect(next.pension.person1.ratepensionAnnual).toBe(30_000)
    expect(next.pension.person1.folkepensionAge).toBe(70)
    expect(next.pension.single).toBe(false)
  })
})
