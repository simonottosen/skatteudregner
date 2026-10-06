import { describe, it, expect } from "vitest"
import { DEFAULT_PLANNING_STATE, type PlanningState } from "../types"
import { applyScenario } from "../scenario"
import { normalizePlanning, normalizeScenarioChanges } from "../normalize"
import { maxInterestOnlyYears, newPlannedLoan } from "../loans"
import { mortgageBudgetNotice, summarize, summarizeResult } from "../summary"
import { modelledMortgageMonthly, simulatePlanning } from "../simulate"
import { formatDKK } from "@/lib/format"
// The budget's own quote, so the notice's figure is pinned to what the user
// will actually see on /budget rather than to a restatement of the planning code.
import { DEFAULT_MORTGAGE, mortgageMonthlyTotal } from "@/lib/budget/mortgage"

function makeState(overrides: Partial<PlanningState> = {}): PlanningState {
  return {
    ...DEFAULT_PLANNING_STATE,
    assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, ...(overrides.assumptions ?? {}) },
    ...overrides,
  }
}

describe("applyScenario", () => {
  it("merges scalar overrides, assumption overrides and appends events", () => {
    const base = makeState({
      monthlyContribution: 10_000,
      events: [{ id: "e0", type: "expense", label: "x", age: 40, amount: 1000 }],
    })
    const out = applyScenario(base, {
      overrides: { monthlyContribution: 15_000, retirementAge: 62 },
      assumptionOverrides: { investmentReturn: 0.08 },
      addEvents: [
        { type: "recurring", label: "Løn +5 %", age: 31, monthlyDelta: 2500 },
      ],
    })
    expect(out.monthlyContribution).toBe(15_000)
    expect(out.retirementAge).toBe(62)
    expect(out.assumptions.investmentReturn).toBe(0.08)
    // Other assumptions untouched.
    expect(out.assumptions.inflation).toBe(base.assumptions.inflation)
    // Base event kept, scenario event appended with a fresh id.
    expect(out.events).toHaveLength(2)
    expect(out.events[1].type).toBe("recurring")
    expect(out.events[1].id).toBeTruthy()
    // Base state is not mutated.
    expect(base.monthlyContribution).toBe(10_000)
    expect(base.events).toHaveLength(1)
  })

  it("merges widened scalar, pension and tax overrides without clobbering persons", () => {
    const base = makeState({
      investmentTaxMode: "realisation",
      loans: [
        { ...newPlannedLoan("realkredit", null), id: "l-base", rate: 0.04 },
        { ...newPlannedLoan("bank", null), id: "l-car" },
      ],
      pension: {
        ...DEFAULT_PLANNING_STATE.pension,
        single: true,
        pensionReturn: 0.05,
        person1: {
          ...DEFAULT_PLANNING_STATE.pension.person1,
          ratepensionBalance: 111,
        },
      },
      tax: { year: 2026, municipality: "København", churchMember: false },
    })
    const out = applyScenario(base, {
      overrides: {
        investmentTaxMode: "ask",
        // A list override replaces the base list rather than being merged into
        // it loan by loan: "what if we refinanced" is a statement about the
        // whole of the household's debt, and there is no key to match on that
        // would let a scenario re-price one loan and keep the others.
        loans: [
          { ...newPlannedLoan("realkredit", null), id: "l-refi", rate: 0.06 },
        ],
      },
      pensionOverrides: { single: false, includeFolkepension: false },
      taxOverrides: { municipality: "Aarhus", churchMember: true },
    })
    expect(out.investmentTaxMode).toBe("ask")
    expect(out.loans).toHaveLength(1)
    expect(out.loans[0].rate).toBe(0.06)
    expect(out.pension.single).toBe(false)
    expect(out.pension.includeFolkepension).toBe(false)
    expect(out.pension.pensionReturn).toBe(0.05) // untouched
    expect(out.pension.person1.ratepensionBalance).toBe(111) // persons intact
    expect(out.tax.municipality).toBe("Aarhus")
    expect(out.tax.churchMember).toBe(true)
    expect(out.tax.year).toBe(2026) // untouched
    expect(base.investmentTaxMode).toBe("realisation") // base not mutated
  })
})

