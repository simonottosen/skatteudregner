import { describe, it, expect } from "vitest"
import { computeBudgetSummary, normalizeBudget } from "../state"
import {
  attributeSavings,
  normalizeSavings,
  savingsResidual,
  statedSavingsPatch,
  withSavingsPatch,
  type SavingsAttribution,
  type SavingsConfig,
} from "../savings-split"

const MORTGAGE = {
  enabled: true,
  homeValue: 2_000_000,
  remainingYears: 30,
  ltv: 0.8,
  interestRate: 0.04,
  bidragssats: 0.006,
  interestOnly: false,
}

/** A couple sharing one expense list: 50.000 in, 30.000 out, 3.000 earmarked. */
function sharedCouple(savings?: SavingsConfig, mortgage = false) {
  const state = normalizeBudget({
    mode: "shared",
    person1: { name: "Anna", incomeSource: "manual", manualIncome: 28000, items: [] },
    person2: { name: "Bo", incomeSource: "manual", manualIncome: 22000, items: [] },
    categories: [
      { id: "bolig", name: "Bolig" },
      { id: "opsparing", name: "Opsparing" },
    ],
    sharedItems: [
      { id: "a", label: "Husleje", amount: 27000, categoryId: "bolig" },
      { id: "b", label: "Opsparing", amount: 3000, categoryId: "opsparing" },
    ],
    mortgage: mortgage ? MORTGAGE : undefined,
    savings,
  })
  return { state, summary: computeBudgetSummary(state, 0, 0) }
}

/** The same couple, each with their own expense list. */
function separateCouple(mortgage = false) {
  const state = normalizeBudget({
    mode: "separate",
    person1: {
      name: "Anna",
      incomeSource: "manual",
      manualIncome: 28000,
      items: [
        { id: "x", label: "Mad", amount: 8000, categoryId: "mad" },
        { id: "z", label: "Opsparing", amount: 2000, categoryId: "opsparing" },
      ],
    },
    person2: {
      name: "Bo",
      incomeSource: "manual",
      manualIncome: 22000,
      items: [{ id: "y", label: "Mad", amount: 7000, categoryId: "mad" }],
    },
    categories: [
      { id: "mad", name: "Mad og dagligvarer" },
      { id: "opsparing", name: "Opsparing" },
    ],
    mortgage: mortgage ? MORTGAGE : undefined,
  })
  return { state, summary: computeBudgetSummary(state, 0, 0) }
}

/**
 * The same 50.000-a-month couple on one expense list, with the household saving
 * dialled to `total` — including below zero, where they are spending more than
 * they earn.
 */
function householdSaving(total: number, savings?: SavingsConfig) {
  const state = normalizeBudget({
    mode: "shared",
    person1: { name: "Anna", incomeSource: "manual", manualIncome: 28000, items: [] },
    person2: { name: "Bo", incomeSource: "manual", manualIncome: 22000, items: [] },
    categories: [{ id: "bolig", name: "Bolig" }],
    sharedItems: [
      { id: "a", label: "Husleje", amount: 50000 - total, categoryId: "bolig" },
    ],
    savings,
  })
  return { state, summary: computeBudgetSummary(state, 0, 0) }
}

/** Every shape the block can take, over households that save and that do not. */
const SAVINGS_CONFIGS: (SavingsConfig | undefined)[] = [
  undefined,
  { split: "with-expenses" },
  { split: "shared" },
  { split: "individual", sharedPortion: 0 },
  { split: "individual", sharedPortion: 4000 },
  { split: "individual", sharedPortion: 40000 },
  {
    split: "individual",
    sharedPortion: 4000,
    allocation: { p1: 3000, p2: 1000 },
    manual: true,
  },
  {
    split: "individual",
    sharedPortion: 40000,
    allocation: { p1: 30000, p2: 10000 },
    manual: true,
  },
]

const TOTALS = [23000, 5000, 0, -5000]

describe("normalizeSavings", () => {
  it("leaves an absent block absent", () => {
    // Writing a default block on load would rewrite the persisted blob of every
    // household that never asked for one, for no change in any figure.
    expect(normalizeSavings(undefined)).toBeUndefined()
    expect(normalizeSavings(null)).toBeUndefined()
    expect(normalizeSavings("shared")).toBeUndefined()
  })

  it("falls back to the with-expenses split on a garbage value", () => {
    expect(normalizeSavings({ split: "nonsense" })).toEqual({
      split: "with-expenses",
    })
  })

  it("keeps unused keys out of the persisted shape", () => {
    expect(normalizeSavings({ split: "shared" })).toEqual({ split: "shared" })
    expect(normalizeSavings({ split: "individual", manual: false })).toEqual({
      split: "individual",
    })
  })

  it("clamps stated amounts at zero", () => {
    expect(
      normalizeSavings({
        split: "individual",
        sharedPortion: -500,
        allocation: { p1: -100, p2: "x" },
        manual: true,
      })
    ).toEqual({
      split: "individual",
      sharedPortion: 0,
      allocation: { p1: 0, p2: 0 },
      manual: true,
    })
  })
})

