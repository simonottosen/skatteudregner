import { describe, it, expect } from "vitest"
import {
  defaultBudgetState,
  newBudgetId,
  normalizeBudget,
  computeBudgetSummary,
  computeResultSummary,
  expensesByCategory,
  planningContribution,
} from "../state"

/**
 * The starting state is built during the first render on both the server and
 * the client, and the row ids reach the DOM as `id`/`for` attributes. Anything
 * the two calls disagree about is therefore a hydration mismatch, so equality
 * across independent calls is the property to hold onto here.
 */
describe("defaultBudgetState", () => {
  it("gives the same row ids on every call", () => {
    const ids = () => defaultBudgetState().sharedItems.map((i) => i.id)
    expect(ids()).toEqual(ids())
  })

  it("gives the default rows distinct ids", () => {
    const ids = defaultBudgetState().sharedItems.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // Shared ids must not mean shared rows: editing one budget's line would
  // otherwise show up in the next default state the process hands out.
  it("hands out rows that can be edited independently", () => {
    defaultBudgetState().sharedItems[0].amount = 999
    expect(defaultBudgetState().sharedItems[0].amount).toBe(0)
  })
})

describe("newBudgetId", () => {
  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, newBudgetId))
    expect(ids.size).toBe(1000)
  })
})

describe("normalizeBudget", () => {
  it("defaults an empty/invalid blob to a v6 single household", () => {
    const s = normalizeBudget(null)
    expect(s.version).toBe(6)
    expect(s.mode).toBe("single")
    expect(Array.isArray(s.sharedItems)).toBe(true)
  })
  it("falls back to the default rows without varying their ids", () => {
    const ids = () =>
      normalizeBudget({ mode: "single" }).sharedItems.map((i) => i.id)
    expect(ids()).toEqual(ids())
  })
  it("migrates a legacy array of items into sharedItems", () => {
    const s = normalizeBudget([{ label: "Mad", amount: 2000, categoryId: "mad" }])
    expect(s.sharedItems).toHaveLength(1)
    expect(s.sharedItems[0].amount).toBe(2000)
  })
  it("keeps the ids a persisted budget already carries", () => {
    // "b-6-…" is the counter-and-clock format rows were saved with before the
    // default rows got literal ids; both have to survive a load unchanged.
    const saved = [
      { id: "b-6-1787678393725", label: "Mad", categoryId: "mad" },
      { id: "default-bolig", label: "Bolig", categoryId: "bolig" },
    ]
    const s = normalizeBudget({ sharedItems: saved })
    expect(s.sharedItems.map((i) => i.id)).toEqual(saved.map((i) => i.id))
  })
  it("gives every id-less row its own id", () => {
    const s = normalizeBudget([
      { label: "Mad", amount: 2000, categoryId: "mad" },
      { label: "Transport", amount: 900, categoryId: "transport" },
    ])
    const ids = s.sharedItems.map((i) => i.id)
    expect(ids.every(Boolean)).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })
})

describe("computeBudgetSummary", () => {
  it("single: income from tax net, expenses from shared items", () => {
    const s = normalizeBudget({
      mode: "single",
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
      sharedItems: [
        { id: "a", label: "Mad", amount: 5000, categoryId: "mad" },
        { id: "b", label: "Bolig", amount: 10000, categoryId: "bolig" },
      ],
    })
    const sum = computeBudgetSummary(s, 30000, 0)
    expect(sum.budgetIncome).toBe(30000)
    expect(sum.budgetExpenses).toBe(15000)
    expect(sum.remaining).toBe(15000)
    expect(sum.savingsRate).toBeCloseTo(0.5, 6)
  })
  it("separate: sums both people's items + manual incomes", () => {
    const s = normalizeBudget({
      mode: "separate",
      person1: {
        name: "P1",
        incomeSource: "manual",
        manualIncome: 20000,
        items: [{ id: "x", label: "a", amount: 8000, categoryId: "mad" }],
      },
      person2: {
        name: "P2",
        incomeSource: "manual",
        manualIncome: 25000,
        items: [{ id: "y", label: "b", amount: 7000, categoryId: "mad" }],
      },
    })
    const sum = computeBudgetSummary(s, 0, 0)
    expect(sum.budgetIncome).toBe(45000)
    expect(sum.budgetExpenses).toBe(15000)
  })
})