describe("normalizeScenarioChanges (widened)", () => {
  it("validates and clamps the widened override set", () => {
    const c = normalizeScenarioChanges({
      overrides: {
        investmentTaxMode: "ask",
        loans: [
          { type: "realkredit", principal: 1_500_000, rate: 0.06 },
          { type: "bank", principal: -500 }, // clamped to 0
        ],
        includePropertyTax: true,
        bogus: 123, // dropped
      },
      pensionOverrides: { single: false, ratepensionYears: 99, bogus: 1 },
      taxOverrides: { churchMember: true, year: 2025 },
      assumptionOverrides: { inflation: 0.03 },
    })
    expect(c.overrides?.investmentTaxMode).toBe("ask")
    expect(c.overrides?.loans?.[0].rate).toBe(0.06)
    expect(c.overrides?.loans?.[1].principal).toBe(0)
    expect(c.overrides?.includePropertyTax).toBe(true)
    expect("bogus" in (c.overrides as object)).toBe(false)
    expect(c.pensionOverrides?.single).toBe(false)
    expect(c.pensionOverrides?.ratepensionYears).toBe(40) // clamped 99 → 40
    expect(c.taxOverrides?.churchMember).toBe(true)
    expect(c.taxOverrides?.year).toBe(2025)
    expect(c.assumptionOverrides?.inflation).toBe(0.03)
  })

  it("migrates a scenario saved against the old debt scalars", () => {
    // Scenarios are stored inside the plan, so a version-2 blob carries
    // version-2 overrides. "What if we had a smaller mortgage" has to survive
    // the move to a list, or reopening a saved comparison silently drops the
    // debt it was a comparison about and the two plans come out identical.
    const c = normalizeScenarioChanges({
      overrides: {
        mortgageBalance: 1_200_000,
        mortgageRate: 0.05,
        otherDebtBalance: 90_000,
        otherDebtRate: 0.08,
      },
    })
    expect(c.overrides?.loans).toHaveLength(2)
    expect(c.overrides?.loans?.[0]).toMatchObject({
      type: "realkredit",
      principal: 1_200_000,
      rate: 0.05,
    })
    expect(c.overrides?.loans?.[1]).toMatchObject({
      type: "bank",
      principal: 90_000,
      rate: 0.08,
    })
  })

  it("drops an invalid investmentTaxMode but keeps valid fields", () => {
    const c = normalizeScenarioChanges({
      overrides: { investmentTaxMode: "bogus", cashBuffer: 10 },
    })
    expect(c.overrides && "investmentTaxMode" in c.overrides).toBe(false)
    expect(c.overrides?.cashBuffer).toBe(10)
  })
})

describe("normalizePlanning (scenarios)", () => {
  it("round-trips a scenario through JSON + normalize", () => {
    const base = makeState({
      scenarios: [
        {
          id: "sc1",
          name: "Løn +5 %",
          createdAt: "2026-01-01T00:00:00.000Z",
          changes: {
            overrides: { monthlyContribution: 20_000 },
            addEvents: [
              { type: "recurring", label: "boost", age: 31, monthlyDelta: 2500 },
            ],
          },
        },
      ],
    })
    const round = normalizePlanning(JSON.parse(JSON.stringify(base)))
    expect(round.scenarios).toHaveLength(1)
    expect(round.scenarios[0].name).toBe("Løn +5 %")
    expect(round.scenarios[0].changes.overrides?.monthlyContribution).toBe(20_000)
    expect(round.scenarios[0].changes.addEvents?.[0]).toMatchObject({
      type: "recurring",
      monthlyDelta: 2500,
    })
  })

  /**
   * A refinance scenario — the common one — overrides the loans and nothing
   * else, so the list it names has no property of its own to be secured on. It
   * has to reach the base plan's, because `applyScenario` swaps the loans out
   * and leaves `properties` standing: those are the properties the scenario's
   * mortgage really meets. Resolved against nothing it would come out as a
   * realkredit securing no particular property, which the engine discharges at
   * the household's *last* disposal rather than at the home's (#9) — a changed
   * projection for a scenario that was saved years ago and never edited.
   */
  it("secures a refinance scenario's mortgage on the base plan's home", () => {
    // The properties arrive without ids, so the id the scenario's loan names has
    // to be the one this plan keeps and not a second minting of the same blob.
    const round = normalizePlanning({
      properties: [
        { value: 4_000_000 },
        { kind: "fritidsbolig", value: 2_000_000 },
      ],
      scenarios: [
        {
          id: "sc-refi",
          name: "Omlagt lån",
          changes: {
            overrides: {
              loans: [
                { type: "realkredit", principal: 1_000_000 },
                // "Uden pant" as the user chose it in the form: an explicit null
                // is a decision, so the fallback may not re-secure it.
                { type: "realkredit", principal: 50_000, propertyId: null },
              ],
            },
          },
        },
      ],
    })
    const loans = round.scenarios[0].changes.overrides!.loans!
    expect(loans[0].propertyId).toBe(round.properties[0].id)
    expect(loans[1].propertyId).toBeNull()
  })

  it("prefers the properties the scenario states over the base plan's", () => {
    // "What if I bought a bigger house and borrowed for it" describes one
    // household: `applyScenario` swaps both lists out together, so the home its
    // loan is secured on is the scenario's own.
    const round = normalizePlanning({
      properties: [{ value: 4_000_000 }],
      scenarios: [
        {
          id: "sc-move",
          name: "Nyt hus",
          changes: {
            overrides: {
              properties: [{ value: 6_000_000 }],
              loans: [{ type: "realkredit", principal: 1_000_000 }],
            },
          },
        },
      ],
    })
    const ov = round.scenarios[0].changes.overrides!
    expect(ov.loans![0].propertyId).toBe(ov.properties![0].id)
    expect(ov.loans![0].propertyId).not.toBe(round.properties[0].id)
  })

  it("drops malformed scenarios and unknown override keys", () => {
    const round = normalizePlanning({
      ...DEFAULT_PLANNING_STATE,
      scenarios: [
        null,
        { id: "x", changes: { overrides: { bogusField: 1, cashBuffer: 50_000 } } },
      ],
    })
    expect(round.scenarios).toHaveLength(1)
    const ov = round.scenarios[0].changes.overrides!
    expect(ov.cashBuffer).toBe(50_000)
    expect("bogusField" in ov).toBe(false)
  })
})