describe("withSavingsPatch", () => {
  it("creates the block on the first edit", () => {
    expect(withSavingsPatch(undefined, { split: "shared" })).toEqual({
      split: "shared",
    })
  })

  it("keeps the stated amounts when only the split changes", () => {
    const current: SavingsConfig = {
      split: "individual",
      sharedPortion: 2000,
      allocation: { p1: 500, p2: 500 },
      manual: true,
    }
    expect(withSavingsPatch(current, { split: "shared" })).toEqual({
      ...current,
      split: "shared",
    })
  })

  it("drops the manual flag rather than storing it as false", () => {
    const current: SavingsConfig = { split: "individual", manual: true }
    expect(withSavingsPatch(current, { manual: false })).toEqual({
      split: "individual",
    })
  })
})

describe("statedSavingsPatch", () => {
  const evenSplit: SavingsAttribution = {
    split: "individual",
    manual: false,
    total: 23000,
    shared: 5000,
    p1: 9000.4,
    p2: 9000.4,
    unallocated: 0,
  }

  it("seeds the two fields from the figures already on screen", () => {
    // Starting at zero would read as if the savings had just vanished.
    expect(statedSavingsPatch({ split: "individual" }, true, evenSplit)).toEqual({
      manual: true,
      allocation: { p1: 9000, p2: 9000 },
    })
  })

  it("keeps amounts the couple has already stated", () => {
    const current: SavingsConfig = {
      split: "individual",
      allocation: { p1: 1500, p2: 500 },
    }
    expect(statedSavingsPatch(current, true, evenSplit)).toEqual({
      manual: true,
      allocation: { p1: 1500, p2: 500 },
    })
  })

  it("never seeds a negative amount from an over-committed budget", () => {
    const patch = statedSavingsPatch(undefined, true, { ...evenSplit, p1: -4000 })
    expect(patch.allocation).toEqual({ p1: 0, p2: 9000 })
  })

  it("leaves the stated amounts alone when the box is cleared", () => {
    // withSavingsPatch drops `manual: false` rather than storing it, so the
    // amounts stay available for a second look at the split.
    expect(statedSavingsPatch({ split: "individual" }, false, evenSplit)).toEqual({
      manual: false,
    })
  })
})

