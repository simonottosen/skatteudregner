import { describe, it, expect } from "vitest"
import { computeBudgetSummary, normalizeBudget, type BudgetState } from "../state"
import { savingsBreakdownView, savingsSplitView } from "../savings-view"
import { attributeSavings, type SavingsConfig } from "../savings-split"

/** 30.000 in; `savings` and `sinking` are monthly kroner in those buckets. */
function summary(opts: { savings?: number; sinking?: number; mortgage?: boolean }) {
  const state = normalizeBudget({
    mode: "single",
    person1: { name: "P1", incomeSource: "skat", manualIncome: 0, items: [] },
    categories: [
      { id: "mad", name: "Mad og dagligvarer" },
      { id: "opsparing", name: "Opsparing" },
      // Tagged outright: what the breakdown does with a sinking fund is a
      // separate question from how a category comes to be tagged as one.
      { id: "hensat", name: "Bilreparation", kind: "sinking" },
    ],
    sharedItems: [
      { id: "a", label: "Mad", amount: 5000, categoryId: "mad" },
      { id: "b", label: "Opsparing", amount: opts.savings ?? 0, categoryId: "opsparing" },
      { id: "c", label: "Bilreparation", amount: opts.sinking ?? 0, categoryId: "hensat" },
    ],
    mortgage: opts.mortgage
      ? {
          enabled: true,
          homeValue: 1_000_000,
          remainingYears: 30,
          ltv: 0.5,
          interestRate: 0.04,
          bidragssats: 0.006,
          interestOnly: false,
        }
      : undefined,
  })
  return computeBudgetSummary(state, 30000, 0)
}

describe("savingsBreakdownView", () => {
  it("stays quiet when nothing is tagged", () => {
    // With no savings line the breakdown would only restate "Til rådighed"
    // under new labels.
    expect(savingsBreakdownView(summary({}))).toBeNull()
  })

  it("shows consumption, the allocation and the real saving", () => {
    const view = savingsBreakdownView(summary({ savings: 3000 }))
    expect(view?.figures).toEqual([
      { label: "Forbrug", amount: 5000 },
      { label: "Afsat til opsparing", amount: 3000 },
      { label: "Reel opsparing / md.", amount: 25000, highlight: true },
    ])
  })

  it("adds the mortgage to the consumption figure it labels", () => {
    const view = savingsBreakdownView(summary({ savings: 3000, mortgage: true }))
    const forbrug = view?.figures[0]
    expect(forbrug?.label).toBe("Forbrug (inkl. lån)")
    expect(forbrug?.amount).toBeGreaterThan(5000)
  })

  it("gives sinking funds a line of their own", () => {
    const view = savingsBreakdownView(summary({ savings: 3000, sinking: 1000 }))
    expect(view?.figures.map((f) => f.label)).toEqual([
      "Forbrug",
      "Hensat til kendte udgifter",
      "Afsat til opsparing",
      "Reel opsparing / md.",
    ])
    // The set-aside is neither consumed nor saved: it is exactly the gap.
    expect(view?.figures[1].amount).toBe(1000)
    expect(view?.figures[3].amount).toBe(24000)
  })

  it("renders for a household that only has sinking funds", () => {
    const view = savingsBreakdownView(summary({ sinking: 1000 }))
    expect(view?.figures.map((f) => f.label)).not.toContain("Afsat til opsparing")
    expect(view?.notes).toHaveLength(2)
  })

  it("explains why the savings rate on Resultat is lower", () => {
    // The rate there still counts savings as an expense; a user watching that
    // number should not have to guess why this page disagrees.
    const notes = savingsBreakdownView(summary({ savings: 3000 }))?.notes ?? []
    expect(notes.some((n) => n.includes("Opsparingsraten på Resultat"))).toBe(true)
  })
})

/** The view a budget produces, with the page's own wiring between the two. */
function viewOf(state: BudgetState) {
  const sum = computeBudgetSummary(state, 0, 0)
  return savingsSplitView({
    attribution: attributeSavings(state, sum),
    mode: state.mode,
    p1Name: state.person1.name,
    p2Name: state.person2.name,
    mortgageMonthly: sum.mortgageMonthly,
  })
}

/**
 * A couple saving 26.000 a month: 50.000 in (28.000 + 22.000), 24.000 consumed
 * and 3.000 already sitting in an Opsparing category. Same figures either way
 * the expenses are arranged, so the two layouts stay comparable.
 */