describe("the mortgage comes off the surplus", () => {
  /** A household with a live realkredit loan on top of two ordinary expenses. */
  const withMortgage = () =>
    normalizeBudget({
      mode: "single",
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
      sharedItems: [
        { id: "a", label: "Mad", amount: 5000, categoryId: "mad" },
        { id: "b", label: "Forsikring", amount: 2000, categoryId: "forsikring" },
      ],
      mortgage: {
        enabled: true,
        homeValue: 3_000_000,
        remainingYears: 30,
        ltv: 0.8,
        interestRate: 0.04,
        bidragssats: 0.006,
        interestOnly: false,
      },
    })

  it("keeps budgetExpenses free of the mortgage", () => {
    const sum = computeBudgetSummary(withMortgage(), 40000, 0)
    // The categorised lines only — the realkredit payment is reported separately
    // so callers can label it ("Udgifter (inkl. lån)") without double-counting.
    expect(sum.budgetExpenses).toBe(7000)
    expect(sum.mortgageMonthly).toBeGreaterThan(0)
  })

  it("subtracts it from remaining and savingsRate", () => {
    const sum = computeBudgetSummary(withMortgage(), 40000, 0)
    expect(sum.remaining).toBeCloseTo(40000 - 7000 - sum.mortgageMonthly, 6)
    expect(sum.savingsRate).toBeCloseTo(sum.remaining / 40000, 6)
    // Without the fix this was 33000 — the surplus /resultat used to show.
    expect(sum.remaining).toBeLessThan(33000)
  })

  it("matches the contribution /planlaegning derives from the same budget", () => {
    const sum = computeBudgetSummary(withMortgage(), 40000, 0)
    // hooks/use-planning.ts feeds the simulator exactly this. Both sides call
    // planningContribution rather than re-deriving income − expenses − mortgage,
    // so there is no second formula left to drift (issue #2).
    expect(planningContribution(sum.remaining)).toBe(Math.round(sum.remaining))
  })

  it("reports a deficit rather than clamping at zero", () => {
    // A household whose loan alone outstrips its income must see the negative
    // number; only the simulator clamps, because a negative contribution is
    // meaningless there.
    const sum = computeBudgetSummary(withMortgage(), 8000, 0)
    expect(sum.remaining).toBeLessThan(0)
    expect(sum.savingsRate).toBeLessThan(0)
  })

  it("hands the simulator zero in a deficit without losing the shortfall", () => {
    const sum = computeBudgetSummary(withMortgage(), 8000, 0)
    // The clamp applies at the simulator boundary and nowhere else…
    expect(planningContribution(sum.remaining)).toBe(0)
    // …so `remaining` still carries the real shortfall, which is what /resultat
    // displays and what the "budget balancerer ikke" warning reads. Clamping it
    // any earlier would show a household in the red a plan that saves nothing
    // and says nothing about why.
    expect(Math.round(sum.remaining)).toBe(
      Math.round(8000 - 7000 - sum.mortgageMonthly)
    )
    expect(sum.remaining).toBeLessThan(0)
  })

  it("nets the mortgage out in separate mode too", () => {
    // The mortgage is a household obligation, so it comes off the surplus
    // whichever way the couple splits their expenses.
    const s = normalizeBudget({
      mode: "separate",
      person1: {
        name: "P1",
        incomeSource: "manual",
        manualIncome: 20000,
        items: [{ id: "x", label: "a", amount: 8000, categoryId: "mad" }],
      },
      person2: {
        name: "P2",
        incomeSource: "manual",
        manualIncome: 25000,
        items: [{ id: "y", label: "b", amount: 7000, categoryId: "mad" }],
      },
      mortgage: {
        enabled: true,
        homeValue: 3_000_000,
        remainingYears: 30,
        ltv: 0.8,
        interestRate: 0.04,
        bidragssats: 0.006,
        interestOnly: false,
      },
    })
    const sum = computeBudgetSummary(s, 0, 0)
    expect(sum.mortgageMonthly).toBeGreaterThan(0)
    expect(sum.budgetExpenses).toBe(15000)
    expect(sum.remaining).toBeCloseTo(45000 - 15000 - sum.mortgageMonthly, 6)
    // /budget's per-person cards render `income − exp`, which leaves the loan
    // unallocated — hence the label "Til rådighed før lån" and the separate
    // household card that reports `remaining`. Pinning the gap at exactly
    // mortgageMonthly is what makes that labelling honest.
    expect(sum.p1Income - sum.p1Total + (sum.p2Income - sum.p2Total)).toBeCloseTo(
      sum.remaining + sum.mortgageMonthly,
      6
    )
  })

  it("leaves a household without a mortgage untouched", () => {
    const s = normalizeBudget({
      mode: "single",
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
      sharedItems: [{ id: "a", label: "Mad", amount: 5000, categoryId: "mad" }],
    })
    const sum = computeBudgetSummary(s, 30000, 0)
    expect(sum.mortgageMonthly).toBe(0)
    expect(sum.remaining).toBe(25000)
  })
})

