import { describe, it, expect } from "vitest"
import { planningSavingsSplit } from "../summary"
import { attributeSavings, type SavingsConfig } from "@/lib/budget/savings-split"
import {
  computeBudgetSummary,
  normalizeBudget,
  planningContribution,
  type BudgetMode,
} from "@/lib/budget/state"

/**
 * A couple saving 26.000 a month — 50.000 in, 24.000 spent on rent — put
 * through the same wiring `usePlanning` uses, so a test here fails for the
 * reasons the page would.
 *
 * `savings` in a category of its own is what makes the plan's contribution and
 * the household's savings differ: the plan gets the *unallocated* leftover.
 */
function splitFor(
  opts: {
    mode?: BudgetMode
    savings?: SavingsConfig
    p2Name?: string
    allocatedSavings?: number
    /** Overrides the contribution the plan is asked to reconcile against. */
    monthlyContribution?: number
  } = {}
) {
  const allocated = opts.allocatedSavings ?? 0
  const state = normalizeBudget({
    mode: opts.mode ?? "shared",
    person1: { name: "Anna", incomeSource: "manual", manualIncome: 28000, items: [] },
    person2: {
      name: opts.p2Name ?? "Bo",
      incomeSource: "manual",
      manualIncome: 22000,
      items: [],
    },
    categories: [
      { id: "bolig", name: "Bolig" },
      { id: "opsparing", name: "Opsparing" },
    ],
    sharedItems: [
      { id: "a", label: "Husleje", amount: 24000, categoryId: "bolig" },
      { id: "b", label: "Opsparing", amount: allocated, categoryId: "opsparing" },
    ],
    savings: opts.savings,
  })
  const summary = computeBudgetSummary(state, 0, 0)
  return planningSavingsSplit({
    attribution: attributeSavings(state, summary),
    mode: state.mode,
    p1Name: state.person1.name,
    p2Name: state.person2.name,
    mortgageMonthly: summary.mortgageMonthly,
    monthlyContribution:
      opts.monthlyContribution ?? planningContribution(summary.remaining),
  })
}

const HVER_SIT: SavingsConfig = {
  split: "individual",
  sharedPortion: 6000,
  allocation: { p1: 12000, p2: 8000 },
  manual: true,
}

describe("planningSavingsSplit", () => {
  it("names both people and their stated amounts", () => {
    expect(splitFor({ savings: HVER_SIT })?.figures).toEqual([
      { id: "shared", label: "Fælles opsparing", amount: 6000 },
      { id: "p1", label: "Anna", amount: 12000 },
      { id: "p2", label: "Bo", amount: 8000 },
      { id: "total", label: "Opsparing i alt / md.", amount: 26000, highlight: true },
    ])
  })

  it("falls back to a placeholder for a blank name", () => {
    const figures = splitFor({ savings: HVER_SIT, p2Name: "  " })?.figures ?? []
    expect(figures.map((f) => f.label)).toContain("Person 2")
  })

  it("splits the remainder evenly until two amounts are stated", () => {
    const view = splitFor({
      savings: { split: "individual", sharedPortion: 6000 },
    })
    expect(view?.figures).toEqual([
      { id: "shared", label: "Fælles opsparing", amount: 6000 },
      { id: "p1", label: "Anna", amount: 10000 },
      { id: "p2", label: "Bo", amount: 10000 },
      { id: "total", label: "Opsparing i alt / md.", amount: 26000, highlight: true },
    ])
  })

  it("shows what the couple has not earmarked yet", () => {
    const view = splitFor({
      savings: { ...HVER_SIT, allocation: { p1: 1000, p2: 1000 } },
    })
    expect(view?.figures).toContainEqual({
      id: "slack",
      label: "Ikke fordelt",
      amount: 18000,
    })
  })

  it("warns rather than quietly capping an over-commitment", () => {
    const view = splitFor({
      savings: { ...HVER_SIT, sharedPortion: 20000 },
    })
    expect(view?.figures).toContainEqual({
      id: "over",
      label: "Fordelt for meget",
      amount: -14000,
    })
    expect(view?.warning?.title).toBe("Mere fordelt end sparet op")
    expect(view?.warning?.subtitle).toContain("14.000 kr.")
  })

  it("leaves the warning off a plan that fits", () => {
    expect(splitFor({ savings: HVER_SIT })?.warning).toBeUndefined()
  })

  it("says the projection is of the household, not of each person", () => {
    // Otherwise the two names beside two amounts read as two fremskrivninger,
    // and there is only ever one Monte Carlo run behind the page.
    const notes = splitFor({ savings: HVER_SIT })?.notes ?? []
    expect(notes.some((n) => n.includes("sin egen fremskrivning"))).toBe(true)
  })

  it("stays quiet for a one-person household", () => {
    // Nobody to share with, whatever the savings block happens to say.
    expect(splitFor({ mode: "single", savings: HVER_SIT })).toBeNull()
  })

  it("stays quiet on the default split, on either expense layout", () => {
    // Every budget carries "with-expenses" until someone changes it. A new
    // panel there would appear for couples who never asked a question.
    expect(splitFor()).toBeNull()
    expect(splitFor({ mode: "separate" })).toBeNull()
    expect(splitFor({ savings: { split: "with-expenses" } })).toBeNull()
  })

  it("stays quiet when the couple saves everything jointly", () => {
    // One row restating the household figure printed directly above it.
    expect(splitFor({ savings: { split: "shared" } })).toBeNull()
  })

  it("stays silent about the plan's contribution when it matches", () => {
    const notes = splitFor({ savings: HVER_SIT })?.notes ?? []
    expect(notes.some((n) => n.includes("Planen regner med"))).toBe(false)
  })

  it("says so when the plan contributes less than the household saves", () => {
    // The plan gets the unallocated leftover, so a category tagged "Opsparing"
    // is the gap; without the note the rows visibly fail to add up to the
    // figure in the input above them.
    const view = splitFor({ allocatedSavings: 4000, savings: HVER_SIT })
    const note = view?.notes.find((n) => n.includes("Planen regner med"))
    expect(note).toContain("22.000 kr.")
    expect(note).toContain("26.000 kr.")
    // The rows still describe the household's own savings, not the plan's.
    expect(view?.figures).toContainEqual({
      id: "total",
      label: "Opsparing i alt / md.",
      amount: 26000,
      highlight: true,
    })
  })

  it("says so when the contribution has been typed in by hand", () => {
    const notes =
      splitFor({ savings: HVER_SIT, monthlyContribution: 30000 })?.notes ?? []
    expect(notes.some((n) => n.includes("30.000 kr."))).toBe(true)
  })

  it("prints rows that add up to the total it prints", () => {
    // The invariant that makes the panel reconcilable with /budget at all.
    for (const sharedPortion of [0, 6000, 26000, 40000]) {
      for (const allocation of [undefined, { p1: 1000, p2: 1000 }]) {
        const view = splitFor({
          savings: {
            split: "individual",
            sharedPortion,
            allocation,
            manual: allocation != null,
          },
        })
        const parts = view?.figures.filter((f) => !f.highlight) ?? []
        const total = view?.figures.find((f) => f.highlight)
        expect(parts.reduce((s, f) => s + f.amount, 0)).toBeCloseTo(
          total?.amount ?? 0,
          6
        )
      }
    }
  })
})