function splitView(
  opts: {
    mode?: "single" | "shared" | "separate"
    savings?: SavingsConfig
    p2Name?: string
  } = {}
) {
  const mode = opts.mode ?? "shared"
  const separate = mode === "separate"
  const state = normalizeBudget({
    mode,
    person1: {
      name: "Anna",
      incomeSource: "manual",
      manualIncome: 28000,
      items: separate
        ? [
            { id: "x", label: "Husleje", amount: 12000, categoryId: "bolig" },
            { id: "z", label: "Opsparing", amount: 3000, categoryId: "opsparing" },
          ]
        : [],
    },
    person2: {
      name: opts.p2Name ?? "Bo",
      incomeSource: "manual",
      manualIncome: 22000,
      items: separate
        ? [{ id: "y", label: "Husleje", amount: 12000, categoryId: "bolig" }]
        : [],
    },
    categories: [
      { id: "bolig", name: "Bolig" },
      { id: "opsparing", name: "Opsparing" },
    ],
    sharedItems: separate
      ? []
      : [
          { id: "a", label: "Husleje", amount: 24000, categoryId: "bolig" },
          { id: "b", label: "Opsparing", amount: 3000, categoryId: "opsparing" },
        ],
    savings: opts.savings,
  })
  return viewOf(state)
}

/** Household savings each of these leaves to attribute, including a deficit. */
const TOTALS = [26000, 5000, 0, -5000]

/**
 * The same couple on one expense list, with the household saving dialled to
 * `total` — including below zero, where they spend more than they earn.
 */
function splitViewFor(total: number, savings?: SavingsConfig) {
  return viewOf(
    normalizeBudget({
      mode: "shared",
      person1: { name: "Anna", incomeSource: "manual", manualIncome: 28000, items: [] },
      person2: { name: "Bo", incomeSource: "manual", manualIncome: 22000, items: [] },
      categories: [{ id: "bolig", name: "Bolig" }],
      sharedItems: [
        { id: "a", label: "Husleje", amount: 50000 - total, categoryId: "bolig" },
      ],
      savings,
    })
  )
}