describe("savings is a derived surplus, not an expense", () => {
  /** 30.000 in, 15.000 consumed, 3.000 deliberately put aside. */
  const withSavings = () =>
    normalizeBudget({
      version: 5,
      mode: "single",
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
      sharedItems: [
        { id: "a", label: "Mad", amount: 5000, categoryId: "mad" },
        { id: "b", label: "Bolig", amount: 10000, categoryId: "bolig" },
        { id: "c", label: "Opsparing", amount: 3000, categoryId: "opsparing" },
      ],
    })

  it("tags the Opsparing category on load without touching any amount", () => {
    const s = withSavings()
    expect(s.categories.find((c) => c.id === "opsparing")?.kind).toBe("savings")
    expect(s.categories.find((c) => c.id === "mad")?.kind).toBeUndefined()
    expect(s.sharedItems.map((i) => i.amount)).toEqual([5000, 10000, 3000])
  })

  it("leaves budgetExpenses and remaining numerically untouched", () => {
    // hooks/use-planning reads both, and lib/mcp/tools serves them over the
    // wire. Redefining them would break the remote server with no compile error
    // and no failing test, so the new meaning lives in the new fields below.
    const sum = computeBudgetSummary(withSavings(), 30000, 0)
    expect(sum.budgetExpenses).toBe(18000)
    expect(sum.remaining).toBe(12000)
    expect(sum.savingsRate).toBeCloseTo(12000 / 30000, 6)
  })

  it("splits the same expense total into consumption and savings", () => {
    const sum = computeBudgetSummary(withSavings(), 30000, 0)
    expect(sum.allocatedSavings).toBe(3000)
    expect(sum.consumptionExpenses).toBe(15000)
    expect(sum.consumptionExpenses + sum.allocatedSavings + sum.sinkingFunds).toBe(
      sum.budgetExpenses
    )
  })

  it("stops counting the savings line on both sides of the equation", () => {
    const sum = computeBudgetSummary(withSavings(), 30000, 0)
    // The household really saves 3.000 allocated + 12.000 left over.
    expect(sum.totalSavings).toBe(15000)
    expect(sum.totalSavings).toBe(sum.remaining + sum.allocatedSavings)
    expect(sum.surplus).toBe(15000)
    expect(sum.totalSavingsRate).toBeCloseTo(0.5, 6)
  })

  it("nets the mortgage out of the surplus like remaining does", () => {
    const s = normalizeBudget({
      ...withSavings(),
      mortgage: {
        enabled: true,
        homeValue: 3_000_000,
        remainingYears: 30,
        ltv: 0.8,
        interestRate: 0.04,
        bidragssats: 0.006,
        interestOnly: false,
      },
    })
    const sum = computeBudgetSummary(s, 40000, 0)
    expect(sum.mortgageMonthly).toBeGreaterThan(0)
    expect(sum.surplus).toBeCloseTo(40000 - 15000 - sum.mortgageMonthly, 6)
    expect(sum.totalSavings).toBeCloseTo(sum.remaining + 3000, 6)
  })

  it("keeps sinking funds out of both consumption and savings", () => {
    // Bilreparation and tandlæge are money set aside for a bill that is coming,
    // just not this month — neither is honestly described as consumption or as
    // long-term saving, so they get their own bucket.
    const s = normalizeBudget({
      mode: "single",
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
      categories: [
        { id: "mad", name: "Mad og dagligvarer" },
        { id: "opsparing", name: "Opsparing" },
        // Tagged outright, so this stays a test of the arithmetic rather than
        // of how a category comes to be tagged.
        { id: "hensat", name: "Bilreparation og tandlæge", kind: "sinking" },
      ],
      sharedItems: [
        { id: "a", label: "Mad", amount: 5000, categoryId: "mad" },
        { id: "b", label: "Opsparing", amount: 3000, categoryId: "opsparing" },
        { id: "c", label: "Bilreparation", amount: 1000, categoryId: "hensat" },
      ],
    })

    const sum = computeBudgetSummary(s, 30000, 0)
    expect(sum.budgetExpenses).toBe(9000)
    expect(sum.consumptionExpenses).toBe(5000)
    expect(sum.sinkingFunds).toBe(1000)
    expect(sum.allocatedSavings).toBe(3000)
    // Not consumed (25.000 surplus), but not saved either — the 1.000 is the
    // whole gap between the two figures.
    expect(sum.surplus).toBe(25000)
    expect(sum.totalSavings).toBe(24000)
  })

  it("splits the savings out in separate mode too", () => {
    const s = normalizeBudget({
      mode: "separate",
      person1: {
        name: "P1",
        incomeSource: "manual",
        manualIncome: 20000,
        items: [
          { id: "x", label: "Mad", amount: 8000, categoryId: "mad" },
          { id: "z", label: "Opsparing", amount: 2000, categoryId: "opsparing" },
        ],
      },
      person2: {
        name: "P2",
        incomeSource: "manual",
        manualIncome: 25000,
        items: [{ id: "y", label: "Mad", amount: 7000, categoryId: "mad" }],
      },
    })
    const sum = computeBudgetSummary(s, 0, 0)
    expect(sum.budgetExpenses).toBe(17000)
    expect(sum.allocatedSavings).toBe(2000)
    expect(sum.consumptionExpenses).toBe(15000)
    expect(sum.totalSavings).toBe(30000)
  })

  it("keeps an untagged budget behaving exactly as before", () => {
    // Nothing recognisable as savings → nothing tagged → the new fields simply
    // restate the old ones.
    const s = normalizeBudget({
      mode: "single",
      categories: [{ id: "mad", name: "Mad og dagligvarer" }],
      sharedItems: [{ id: "a", label: "Mad", amount: 5000, categoryId: "mad" }],
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
    })
    const sum = computeBudgetSummary(s, 30000, 0)
    expect(sum.allocatedSavings).toBe(0)
    expect(sum.sinkingFunds).toBe(0)
    expect(sum.consumptionExpenses).toBe(sum.budgetExpenses)
    expect(sum.totalSavings).toBe(sum.remaining)
    expect(sum.surplus).toBe(sum.remaining)
  })

  it("lets an explicit tag overrule the heuristic", () => {
    // "Warn, never block": whatever the user picked survives the next load.
    const s = normalizeBudget({
      mode: "single",
      categories: [{ id: "opsparing", name: "Opsparing", kind: "expense" }],
      sharedItems: [
        { id: "a", label: "Opsparing", amount: 3000, categoryId: "opsparing" },
      ],
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
    })
    expect(s.categories[0].kind).toBe("expense")
    expect(computeBudgetSummary(s, 30000, 0).allocatedSavings).toBe(0)
  })

  it("ignores a garbage kind rather than trusting it", () => {
    const s = normalizeBudget({
      mode: "single",
      categories: [{ id: "mad", name: "Mad", kind: "nonsense" }],
      sharedItems: [],
      person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
    })
    expect(s.categories[0].kind).toBeUndefined()
  })
})