describe("attributeSavings", () => {
  it("gives the whole pot to the one person in a single household", () => {
    const state = normalizeBudget({
      mode: "single",
      person1: { name: "P1", incomeSource: "manual", manualIncome: 30000, items: [] },
      sharedItems: [{ id: "a", label: "Mad", amount: 5000, categoryId: "mad" }],
      // Left over from a spell as a couple — there is still nobody to share with.
      savings: { split: "shared" },
    })
    const a = attributeSavings(state, computeBudgetSummary(state, 0, 0))
    expect(a).toMatchObject({ shared: 0, p1: 25000, p2: 0, unallocated: 0 })
  })

  it("defaults a shared-expense couple to one joint pot", () => {
    const { state, summary } = sharedCouple()
    const a = attributeSavings(state, summary)
    expect(a.split).toBe("with-expenses")
    // 50.000 − 27.000 consumed = 23.000, of which 3.000 is already earmarked.
    expect(summary.totalSavings).toBe(23000)
    expect(a).toMatchObject({ shared: 23000, p1: 0, p2: 0, unallocated: 0 })
  })

  it("gives each person their own leftover when the budget is separate", () => {
    const { state, summary } = separateCouple()
    const a = attributeSavings(state, summary)
    expect(a.p1).toBe(28000 - 8000)
    expect(a.p2).toBe(22000 - 7000)
    expect(a.shared).toBe(0)
    expect(a.p1 + a.p2).toBe(summary.totalSavings)
  })

  it("halves the joint mortgage so the two figures still add up", () => {
    const { state, summary } = separateCouple(true)
    const a = attributeSavings(state, summary)
    expect(summary.mortgageMonthly).toBeGreaterThan(0)
    expect(a.p1).toBeCloseTo(20000 - summary.mortgageMonthly / 2, 6)
    expect(a.p1 + a.p2).toBeCloseTo(summary.totalSavings, 6)
    expect(a.unallocated).toBeCloseTo(0, 6)
  })

  it("makes everything joint on the shared split, whatever the budget does", () => {
    const { state, summary } = separateCouple()
    const withShared = { ...state, savings: { split: "shared" as const } }
    const a = attributeSavings(withShared, summary)
    expect(a).toMatchObject({ shared: summary.totalSavings, p1: 0, p2: 0 })
  })

  it("splits the rest evenly until the couple states two amounts", () => {
    const { state, summary } = sharedCouple({
      split: "individual",
      sharedPortion: 5000,
    })
    const a = attributeSavings(state, summary)
    // 23.000 saved, 5.000 of it joint → 9.000 each.
    expect(a).toMatchObject({ shared: 5000, p1: 9000, p2: 9000, unallocated: 0 })
  })

  it("uses the stated amounts once manual is set", () => {
    // "We save 5.000 together and 1.000 each."
    const { state, summary } = sharedCouple({
      split: "individual",
      sharedPortion: 5000,
      allocation: { p1: 1000, p2: 1000 },
      manual: true,
    })
    const a = attributeSavings(state, summary)
    expect(a).toMatchObject({ shared: 5000, p1: 1000, p2: 1000 })
    // The couple saves 23.000 but has only earmarked 7.000 of it.
    expect(a.unallocated).toBe(16000)
  })

  it("reports an over-commitment instead of absorbing it", () => {
    const { state, summary } = sharedCouple({
      split: "individual",
      sharedPortion: 20000,
      allocation: { p1: 4000, p2: 4000 },
      manual: true,
    })
    const a = attributeSavings(state, summary)
    // Quietly capping any of the three would let the page report savings the
    // household has not got.
    expect(a.unallocated).toBe(-5000)
    expect(a.shared).toBe(20000)
  })

  it("never derives a negative personal saving from an oversized joint amount", () => {
    // 5.000 saved, 10.000 called joint. Halving the −5.000 difference would put
    // "−2.500 kr." under each name and label it savings — an amount the couple
    // cannot even type into the field it came from.
    const { state, summary } = householdSaving(5000, {
      split: "individual",
      sharedPortion: 10000,
    })
    const a = attributeSavings(state, summary)
    expect(a).toMatchObject({ shared: 10000, p1: 0, p2: 0, unallocated: -5000 })
  })

  it("signs an automatic over-commitment the way a stated one is signed", () => {
    // Two conventions for the same fact would be worse than either: the page
    // reads one rule off `unallocated` whichever path produced it.
    const auto = householdSaving(5000, {
      split: "individual",
      sharedPortion: 10000,
    })
    const stated = householdSaving(5000, {
      split: "individual",
      sharedPortion: 6000,
      allocation: { p1: 3000, p2: 1000 },
      manual: true,
    })
    expect(attributeSavings(auto.state, auto.summary).unallocated).toBe(-5000)
    expect(attributeSavings(stated.state, stated.summary).unallocated).toBe(-5000)
  })

  it("attributes nothing to either person when the household is in deficit", () => {
    // Dissaving is a real budget, not a broken one — but there is no saving to
    // hand out, so neither name gets a figure that reads as one.
    const { state, summary } = householdSaving(-5000, {
      split: "individual",
      sharedPortion: 0,
    })
    expect(summary.totalSavings).toBe(-5000)
    expect(attributeSavings(state, summary)).toMatchObject({
      shared: 0,
      p1: 0,
      p2: 0,
      unallocated: -5000,
    })
  })

  it("still hands a deficit to the joint pot on the shared split", () => {
    // The joint pot is derived, not stated, so it carries the household figure
    // as it is. Flooring it would be the page claiming a saving of zero.
    const { state, summary } = householdSaving(-5000, { split: "shared" })
    expect(attributeSavings(state, summary)).toMatchObject({
      shared: -5000,
      p1: 0,
      p2: 0,
      unallocated: 0,
    })
  })

  it("keeps both personal figures at or above zero, whatever is stated", () => {
    for (const total of TOTALS) {
      for (const config of SAVINGS_CONFIGS) {
        const { state, summary } = householdSaving(total, config)
        const a = attributeSavings(state, summary)
        expect(a.p1).toBeGreaterThanOrEqual(0)
        expect(a.p2).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("reconciles to the household total when over-committed or in deficit", () => {
    for (const total of TOTALS) {
      for (const config of SAVINGS_CONFIGS) {
        const { state, summary } = householdSaving(total, config)
        const a = attributeSavings(state, summary)
        expect(a.total).toBe(total)
        expect(a.shared + a.p1 + a.p2 + a.unallocated).toBeCloseTo(total, 6)
      }
    }
  })

  it("always reconciles to the household total", () => {
    const configs: (SavingsConfig | undefined)[] = [
      undefined,
      { split: "with-expenses" },
      { split: "shared" },
      { split: "individual", sharedPortion: 4000 },
      {
        split: "individual",
        sharedPortion: 4000,
        allocation: { p1: 3000, p2: 1000 },
        manual: true,
      },
    ]
    for (const config of configs) {
      for (const mortgage of [false, true]) {
        const separate = separateCouple(mortgage)
        const households = [
          sharedCouple(config, mortgage),
          // The same block over separate expense lists, where the per-person
          // figures come off each list rather than off the stated amounts.
          { ...separate, state: { ...separate.state, savings: config } },
        ]
        for (const { state, summary } of households) {
          const a = attributeSavings(state, summary)
          expect(a.shared + a.p1 + a.p2 + a.unallocated).toBeCloseTo(a.total, 6)
          expect(a.total).toBe(summary.totalSavings)
        }
      }
    }
  })

  it("never moves money in or out of the budget", () => {
    // The whole design rests on this: attribution divides a figure the summary
    // already produced, so no split can change what the rest of the app reads.
    const plain = sharedCouple().summary
    for (const split of ["with-expenses", "shared", "individual"] as const) {
      const { summary } = sharedCouple({
        split,
        sharedPortion: 9999,
        allocation: { p1: 1234, p2: 4321 },
        manual: true,
      })
      expect(summary).toEqual(plain)
    }
  })

  it("leaves the household summary alone when the split cannot be honoured", () => {
    // The over-committed case is where a fix is most tempted to balance the
    // books by moving an amount; `budgetExpenses` and `remaining` are read over
    // the wire by the MCP tools, so a shift there would break them silently.
    for (const total of TOTALS) {
      const plain = householdSaving(total).summary
      for (const config of SAVINGS_CONFIGS)
        expect(householdSaving(total, config).summary).toEqual(plain)
    }
  })
})

describe("savingsResidual", () => {
  const base: SavingsAttribution = {
    split: "individual",
    manual: false,
    total: 0,
    shared: 0,
    p1: 0,
    p2: 0,
    unallocated: 0,
  }

  it("calls a shortfall against a real saving an over-commitment", () => {
    expect(
      savingsResidual({ ...base, total: 5000, shared: 10000, unallocated: -5000 })
    ).toEqual({ slack: 0, overCommitted: -5000, deficit: 0 })
  })

  it("calls a shortfall with nothing earmarked a deficit", () => {
    // Nothing was shared out, so nothing can have been shared out too far.
    expect(savingsResidual({ ...base, total: -5000, unallocated: -5000 })).toEqual({
      slack: 0,
      overCommitted: 0,
      deficit: -5000,
    })
  })

  it("separates the two when a deficit household also states amounts", () => {
    // 10.000 promised out of nothing, on top of a budget already 5.000 short.
    expect(
      savingsResidual({ ...base, total: -5000, shared: 10000, unallocated: -15000 })
    ).toEqual({ slack: 0, overCommitted: -10000, deficit: -5000 })
  })

  it("finds nothing to explain in a derived joint pot", () => {
    // The "shared" split hands the household figure to the joint pot whole,
    // deficit and all, so there is no residual to account for.
    expect(
      savingsResidual({
        ...base,
        split: "shared",
        total: -5000,
        shared: -5000,
        unallocated: 0,
      })
    ).toEqual({ slack: 0, overCommitted: 0, deficit: 0 })
  })

  it("adds back up to the residual it came from, with the signs it promises", () => {
    for (const total of TOTALS) {
      for (const config of SAVINGS_CONFIGS) {
        const { state, summary } = householdSaving(total, config)
        const a = attributeSavings(state, summary)
        const r = savingsResidual(a)
        expect(r.slack + r.overCommitted + r.deficit).toBeCloseTo(a.unallocated, 6)
        expect(r.slack).toBeGreaterThanOrEqual(0)
        expect(r.overCommitted).toBeLessThanOrEqual(0)
        expect(r.deficit).toBeLessThanOrEqual(0)
      }
    }
  })
})