describe("summarize", () => {
  it("reports both nominal and today's-kroner figures", () => {
    const s = summarize(
      makeState({
        currentAge: 35,
        endAge: 90,
        retirementAge: 65,
        startInvestments: 100_000,
        monthlyContribution: 10_000,
        annualSpending: 300_000,
      })
    )
    expect(s.netWorthAtRetirement.nominal).toBeGreaterThan(0)
    // Positive inflation → today's-kr value is below the nominal future value.
    expect(s.netWorthAtRetirement.real).toBeLessThan(s.netWorthAtRetirement.nominal)
    expect(typeof s.successProbability).toBe("number")
  })

  it("a 'salary +X/mo invested' scenario raises net worth at retirement", () => {
    const base = makeState({
      currentAge: 35,
      endAge: 90,
      retirementAge: 65,
      startInvestments: 100_000,
      monthlyContribution: 10_000,
      annualSpending: 300_000,
    })
    const boosted = applyScenario(base, {
      addEvents: [
        { type: "recurring", label: "Løn +5 %", age: 35, monthlyDelta: 3000 },
      ],
    })
    expect(summarize(boosted).netWorthAtRetirement.nominal).toBeGreaterThan(
      summarize(base).netWorthAtRetirement.nominal
    )
  })
})

/**
 * The planning page charts the scenario as a second curve, so it needs the
 * scenario's *points* as well as its summary. These pin the contract that lets
 * it simulate once and derive both, instead of running the Monte Carlo twice.
 */
describe("summarizeResult", () => {
  const base = makeState({
    currentAge: 35,
    endAge: 90,
    retirementAge: 65,
    startInvestments: 100_000,
    monthlyContribution: 10_000,
    annualSpending: 300_000,
  })

  it("matches summarize() on the same state", () => {
    // The Monte Carlo is seeded, so this is an exact equality, not an epsilon.
    expect(summarizeResult(simulatePlanning(base), base)).toEqual(summarize(base))
  })

  it("deflates with the scenario's own inflation, not the base plan's", () => {
    // A scenario may override inflation. Summarizing its result against the
    // *base* state would then report today's-kroner figures deflated at the
    // wrong rate — the base and scenario curves would not be comparable.
    const scenario = applyScenario(base, {
      assumptionOverrides: { inflation: 0.05 },
    })
    const result = simulatePlanning(scenario)
    const correct = summarizeResult(result, scenario)
    const wrong = summarizeResult(result, base)

    expect(correct.netWorthAtRetirement.nominal).toBe(
      wrong.netWorthAtRetirement.nominal
    )
    // 5 % over the 30 years to retirement deflates much harder than 2 %.
    expect(correct.netWorthAtRetirement.real).toBeLessThan(
      wrong.netWorthAtRetirement.real
    )
    const years = base.retirementAge - base.currentAge
    expect(correct.netWorthAtRetirement.real).toBeCloseTo(
      correct.netWorthAtRetirement.nominal / Math.pow(1.05, years),
      6
    )
  })

  it("keeps the scenario's points aligned age-for-age with the base plan", () => {
    // The chart joins the two series on age. `currentAge`/`endAge` are not
    // overridable, so the join is total — no scenario point goes unplotted.
    const scenario = applyScenario(base, {
      overrides: { monthlyContribution: 15_000 },
    })
    const baseAges = simulatePlanning(base).points.map((p) => p.age)
    const scenarioAges = simulatePlanning(scenario).points.map((p) => p.age)
    expect(scenarioAges).toEqual(baseAges)
    expect(baseAges[0]).toBe(base.currentAge)
    expect(baseAges.at(-1)).toBe(base.endAge)
  })
})