describe("the v5 → v6 migration", () => {
  /** A budget as it was persisted before the kind discriminator existed. */
  const v5Blob = {
    version: 5,
    mode: "shared",
    person1: { name: "A", incomeSource: "manual", manualIncome: 26000, items: [] },
    person2: { name: "B", incomeSource: "manual", manualIncome: 24000, items: [] },
    sharedItems: [
      { id: "a", label: "Husleje", amount: 12000, categoryId: "bolig" },
      { id: "b", label: "Dagligvarer", amount: 5500, categoryId: "mad" },
      { id: "c", label: "Spar Nord", amount: 400, categoryId: "oevrigt" },
      { id: "d", label: "Opsparing og buffer", amount: 2000, categoryId: "opsparing" },
    ],
    categories: [
      { id: "bolig", name: "Bolig" },
      { id: "mad", name: "Mad og dagligvarer" },
      { id: "opsparing", name: "Opsparing" },
      { id: "oevrigt", name: "Øvrigt" },
    ],
    mortgage: {
      enabled: true,
      homeValue: 2_500_000,
      remainingYears: 25,
      ltv: 0.7,
      interestRate: 0.041,
      bidragssats: 0.006,
      interestOnly: false,
    },
  }

  it("adds no items and removes none", () => {
    const s = normalizeBudget(v5Blob)
    expect(s.version).toBe(6)
    expect(s.sharedItems).toHaveLength(4)
    expect(s.sharedItems.map((i) => [i.label, i.amount])).toEqual(
      v5Blob.sharedItems.map((i) => [i.label, i.amount])
    )
    expect(s.categories.map((c) => c.id)).toEqual(
      v5Blob.categories.map((c) => c.id)
    )
  })

  it("leaves every pre-existing total unchanged", () => {
    const s = normalizeBudget(v5Blob)
    const sum = computeBudgetSummary(s, 0, 0)
    expect(sum.budgetIncome).toBe(50000)
    expect(sum.budgetExpenses).toBe(19900)
    expect(sum.remaining).toBeCloseTo(50000 - 19900 - sum.mortgageMonthly, 6)
    expect(sum.savingsRate).toBeCloseTo(sum.remaining / 50000, 6)
  })

  it("round-trips through storage with identical figures", () => {
    const once = normalizeBudget(v5Blob)
    const twice = normalizeBudget(JSON.parse(JSON.stringify(once)))
    expect(twice).toEqual(once)
    expect(computeBudgetSummary(twice, 0, 0)).toEqual(
      computeBudgetSummary(once, 0, 0)
    )
  })

  it("does not mistake the household's Spar Nord line for savings", () => {
    const sum = computeBudgetSummary(normalizeBudget(v5Blob), 0, 0)
    // Only the 2.000 kr. Opsparing line — the 400 kr. bank line stays put.
    expect(sum.allocatedSavings).toBe(2000)
  })

  /**
   * The migration infers a missing kind from the category name, so it can move
   * a category the user never asked it to move. A bill name alone must not be
   * enough: "Tandlæge" is ordinarily consumption, and re-tagging it as a
   * hensættelse would quietly cut `consumptionExpenses` and inflate `surplus`.
   */
  it("keeps a plainly named bill category in consumption", () => {
    const withDentist = {
      ...v5Blob,
      sharedItems: [
        ...v5Blob.sharedItems,
        { id: "e", label: "Tandlæge", amount: 300, categoryId: "tandlaege" },
      ],
      categories: [
        ...v5Blob.categories,
        { id: "tandlaege", name: "Tandlæge" },
      ],
    }
    const s = normalizeBudget(withDentist)
    expect(s.categories.find((c) => c.id === "tandlaege")?.kind).toBeUndefined()

    const sum = computeBudgetSummary(s, 0, 0)
    expect(sum.sinkingFunds).toBe(0)
    // The whole 300 kr. stays where a v5 budget put it.
    expect(sum.consumptionExpenses).toBe(19900 + 300 - 2000)
  })

  it("moves a bill category only once its name says it is saved up", () => {
    const withFund = {
      ...v5Blob,
      sharedItems: [
        ...v5Blob.sharedItems,
        { id: "e", label: "Tandlæge", amount: 300, categoryId: "tandlaege" },
      ],
      categories: [
        ...v5Blob.categories,
        { id: "tandlaege", name: "Opsparing til tandlæge" },
      ],
    }
    const sum = computeBudgetSummary(normalizeBudget(withFund), 0, 0)
    expect(sum.sinkingFunds).toBe(300)
    expect(sum.consumptionExpenses).toBe(19900 - 2000)
  })
})