describe("savingsSplitView", () => {
  it("stays quiet for a one-person household", () => {
    // There is nobody to share with, so the whole question is moot.
    expect(splitView({ mode: "single" })).toBeNull()
  })

  it("shows one joint figure for a couple on a shared budget", () => {
    // A second row restating the same 26.000 under "i alt" would only invite
    // the reader to add the two together.
    expect(splitView()?.figures).toEqual([
      { label: "Fælles opsparing", amount: 26000, highlight: true },
    ])
  })

  it("names each person when the budget is split per person", () => {
    const view = splitView({ mode: "separate" })
    expect(view?.figures).toEqual([
      { label: "Anna", amount: 16000 },
      { label: "Bo", amount: 10000 },
      { label: "Opsparing i alt / md.", amount: 26000, highlight: true },
    ])
  })

  it("falls back to a placeholder for a blank name", () => {
    expect(splitView({ mode: "separate", p2Name: "  " })?.p2Label).toBe("Person 2")
  })

  it("splits the remainder evenly until two amounts are stated", () => {
    const view = splitView({
      savings: { split: "individual", sharedPortion: 5000 },
    })
    expect(view?.figures).toEqual([
      { label: "Fælles opsparing", amount: 5000 },
      { label: "Anna", amount: 10500 },
      { label: "Bo", amount: 10500 },
      { label: "Opsparing i alt / md.", amount: 26000, highlight: true },
    ])
    expect(view?.warning).toBeUndefined()
  })

  it("shows what is left over when the couple states its own amounts", () => {
    const view = splitView({
      savings: {
        split: "individual",
        sharedPortion: 5000,
        allocation: { p1: 1000, p2: 1000 },
        manual: true,
      },
    })
    expect(view?.figures).toEqual([
      { label: "Fælles opsparing", amount: 5000 },
      { label: "Anna", amount: 1000 },
      { label: "Bo", amount: 1000 },
      { label: "Ikke fordelt", amount: 19000 },
      { label: "Opsparing i alt / md.", amount: 26000, highlight: true },
    ])
  })

  it("warns rather than quietly capping an over-commitment", () => {
    const view = splitView({
      savings: {
        split: "individual",
        sharedPortion: 20000,
        allocation: { p1: 4000, p2: 4000 },
        manual: true,
      },
    })
    expect(view?.figures).toContainEqual({
      label: "Fordelt for meget",
      amount: -2000,
    })
    expect(view?.warning).toContain("2.000 kr.")
  })

  it("warns when the joint amount alone outruns the household saving", () => {
    // The automatic path used to report 10.000 joint, −2.500 kr. under each
    // name and no warning at all.
    const view = splitViewFor(5000, { split: "individual", sharedPortion: 10000 })
    expect(view?.figures).toEqual([
      { label: "Fælles opsparing", amount: 10000 },
      { label: "Anna", amount: 0 },
      { label: "Bo", amount: 0 },
      { label: "Fordelt for meget", amount: -5000 },
      { label: "Opsparing i alt / md.", amount: 5000, highlight: true },
    ])
    expect(view?.warning).toContain("5.000 kr.")
  })

  it("gives each name a row, and never a negative one, on the hver-sit split", () => {
    // Both halves matter: a couple who asked for two personal figures should be
    // shown two, and neither may come out below zero however large the joint
    // amount they typed.
    for (const total of TOTALS) {
      for (const sharedPortion of [0, 5000, 10000, 40000]) {
        const view = splitViewFor(total, { split: "individual", sharedPortion })
        for (const label of ["Anna", "Bo"]) {
          const row = view?.figures.find((f) => f.label === label)
          expect(row, `${label} at total ${total}, joint ${sharedPortion}`).toBeDefined()
          expect(row?.amount).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it("blames the budget, not the couple, when the household is in deficit", () => {
    // Every amount on the card is zero, so "sæt beløbene ned" would be advice
    // about nothing. The deficit is a budget fact and is shown as one.
    const view = splitViewFor(-5000, { split: "individual", sharedPortion: 0 })
    expect(view?.warning).toBeUndefined()
    expect(view?.figures).toContainEqual({
      label: "Underskud i budgettet",
      amount: -5000,
    })
  })

  it("keeps the two apart when a deficit household also states amounts", () => {
    const view = splitViewFor(-5000, { split: "individual", sharedPortion: 10000 })
    expect(view?.figures).toContainEqual({
      label: "Fordelt for meget",
      amount: -10000,
    })
    expect(view?.figures).toContainEqual({
      label: "Underskud i budgettet",
      amount: -5000,
    })
    // The warning names only the part they can act on, not the 15.000 gap.
    expect(view?.warning).toContain("10.000 kr.")
  })

  it("prints rows that add up to the total it prints", () => {
    for (const total of TOTALS) {
      for (const savings of [
        undefined,
        { split: "shared" as const },
        { split: "individual" as const, sharedPortion: 0 },
        { split: "individual" as const, sharedPortion: 10000 },
        {
          split: "individual" as const,
          sharedPortion: 10000,
          allocation: { p1: 20000, p2: 1000 },
          manual: true,
        },
      ]) {
        const view = splitViewFor(total, savings)
        if (!view) continue
        const headline = view.figures.find((f) => f.highlight)
        const parts = view.figures.filter((f) => !f.highlight)
        // A lone component is the total; otherwise the rest must sum to it.
        expect(
          parts.length ? parts.reduce((s, f) => s + f.amount, 0) : headline?.amount
        ).toBeCloseTo(total, 6)
      }
    }
  })

  it("says how the realkredit payment was apportioned, and only then", () => {
    // The per-person expense cards leave the loan unallocated; the savings
    // figures cannot, or they would not add up to the household's. Saying so is
    // what keeps both statements honest on the same page.
    const state = normalizeBudget({
      mode: "separate",
      person1: {
        name: "Anna",
        incomeSource: "manual",
        manualIncome: 28000,
        items: [{ id: "x", label: "Mad", amount: 8000, categoryId: "bolig" }],
      },
      person2: {
        name: "Bo",
        incomeSource: "manual",
        manualIncome: 22000,
        items: [{ id: "y", label: "Mad", amount: 7000, categoryId: "bolig" }],
      },
      categories: [{ id: "bolig", name: "Bolig" }],
      mortgage: {
        enabled: true,
        homeValue: 2_000_000,
        remainingYears: 30,
        ltv: 0.8,
        interestRate: 0.04,
        bidragssats: 0.006,
        interestOnly: false,
      },
    })
    const view = viewOf(state)
    expect(view?.notes.some((n) => n.includes("50/50"))).toBe(true)
    expect(splitView({ mode: "separate" })?.notes.some((n) => n.includes("50/50"))).toBe(
      false
    )
  })
})