describe("mortgageBudgetNotice", () => {
  /**
   * The plan cannot tell whether a contribution was quoted before or after the
   * household's realkredit payment, and the two readings differ by a five-figure
   * sum a year. Rather than pick one silently, the projection charges what its
   * own inputs describe and this says so. These pin the trigger: a notice that
   * fires on a consistent plan is noise, and one that stays quiet on an
   * inconsistent plan is the original bug with extra steps.
   */
  const theLoan = {
    ...newPlannedLoan("realkredit", "p0"),
    id: "l0",
    principal: 2_000_000,
    rate: 0.04,
    termMonths: 20 * 12,
  }
  const inconsistent = makeState({
    properties: [
      {
        id: "p0",
        label: "Bolig",
        kind: "helaarsbolig",
        use: "own",
        value: 3_000_000,
        landValue: 0,
        saleCostsPct: 0,
        acquisitionAge: 0,
        disposalAge: null,
        financing: null,
        housingReturn: null,
      },
    ],
    loans: [theLoan],
    mortgageBudgetedMonthly: 0,
  })

  it("fires on a loan the budget never deducted for", () => {
    const n = mortgageBudgetNotice(inconsistent)
    expect(n).not.toBeNull()
    expect(n!.title).toContain("budget")
  })

  it("quotes the payment the projection actually charges", () => {
    // The number in the copy has to be the number in the cash flow, or the
    // notice sends the user to check a figure that appears nowhere.
    const monthly = modelledMortgageMonthly(inconsistent)
    expect(monthly).toBeGreaterThan(0)
    expect(mortgageBudgetNotice(inconsistent)!.subtitle).toContain(
      formatDKK(monthly)
    )
  })

  it("quotes the same monthly figure the budget would", () => {
    // The notice tells the user to go and switch the module on, so its number
    // has to be the one they will see there — same units, same components.
    // Derived from the budget's own quote, not from the planning code, so a
    // per-year figure dressed up as "/md." cannot pass.
    const monthly = modelledMortgageMonthly({
      ...inconsistent,
      loans: [{ ...theLoan, bidragssats: 0.006 }],
    })
    expect(monthly).toBeCloseTo(
      mortgageMonthlyTotal({
        ...DEFAULT_MORTGAGE,
        enabled: true,
        homeValue: 2_500_000,
        ltv: 0.8, // the same 2 mio. loan
        interestRate: 0.04,
        remainingYears: 20,
        bidragssats: 0.006,
      }),
      6
    )
    // …and bidrag is a real part of it, not a rounding difference.
    expect(monthly - modelledMortgageMonthly(inconsistent)).toBeCloseTo(
      (2_000_000 * 0.006) / 12,
      6
    )
  })

  it("stays quiet when the budget does deduct a payment", () => {
    expect(
      mortgageBudgetNotice({ ...inconsistent, mortgageBudgetedMonthly: 12_119 })
    ).toBeNull()
  })

  it("stays quiet when there is no loan", () => {
    expect(mortgageBudgetNotice({ ...inconsistent, loans: [] })).toBeNull()
  })

  it("stays quiet about a banklån the housing line never paid for", () => {
    // A car loan is not a housing cost, so a budget with no realkredit section
    // is not inconsistent with holding one — it is what a renter with a car
    // looks like. Only the realkredit half of the list can fire this.
    expect(
      mortgageBudgetNotice({
        ...inconsistent,
        loans: [{ ...newPlannedLoan("bank", null), principal: 200_000 }],
      })
    ).toBeNull()
  })

  it("stays quiet when the loan costs nothing to hold", () => {
    // Interest-free, fee-free and afdragsfri for as long as the bound allows:
    // the projection charges one year of afdrag at the very end and nothing
    // before it, so the first year has nothing for the budget to have deducted.
    // A `principal` on its own is not evidence of a payment.
    expect(
      mortgageBudgetNotice({
        ...inconsistent,
        loans: [
          {
            ...theLoan,
            rate: 0,
            bidragssats: 0,
            interestOnlyYears: maxInterestOnlyYears(theLoan),
          },
        ],
      })
    ).toBeNull()
  })

  it("adds up two realkreditlån the one housing line paid for", () => {
    // The notice quotes what the budget is short by, and a household with two
    // realkreditlån is short the service on both — the budget has one housing
    // line and cannot say which loan it covered.
    const both = {
      ...inconsistent,
      loans: [theLoan, { ...theLoan, id: "l1", principal: 500_000 }],
    }
    expect(modelledMortgageMonthly(both)).toBeCloseTo(
      modelledMortgageMonthly(inconsistent) +
        modelledMortgageMonthly({
          ...inconsistent,
          loans: [{ ...theLoan, id: "l1", principal: 500_000 }],
        }),
      6
    )
    expect(mortgageBudgetNotice(both)!.subtitle).toContain(
      formatDKK(2_500_000)
    )
  })
})