describe("the optional savings block", () => {
  /** A couple as persisted before the block existed. */
  const withoutBlock = {
    version: 6,
    mode: "shared",
    person1: { name: "A", incomeSource: "manual", manualIncome: 28000, items: [] },
    person2: { name: "B", incomeSource: "manual", manualIncome: 22000, items: [] },
    sharedItems: [
      { id: "a", label: "Husleje", amount: 12000, categoryId: "bolig" },
      { id: "b", label: "Opsparing", amount: 3000, categoryId: "opsparing" },
    ],
    categories: [
      { id: "bolig", name: "Bolig" },
      { id: "opsparing", name: "Opsparing" },
      { id: "oevrigt", name: "Øvrigt" },
    ],
  }

  it("stays absent for a budget that never carried one", () => {
    // Persisting a default block would rewrite every stored budget on load.
    const s = normalizeBudget(withoutBlock)
    expect(s.savings).toBeUndefined()
    expect(JSON.parse(JSON.stringify(s))).not.toHaveProperty("savings")
  })

  it("round-trips such a budget with identical figures", () => {
    const once = normalizeBudget(withoutBlock)
    const twice = normalizeBudget(JSON.parse(JSON.stringify(once)))
    expect(twice).toEqual(once)
    expect(computeBudgetSummary(twice, 0, 0)).toEqual(
      computeBudgetSummary(once, 0, 0)
    )
  })

  it("leaves budgetExpenses and remaining alone whatever the split says", () => {
    // hooks/use-planning derives monthlyContribution from `remaining` and
    // annualSpending from `budgetExpenses`, and lib/mcp/tools ships both over
    // the wire. Redefining either would break the remote server with no compile
    // error, so the split may only divide figures, never restate them.
    const base = computeBudgetSummary(normalizeBudget(withoutBlock), 0, 0)
    expect(base.budgetExpenses).toBe(15000)
    expect(base.remaining).toBe(35000)

    for (const savings of [
      { split: "with-expenses" },
      { split: "shared" },
      {
        split: "individual",
        sharedPortion: 4000,
        allocation: { p1: 2000, p2: 1000 },
        manual: true,
      },
    ]) {
      const s = normalizeBudget({ ...withoutBlock, savings })
      expect(computeBudgetSummary(s, 0, 0)).toEqual(base)
    }
  })

  it("round-trips a stated split unchanged", () => {
    const stated = {
      ...withoutBlock,
      savings: {
        split: "individual",
        sharedPortion: 4000,
        allocation: { p1: 2000, p2: 1000 },
        manual: true,
      },
    }
    const once = normalizeBudget(stated)
    expect(once.savings).toEqual(stated.savings)
    expect(normalizeBudget(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })
})

describe("computeResultSummary", () => {
  it("sums gross/tax/net and derives effective rate + monthly", () => {
    const r = computeResultSummary([
      { amBasis: 500000, insuranceBasis: 0, nonAmIncome: 0, totalTax: 150000, netIncome: 350000 },
      { amBasis: 300000, insuranceBasis: 0, nonAmIncome: 0, totalTax: 80000, netIncome: 220000 },
    ])
    expect(r.grossYear).toBe(800000)
    expect(r.taxYear).toBe(230000)
    expect(r.netYear).toBe(570000)
    expect(r.effectiveRate).toBeCloseTo(230000 / 800000, 6)
    expect(r.netMonthly).toBeCloseTo(570000 / 12, 4)
  })
})

describe("expensesByCategory", () => {
  it("aggregates items by category", () => {
    const s = normalizeBudget({
      mode: "single",
      sharedItems: [
        { id: "a", label: "Mad", amount: 1000, categoryId: "mad" },
        { id: "b", label: "Mere mad", amount: 500, categoryId: "mad" },
      ],
    })
    expect(expensesByCategory(s).find((c) => c.categoryId === "mad")?.total).toBe(1500)
  })
})
