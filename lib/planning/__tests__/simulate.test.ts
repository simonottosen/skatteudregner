import { describe, it, expect } from "vitest"
import { simulatePlanning, solveRequiredMonthlyContribution } from "../simulate"
import {
  DEFAULT_PENSION_PERSON,
  DEFAULT_PLANNING_STATE,
  DEFAULT_TAX_PROFILE,
  type PlannedProperty,
  type PlanningResult,
  type PlanningState,
} from "../types"
import { amortizeYear } from "../amortisation"
// The budget's own quote, so the reconciliation tests below compare the
// simulation against what /budget really withholds rather than against a
// restatement of it.
import {
  DEFAULT_MORTGAGE,
  computeMortgage,
  mortgageMonthlyTotal,
  type MortgageState,
} from "@/lib/budget/mortgage"
import { applyScenario } from "../scenario"
import {
  ASSESSMENT_FACTOR,
  createPropertyPortfolioTax,
  grossUpStockSale,
  pensionIncomeTax,
  propertyHoldingTax,
  stockGainTax,
  type TaxContext,
} from "../taxation"
import { getMunicipality } from "@/lib/tax/municipalities"
import { getRates } from "@/lib/tax/rates"
import {
  afterPalReturn,
  annuityPayment,
  folkepensionAfterModregning,
} from "../pension"

// Income tax on a year's gross pension income, real terms (inflation 0 in the
// tests that use this), matching what the engine applies internally.
function pTax(gross: number, married = false, spouse?: number): number {
  const ctx: TaxContext = {
    t: 0,
    inflation: 0,
    profile: DEFAULT_TAX_PROFILE,
    married,
  }
  return pensionIncomeTax(gross, ctx, spouse)
}

/**
 * A year's loan service (principal repaid + interest + bidrag), from the loan
 * module and the definition of bidrag rather than restated from the simulation —
 * so the mortgage expectations below are independent figures and not a copy of
 * the implementation.
 */
function serviceOf(
  balance: number,
  rate: number,
  months: number,
  interestOnly = false,
  bidragssats = 0
): number {
  const y = amortizeYear(balance, rate, months, interestOnly)
  return balance - y.balance + y.interest + balance * bidragssats
}

let propertyIds = 0

/** A plan property with the fields these tests rarely care about filled in. */
function property(
  fields: Partial<PlannedProperty> & { value: number }
): PlannedProperty {
  return {
    id: `p${propertyIds++}`,
    label: "Bolig",
    kind: "helaarsbolig",
    landValue: 0,
    acquisitionAge: 0,
    disposalAge: null,
    ...fields,
  }
}

/**
 * The plan's own shape, plus a one-home shorthand.
 *
 * Most of these tests predate {@link PlanningState.properties} and describe a
 * household with a single owner-occupied home, which is a list of one entry.
 * Spelling that list out at every call site would bury the field each test is
 * actually about; the tests that are about the list pass `properties` instead.
 */
type StateOverrides = Partial<PlanningState> & {
  homeValue?: number
  landValue?: number
}

function makeState(overrides: StateOverrides = {}): PlanningState {
  const { homeValue, landValue = 0, ...rest } = overrides
  // The shorthand wins over a list spread in from another `makeState` call, so
  // that `makeState({ ...base, homeValue: X })` still says what it looks like.
  const properties =
    homeValue === undefined
      ? (rest.properties ?? DEFAULT_PLANNING_STATE.properties)
      : homeValue > 0
        ? [property({ value: homeValue, landValue })]
        : []
  return {
    ...DEFAULT_PLANNING_STATE,
    assumptions: {
      ...DEFAULT_PLANNING_STATE.assumptions,
      ...(rest.assumptions ?? {}),
    },
    ...rest,
    properties,
  }
}

describe("simulatePlanning", () => {
  it("returns one point per year inclusive of start and end", () => {
    const res = simulatePlanning(makeState({ currentAge: 30, endAge: 90 }))
    expect(res.points).toHaveLength(61)
    expect(res.points[0].age).toBe(30)
    expect(res.points.at(-1)!.age).toBe(90)
  })

  it("compounds investments with contributions and no volatility band spread", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 31,
        startInvestments: 100000,
        monthlyContribution: 0,
        homeValue: 0,
        mortgageBalance: 0,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0.05,
          investmentFee: 0,
          volatility: 0, // deterministic → band collapses to the median
        },
      })
    )
    // 100000 * 1.05 = 105000 after one year.
    expect(res.points[1].investments).toBeCloseTo(105000, 0)
    expect(res.points[1].band[0]).toBeCloseTo(105000, 0)
    expect(res.points[1].band[1]).toBeCloseTo(105000, 0)
  })

  it("grows the annual contribution each year", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 32,
        startInvestments: 0,
        monthlyContribution: 1000, // 12.000/yr
        homeValue: 0,
        mortgageBalance: 0,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          volatility: 0,
          contributionGrowth: 0.1,
        },
      })
    )
    // Year 1: 12.000. Year 2: 12.000 + 13.200 = 25.200.
    expect(res.points[1].investments).toBeCloseTo(12000, 0)
    expect(res.points[2].investments).toBeCloseTo(25200, 0)
  })

  it("includes home equity that grows and gains from mortgage paydown", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 41,
        startInvestments: 0,
        monthlyContribution: 0,
        homeValue: 2_000_000,
        mortgageBalance: 1_000_000,
        // This is a balance-sheet test: the household's budget pays the loan, so
        // the cash flow has nothing to charge and cannot borrow against the very
        // equity being measured.
        mortgageBudgetedMonthly:
          serviceOf(1_000_000, DEFAULT_PLANNING_STATE.mortgageRate, 30 * 12) /
          12,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          housingReturn: 0.02,
          volatility: 0,
        },
      })
    )
    // Equity start = 1.0M; after a year home +2% and mortgage shrinks → equity up.
    expect(res.points[0].homeEquity).toBeCloseTo(1_000_000, 0)
    expect(res.points[1].homeEquity).toBeGreaterThan(1_040_000)
    expect(res.points[1].netWorth).toBe(res.points[1].homeEquity)
  })

  it("applies a one-time expense at the right age", () => {
    const base = makeState({
      currentAge: 30,
      endAge: 35,
      startInvestments: 500000,
      monthlyContribution: 0,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0,
        investmentFee: 0,
        volatility: 0,
      },
    })
    const withExpense = simulatePlanning({
      ...base,
      events: [
        {
          id: "e1",
          type: "expense",
          label: "Bryllup",
          age: 32,
          amount: 200000,
        },
      ],
    })
    const at32 = withExpense.points.find((p) => p.age === 32)!
    expect(at32.investments).toBeCloseTo(300000, 0)
  })

  it("applies a windfall and a recurring contribution change", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 33,
        startInvestments: 0,
        monthlyContribution: 0,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          volatility: 0,
          contributionGrowth: 0,
        },
        events: [
          { id: "w1", type: "windfall", label: "Arv", age: 31, amount: 100000 },
          {
            id: "r1",
            type: "recurring",
            label: "Lønhop",
            age: 31,
            monthlyDelta: 5000,
          },
        ],
      })
    )
    // Age 31: +100k windfall, contribution still 0 that year → 100k.
    expect(res.points.find((p) => p.age === 31)!.investments).toBeCloseTo(
      100000,
      0
    )
    // Age 32: +60k/yr from the recurring change → 160k.
    expect(res.points.find((p) => p.age === 32)!.investments).toBeCloseTo(
      160000,
      0
    )
  })

  it("handles a property reallocation (sell + buy with mortgage)", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 41,
        startInvestments: 0,
        monthlyContribution: 0,
        homeValue: 2_000_000,
        mortgageBalance: 500_000, // equity = 1.5M
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          housingReturn: 0,
          volatility: 0,
        },
        events: [
          {
            id: "p1",
            type: "property",
            label: "Nyt hus",
            age: 40,
            newValue: 3_000_000,
            mortgageLtv: 0.8,
          },
        ],
      })
    )
    // At age 40: realise 1.5M equity, pay 20% down (600k) → investments = 0.9M.
    const at40 = res.points.find((p) => p.age === 40)!
    expect(at40.investments).toBeCloseTo(900_000, 0)
    expect(at40.homeEquity).toBeCloseTo(600_000, 0) // 3.0M - 2.4M mortgage
  })

  it("detects FI age when investments reach 25x annual spending", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 70,
        startInvestments: 1_000_000,
        monthlyContribution: 20000,
        homeValue: 0,
        mortgageBalance: 0,
        annualSpending: 300000, // FI target = 7.5M (25x)
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          inflation: 0,
          safeWithdrawalRate: 0.04,
        },
      })
    )
    expect(res.fiAge).not.toBeNull()
    const fiPoint = res.points.find((p) => p.age === res.fiAge)!
    expect(fiPoint.investments).toBeGreaterThanOrEqual(7_500_000)
  })

  it("stops monthly contributions at the retirement age", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 34,
        retirementAge: 32,
        startInvestments: 0,
        monthlyContribution: 1000, // 12.000/yr
        homeValue: 0,
        mortgageBalance: 0,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          volatility: 0,
          contributionGrowth: 0,
        },
      })
    )
    // Contributions at 31 only; from age 32 (retirement) onward they stop.
    expect(res.points.find((p) => p.age === 31)!.investments).toBeCloseTo(
      12000,
      0
    )
    expect(res.points.find((p) => p.age === 32)!.investments).toBeCloseTo(
      12000,
      0
    )
    expect(res.points.find((p) => p.age === 34)!.investments).toBeCloseTo(
      12000,
      0
    )
    expect(res.points.find((p) => p.age === 32)!.contributionYoY).toBe(0)
  })

  it("tracks growth sources (contributions, housing, investment gains)", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 41,
        retirementAge: 65,
        startInvestments: 100000,
        monthlyContribution: 1000, // 12.000/yr
        homeValue: 1_000_000,
        mortgageBalance: 0,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0.05,
          investmentFee: 0,
          housingReturn: 0.02,
          contributionGrowth: 0,
          volatility: 0,
        },
      })
    )
    const p = res.points.find((x) => x.age === 41)!
    expect(p.contributionYoY).toBeCloseTo(12000, 0)
    expect(p.investmentGainYoY).toBeCloseTo(5000, 0) // 100k * 5%
    expect(p.housingGainYoY).toBeCloseTo(20000, 0) // 1M * 2%
    expect(p.contributionsTotal).toBeCloseTo(12000, 0)
    expect(p.investmentGainsTotal).toBeCloseTo(5000, 0)
    expect(p.housingGainsTotal).toBeCloseTo(20000, 0)
  })

  it("pays out pension pots and folkepension as retirement income", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 64,
        endAge: 80,
        retirementAge: 64,
        startInvestments: 0,
        monthlyContribution: 0,
        annualSpending: 0,
        homeValue: 0,
        mortgageBalance: 0,
        assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, inflation: 0 },
        pension: {
          person1: {
            ratepensionBalance: 1_000_000,
            livrenteBalance: 0,
            aldersopsparingBalance: 0,
            ratepensionAnnual: 0,
            livrenteAnnual: 0,
            aldersopsparingAnnual: 0,
            folkepensionAge: 67,
          },
          person2: { ...DEFAULT_PENSION_PERSON },
          pensionReturn: 0,
          ratepensionYears: 10,
          single: true,
          includeFolkepension: true,
        },
      })
    )
    // Age 65: ratepension only (100k gross), net of personal income tax.
    expect(res.points.find((p) => p.age === 65)!.retirementIncome).toBeCloseTo(
      100000 - pTax(100000),
      0
    )
    // Age 67: ratepension + folkepension → higher net income than at 65.
    const at65 = res.points.find((p) => p.age === 65)!.retirementIncome
    const at67 = res.points.find((p) => p.age === 67)!.retirementIncome
    expect(at67).toBeGreaterThan(at65)
    expect(res.points.find((p) => p.age === 67)!.taxPaid).toBeGreaterThan(0)
  })

  it("amortizes the mortgage and reports the debt-free age", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 90,
        retirementAge: 65,
        startInvestments: 0,
        monthlyContribution: 0,
        homeValue: 3_000_000,
        mortgageBalance: 2_000_000,
        mortgageRate: 0.04,
        mortgageTermYears: 20,
        // Same reason as above: a budget that pays the loan keeps this about the
        // amortisation schedule and not about how the payment is funded.
        mortgageBudgetedMonthly: serviceOf(2_000_000, 0.04, 20 * 12) / 12,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          housingReturn: 0,
          volatility: 0,
        },
      })
    )
    // Debt-free 20 years after age 40.
    expect(res.debtFreeAge).toBe(60)
    // Mortgage gone → home equity equals the (flat) home value afterwards.
    const at60 = res.points.find((p) => p.age === 60)!
    expect(at60.homeEquity).toBeCloseTo(3_000_000, -4)
  })

  it("builds no equity while afdragsfrihed runs, then catches up", () => {
    // Home value is flat here, so equity moves only with the mortgage balance.
    // The contribution has to cover the step-up: a household that cannot pay it
    // borrows against the house instead, which cancels the extra afdrag out of
    // equity and is its own case below.
    const base = {
      currentAge: 40,
      endAge: 90,
      retirementAge: 65,
      startInvestments: 0,
      monthlyContribution: 20_000,
      homeValue: 3_000_000,
      mortgageBalance: 2_000_000,
      mortgageRate: 0.04,
      mortgageTermYears: 20,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        housingReturn: 0,
        volatility: 0,
      },
    }
    const plain = simulatePlanning(makeState(base))
    const io = simulatePlanning(
      makeState({ ...base, mortgageInterestOnlyYears: 5 })
    )
    const at = (r: typeof plain, age: number) =>
      r.points.find((p) => p.age === age)!

    // Nothing repaid for five years — equity sits at the starting 1 M.
    expect(at(io, 45).homeEquity).toBeCloseTo(1_000_000, 0)
    expect(at(io, 45).homeEquity).toBeLessThan(at(plain, 45).homeEquity)
    // Then the skipped principal is squeezed into the years left, so afdrag
    // (the whole housing gain at 0 % appreciation) steps up above the plain loan.
    expect(at(io, 45).housingGainYoY).toBeCloseTo(0, 0)
    expect(at(io, 46).housingGainYoY).toBeGreaterThan(
      at(plain, 46).housingGainYoY * 1.2
    )
    // The loan keeps its maturity, so it is still gone twenty years in.
    expect(io.debtFreeAge).toBe(60)
  })

  it("pushes the debt-free age out of reach when afdragsfrihed covers the term", () => {
    // Interest-only to maturity leaves nothing scheduled to repay the principal.
    // The household never retires inside the horizon, so the balance moves only
    // with the loan schedule — a retired one would have to borrow against the
    // house to keep paying the interest, which is its own case below.
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 90,
        retirementAge: 95,
        startInvestments: 0,
        monthlyContribution: 0,
        homeValue: 3_000_000,
        mortgageBalance: 2_000_000,
        mortgageRate: 0.04,
        mortgageTermYears: 20,
        mortgageInterestOnlyYears: 20,
        // The budget pays this loan's interest, so the balance moves with the
        // schedule alone. Leave it out and the household has no contribution to
        // charge the interest against, borrows it against the house instead,
        // and the balance climbs — a real behaviour, but a different test.
        mortgageBudgetedMonthly: serviceOf(2_000_000, 0.04, 20 * 12, true) / 12,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          housingReturn: 0,
          volatility: 0,
        },
      })
    )
    expect(res.debtFreeAge).toBeNull()
    expect(res.points.find((p) => p.age === 70)!.homeEquity).toBeCloseTo(
      1_000_000,
      0
    )
  })

  /**
   * `monthlyContribution` is the budget's surplus *after* the realkredit
   * payment (`lib/budget/state.ts`), so the simulation owes the household the
   * difference between that payment and the one it models — whenever the
   * modelled one moves, and in whichever direction.
   *
   * These run with a real contribution so the reconciliation has somewhere to
   * land: with `monthlyContribution: 0` the `Math.max(0, …)` floor swallows it,
   * which is how the step-up came to be modelled on the balance sheet but not
   * in the cash flow.
   */
  describe("the modelled payment is reconciled against the budget's", () => {
    const IO_YEARS = 5
    const service = (balance: number, months: number, interestOnly = false) =>
      serviceOf(balance, 0.04, months, interestOnly)
    const payment = service(2_000_000, 20 * 12) // level annuity, ~145.435/yr
    const ioService = service(2_000_000, 20 * 12, true) // balance stands still
    // Maturity is fixed: the term lost the afdragsfri years.
    const stepUp = service(2_000_000, (20 - IO_YEARS) * 12) - ioService

    // Every source of growth is off, so a krone of net worth can only come from
    // a krone the household actually put in.
    const base = {
      currentAge: 40,
      endAge: 70,
      retirementAge: 100, // never retires — contributions run the whole horizon
      startInvestments: 0,
      monthlyContribution: 10_000,
      homeValue: 3_000_000,
      mortgageBalance: 2_000_000,
      mortgageRate: 0.04,
      mortgageTermYears: 20,
      includePropertyTax: false,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0,
        investmentFee: 0,
        volatility: 0,
        inflation: 0,
        housingReturn: 0,
        contributionGrowth: 0,
      },
    }
    /**
     * A household whose budget really does pay this loan. The deduction is
     * *today's* payment — the interest-only one while afdragsfrihed runs — and
     * it is stated here rather than reconstructed from the loan, because the
     * budget is the only thing that knows what it withheld.
     */
    const withBudget = (mortgageInterestOnlyYears: number) => ({
      ...base,
      mortgageInterestOnlyYears,
      mortgageBudgetedMonthly:
        (mortgageInterestOnlyYears >= 1 ? ioService : payment) / 12,
    })
    const run = (mortgageInterestOnlyYears: number) =>
      simulatePlanning(makeState(withBudget(mortgageInterestOnlyYears)))
    const contribAt = (r: ReturnType<typeof run>, age: number) =>
      r.points.find((p) => p.age === age)!.contributionYoY

    it("leaves the contribution alone while a plain loan runs its term", () => {
      // A level annuity never differs from what the budget deducted, so there
      // is nothing to charge or hand back until the loan matures.
      const r = run(0)
      for (let age = 41; age <= 60; age++) {
        expect(contribAt(r, age)).toBeCloseTo(120_000, 6)
      }
    })

    it("re-invests the payment freed when the loan matures", () => {
      // Without this the household kept paying a lender it no longer owed
      // anything, forever: `contributionYoY` was flat across the debt-free age.
      const r = run(0)
      expect(payment).toBeGreaterThan(0)
      expect(r.debtFreeAge).toBe(60)
      expect(contribAt(r, 61)).toBeCloseTo(120_000 + payment, 6)
      expect(contribAt(r, 70)).toBeCloseTo(120_000 + payment, 6)
    })

    it("does not touch contributions while afdragsfrihed runs", () => {
      // The budget-derived contribution already nets off today's interest-only
      // payment, so nothing changes until the payment does.
      const r = run(IO_YEARS)
      for (let age = 41; age <= 45; age++) {
        expect(contribAt(r, age)).toBeCloseTo(120_000, 6)
      }
    })

    it("cuts the contribution by exactly the rise in the payment", () => {
      const r = run(IO_YEARS)
      expect(stepUp).toBeGreaterThan(0)
      expect(contribAt(r, 46)).toBeCloseTo(120_000 - stepUp, 6)
      // …and stays there for the rest of the shortened term.
      expect(contribAt(r, 59)).toBeCloseTo(120_000 - stepUp, 6)
    })

    it("hands back only what the budget deducted, not the last payment", () => {
      // An afdragsfri household budgeted for the interest-only payment, so that
      // is what maturity frees — the extra it paid after the cliff was already
      // coming out of the contribution. A repaid loan can also leave a
      // sub-krone residue; treating that as "still servicing" would hand back a
      // hundredth of a krone instead of the payment.
      const r = run(IO_YEARS)
      expect(r.debtFreeAge).toBe(60)
      expect(contribAt(r, 61)).toBeCloseTo(120_000 + ioService, 6)
      expect(contribAt(r, 70)).toBeCloseTo(120_000 + ioService, 6)
    })

    it("no longer hands over equity nobody paid for", () => {
      // With nothing growing, terminal wealth is the house plus what was paid
      // in. Before the step-up was charged the household reached the same
      // debt-free age on an unreduced contribution, ending ~1,46 mio. richer
      // for free.
      const r = run(IO_YEARS)
      const paidIn = r.points.reduce((t, p) => t + p.contributionYoY, 0)
      expect(r.points.find((p) => p.age === 60)!.netWorth).toBeCloseTo(
        3_000_000 + 120_000 * IO_YEARS + (120_000 - stepUp) * (20 - IO_YEARS),
        0
      )
      expect(r.points.at(-1)!.netWorth).toBeCloseTo(3_000_000 + paidIn, 0)
      expect(r.points.at(-1)!.netWorth).toBeLessThan(
        run(0).points.at(-1)!.netWorth
      )
    })

    it("charges the step-up against assets when it lands after retiring", () => {
      // Retired at 44, cliff at 46: there is no contribution left to reduce, so
      // the payment has to come out of the portfolio instead of being ignored.
      // Ages 45 and 46 are both retired years, one either side of the cliff, so
      // the difference between their drawdowns isolates the step-up.
      const r = simulatePlanning(
        makeState({
          ...withBudget(IO_YEARS),
          retirementAge: 44,
          startInvestments: 5_000_000, // deep enough never to run dry
          annualSpending: 100_000,
        })
      )
      const inv = (age: number) =>
        r.points.find((p) => p.age === age)!.investments
      const drawdownBefore = inv(44) - inv(45)
      const drawdownAtCliff = inv(45) - inv(46)
      expect(drawdownAtCliff - drawdownBefore).toBeCloseTo(stepUp, 6)
    })

    describe("a property event re-prices the payment", () => {
      // A bigger contribution than above, so the larger payment still fits
      // inside it and the whole reconciliation stays visible in the deposit.
      const move = (mortgageLtv: number) =>
        simulatePlanning(
          makeState({
            ...withBudget(0),
            monthlyContribution: 30_000, // 360.000/yr
            events: [
              {
                id: "p1",
                type: "property",
                label: "Nyt hus",
                age: 45,
                newValue: 5_000_000,
                mortgageLtv,
              },
            ],
          })
        )
      // The event's own loan: 30 years, per MORTGAGE_TERM_MONTHS in simulate.ts.
      const newPayment = service(5_000_000 * 0.8, 30 * 12)

      it("keeps the old payment as the baseline after the loan is swapped", () => {
        // The budget was measured once, today, and never learns about the new
        // loan — so the household owes the difference between the two, not
        // nothing (which would make any move free) and not the whole new
        // payment (which would charge the old one twice).
        const r = move(0.8)
        expect(newPayment).toBeGreaterThan(payment)
        expect(contribAt(r, 45)).toBeCloseTo(360_000, 6)
        expect(contribAt(r, 46)).toBeCloseTo(360_000 + payment - newPayment, 6)
        expect(contribAt(r, 70)).toBeCloseTo(360_000 + payment - newPayment, 6)
      })

      it("frees the whole payment when the new home is bought outright", () => {
        const r = move(0)
        expect(contribAt(r, 46)).toBeCloseTo(360_000 + payment, 6)
      })

      /**
       * Selling the mortgaged home settles that loan out of the proceeds, so the
       * household is billed nothing from the sale onwards — but only for *that*
       * loan. Moving into a new home afterwards is a new debt, and the schedule
       * has to start billing again. Getting this wrong gives the household a
       * free house: it lives in a 5.000.000 kr. home financed at 80 % and never
       * pays a krone of service on it.
       */
      it("bills the loan a move takes out after the old one was repaid", () => {
        const r = simulatePlanning(
          makeState({
            ...withBudget(0),
            monthlyContribution: 30_000,
            // The same home as `base`, but with a disposal — spelled as a list
            // because `makeState`'s `homeValue` shorthand would otherwise win.
            homeValue: undefined,
            properties: [property({ value: 3_000_000, disposalAge: 45 })],
            events: [
              {
                id: "p1",
                type: "property",
                label: "Nyt hus",
                age: 50,
                newValue: 5_000_000,
                mortgageLtv: 0.8,
              },
            ],
          })
        )
        // Sold at 45 and not yet re-bought: no loan to service, and the budget
        // hands its whole deduction back.
        expect(contribAt(r, 47)).toBeCloseTo(360_000 + payment, 6)
        // Bought again at 50, so the new loan is charged from the year after.
        expect(contribAt(r, 51)).toBeCloseTo(360_000 + payment - newPayment, 6)
        expect(contribAt(r, 60)).toBeCloseTo(360_000 + payment - newPayment, 6)
      })
    })
  })

  /**
   * The hand-back is a reading of the *budget* (`mortgageBudgetedMonthly`),
   * never of the modelled loan. Reconstructing it from the loan — principal +
   * interest on the plan's own balance — is right only for the household whose
   * budget happens to pay exactly that loan, exactly that way. These are the
   * three households for which it is wrong.
   */
  describe("the hand-back comes from the budget, not from the loan", () => {
    const base = {
      currentAge: 40,
      endAge: 70,
      retirementAge: 100, // never retires — contributions run the whole horizon
      startInvestments: 0,
      monthlyContribution: 10_000, // 120.000/yr
      homeValue: 3_000_000,
      mortgageRate: 0.04,
      mortgageTermYears: 20,
      includePropertyTax: false,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0,
        investmentFee: 0,
        volatility: 0,
        inflation: 0,
        housingReturn: 0,
        contributionGrowth: 0,
      },
    }
    const contribAt = (r: PlanningResult, age: number) =>
      r.points.find((p) => p.age === age)!.contributionYoY

    it("charges the whole payment when the budget deducted nothing", () => {
      // The budget's realkredit module is off by default, so it withholds 0 —
      // yet `usePlanning` still infers a balance from the interest on /skat.
      // Reconstructing the hand-back from that balance handed this household
      // ~145.435 kr./yr it never earned, and went on handing it over after
      // maturity, when even the modelled loan cost nothing.
      const payment = serviceOf(2_000_000, 0.04, 20 * 12)
      const r = simulatePlanning(
        makeState({
          ...base,
          // Big enough that the whole payment fits inside it; at 10.000/md. the
          // `Math.max(0, …)` floor would hide the size of the charge.
          monthlyContribution: 20_000, // 240.000/yr
          mortgageBalance: 2_000_000,
          mortgageBudgetedMonthly: 0,
        })
      )
      expect(payment).toBeGreaterThan(0)
      expect(contribAt(r, 41)).toBeCloseTo(240_000 - payment, 6)
      expect(r.debtFreeAge).toBe(60)
      // Maturity returns the contribution to its full size and no further: a
      // budget that deducted nothing has nothing to give back.
      expect(contribAt(r, 61)).toBeCloseTo(240_000, 6)
      expect(contribAt(r, 70)).toBeCloseTo(240_000, 6)
    })

    it("reconciles to zero against the budget's own bidrag-inclusive payment", () => {
      // The budget quotes interest + bidrag + afdrag (`mortgageMonthlyTotal`).
      // The modelled service has to be the same quantity or the difference is
      // banked as saving every year — a fee-sized version of the bug above.
      const m: MortgageState = {
        ...DEFAULT_MORTGAGE,
        enabled: true,
        homeValue: 2_500_000,
        ltv: 0.8, // a 2 mio. loan
        interestRate: 0.04,
        remainingYears: 20,
        bidragssats: 0.006,
      }
      const quoted = computeMortgage(m)
      expect(quoted.loan).toBe(2_000_000)
      expect(quoted.monthlyBidrag * 12).toBeCloseTo(12_000, 6)

      const r = simulatePlanning(
        makeState({
          ...base,
          mortgageBalance: quoted.loan,
          mortgageBidragssats: m.bidragssats,
          mortgageBudgetedMonthly: mortgageMonthlyTotal(m),
        })
      )
      // Year one: the plan's loan *is* the budget's loan, so the two payments
      // cancel and the contribution passes through untouched.
      expect(contribAt(r, 41)).toBeCloseTo(120_000, 6)
      // Maturity frees the whole quoted payment, bidrag included. Omitting
      // bidrag from the schedule would strand those 12.000 kr./yr with the
      // lender forever, which is the second half of the same mistake.
      const freed = serviceOf(2_000_000, 0.04, 20 * 12, false, m.bidragssats)
      expect(freed).toBeCloseTo(mortgageMonthlyTotal(m) * 12, 6)
      expect(contribAt(r, 61)).toBeCloseTo(120_000 + freed, 6)
      expect(freed - serviceOf(2_000_000, 0.04, 20 * 12)).toBeCloseTo(12_000, 6)
    })

    it("charges the afdrag a budget on afdragsfrihed never paid", () => {
      // The budget's `interestOnly` flag and the plan's
      // `mortgageInterestOnlyYears` are separate inputs, so they can disagree:
      // here the household pays interest + bidrag only, while the plan
      // amortizes from year one. The gap is the afdrag, and it has to be
      // charged — the plan cannot repay principal out of money nobody paid.
      const m: MortgageState = {
        ...DEFAULT_MORTGAGE,
        enabled: true,
        homeValue: 2_500_000,
        ltv: 0.8,
        interestRate: 0.04,
        remainingYears: 20,
        bidragssats: 0.006,
        interestOnly: true, // the budget's household repays nothing
      }
      const budgeted = mortgageMonthlyTotal(m) * 12
      const modelled = serviceOf(2_000_000, 0.04, 20 * 12, false, m.bidragssats)
      const afdrag = modelled - budgeted
      expect(afdrag).toBeGreaterThan(0)

      const r = simulatePlanning(
        makeState({
          ...base,
          mortgageBalance: 2_000_000,
          mortgageBidragssats: m.bidragssats,
          mortgageBudgetedMonthly: mortgageMonthlyTotal(m),
          // The plan disagrees with the budget: no afdragsfrihed here.
          mortgageInterestOnlyYears: 0,
        })
      )
      expect(contribAt(r, 41)).toBeCloseTo(120_000 - afdrag, 6)
      // The krone is not lost, only moved: the home value is flat, so what
      // leaves the saving arrives as equity. The two differ by ~1.200 kr. and
      // not by zero, because the budget quotes interest flat on the opening
      // balance while the schedule accrues it on a declining one — the plan is
      // charged the difference between two real payments, not a rounded one.
      const equityAt = (age: number) =>
        r.points.find((p) => p.age === age)!.homeEquity
      const year1 = amortizeYear(2_000_000, 0.04, 20 * 12, false)
      const repaid = 2_000_000 - year1.balance
      expect(equityAt(41) - equityAt(40)).toBeCloseTo(repaid, 6)
      expect(repaid - afdrag).toBeCloseTo(2_000_000 * 0.04 - year1.interest, 6)
    })
  })

  it("services the mortgage out of the drawdown after retiring", () => {
    // `annualSpending` is the budget's expense total, which excludes the
    // realkredit payment (`lib/budget/state.ts`) — so unlike the contribution
    // it has nothing netted out to hand back, and the retired household has to
    // find the whole payment. Zeroed growth and no pension income, so the
    // drawdown is exactly the year's outflow.
    const res = simulatePlanning(
      makeState({
        currentAge: 55,
        endAge: 70,
        retirementAge: 55,
        startInvestments: 10_000_000, // deep enough never to run dry
        monthlyContribution: 0,
        annualSpending: 100_000,
        homeValue: 3_000_000,
        mortgageBalance: 2_000_000,
        mortgageRate: 0.04,
        mortgageTermYears: 5,
        includePropertyTax: false,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          volatility: 0,
          inflation: 0,
          housingReturn: 0,
        },
        pension: {
          ...DEFAULT_PLANNING_STATE.pension,
          includeFolkepension: false,
        },
      })
    )
    const payment = serviceOf(2_000_000, 0.04, 5 * 12)
    const sold = (age: number) =>
      res.points.find((p) => p.age === age)!.investmentsSold

    expect(payment).toBeGreaterThan(0)
    // While the loan lives, the drawdown covers forbrug *and* the payment.
    expect(sold(56)).toBeCloseTo(100_000 + payment, 6)
    expect(sold(60)).toBeCloseTo(100_000 + payment, 6)
    // It matures at 60, and the drawdown drops back to forbrug alone.
    expect(res.debtFreeAge).toBe(60)
    expect(sold(61)).toBeCloseTo(100_000, 6)
    // The house was never mortgaged to pay for any of it.
    expect(res.points.at(-1)!.homeEquity).toBeCloseTo(3_000_000, 6)
  })

  it("survives a scenario shortening the term below the afdragsfri period", () => {
    // `applyScenario` spreads overrides straight onto the state without going
    // back through `normalizePlanning`, and `mortgageInterestOnlyYears` is not
    // itself overridable — so a scenario that shortens the term is the one way
    // an afdragsfri period can outlast the loan it belongs to. No clamp is
    // needed at the point of use: past maturity `amortizeYear` charges interest
    // only regardless, so the extra afdragsfri years ask for what already
    // happens. This pins that, since the obvious "fix" is a clamp no test can
    // tell apart from its absence.
    const base = makeState({
      currentAge: 40,
      endAge: 90,
      retirementAge: 65,
      startInvestments: 0,
      monthlyContribution: 30_000,
      homeValue: 3_000_000,
      mortgageBalance: 2_000_000,
      mortgageRate: 0.04,
      mortgageTermYears: 30,
      mortgageInterestOnlyYears: 25,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        housingReturn: 0,
        volatility: 0,
      },
    })
    const res = simulatePlanning(
      applyScenario(base, { overrides: { mortgageTermYears: 10 } })
    )
    // Interest-only for the whole (shortened) term leaves the principal
    // untouched: still 2 M owed when the loan matures at 50 and ever after.
    expect(res.debtFreeAge).toBeNull()
    expect(res.points.find((p) => p.age === 50)!.homeEquity).toBeCloseTo(
      1_000_000,
      0
    )
    expect(res.points.find((p) => p.age === 60)!.homeEquity).toBeCloseTo(
      1_000_000,
      0
    )
  })

  it("reports no debt-free age when there is no mortgage", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 60,
        homeValue: 0,
        mortgageBalance: 0,
      })
    )
    expect(res.debtFreeAge).toBeNull()
  })

  it("sums pension income across both partners when a couple", () => {
    const person = {
      ratepensionBalance: 1_000_000,
      livrenteBalance: 0,
      aldersopsparingBalance: 0,
      ratepensionAnnual: 0,
      livrenteAnnual: 0,
      aldersopsparingAnnual: 0,
      folkepensionAge: 67,
    }
    const base = {
      currentAge: 64,
      endAge: 70,
      retirementAge: 64,
      startInvestments: 0,
      monthlyContribution: 0,
      annualSpending: 0,
      homeValue: 0,
      mortgageBalance: 0,
      assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, inflation: 0 },
    }
    const single = simulatePlanning(
      makeState({
        ...base,
        pension: {
          person1: { ...person },
          person2: { ...DEFAULT_PENSION_PERSON },
          pensionReturn: 0,
          ratepensionYears: 10,
          single: true,
          includeFolkepension: false,
        },
      })
    )
    const couple = simulatePlanning(
      makeState({
        ...base,
        pension: {
          person1: { ...person },
          person2: { ...person },
          pensionReturn: 0,
          ratepensionYears: 10,
          single: false,
          includeFolkepension: false,
        },
      })
    )
    const at65 = (r: typeof single) =>
      r.points.find((p) => p.age === 65)!.retirementIncome
    // Net of income tax; the couple has two ratepensions, each taxed alone
    // (100k is well below any threshold, so the married transfer is a no-op).
    expect(at65(single)).toBeCloseTo(100000 - pTax(100000), 0)
    expect(at65(couple)).toBeCloseTo(
      2 * (100000 - pTax(100000, true, 100000)),
      0
    )
  })

  it("spends from investments then borrows against home, only after retirement", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 60,
        endAge: 75,
        retirementAge: 65,
        startInvestments: 1_000_000,
        monthlyContribution: 0,
        annualSpending: 600_000,
        homeValue: 5_000_000,
        mortgageBalance: 0,
        mortgageTermYears: 1, // already paid off
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          housingReturn: 0,
          inflation: 0,
          volatility: 0,
        },
      })
    )
    // Before retirement spending is covered by salary → investments untouched.
    expect(res.points.find((p) => p.age === 64)!.investments).toBeCloseTo(
      1_000_000,
      0
    )
    // After retirement the 1.0M is drawn down within ~2 years…
    expect(res.points.find((p) => p.age === 67)!.investments).toBe(0)
    // …then spending is funded by borrowing against the home (equity falls).
    const at75 = res.points.find((p) => p.age === 75)!
    expect(at75.homeEquity).toBeLessThan(5_000_000)
    expect(at75.homeEquity).toBeGreaterThanOrEqual(0)
  })

  it("taxes realised investment gains during the retirement drawdown", () => {
    const common = {
      currentAge: 64,
      endAge: 66,
      retirementAge: 65,
      startInvestments: 2_000_000,
      monthlyContribution: 0,
      annualSpending: 200_000,
      homeValue: 0,
      mortgageBalance: 0,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0,
        investmentFee: 0,
        housingReturn: 0,
        inflation: 0,
        volatility: 0,
      },
    }
    // No embedded gains (basis == value) → no investment tax on the drawdown.
    const noGain = simulatePlanning(makeState({ ...common }))
    expect(noGain.points.find((p) => p.age === 65)!.taxPaid).toBeCloseTo(0, 0)

    // A pot that has grown a lot → the drawdown realises gains that get taxed.
    const withGain = simulatePlanning(
      makeState({
        ...common,
        startInvestments: 1_000_000,
        assumptions: {
          ...common.assumptions,
          investmentReturn: 1.0, // doubles in year 1 → large unrealised gain
        },
      })
    )
    expect(withGain.points.find((p) => p.age === 65)!.taxPaid).toBeGreaterThan(
      0
    )
  })

  it("pays aldersopsparing as a tax-free lump at the folkepension age", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 66,
        endAge: 75,
        retirementAge: 66,
        startInvestments: 0,
        monthlyContribution: 0,
        annualSpending: 0,
        homeValue: 0,
        mortgageBalance: 0,
        pension: {
          person1: {
            ...DEFAULT_PENSION_PERSON,
            aldersopsparingBalance: 500_000,
            folkepensionAge: 68,
          },
          person2: { ...DEFAULT_PENSION_PERSON },
          pensionReturn: 0,
          ratepensionYears: 10,
          single: true,
          includeFolkepension: false, // isolate aldersopsparing
        },
      })
    )
    // Lump lands the year folkepension starts (age 68), tax-free → no taxPaid.
    const at68 = res.points.find((p) => p.age === 68)!
    expect(at68.retirementIncome).toBeCloseTo(500_000, 0)
    expect(at68.taxPaid).toBeCloseTo(0, 0)
    // Not paid out in other years.
    expect(res.points.find((p) => p.age === 67)!.retirementIncome).toBeCloseTo(
      0,
      0
    )
    expect(res.points.find((p) => p.age === 69)!.retirementIncome).toBeCloseTo(
      0,
      0
    )
  })

  it("reports per-year spending, investments sold and equity borrowed", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 64,
        endAge: 70,
        retirementAge: 65,
        startInvestments: 150_000,
        monthlyContribution: 0,
        annualSpending: 100_000,
        homeValue: 5_000_000,
        mortgageBalance: 0,
        mortgageTermYears: 1, // already paid off
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          housingReturn: 0,
          inflation: 0,
          volatility: 0,
        },
      })
    )
    // Before retirement: spending paid by salary, nothing drawn.
    const at64 = res.points.find((p) => p.age === 64)!
    expect(at64.spending).toBeCloseTo(0, 0)
    expect(at64.investmentsSold).toBeCloseTo(0, 0)
    // Age 65: first 100k comes out of the 150k pot (no embedded gains → no tax).
    const at65 = res.points.find((p) => p.age === 65)!
    expect(at65.spending).toBeCloseTo(100_000, 0)
    expect(at65.investmentsSold).toBeCloseTo(100_000, 0)
    expect(at65.borrowed).toBeCloseTo(0, 0)
    // Age 66: 50k left in the pot, the remaining 50k is borrowed against the home.
    const at66 = res.points.find((p) => p.age === 66)!
    expect(at66.investmentsSold).toBeCloseTo(50_000, 0)
    expect(at66.borrowed).toBeCloseTo(50_000, 0)
  })

  it("funds spending from a large pot without borrowing, even with gains tax", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 64,
        endAge: 80,
        retirementAge: 65,
        startInvestments: 1_000_000,
        monthlyContribution: 0,
        annualSpending: 300_000,
        homeValue: 5_000_000,
        mortgageBalance: 0,
        mortgageTermYears: 1,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0.5, // big embedded gains → high gains-tax bracket
          investmentFee: 0,
          housingReturn: 0,
          inflation: 0,
          volatility: 0,
        },
      })
    )
    // The pot grows faster than it is drawn, so the home is never tapped and
    // its equity holds steady — no spurious borrowing from the tax gross-up.
    for (const p of res.points) {
      expect(p.borrowed).toBeCloseTo(0, 0)
      expect(p.homeEquity).toBeCloseTo(5_000_000, -2)
    }
  })

  it("repays equity borrowed for spending before topping up investments", () => {
    const rate = 0.04
    const res = simulatePlanning(
      makeState({
        currentAge: 65,
        endAge: 75,
        retirementAge: 65,
        startInvestments: 0,
        monthlyContribution: 0,
        annualSpending: 100_000,
        homeValue: 5_000_000,
        mortgageBalance: 0,
        mortgageRate: rate,
        mortgageTermYears: 1, // already paid off
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          housingReturn: 0,
          inflation: 0,
          volatility: 0,
        },
        pension: {
          person1: {
            ...DEFAULT_PENSION_PERSON,
            aldersopsparingBalance: 500_000, // tax-free lump at folkepension age
            folkepensionAge: 68,
          },
          person2: { ...DEFAULT_PENSION_PERSON },
          pensionReturn: 0,
          ratepensionYears: 10,
          single: true,
          includeFolkepension: false, // isolate the aldersopsparing lump
        },
      })
    )
    // Ages 66–67: no pension income, so the household borrows its 100k of
    // spending — and from 67 the interest on what it borrowed the year before.
    expect(res.points.find((p) => p.age === 66)!.borrowed).toBeCloseTo(
      100_000,
      6
    )
    const at67 = res.points.find((p) => p.age === 67)!
    expect(at67.borrowed).toBeCloseTo(100_000 * (1 + rate), 6)
    const owed = 100_000 * (2 + rate)
    expect(at67.homeEquity).toBeCloseTo(5_000_000 - owed, 6)
    // Age 68: the 500k lump covers the year's spending and the interest on the
    // balance, and the remainder repays the borrowing in full — restoring the
    // equity — before a krone of it is invested.
    const at68 = res.points.find((p) => p.age === 68)!
    expect(at68.homeEquity).toBeCloseTo(5_000_000, 6)
    expect(at68.investments).toBeCloseTo(
      500_000 - 100_000 - owed * rate - owed,
      6
    )
  })

  /**
   * Equity drawn to fund spending is a second balance, apart from the scheduled
   * loan: it accrues interest and nothing ever amortises it. Before that split
   * the borrowing landed on the mortgage, where the year's `amortizeYear` repaid
   * principal out of it — while the household was charged a schedule derived
   * from the plan's inputs, which never sees the borrowing. It therefore paid
   * neither the interest nor the afdrag.
   */
  describe("equity borrowed to fund spending", () => {
    // Issue #28's reproduction: a retired household with no income and no pot,
    // so every krone of spending is borrowed against the house.
    const repro = (mortgageRate: number) =>
      makeState({
        currentAge: 65,
        endAge: 70,
        retirementAge: 65,
        startInvestments: 0,
        cashBuffer: 0,
        monthlyContribution: 0,
        annualSpending: 100_000,
        homeValue: 5_000_000,
        mortgageBalance: 0,
        mortgageRate,
        mortgageTermYears: 30,
        includePropertyTax: false,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          volatility: 0,
          housingVolatility: 0,
          inflation: 0,
          housingReturn: 0,
        },
        pension: {
          ...DEFAULT_PLANNING_STATE.pension,
          includeFolkepension: false,
        },
      })

    it("costs the household its equity krone for krone", () => {
      // Interest-free borrowing, so the only thing that can move equity is the
      // spending. It used to fall by 100.000, then 98.134, 96.080, 93.819 and
      // 91.335 — ending at 4.535.761 instead of 4.500.000, the household 35.761
      // kr. richer for nothing.
      const res = simulatePlanning(repro(0))
      const equity = res.points.map((p) => p.homeEquity)
      for (let y = 1; y < equity.length; y++) {
        expect(equity[y - 1] - equity[y]).toBeCloseTo(100_000, 6)
      }
      expect(equity.at(-1)).toBeCloseTo(4_500_000, 6)
    })

    it("charges interest on what it has already borrowed", () => {
      // The issue's own figures: at 4 % the projection ended at 4.520.632, which
      // is 20.632 kr. of equity nobody paid for *and* five years of interest
      // nobody was billed. The balance is now the future value of a 100.000
      // kr./yr ordinary annuity — geometric growth of the interest alone.
      const rate = 0.04
      const res = simulatePlanning(repro(rate))
      const owed = 100_000 * ((Math.pow(1 + rate, 5) - 1) / rate)
      expect(owed).toBeCloseTo(541_632.26, 2)
      expect(res.points.at(-1)!.homeEquity).toBeCloseTo(5_000_000 - owed, 6)
      // Each year's borrowing is the spending plus interest on the opening
      // balance — and nothing else. Charging the balance a full annuity service
      // instead is what made `borrowed` run away from 97.525 to 1.873.929 kr.
      // when this was tried in #21.
      const borrowed = res.points.map((p) => p.borrowed)
      for (let y = 1; y < borrowed.length; y++) {
        expect(borrowed[y]).toBeCloseTo(100_000 * Math.pow(1 + rate, y - 1), 6)
      }
    })

    it("leaves the scheduled loan's own amortisation untouched", () => {
      // The two balances have to stay apart in both directions: the borrowing
      // must not be amortised, and the scheduled loan must amortise exactly as
      // it would have if the household had never borrowed. Rebuilt here from
      // `amortizeYear` and the definition of a year's service, so the
      // expectation is an independent figure rather than a restatement.
      const rate = 0.04
      const term = 20
      const res = simulatePlanning(
        makeState({
          ...repro(rate),
          homeValue: 3_000_000,
          mortgageBalance: 2_000_000,
          mortgageTermYears: term,
        })
      )
      let scheduled = 2_000_000
      let borrowed = 0
      for (let y = 1; y <= 5; y++) {
        const step = amortizeYear(scheduled, rate, (term - y + 1) * 12)
        const service = scheduled - step.balance + step.interest
        borrowed += borrowed * rate + 100_000 + service
        scheduled = step.balance
      }
      expect(scheduled).toBeLessThan(2_000_000) // it really did amortise
      expect(res.points.at(-1)!.homeEquity).toBeCloseTo(
        3_000_000 - scheduled - borrowed,
        6
      )
    })

    it("settles the borrowing when the house is sold", () => {
      // A move pays off every claim on the old home, so what the household
      // takes with it is the net equity — not a loan that follows it.
      const res = simulatePlanning(
        makeState({
          ...repro(0),
          endAge: 69,
          events: [
            {
              id: "p1",
              type: "property",
              label: "Nyt hus",
              age: 67,
              newValue: 2_000_000,
              mortgageLtv: 0,
            },
          ],
        })
      )
      // Borrowed 100k at 66 and 67 → 4.8M of equity realised on the move, of
      // which 2M buys the new home outright and 2.8M lands in the portfolio.
      const at67 = res.points.find((p) => p.age === 67)!
      expect(at67.homeEquity).toBeCloseTo(2_000_000, 6)
      expect(at67.investments).toBeCloseTo(2_800_000, 6)
      // …and the debt is gone: the next year's spending comes out of the pot.
      const at68 = res.points.find((p) => p.age === 68)!
      expect(at68.borrowed).toBe(0)
      expect(at68.homeEquity).toBeCloseTo(2_000_000, 6)
    })
  })

  it("grows pension pots net of PAL-skat (15,3 %)", () => {
    expect(afterPalReturn(0.1)).toBeCloseTo(0.0847, 6)
    expect(afterPalReturn(-0.05)).toBe(-0.05) // losses aren't PAL-taxed here
    const res = simulatePlanning(
      makeState({
        currentAge: 64,
        endAge: 66,
        retirementAge: 65,
        startInvestments: 0,
        monthlyContribution: 0,
        annualSpending: 0,
        homeValue: 0,
        mortgageBalance: 0,
        assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, inflation: 0 },
        pension: {
          person1: {
            ...DEFAULT_PENSION_PERSON,
            ratepensionBalance: 1_000_000,
            folkepensionAge: 68, // → private payout starts at 65
          },
          person2: { ...DEFAULT_PENSION_PERSON },
          pensionReturn: 0.1,
          ratepensionYears: 1, // pays the whole (grown) pot in year one
          single: true,
          includeFolkepension: false,
        },
      })
    )
    // The pot earns 10 % gross → 8,47 % after PAL before the lump payout at 65.
    const gross = 1_000_000 * (1 + afterPalReturn(0.1))
    expect(res.points.find((p) => p.age === 65)!.retirementIncome).toBeCloseTo(
      gross - pTax(gross),
      0
    )
  })

  it("flags ruin and a low success probability for an unsustainable plan", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 65,
        endAge: 90,
        retirementAge: 65,
        startInvestments: 100_000,
        monthlyContribution: 0,
        annualSpending: 1_000_000, // dwarfs every resource
        homeValue: 500_000,
        mortgageBalance: 0,
        mortgageTermYears: 1,
        assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, inflation: 0 },
      })
    )
    expect(res.ruinAge).not.toBeNull()
    expect(res.ruinAge!).toBeLessThan(90)
    expect(res.successProbability).toBe(0)
  })

  it("reports full success and no ruin for a comfortable plan", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 65,
        endAge: 90,
        retirementAge: 65,
        startInvestments: 20_000_000,
        monthlyContribution: 0,
        annualSpending: 200_000,
        homeValue: 0,
        mortgageBalance: 0,
        assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, inflation: 0 },
      })
    )
    expect(res.ruinAge).toBeNull()
    expect(res.successProbability).toBe(1)
  })

  it("taxes investments annually under lager/ASK, but not under realisation", () => {
    const common = {
      currentAge: 40,
      endAge: 50,
      retirementAge: 65,
      startInvestments: 1_000_000,
      monthlyContribution: 0,
      annualSpending: 0,
      homeValue: 0,
      mortgageBalance: 0,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0.1,
        investmentFee: 0,
        inflation: 0,
        volatility: 0,
      },
    }
    const at50 = (mode: PlanningState["investmentTaxMode"]) =>
      simulatePlanning(
        makeState({ ...common, investmentTaxMode: mode })
      ).points.find((p) => p.age === 50)!.investments
    const realisation = at50("realisation")
    const ask = at50("ask")
    const lager = at50("lager")
    // Realisation grows untaxed; ASK is taxed 17 %/yr; lager 27/42 %/yr.
    expect(realisation).toBeCloseTo(1_000_000 * 1.1 ** 10, -2)
    expect(realisation).toBeGreaterThan(ask)
    expect(ask).toBeGreaterThan(lager)
  })

  it("spends the cash buffer before selling investments in retirement", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 64,
        endAge: 70,
        retirementAge: 65,
        startInvestments: 1_000_000,
        cashBuffer: 500_000,
        monthlyContribution: 0,
        annualSpending: 300_000,
        homeValue: 0,
        mortgageBalance: 0,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          inflation: 0,
          volatility: 0,
        },
        pension: {
          ...DEFAULT_PLANNING_STATE.pension,
          includeFolkepension: false,
        },
      })
    )
    // Age 65: the 300k need comes entirely out of cash → nothing sold.
    const at65 = res.points.find((p) => p.age === 65)!
    expect(at65.cash).toBeCloseTo(200_000, 0)
    expect(at65.investmentsSold).toBeCloseTo(0, 0)
    expect(at65.investments).toBeCloseTo(1_000_000, 0)
    // Age 66: 200k cash left covers part, the remaining 100k is sold.
    const at66 = res.points.find((p) => p.age === 66)!
    expect(at66.cash).toBeCloseTo(0, 0)
    expect(at66.investmentsSold).toBeCloseTo(100_000, 0)
  })

  it("amortizes other debt and subtracts it from net worth", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 45,
        retirementAge: 65,
        startInvestments: 0,
        monthlyContribution: 0,
        annualSpending: 0,
        homeValue: 0,
        mortgageBalance: 0,
        otherDebtBalance: 200_000,
        otherDebtRate: 0,
        otherDebtTermYears: 10,
        assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, volatility: 0 },
      })
    )
    expect(res.points[0].otherDebt).toBeCloseTo(200_000, 0)
    expect(res.points[0].netWorth).toBeCloseTo(-200_000, 0)
    // 200k over 10 years at 0 % → 20k/yr; after 5 years 100k remains.
    const at45 = res.points.find((p) => p.age === 45)!
    expect(at45.otherDebt).toBeCloseTo(100_000, 0)
    expect(at45.netWorth).toBeCloseTo(-100_000, 0)
  })

  it("funds other-debt service from the drawdown in retirement", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 64,
        endAge: 66,
        retirementAge: 65,
        startInvestments: 1_000_000,
        monthlyContribution: 0,
        annualSpending: 0,
        homeValue: 0,
        mortgageBalance: 0,
        otherDebtBalance: 100_000,
        otherDebtRate: 0,
        otherDebtTermYears: 10, // still being paid off at 65
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          inflation: 0,
          volatility: 0,
        },
        pension: {
          ...DEFAULT_PLANNING_STATE.pension,
          includeFolkepension: false,
        },
      })
    )
    // Age 65: 10k/yr debt service is funded by selling investments.
    const at65 = res.points.find((p) => p.age === 65)!
    expect(at65.investmentsSold).toBeCloseTo(10_000, 0)
    expect(at65.otherDebt).toBeCloseTo(90_000, 0)
  })

  it("models property tax in retirement only when enabled", () => {
    // The projection starts at 64 and retires at 65, so every charged year is a
    // retired one — nothing here depends on the working-year branch.
    const base = {
      currentAge: 64,
      endAge: 67,
      retirementAge: 65,
      startInvestments: 5_000_000,
      monthlyContribution: 0,
      annualSpending: 0,
      homeValue: 4_000_000,
      landValue: 2_000_000,
      mortgageBalance: 0,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0,
        investmentFee: 0,
        housingReturn: 0,
        inflation: 0,
        volatility: 0,
      },
      pension: {
        ...DEFAULT_PLANNING_STATE.pension,
        includeFolkepension: false,
      },
    }
    const off = simulatePlanning(
      makeState({ ...base, includePropertyTax: false })
    )
    const on = simulatePlanning(
      makeState({ ...base, includePropertyTax: true })
    )
    // Off: no property tax line at all.
    expect(off.points.find((p) => p.age === 66)!.propertyTax).toBe(0)
    // On: a positive property tax is charged in retirement and funded by selling.
    const at66 = on.points.find((p) => p.age === 66)!
    expect(at66.propertyTax).toBeGreaterThan(0)
    expect(at66.investmentsSold).toBeGreaterThan(0)
    // The extra cost leaves less wealth than with no property tax.
    expect(on.points.find((p) => p.age === 67)!.netWorth).toBeLessThan(
      off.points.find((p) => p.age === 67)!.netWorth
    )
  })

  it("skips property tax in retirement too when the budget already covers it", () => {
    // `annualSpending` is derived from the same budget as the working-year
    // contribution (hooks/use-planning.ts), so a household that answers "it is
    // already in my budget" must not be charged on top of its forbrug either.
    const base = {
      currentAge: 64,
      endAge: 67,
      retirementAge: 65,
      startInvestments: 5_000_000,
      monthlyContribution: 0,
      annualSpending: 200_000,
      homeValue: 4_000_000,
      landValue: 2_000_000,
      mortgageBalance: 0,
      includePropertyTax: true,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0,
        investmentFee: 0,
        housingReturn: 0,
        inflation: 0,
        volatility: 0,
      },
      pension: {
        ...DEFAULT_PLANNING_STATE.pension,
        includeFolkepension: false,
      },
    }
    const inBudget = simulatePlanning(
      makeState({ ...base, propertyTaxInBudget: true })
    )
    const onTop = simulatePlanning(
      makeState({ ...base, propertyTaxInBudget: false })
    )
    expect(inBudget.points.find((p) => p.age === 66)!.propertyTax).toBe(0)
    expect(onTop.points.find((p) => p.age === 66)!.propertyTax).toBeGreaterThan(
      0
    )
    // Charging it on top leaves the household poorer by exactly that much.
    expect(onTop.points.find((p) => p.age === 67)!.netWorth).toBeLessThan(
      inBudget.points.find((p) => p.age === 67)!.netWorth
    )
  })

  it("funds a retirement shortfall from the pot alone under lagerbeskatning", () => {
    // Under lager the year's unrealised gain is already taxed in step 1. The
    // drawdown must net the sale against *its own* gains tax only; counting the
    // lager tax again would understate the proceeds and mortgage the house to
    // cover a gap the portfolio can plainly fund on its own.
    const res = simulatePlanning(
      makeState({
        currentAge: 64,
        endAge: 67,
        retirementAge: 65,
        startInvestments: 10_000_000,
        investmentTaxMode: "lager",
        monthlyContribution: 0,
        annualSpending: 300_000,
        homeValue: 4_000_000,
        mortgageBalance: 0,
        includePropertyTax: false,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0.07,
          investmentFee: 0,
          housingReturn: 0,
          inflation: 0,
          volatility: 0,
        },
        pension: {
          ...DEFAULT_PLANNING_STATE.pension,
          includeFolkepension: false,
        },
      })
    )
    const at66 = res.points.find((p) => p.age === 66)!
    expect(at66.investmentsSold).toBeGreaterThan(0)
    expect(at66.borrowed).toBe(0)
    expect(at66.homeEquity).toBeCloseTo(4_000_000, 0)
    expect(res.ruinAge).toBeNull()
  })

  describe("property tax before retirement", () => {
    // A household still working for the whole projection, so nothing here can
    // be explained by the retirement branch.
    const base = {
      currentAge: 40,
      endAge: 43,
      retirementAge: 65,
      startInvestments: 0,
      monthlyContribution: 10_000,
      annualSpending: 0,
      homeValue: 4_000_000,
      landValue: 2_000_000,
      mortgageBalance: 0,
      includePropertyTax: true,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0,
        investmentFee: 0,
        housingReturn: 0,
        inflation: 0,
        volatility: 0,
        contributionGrowth: 0,
      },
    }

    it("charges nothing while the budget already covers it", () => {
      // The contribution is derived from the budget, so an ejendomsskat line
      // there has already reduced it — charging again would double-count.
      const res = simulatePlanning(
        makeState({ ...base, propertyTaxInBudget: true })
      )
      const at41 = res.points.find((p) => p.age === 41)!
      expect(at41.propertyTax).toBe(0)
      expect(at41.investments).toBeCloseTo(120_000, 0)
    })

    it("takes it out of the contribution when the budget does not", () => {
      const res = simulatePlanning(
        makeState({ ...base, propertyTaxInBudget: false })
      )
      const at41 = res.points.find((p) => p.age === 41)!
      expect(at41.propertyTax).toBeGreaterThan(0)
      // Paid from salary, so it is exactly what no longer reaches investments.
      expect(at41.investments).toBeCloseTo(120_000 - at41.propertyTax, 0)
      expect(at41.contributionYoY).toBeCloseTo(120_000 - at41.propertyTax, 0)
    })

    it("still charges nothing when property tax is off entirely", () => {
      const res = simulatePlanning(
        makeState({
          ...base,
          includePropertyTax: false,
          propertyTaxInBudget: false,
        })
      )
      expect(res.points.find((p) => p.age === 41)!.propertyTax).toBe(0)
    })

    it("keeps the deposit at zero when the tax outruns the contribution", () => {
      // 1.200 kr/yr saved against a 4 mio. kr home: the tax is far larger. The
      // year must not be recorded as a negative deposit — that would silently
      // drain the pot and make the cumulative "Indbetalinger" line fall.
      const res = simulatePlanning(
        makeState({
          ...base,
          monthlyContribution: 100,
          startInvestments: 1_000_000,
          propertyTaxInBudget: false,
        })
      )
      const at41 = res.points.find((p) => p.age === 41)!
      expect(at41.propertyTax).toBeGreaterThan(1_200)
      // The whole 1.200 kr goes to the tax, so nothing is deposited — and the
      // year is recorded as a deposit of zero, not of the negative remainder.
      expect(at41.contributionYoY).toBe(0)
      // The excess is funded the way retirement spending is: from the portfolio.
      expect(at41.investmentsSold).toBeGreaterThan(0)
      expect(at41.borrowed).toBe(0)
      // Cumulative deposits can only ever climb.
      const totals = res.points.map((p) => p.contributionsTotal)
      for (let i = 1; i < totals.length; i++) {
        expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1])
      }
    })

    it("reports ruin when the tax cannot be funded from anywhere", () => {
      // Nothing saved, nothing invested, and the home is underwater — so there
      // is no cash, no pot to sell and no equity to borrow against.
      const res = simulatePlanning(
        makeState({
          ...base,
          monthlyContribution: 0,
          startInvestments: 0,
          cashBuffer: 0,
          mortgageBalance: 8_000_000,
          mortgageRate: 0,
          propertyTaxInBudget: false,
        })
      )
      expect(res.points.find((p) => p.age === 41)!.propertyTax).toBeGreaterThan(
        0
      )
      expect(res.ruinAge).toBe(41)
    })

    it("does not hand a 40-year-old the pensioner nedslag", () => {
      // The reduction is age-gated inside propertyHoldingTax; extending the
      // charge to working years must not leak it to someone too young.
      const young = simulatePlanning(
        makeState({ ...base, propertyTaxInBudget: false })
      ).points.find((p) => p.age === 41)!.propertyTax
      const old = simulatePlanning(
        makeState({
          ...base,
          currentAge: 70,
          endAge: 73,
          retirementAge: 95,
          propertyTaxInBudget: false,
        })
      ).points.find((p) => p.age === 71)!.propertyTax
      expect(old).toBeLessThan(young)
    })
  })

  /**
   * Ejendomsskatteloven § 26 takes 5 % of the household's income above a
   * grundbeløb off the § 25 pensioner nedslag. That income is assembled here and
   * not in `propertyHoldingTax`, so until it was passed along every retired
   * household kept the whole 6.000 kr. however large its payouts were — an error
   * of up to 6.000 kr. a year, for the rest of the plan, always optimistic.
   *
   * Both cases below clear the grundbeløb by enough to lose the nedslag outright,
   * so the gap is the whole reduction and does not restate the graduation.
   */
  describe("the pensioner nedslag is graded on the year's income", () => {
    const retiredHomeowner = (overrides: Partial<PlanningState>) =>
      simulatePlanning(
        makeState({
          currentAge: 70,
          endAge: 72,
          retirementAge: 70,
          startInvestments: 5_000_000,
          monthlyContribution: 0,
          annualSpending: 0,
          homeValue: 4_000_000,
          landValue: 2_000_000,
          mortgageBalance: 0,
          includePropertyTax: true,
          propertyTaxInBudget: false,
          assumptions: {
            ...DEFAULT_PLANNING_STATE.assumptions,
            investmentReturn: 0,
            investmentFee: 0,
            housingReturn: 0,
            inflation: 0,
            volatility: 0,
          },
          pension: {
            ...DEFAULT_PLANNING_STATE.pension,
            includeFolkepension: false,
          },
          ...overrides,
        })
      ).points.find((p) => p.age === 71)!

    it("counts the year's pension payout", () => {
      const withRatepension = (ratepensionBalance: number) =>
        retiredHomeowner({
          pension: {
            person1: {
              ...DEFAULT_PENSION_PERSON,
              ratepensionBalance,
              folkepensionAge: 70,
            },
            person2: { ...DEFAULT_PENSION_PERSON },
            pensionReturn: 0,
            ratepensionYears: 10,
            single: true,
            includeFolkepension: false, // isolate the ratepension payout
          },
        })
      const modest = withRatepension(0)
      const large = withRatepension(10_000_000) // ~1 mio. kr. a year
      expect(modest.retirementIncome).toBe(0)
      expect(large.retirementIncome).toBeGreaterThan(0)
      expect(large.propertyTax - modest.propertyTax).toBe(6_000)
    })

    it("counts a lager-taxed pot's gain, which is income whether or not it is sold", () => {
      // Same pot and same gain either way; only the tax model differs. Under
      // realisation nothing is sold, so the year produces no aktieindkomst at
      // all — the household keeps the nedslag it is entitled to.
      const gains = (investmentTaxMode: PlanningState["investmentTaxMode"]) =>
        retiredHomeowner({
          investmentTaxMode,
          startInvestments: 10_000_000,
          assumptions: {
            ...DEFAULT_PLANNING_STATE.assumptions,
            investmentReturn: 0.1, // ~1 mio. kr. of gain a year
            investmentFee: 0,
            housingReturn: 0,
            inflation: 0,
            volatility: 0,
          },
        })
      expect(
        gains("lager").propertyTax - gains("realisation").propertyTax
      ).toBe(6_000)
    })
  })

  /**
   * Under realisationsbeskatning the year's property tax and the drawdown that
   * pays for it define each other: the charge sizes the withdrawal, the
   * withdrawal realises a gain, § 26 grades the § 25 nedslag on that
   * aktieindkomst — and the nedslag sets the charge. The model used to hand § 26
   * a flat zero here, so a retired household selling an appreciated portfolio to
   * live on kept a nedslag the law had already graded away.
   *
   * The household below is built so the loop is *visible*: its pension income
   * sits just under the grundbeløb, and the gain the drawdown realises is what
   * carries it into the graduation band — an interior fixed point rather than
   * either saturated end.
   */
  describe("§ 26 counts the gain a realisation drawdown makes", () => {
    const ctxAt = (t: number): TaxContext => ({
      t,
      inflation: 0,
      profile: DEFAULT_TAX_PROFILE,
      married: false,
    })

    /** No return, no fees, no inflation — so every figure below is derivable. */
    const flat = {
      ...DEFAULT_PLANNING_STATE.assumptions,
      investmentFee: 0,
      housingReturn: 0,
      inflation: 0,
      volatility: 0,
      housingVolatility: 0,
    }

    /**
     * A pot with one year of growth behind it and nothing sold from it yet has a
     * gain fraction that follows from the return alone: value (1+r), basis 1.
     */
    const RETURN = 0.1
    const GAIN_FRACTION = RETURN / (1 + RETURN)
    const START_INVESTMENTS = 12_000_000

    it("sells the grossed-up amount and taxes the gain the pre-sale basis implies", () => {
      // No home and no pension, so the year's whole shortfall is the spending:
      // the sale can be derived from the inputs rather than from the engine.
      const res = simulatePlanning(
        makeState({
          currentAge: 69,
          endAge: 71,
          retirementAge: 70,
          startInvestments: START_INVESTMENTS,
          monthlyContribution: 0,
          annualSpending: 400_000,
          homeValue: 0,
          landValue: 0,
          mortgageBalance: 0,
          includePropertyTax: false,
          assumptions: { ...flat, investmentReturn: RETURN },
          pension: {
            ...DEFAULT_PLANNING_STATE.pension,
            single: true,
            includeFolkepension: false,
            person1: { ...DEFAULT_PENSION_PERSON },
            person2: { ...DEFAULT_PENSION_PERSON },
          },
        })
      )

      const sold = grossUpStockSale(400_000, GAIN_FRACTION, ctxAt(1))
      const first = res.points.find((p) => p.age === 70)!
      expect(first.investmentsSold).toBeCloseTo(sold, 4)
      expect(first.borrowed).toBe(0) // the pot covered it — nothing was borrowed
      // The only tax in this year is the one on the realised gain, and the gain
      // is measured at the fraction from *before* the sale — which is exactly
      // the quantity § 26 is handed below.
      expect(first.taxPaid).toBeCloseTo(
        stockGainTax(sold * GAIN_FRACTION, ctxAt(1)),
        4
      )

      // The following year re-derives from the basis this sale left behind, i.e.
      // from `sold × (1 − g)` — the complement of the gain it realised.
      const basis = START_INVESTMENTS - sold * (1 - GAIN_FRACTION)
      const value = (START_INVESTMENTS * (1 + RETURN) - sold) * (1 + RETURN)
      expect(res.points.find((p) => p.age === 71)!.investmentsSold).toBeCloseTo(
        grossUpStockSale(400_000, (value - basis) / value, ctxAt(2)),
        4
      )
    })

    /**
     * Ratepension over ten flat years pays a tenth of the balance; folkepension
     * is untouched by modregning at that size. Derived rather than written down,
     * so § 26's income base here is the pension module's own arithmetic.
     */
    const RATEPENSION_BALANCE = 600_000
    const RATEPENSION_YEARS = 10
    const RATEPENSION_PAYOUT = annuityPayment(
      RATEPENSION_BALANCE,
      afterPalReturn(0),
      RATEPENSION_YEARS
    )
    const PERSONAL_INCOME =
      RATEPENSION_PAYOUT + folkepensionAfterModregning(RATEPENSION_PAYOUT, true)

    const HOME_VALUE = 4_000_000
    const LAND_VALUE = 2_000_000

    const inTheBand = (overrides: Partial<PlanningState> = {}) =>
      makeState({
        currentAge: 69,
        endAge: 75,
        retirementAge: 70,
        startInvestments: START_INVESTMENTS,
        monthlyContribution: 0,
        annualSpending: 590_000,
        homeValue: HOME_VALUE,
        landValue: LAND_VALUE,
        mortgageBalance: 0,
        includePropertyTax: true,
        propertyTaxInBudget: false,
        assumptions: { ...flat, investmentReturn: RETURN },
        pension: {
          ...DEFAULT_PLANNING_STATE.pension,
          single: true,
          includeFolkepension: true,
          pensionReturn: 0,
          ratepensionYears: RATEPENSION_YEARS,
          person1: {
            ...DEFAULT_PENSION_PERSON,
            folkepensionAge: 70,
            ratepensionBalance: RATEPENSION_BALANCE,
          },
          person2: { ...DEFAULT_PENSION_PERSON },
        },
        ...overrides,
      })

    it("settles the charge and the drawdown that funds it on each other", () => {
      const first = simulatePlanning(inTheBand()).points.find(
        (p) => p.age === 70
      )!
      const charge = (positiveStockIncome: number) =>
        propertyHoldingTax(HOME_VALUE, LAND_VALUE, 70, ctxAt(1), {
          personalIncome: PERSONAL_INCOME,
          positiveStockIncome,
        })

      // Reconstruct the aktieindkomst from what the year reports selling, and
      // put it back through § 26. A self-consistent year answers with the very
      // charge the sale was sized for.
      const realisedGain = first.investmentsSold * GAIN_FRACTION
      expect(Math.abs(first.propertyTax - charge(realisedGain))).toBeLessThan(1)

      // And it is an interior point of the graduation band: ignoring the gain
      // charges materially less (what the model used to do), while the household
      // has not yet lost the whole nedslag either.
      const ignoringTheGain = charge(0)
      const nedslagGoneEntirely = charge(1_000_000)
      expect(first.propertyTax).toBeGreaterThan(ignoringTheGain + 1_000)
      expect(first.propertyTax).toBeLessThan(nedslagGoneEntirely)
    })

    /**
     * The same pot value funding the same spending, differing only in how much of
     * it is gain. More embedded gain is more aktieindkomst when it is sold, and
     * § 26 only ever grades the nedslag *down* — so the charge can never fall.
     */
    describe("a larger embedded gain never lowers the charge", () => {
      const expectMonotone = (
        allBasis: PlanningResult,
        appreciated: PlanningResult
      ) => {
        let strictlyHigherSomewhere = false
        for (const a of allBasis.points) {
          const b = appreciated.points.find((p) => p.age === a.age)!
          expect(b.propertyTax).toBeGreaterThanOrEqual(a.propertyTax)
          if (b.propertyTax > a.propertyTax) strictlyHigherSomewhere = true
        }
        expect(strictlyHigherSomewhere).toBe(true)
      }

      it("in retirement", () => {
        // Both pots are worth 13,2 mio. kr. in the first drawdown year; only one
        // of them has a gain inside it. (A literally zero-basis pot is not an
        // expressible input — the basis starts at `startInvestments`.)
        expectMonotone(
          simulatePlanning(
            inTheBand({
              startInvestments: START_INVESTMENTS * (1 + RETURN),
              assumptions: { ...flat, investmentReturn: 0 },
            })
          ),
          simulatePlanning(inTheBand())
        )
      })

      it("while the plan still counts the household as working", () => {
        // `retirementAge` and folkepensionsalderen are separate inputs, so a
        // household can be old enough for the nedslag while the plan still has
        // it saving — and a tax that outruns the saving is funded by selling,
        // exactly as retirement spending is.
        const stillWorking = (investmentReturn: number) =>
          simulatePlanning(
            makeState({
              currentAge: 69,
              endAge: 79,
              retirementAge: 95,
              startInvestments: 20_000_000,
              monthlyContribution: 0,
              annualSpending: 0,
              homeValue: 30_000_000,
              landValue: 15_000_000,
              mortgageBalance: 0,
              includePropertyTax: true,
              propertyTaxInBudget: false,
              assumptions: { ...flat, investmentReturn },
              pension: {
                ...DEFAULT_PLANNING_STATE.pension,
                single: true,
                includeFolkepension: true,
                pensionReturn: 0,
                person1: { ...DEFAULT_PENSION_PERSON, folkepensionAge: 70 },
                person2: { ...DEFAULT_PENSION_PERSON },
              },
            })
          )
        const allBasis = stillWorking(0)
        const appreciated = stillWorking(RETURN)
        expectMonotone(allBasis, appreciated)
        // Partly graded in at least one year — so this branch grades the nedslag
        // rather than merely switching it off.
        const flatCharge = allBasis.points.at(-1)!.propertyTax
        expect(
          appreciated.points.some(
            (p) =>
              p.propertyTax > flatCharge && p.propertyTax < flatCharge + 6_000
          )
        ).toBe(true)
      })
    })

    /**
     * The settlement must be inert everywhere it does not belong. Under lager the
     * gain is aktieindkomst whether or not anything is sold, so the year already
     * knew it; an ASK gain is not aktieindkomst at all; and a household below
     * folkepensionsalderen has no § 25 nedslag to grade. The figures below were
     * taken from the pre-fix engine, so an accidental change shows up as a
     * failure rather than as a quietly different projection.
     */
    describe("leaves the cases it does not apply to untouched", () => {
      const inert = (overrides: Partial<PlanningState>) =>
        simulatePlanning(inTheBand({ endAge: 73, ...overrides }))

      it("under lagerbeskatning", () => {
        const r = inert({ investmentTaxMode: "lager" })
        expect(r.points.map((p) => p.propertyTax)).toEqual([
          0, 24_480, 24_480, 24_480, 24_480,
        ])
        expect(r.points.map((p) => p.investmentsSold)).toEqual([
          0, 436_203, 436_203, 436_203, 436_203,
        ])
        expect(r.points.at(-1)!.netWorth).toBe(17_185_091.167)
      })

      it("on an aktiesparekonto", () => {
        const r = inert({ investmentTaxMode: "ask" })
        expect(r.points.map((p) => p.propertyTax)).toEqual([
          0, 18_806, 18_806, 18_806, 18_806,
        ])
        expect(r.points.map((p) => p.investmentsSold)).toEqual([
          0, 430_529, 430_529, 430_529, 430_529,
        ])
        expect(r.points.at(-1)!.netWorth).toBe(18_559_394.00584268)
      })

      it("for a household below folkepensionsalderen", () => {
        // Saving nothing and owning an expensive home, so the charge is funded by
        // selling — the coupled path — but there is no nedslag to grade.
        const r = simulatePlanning(
          makeState({
            currentAge: 40,
            endAge: 44,
            retirementAge: 65,
            startInvestments: 2_000_000,
            monthlyContribution: 0,
            annualSpending: 0,
            homeValue: 8_000_000,
            landValue: 4_000_000,
            mortgageBalance: 0,
            includePropertyTax: true,
            propertyTaxInBudget: false,
            assumptions: { ...flat, investmentReturn: RETURN },
            pension: {
              ...DEFAULT_PLANNING_STATE.pension,
              single: true,
              includeFolkepension: false,
              person1: { ...DEFAULT_PENSION_PERSON },
              person2: { ...DEFAULT_PENSION_PERSON },
            },
          })
        )
        expect(r.points.map((p) => p.propertyTax)).toEqual([
          0, 48_960, 48_960, 48_960, 48_960,
        ])
        expect(r.points.map((p) => p.investmentsSold)).toEqual([
          0, 50_191.985088536814, 51_367.033729298535, 52_484.0411394699,
          53_542.508812041895,
        ])
        expect(r.points.at(-1)!.netWorth).toBe(10_687_965.402969249)
      })
    })
  })

  it("widens the net-worth band when home prices are volatile", () => {
    const base = {
      currentAge: 40,
      endAge: 60,
      retirementAge: 65,
      startInvestments: 0,
      monthlyContribution: 0,
      annualSpending: 0,
      homeValue: 3_000_000,
      mortgageBalance: 0,
    }
    const width = (housingVolatility: number) => {
      const r = simulatePlanning(
        makeState({
          ...base,
          assumptions: {
            ...DEFAULT_PLANNING_STATE.assumptions,
            volatility: 0, // isolate housing risk
            housingVolatility,
          },
        })
      )
      const last = r.points.at(-1)!
      return last.band[1] - last.band[0]
    }
    expect(width(0)).toBeCloseTo(0, -2) // no risk → band collapses
    expect(width(0.1)).toBeGreaterThan(100_000) // housing risk widens the band
  })

  it("solves the monthly contribution needed to reach FI by retirement", () => {
    const state = makeState({
      currentAge: 35,
      endAge: 90,
      retirementAge: 60,
      startInvestments: 0,
      monthlyContribution: 0,
      annualSpending: 300_000,
      homeValue: 0,
      mortgageBalance: 0,
      assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, inflation: 0 },
    })
    const req = solveRequiredMonthlyContribution(state)
    expect(req).not.toBeNull()
    expect(req!).toBeGreaterThan(0)
    // The solved amount reaches FI by 60; clearly less does not.
    const withReq = simulatePlanning({ ...state, monthlyContribution: req! })
    expect(withReq.fiAge != null && withReq.fiAge <= 60).toBe(true)
    const withLess = simulatePlanning({
      ...state,
      monthlyContribution: req! * 0.5,
    })
    expect(withLess.fiAge == null || withLess.fiAge > 60).toBe(true)
  })

  it("returns 0 when already FI and null when FI can't be reached in time", () => {
    const alreadyFI = makeState({
      currentAge: 50,
      endAge: 90,
      retirementAge: 65,
      startInvestments: 20_000_000,
      monthlyContribution: 0,
      annualSpending: 300_000,
      homeValue: 0,
      mortgageBalance: 0,
      assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, inflation: 0 },
    })
    expect(solveRequiredMonthlyContribution(alreadyFI)).toBe(0)
    // No years left to save before retirement and not FI yet → unreachable.
    const unreachable = makeState({
      currentAge: 65,
      endAge: 90,
      retirementAge: 65,
      startInvestments: 1_000_000,
      monthlyContribution: 0,
      annualSpending: 300_000,
      homeValue: 0,
      mortgageBalance: 0,
      assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, inflation: 0 },
    })
    expect(solveRequiredMonthlyContribution(unreachable)).toBeNull()
  })

  describe("a portfolio of more than one property", () => {
    /** No returns, no inflation, no shocks — every figure below is derivable. */
    const still = {
      ...DEFAULT_PLANNING_STATE.assumptions,
      investmentReturn: 0,
      investmentFee: 0,
      housingReturn: 0,
      inflation: 0,
      volatility: 0,
      housingVolatility: 0,
    }

    /**
     * A household that owns `properties` and nothing else worth modelling: no
     * pension, no loan, no spending, on an aktiesparekonto so no sale is ever
     * aktieindkomst. Both halves of the § 26 base are therefore zero and the
     * nedslag is granted in full — which is what makes the § 25 amounts below
     * readable straight off the difference between two ages.
     */
    const owning = (properties: PlannedProperty[], currentAge: number) =>
      makeState({
        currentAge,
        endAge: currentAge + 1,
        retirementAge: Math.min(currentAge, 65),
        startInvestments: 5_000_000,
        investmentTaxMode: "ask",
        monthlyContribution: 0,
        annualSpending: 0,
        properties,
        mortgageBalance: 0,
        includePropertyTax: true,
        propertyTaxInBudget: false,
        assumptions: still,
        pension: {
          ...DEFAULT_PLANNING_STATE.pension,
          single: true,
          includeFolkepension: false,
          person1: { ...DEFAULT_PENSION_PERSON },
          person2: { ...DEFAULT_PENSION_PERSON },
        },
      })

    /** The first full year's charge on this portfolio at this age. */
    const charge = (properties: PlannedProperty[], currentAge: number) =>
      simulatePlanning(owning(properties, currentAge)).points[1].propertyTax

    /**
     * What retirement is worth to a portfolio: the § 25 nedslag the household
     * actually receives, as the difference between the same properties taxed
     * below and above folkepensionsalderen.
     */
    const granted = (properties: PlannedProperty[]) =>
      charge(properties, 40) - charge(properties, 70)

    const home = (value: number, landValue = 0) =>
      property({ kind: "helaarsbolig", value, landValue })
    const summer = (value: number, landValue = 0) =>
      property({ kind: "fritidsbolig", value, landValue })

    const rates = getRates(DEFAULT_TAX_PROFILE.year)
    const HOME_NEDSLAG = rates.ejendomsvaerdiSkatPensionerReduction
    const SUMMER_NEDSLAG = rates.ejendomsvaerdiSkatPensionerReductionSummer

    it("grades the nedslag once for the household, not once per property", () => {
      // The regression PR #23 fixed, reached through the simulation this time:
      // three homes are three § 22 progressions but still one § 26 graduation,
      // and § 25 attaches to the one helårsbolig the pensioner lives in.
      const three = [home(4_000_000), home(4_000_000), home(4_000_000)]
      expect(granted(three)).toBe(HOME_NEDSLAG)
      expect(granted(three)).toBeLessThan(3 * HOME_NEDSLAG)
      // Each of them owes more than the nedslag on its own, so a per-property
      // grant would have had room to show up.
      expect(charge([home(4_000_000)], 40)).toBeGreaterThan(HOME_NEDSLAG)
    })

    it("adds a fritidsbolig's own 2.000 kr. to a helårsbolig's 6.000", () => {
      // § 25 is an amount per boligenhed, so the two dwellings each keep their
      // own — it is § 26's graduation that is spent once, and there is none to
      // spend here.
      expect(granted([home(4_000_000), summer(2_000_000)])).toBe(
        HOME_NEDSLAG + SUMMER_NEDSLAG
      )
      expect(granted([home(4_000_000)])).toBe(HOME_NEDSLAG)
      expect(granted([summer(2_000_000)])).toBe(SUMMER_NEDSLAG)
    })

    it("gives a third dwelling no nedslag but its own § 22 progression", () => {
      const two = [home(4_000_000), summer(2_000_000)]
      const third = home(12_000_000)
      // Nothing more to claim: § 25's two slots are taken.
      expect(granted([...two, third])).toBe(HOME_NEDSLAG + SUMMER_NEDSLAG)
      // It is taxed all the same, at what it would owe standing alone — the
      // progression is per property, so the third does not inherit a rate from
      // the two it is added to.
      expect(charge([...two, third], 40) - charge(two, 40)).toBe(
        charge([third], 40)
      )
    })

    it("charges grundskyld on each property's own land value", () => {
      // Absolute kroner per property, not a share of the household's combined
      // value: adding a summer house with land of its own costs exactly the
      // grundskyld on that land, and adding one without land costs none.
      const muni = getMunicipality(
        DEFAULT_TAX_PROFILE.municipality,
        DEFAULT_TAX_PROFILE.year
      )!
      const grundskyld = (land: number) =>
        Math.round((muni.grundskyldRate / 1000) * land * ASSESSMENT_FACTOR)

      const base = [home(4_000_000, 2_000_000)]
      const noLand = charge([...base, summer(1_500_000, 0)], 40)
      const withLand = charge([...base, summer(1_500_000, 1_000_000)], 40)
      expect(withLand - noLand).toBe(grundskyld(1_000_000))
      // And the plot the household already had is still charged on its own
      // figure rather than on a fraction re-derived from the pair.
      expect(charge(base, 40) - charge([home(4_000_000, 0)], 40)).toBe(
        grundskyld(2_000_000)
      )
    })

    it("starts and stops charging a property as it changes hands", () => {
      const bought = property({
        kind: "fritidsbolig",
        value: 2_000_000,
        landValue: 1_000_000,
        acquisitionAge: 42,
        disposalAge: 44,
      })
      const state = {
        ...owning([home(4_000_000, 2_000_000), bought], 40),
        endAge: 45,
      }
      const byAge = new Map(
        simulatePlanning(state).points.map((p) => [p.age, p.propertyTax])
      )
      const alone = charge([home(4_000_000, 2_000_000)], 40)
      expect(byAge.get(41)).toBe(alone)
      // Ownership is half-open: charged from the year of purchase through the
      // year before the sale, and nothing in the year of the sale itself.
      expect(byAge.get(42)).toBeGreaterThan(alone)
      expect(byAge.get(43)).toBe(byAge.get(42))
      expect(byAge.get(44)).toBe(alone)
      expect(byAge.get(45)).toBe(alone)
    })

    it("counts every owned property in the household's home equity", () => {
      const both = simulatePlanning(
        owning([home(4_000_000), summer(2_000_000)], 40)
      ).points[1]
      const one = simulatePlanning(owning([home(4_000_000)], 40)).points[1]
      expect(both.homeEquity - one.homeEquity).toBe(2_000_000)
    })

    /**
     * The invariant PR #44 established, carried onto a portfolio: the charge and
     * the drawdown that funds it are mutually recursive under realisation, and
     * `settleAgainstDrawdown` resolves them on a throwaway clone so that the one
     * `fundShortfall` call against the real state fires exactly once a year. A
     * second call would sell the pot twice over.
     */
    describe("under a realisation drawdown", () => {
      const RETURN = 0.1
      const GAIN_FRACTION = RETURN / (1 + RETURN)
      /**
       * Large, deliberately: this household has no pension income, so the only
       * thing that can carry it into § 26's graduation band is the aktieindkomst
       * of the drawdown itself — which is the coupling under test. Spending less
       * would leave the nedslag untouched whatever the sale realised, and the
       * settlement would have nothing to settle.
       */
      const SPENDING = 2_960_000
      const HOME = home(4_000_000, 2_000_000)
      const SUMMER = summer(2_000_000, 1_000_000)
      const ctxAt = (t: number): TaxContext => ({
        t,
        inflation: 0,
        profile: DEFAULT_TAX_PROFILE,
        married: false,
      })

      const path = (properties: PlannedProperty[]) =>
        simulatePlanning(
          makeState({
            currentAge: 69,
            endAge: 71,
            retirementAge: 70,
            startInvestments: 12_000_000,
            monthlyContribution: 0,
            annualSpending: SPENDING,
            properties,
            mortgageBalance: 0,
            includePropertyTax: true,
            propertyTaxInBudget: false,
            assumptions: { ...still, investmentReturn: RETURN },
            pension: {
              ...DEFAULT_PLANNING_STATE.pension,
              single: true,
              includeFolkepension: false,
              person1: { ...DEFAULT_PENSION_PERSON },
              person2: { ...DEFAULT_PENSION_PERSON },
            },
          })
        ).points
      const drawing = (properties: PlannedProperty[]) =>
        path(properties).find((p) => p.age === 70)!

      it("reaches a charge the sale that funds it agrees with", () => {
        const year = drawing([HOME, SUMMER])
        const portfolio = createPropertyPortfolioTax(DEFAULT_TAX_PROFILE, false)
        const asked = portfolio([HOME, SUMMER], 70, ctxAt(1), {
          personalIncome: 0,
          positiveStockIncome: year.investmentsSold * GAIN_FRACTION,
        })
        expect(Math.abs(year.propertyTax - asked)).toBeLessThan(1)
        // An interior point of the band, so the settlement had something to do:
        // ignoring the drawdown's gain charges materially less, and the whole
        // 6.000 + 2.000 has not been graded away either.
        const given = (positiveStockIncome: number) =>
          portfolio([HOME, SUMMER], 70, ctxAt(1), {
            personalIncome: 0,
            positiveStockIncome,
          })
        expect(year.propertyTax).toBeGreaterThan(given(0) + 1_000)
        expect(year.propertyTax).toBeLessThan(given(10_000_000))
      })

      it("funds the whole year with one sale, not one per property", () => {
        const points = path([HOME, SUMMER])
        const opening = points.find((p) => p.age === 69)!.investments
        const year = points.find((p) => p.age === 70)!
        // The sale reported is the settled need — spending plus the charge the
        // settlement landed on — grossed up for the tax on its gain.
        expect(year.investmentsSold).toBeCloseTo(
          grossUpStockSale(
            SPENDING + year.propertyTax,
            GAIN_FRACTION,
            ctxAt(1)
          ),
          4
        )
        // And the pot fell by that one sale and no more. Asserted against the
        // balance rather than against `investmentsSold` alone, because a second
        // `fundShortfall` against the real state drains the pot twice while
        // still *reporting* one sale: the proportional cost basis makes both
        // calls gross up to the same figure, so only the balance shows it.
        expect(year.investments).toBeCloseTo(
          opening * (1 + RETURN) - year.investmentsSold,
          4
        )
        expect(year.borrowed).toBe(0)
      })

      it("settles a portfolio the same way it settles a single home", () => {
        // One property is the case PR #44 pinned; the portfolio path has to
        // reach the same answer for it, and a larger portfolio has to cost more
        // rather than diverge.
        const one = drawing([HOME])
        expect(
          Math.abs(
            one.propertyTax -
              propertyHoldingTax(HOME.value, HOME.landValue, 70, ctxAt(1), {
                personalIncome: 0,
                positiveStockIncome: one.investmentsSold * GAIN_FRACTION,
              })
          )
        ).toBeLessThan(1)
        expect(drawing([HOME, SUMMER]).propertyTax).toBeGreaterThan(
          one.propertyTax
        )
      })
    })
  })

  /**
   * Interest is deductible as kapitalindkomst, and until this the projection
   * charged every krone of it and reduced no tax by it (#53).
   *
   * The retirement side is where it belongs: there the projection charges the
   * whole loan service, and `pensionIncomeTax` builds the household's tax return
   * from scratch, so nothing else can be carrying the fradrag. Before retirement
   * it deliberately grants none — see `pensionNetIncomeByYear` — and the last
   * two tests here are what stop that from being reversed by accident.
   */
  describe("rentefradrag", () => {
    const INTEREST_YEAR = 66
    const BIDRAGSSATS = 0.008
    /**
     * The year's deductible cost of a realkreditlån opening at `balance`:
     * interest plus bidrag, afdraget excluded. Bidrag is in here because
     * ligningslovens § 15 J, stk. 1 lets an owner-occupier deduct exactly two
     * things — prioritetsrenterne and "reservefonds- og administrationsbidrag
     * til realkreditinstitutter" — the latter as a løbende provision under
     * § 8, stk. 3, litra a.
     */
    const deductibleOf = (balance: number, months = 30 * 12) =>
      amortizeYear(balance, 0.04, months).interest + balance * BIDRAGSSATS
    /** Retired, drawing a real pension, and still carrying a real loan. */
    const retiredWithLoan = (mortgageBalance: number) =>
      makeState({
        currentAge: 65,
        endAge: 80,
        retirementAge: 65,
        startInvestments: 2_000_000,
        monthlyContribution: 0,
        annualSpending: 250_000,
        homeValue: 4_000_000,
        mortgageBalance,
        mortgageRate: 0.04,
        mortgageTermYears: 30,
        // A real bidragssats, so the expectations below — all built from
        // `deductibleOf` — pin that the lender's fee earns the fradrag the
        // statute grants it, and that it does so without leaving the cash flow.
        mortgageBidragssats: BIDRAGSSATS,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          inflation: 0,
          housingReturn: 0,
          volatility: 0,
          housingVolatility: 0,
          // No investment gains, so a sale realises nothing and `taxPaid` is the
          // pension tax alone — the figure these tests are actually about.
          investmentReturn: 0,
          investmentFee: 0,
        },
        pension: {
          ...DEFAULT_PLANNING_STATE.pension,
          person1: {
            ...DEFAULT_PENSION_PERSON,
            ratepensionBalance: 4_000_000,
            folkepensionAge: 67,
          },
          pensionReturn: 0,
          ratepensionYears: 15,
        },
      })
    const at = (r: PlanningResult, age: number) =>
      r.points.find((p) => p.age === age)!

    it("nets the loan's interest off the household's pension tax", () => {
      const withLoan = simulatePlanning(retiredWithLoan(2_000_000))
      const debtFree = simulatePlanning(retiredWithLoan(0))
      const year = at(withLoan, INTEREST_YEAR)
      const clear = at(debtFree, INTEREST_YEAR)
      // Same pension either way — only the tax on it differs.
      expect(year.taxPaid).toBeLessThan(clear.taxPaid)
      expect(year.retirementIncome).toBeGreaterThan(clear.retirementIncome)

      // And by the right amount: the first year's interest and bidrag off the
      // opening balance (the schedule starts billing at year 1), priced through
      // the same engine the /skat page uses rather than restated here.
      const deductible = deductibleOf(2_000_000)
      const gross = clear.retirementIncome + clear.taxPaid
      const ctx: TaxContext = {
        t: 0,
        inflation: 0,
        profile: DEFAULT_TAX_PROFILE,
        married: false,
      }
      const relief =
        pTax(gross) - pensionIncomeTax(gross, ctx, undefined, deductible)
      expect(relief).toBeGreaterThan(20_000)
      expect(clear.taxPaid - year.taxPaid).toBeCloseTo(relief, 6)
      expect(year.retirementIncome - clear.retirementIncome).toBeCloseTo(
        relief,
        6
      )
    })

    it("deducts the realkredit bidrag as well as the interest", () => {
      // Ligningslovens § 15 J, stk. 1 lets an owner-occupier deduct
      // "reservefonds- og administrationsbidrag til realkreditinstitutter"
      // alongside prioritetsrenterne, and personskattelovens § 4, stk. 1, nr. 2
      // puts the provisions of § 8, stk. 3 in kapitalindkomst with them. So the
      // fee reaches the household's tax return, and the projection understated
      // every bidrag-bearing retirement year until it did.
      const withBidrag = at(
        simulatePlanning(retiredWithLoan(2_000_000)),
        INTEREST_YEAR
      )
      const noBidrag = at(
        simulatePlanning({
          ...retiredWithLoan(2_000_000),
          mortgageBidragssats: 0,
        }),
        INTEREST_YEAR
      )
      const gross = noBidrag.retirementIncome + noBidrag.taxPaid
      const ctx: TaxContext = {
        t: 0,
        inflation: 0,
        profile: DEFAULT_TAX_PROFILE,
        married: false,
      }
      const bidrag = 2_000_000 * BIDRAGSSATS
      const interest = amortizeYear(2_000_000, 0.04, 30 * 12).interest
      const extra =
        pensionIncomeTax(gross, ctx, undefined, interest) -
        pensionIncomeTax(gross, ctx, undefined, interest + bidrag)
      // ~a quarter of a 16.000 kr. fee: the interest has already spent § 11's
      // band, so the fee earns the kommune- and kirkeskat relief alone.
      expect(extra).toBeGreaterThan(3_000)
      expect(noBidrag.taxPaid - withBidrag.taxPaid).toBeCloseTo(extra, 6)
    })

    it("leaves the cash flow's bidrag alone while deducting it", () => {
      // The fee is an expense *and* a fradrag, and the two arrive by different
      // routes. Making it deductible must not also stop it being paid: the
      // service is what `modelledMortgageMonthly` and `mortgageBudgetNotice`
      // quote, so a krone moved here would move the notice too. The working
      // years are where that is visible to the krone — they take the whole
      // modelled service off the contribution and grant no fradrag at all.
      const service = serviceOf(2_000_000, 0.04, 30 * 12, false, BIDRAGSSATS)
      const bidrag = 2_000_000 * BIDRAGSSATS
      expect(service - serviceOf(2_000_000, 0.04, 30 * 12)).toBeCloseTo(
        bidrag,
        6
      )
      const working = simulatePlanning(
        makeState({
          currentAge: 40,
          endAge: 50,
          retirementAge: 100,
          startInvestments: 0,
          monthlyContribution: 30_000,
          homeValue: 4_000_000,
          mortgageBalance: 2_000_000,
          mortgageRate: 0.04,
          mortgageTermYears: 30,
          mortgageBidragssats: BIDRAGSSATS,
          mortgageBudgetedMonthly: 0,
          assumptions: {
            ...DEFAULT_PLANNING_STATE.assumptions,
            investmentReturn: 0,
            investmentFee: 0,
            inflation: 0,
            housingReturn: 0,
            contributionGrowth: 0,
            volatility: 0,
          },
        })
      )
      expect(at(working, 41).contributionYoY).toBeCloseTo(360_000 - service, 6)
    })

    it("relieves every year the loan runs, not just the first", () => {
      // The relief is not a one-off. A 30-year loan still accrues interest in
      // year 15, so a retired borrower was understated by the fradrag in every
      // single year of the projection — which is what made #53 worth fixing.
      const withLoan = simulatePlanning(retiredWithLoan(2_000_000))
      const debtFree = simulatePlanning(retiredWithLoan(0))
      const retired = withLoan.points.filter((p) => p.age > 65)
      expect(retired).toHaveLength(15)
      let total = 0
      for (const p of retired) {
        const gap = p.retirementIncome - at(debtFree, p.age).retirementIncome
        expect(gap).toBeGreaterThan(0)
        total += gap
      }
      expect(total).toBeGreaterThan(250_000)
    })

    it("gives a couple two § 11 beløbsgrænser, not one", () => {
      // Personskattelovens § 11 grants the 8 % nedslag per person on up to
      // 50.000 kr. of negative nettokapitalindkomst, so 120.000 kr. of interest
      // reaches both partners' bands only if each is assessed with their own
      // share. Deducting the household's whole interest in one assessment would
      // spill over a single 50.000 band and silently throw the 8 % away.
      // Pensions large enough that even the partner carrying the whole interest
      // still has skattepligtig indkomst left, so the ordinary kommune- and
      // kirkeskat relief is identical either way and § 11's band is the only
      // thing the split changes.
      const twoEqualPensions = (state: PlanningState) => ({
        ...state,
        homeValue: 6_000_000,
        pension: {
          ...state.pension,
          single: false,
          person1: { ...state.pension.person1, ratepensionBalance: 5_000_000 },
          person2: { ...state.pension.person1, ratepensionBalance: 5_000_000 },
        },
      })
      const withLoan = simulatePlanning(
        twoEqualPensions(retiredWithLoan(3_000_000))
      )
      const debtFree = simulatePlanning(twoEqualPensions(retiredWithLoan(0)))

      const deductible = deductibleOf(3_000_000)
      expect(deductible).toBeGreaterThan(100_000) // must overflow one band
      const clear = at(debtFree, INTEREST_YEAR)
      const each = (clear.retirementIncome + clear.taxPaid) / 2
      const ctx: TaxContext = {
        t: 0,
        inflation: 0,
        profile: DEFAULT_TAX_PROFILE,
        married: true,
      }
      const perPartner = 2 * pensionIncomeTax(each, ctx, each, deductible / 2)
      const allOnOne =
        pensionIncomeTax(each, ctx, each, deductible) +
        pensionIncomeTax(each, ctx, each, 0)
      // Each half still fills a whole band, so concentrating the interest costs
      // the household the second band outright — 8 % of 50.000 kr. (to the
      // krone; the engine rounds the nedslag).
      const rates = getRates(DEFAULT_TAX_PROFILE.year)
      expect(deductible / 2).toBeGreaterThan(rates.ekstraRentefradragThreshold)
      expect(allOnOne - perPartner).toBeCloseTo(
        rates.ekstraRentefradragRate * rates.ekstraRentefradragThreshold,
        -1
      )
      expect(at(withLoan, INTEREST_YEAR).taxPaid).toBeCloseTo(perPartner, 6)
    })

    it("relieves other debt's interest as well as the mortgage's", () => {
      // Both streams are kapitalindkomst and both are charged in full after
      // retirement, so passing only the mortgage's would leave half the fix
      // undone — and § 11's band is shared, so they have to arrive together.
      const noDebt = simulatePlanning(retiredWithLoan(0))
      const withDebt = simulatePlanning({
        ...retiredWithLoan(0),
        otherDebtBalance: 500_000,
        otherDebtRate: 0.08,
        otherDebtTermYears: 10,
      })
      const interest = amortizeYear(500_000, 0.08, 10 * 12).interest
      const gross =
        at(noDebt, INTEREST_YEAR).retirementIncome +
        at(noDebt, INTEREST_YEAR).taxPaid
      const ctx: TaxContext = {
        t: 0,
        inflation: 0,
        profile: DEFAULT_TAX_PROFILE,
        married: false,
      }
      const relief =
        pTax(gross) - pensionIncomeTax(gross, ctx, undefined, interest)
      expect(relief).toBeGreaterThan(10_000)
      expect(
        at(withDebt, INTEREST_YEAR).retirementIncome -
          at(noDebt, INTEREST_YEAR).retirementIncome
      ).toBeCloseTo(relief, 6)
    })

    /**
     * A household that has eaten its portfolio keeps borrowing against the
     * house, and that balance accrues real, deductible interest that no schedule
     * can predict — it is path state, so `pension.tax` cannot have carried it
     * and `runPath` has to relieve it itself.
     *
     * No portfolio, no scheduled loan, no returns and no property tax, so the
     * only tax in `taxPaid` is the pension's and the only unfunded krone is the
     * one the year borrows. `spending` is the free parameter: raise it and the
     * household borrows, lower it and it lives off its pension and borrows
     * nothing. The two runs share a pension, so the second is the same household
     * assessed without the borrowed-equity fradrag — the reference the first is
     * measured against.
     */
    const equityBorrower = (annualSpending: number, homeValue = 4_000_000) => {
      const base = retiredWithLoan(0)
      return simulatePlanning(
        makeState({
          ...base,
          homeValue,
          startInvestments: 0,
          annualSpending,
          mortgageRate: 0.04,
          pension: {
            ...base.pension,
            person1: {
              ...DEFAULT_PENSION_PERSON,
              ratepensionBalance: 3_000_000,
              folkepensionAge: 67,
            },
            pensionReturn: 0,
            ratepensionYears: 15,
          },
        })
      )
    }

    it("relieves interest on equity borrowed to fund spending", () => {
      const RATE = 0.04
      const borrowing = equityBorrower(400_000)
      const solvent = equityBorrower(100_000) // funded by the pension alone
      const first = at(borrowing, 66)
      const second = at(borrowing, 67)
      expect(first.borrowed).toBeGreaterThan(0) // year 1 has no balance yet
      expect(at(solvent, 67).borrowed).toBe(0)

      // The relief is what the reported tax fell by against the household that
      // borrowed nothing — same pension, same assessment, one fradrag apart.
      const relief = at(solvent, 67).taxPaid - second.taxPaid
      const grossInterest = first.borrowed * RATE
      expect(relief).toBeGreaterThan(0)
      expect(relief).toBeLessThan(grossInterest)
      // A plausible Danish marginal relief rate: kommune and kirke plus § 11's
      // 8 %, nowhere near a topskat-sized number.
      expect(relief / grossInterest).toBeGreaterThan(0.25)
      expect(relief / grossInterest).toBeLessThan(0.45)

      // And it is the same krone the cash flow kept. With nothing else to draw
      // on, the year borrows its spending plus the *net* interest, less the
      // pension it lives on — and the reported income is that pension plus the
      // relief, so the two rearrange to the gross interest exactly.
      expect(second.borrowed - 400_000 + second.retirementIncome).toBeCloseTo(
        grossInterest,
        6
      )
    })

    it("reports the borrowed-equity relief, not just spends it", () => {
      // The relief is realised as a smaller outflow, so nothing forces it into
      // the figures the UI reads — and while it was missing from them, an
      // equity-borrowing year showed the corrected wealth alongside a tax bill
      // and a net income that both still assumed no fradrag at all.
      const borrowing = equityBorrower(400_000)
      const solvent = equityBorrower(100_000)
      let relieved = 0
      for (const p of borrowing.points.filter((point) => point.age >= 67)) {
        const reference = at(solvent, p.age)
        const relief = reference.taxPaid - p.taxPaid
        expect(relief).toBeGreaterThan(0)
        // The mirror image: a krone off the tax is a krone onto the net income.
        expect(p.retirementIncome - reference.retirementIncome).toBeCloseTo(
          relief,
          6
        )
        relieved += relief
      }
      expect(relieved).toBeGreaterThan(50_000)
    })

    it("never relieves more than the household had tax to reduce", () => {
      // The relief saturates: past § 11's beløbsgrænse the 8 % stops, and once
      // the deduction has eaten the skattepligtige indkomst the kommune- and
      // kirkeskat go with it. A household deep enough in borrowed equity asks
      // about an `extra` several times its whole pension, and the answer has to
      // be the tax it actually owed — a marginal rate measured on a small probe
      // and multiplied out sails past every one of those breakpoints and refunds
      // tax nobody paid.
      const HOME = 40_000_000 // deep enough to keep lending for the whole horizon
      const r = equityBorrower(2_000_000, HOME)
      const solvent = equityBorrower(100_000, HOME)
      // Housing return and inflation are 0 here, so what the house has lost in
      // equity is exactly the balance the borrowing has run up.
      const balanceEnteringYear = (age: number) =>
        HOME - at(r, age - 1).homeEquity
      const ctx: TaxContext = {
        t: 0,
        inflation: 0,
        profile: DEFAULT_TAX_PROFILE,
        married: false,
      }

      const late = r.points.filter((p) => p.age >= 72)
      expect(late.length).toBeGreaterThan(5)
      for (const p of late) {
        const reference = at(solvent, p.age)
        const gross = reference.retirementIncome + reference.taxPaid
        const extra = balanceEnteringYear(p.age) * 0.04
        expect(extra).toBeGreaterThan(gross) // more deduction than income
        // What the discarded linear approximation would have paid out: a rate
        // read off a 10.000 kr. probe, multiplied across the whole `extra`.
        const probe = 10_000
        const rate =
          (pTax(gross) - pensionIncomeTax(gross, ctx, undefined, probe)) / probe
        // It exceeds the household's entire tax bill, so the reported figure it
        // is subtracted from would have gone negative.
        expect(rate * extra).toBeGreaterThan(reference.taxPaid)

        const relief = reference.taxPaid - p.taxPaid
        expect(relief).toBeGreaterThan(0)
        expect(relief).toBeLessThanOrEqual(reference.taxPaid + 1e-9)
        expect(p.taxPaid).toBeGreaterThanOrEqual(0)
        // And the gap is not a rounding one: the linear figure is half again
        // what the brackets actually had left to give.
        expect(rate * extra).toBeGreaterThan(1.5 * relief)
      }
      // The tax that survives is bundskat, which is levied on personlig
      // indkomst — negative kapitalindkomst never reaches it, so the relief
      // saturates strictly above zero rather than wiping the bill out.
      expect(Math.min(...late.map((p) => p.taxPaid))).toBeGreaterThan(0)
    })

    it("grants no deduction to a working household already on folkepension", () => {
      // `retirementAge` and folkepensionsalderen are separate inputs, so a
      // household can draw a taxed folkepension while the plan still counts it
      // as working — the one window where the retirement gate is observable.
      // It stays shut: the plan is still charging only the *excess* over the
      // budget's mortgage line, so the budget still holds the fradrag.
      const stillWorking = (mortgageBalance: number) =>
        simulatePlanning(
          makeState({
            currentAge: 66,
            endAge: 72,
            retirementAge: 75, // never retires inside the horizon
            startInvestments: 0,
            monthlyContribution: 30_000,
            homeValue: 4_000_000,
            mortgageBalance,
            mortgageRate: 0.04,
            mortgageTermYears: 30,
            assumptions: {
              ...DEFAULT_PLANNING_STATE.assumptions,
              investmentReturn: 0,
              investmentFee: 0,
              inflation: 0,
              housingReturn: 0,
              contributionGrowth: 0,
              volatility: 0,
            },
            pension: {
              ...DEFAULT_PLANNING_STATE.pension,
              person1: { ...DEFAULT_PENSION_PERSON, folkepensionAge: 67 },
              pensionReturn: 0,
            },
          })
        )
      const withLoan = at(stillWorking(2_000_000), 68)
      const noLoan = at(stillWorking(0), 68)
      expect(noLoan.taxPaid).toBeGreaterThan(0) // folkepension is being taxed
      expect(withLoan.taxPaid).toBe(noLoan.taxPaid)
      expect(withLoan.retirementIncome).toBe(noLoan.retirementIncome)
    })

    it("grants no deduction before retirement, where the budget already has", () => {
      // The contribution is a net, post-tax budget surplus, and a Danish
      // household's take-home is already withheld on a trækprocent that carries
      // its renteudgifter. Handing the fradrag over again here would count it
      // twice — so the working year's deposit is the contribution plus what the
      // budget deducted, less the modelled service, and not a krone more.
      const service = serviceOf(2_000_000, 0.04, 30 * 12)
      const working = simulatePlanning(
        makeState({
          currentAge: 40,
          endAge: 50,
          retirementAge: 100, // never retires inside the horizon
          startInvestments: 0,
          monthlyContribution: 30_000, // 360.000/yr, comfortably above the loan
          homeValue: 4_000_000,
          mortgageBalance: 2_000_000,
          mortgageRate: 0.04,
          mortgageTermYears: 30,
          mortgageBudgetedMonthly: 0, // budget deducted nothing → charge it all
          assumptions: {
            ...DEFAULT_PLANNING_STATE.assumptions,
            investmentReturn: 0,
            investmentFee: 0,
            inflation: 0,
            housingReturn: 0,
            contributionGrowth: 0,
            volatility: 0,
          },
        })
      )
      expect(service).toBeGreaterThan(100_000)
      expect(at(working, 41).contributionYoY).toBeCloseTo(360_000 - service, 6)
    })

    it("does not soften the afdragsfrihed step-up with a fradrag", () => {
      // The step-up is *principal* falling due, not interest: when interest-only
      // years end the payment jumps while the interest itself is flat across the
      // step and declining after it. So there is no missing fradrag hiding in
      // the cliff, and the contribution has to absorb the whole of it.
      const IO = 5
      const base = {
        currentAge: 40,
        endAge: 50,
        retirementAge: 100,
        startInvestments: 0,
        monthlyContribution: 30_000,
        homeValue: 4_000_000,
        mortgageBalance: 2_000_000,
        mortgageRate: 0.04,
        mortgageTermYears: 30,
        mortgageInterestOnlyYears: IO,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          inflation: 0,
          housingReturn: 0,
          contributionGrowth: 0,
          volatility: 0,
        },
      }
      const r = simulatePlanning(makeState(base))
      const stepUp =
        serviceOf(2_000_000, 0.04, (30 - IO) * 12) -
        serviceOf(2_000_000, 0.04, 30 * 12, true)
      expect(stepUp).toBeGreaterThan(0)
      const before = at(r, 45).contributionYoY
      const after = at(r, 46).contributionYoY
      expect(before - after).toBeCloseTo(stepUp, 6)
    })
  })

  /**
   * A regression lock on the whole projection, not on any one figure it reports.
   *
   * The engine is a long chain of arithmetic whose parts are individually
   * plausible, so a change to one of them can move a number thirty years later
   * without failing a single one of the tests above — every one of which asserts
   * a property rather than the series. These fixtures pin the series itself, so
   * that a change meant to be behaviour-preserving has to prove it is.
   *
   * They are deliberately *not* a description of anything. When one fails, the
   * question it answers is "did anything move?", and the field it names is where
   * to start looking; the tests above are what say whether the movement is right.
   */
  describe("regression fingerprint", () => {
    /**
     * How far a value may sit from its reference before this counts as a change,
     * as a fraction of the largest value in the same series.
     *
     * Relative to the series rather than to each value: the rounding error that
     * accumulates through fifty-one years of compounding is set by the size of
     * the numbers being compounded, not by whatever is left in a balance that
     * has since run down to a few kroner. A per-value relative tolerance would
     * hold those tail values to a precision the arithmetic never had.
     *
     * 1e-9 sits in the gap between two measured quantities:
     *
     * - Below it, ~1e-12 relative, is the disagreement between JavaScript
     *   runtimes. The engine leans on `Math.pow` in the annuity formula and on
     *   `Math.log`/`Math.cos` in the Box–Muller draw, none of which ECMAScript
     *   requires to be correctly rounded, so two V8 builds can differ in the
     *   last bits and half a century of compounding amplifies the difference.
     * - Above it, 1e-7 relative, is the smallest change we would call a
     *   regression: a nudge of that size to the mortgage balance is 0,24 kr on
     *   this fixture's 2,4 mio. and fails here by two orders of magnitude,
     *   before it has propagated into anything else.
     *
     * This replaces a hash of the float64 bits. Bit-equality is the strictest
     * lock available and needs no tolerance at all, but it locks the runtime as
     * well as the behaviour: it made CI red for a difference no user could
     * observe, and a digest can only say *that* something moved, never how far
     * — which is exactly the question a cross-runtime failure turns on.
     * Quantising to a fixed precision and hashing that would keep the digests
     * compact, but a value landing within an ULP of a quantisation boundary
     * would still round to different buckets on different runtimes, trading a
     * reproducible failure for an occasional one. Comparing numbers has no
     * boundary to land on.
     */
    const TOLERANCE = 1e-9

    /** Every number the result reports, one array per reported field. */
    const seriesOf = (r: PlanningResult): Record<string, number[]> => {
      const of = (pick: (p: PlanningResult["points"][number]) => number) =>
        r.points.map(pick)
      return {
        age: of((p) => p.age),
        investments: of((p) => p.investments),
        homeEquity: of((p) => p.homeEquity),
        cash: of((p) => p.cash),
        otherDebt: of((p) => p.otherDebt),
        netWorth: of((p) => p.netWorth),
        bandLow: of((p) => p.band[0]),
        bandHigh: of((p) => p.band[1]),
        investmentsBandLow: of((p) => p.investmentsBand[0]),
        investmentsBandHigh: of((p) => p.investmentsBand[1]),
        contributionsTotal: of((p) => p.contributionsTotal),
        housingGainsTotal: of((p) => p.housingGainsTotal),
        investmentGainsTotal: of((p) => p.investmentGainsTotal),
        contributionYoY: of((p) => p.contributionYoY),
        housingGainYoY: of((p) => p.housingGainYoY),
        investmentGainYoY: of((p) => p.investmentGainYoY),
        retirementIncome: of((p) => p.retirementIncome),
        taxPaid: of((p) => p.taxPaid),
        spending: of((p) => p.spending),
        investmentsSold: of((p) => p.investmentsSold),
        borrowed: of((p) => p.borrowed),
        propertyTax: of((p) => p.propertyTax),
        // The result's scalars, and the length the series above are taken over
        // — without which a shorter projection could still match everywhere it
        // overlapped the reference.
        scalars: [
          r.points.length,
          r.fiAge ?? -1,
          r.debtFreeAge ?? -1,
          r.ruinAge ?? -1,
          r.successProbability,
        ],
      }
    }

    /** The worst a series deviates from its reference, and where. */
    const worstDeviation = (got: number[], want: number[]) => {
      // One scale for the whole series, so the comparison is the same size at
      // every point of it — see {@link TOLERANCE}.
      const scale = Math.max(...want.map((v) => Math.abs(v)), 1)
      let at = 0
      let off = 0
      for (const [i, w] of want.entries()) {
        const d = Math.abs(got[i] - w) / scale
        if (d > off) {
          off = d
          at = i
        }
      }
      return { at, off }
    }

    /**
     * Compare a projection against a stored one, series by series, reporting the
     * value that moved furthest in each.
     *
     * Per series rather than one verdict for the whole result, so a failure
     * names the fields that changed — which is most of the way to the cause —
     * and by how much, which is what says whether the change is a regression or
     * a runtime drifting further than {@link TOLERANCE} allows for.
     */
    const expectMatchesReference = (
      r: PlanningResult,
      reference: Record<string, number[]>
    ) => {
      const actual = seriesOf(r)
      // By name, so a field added to the result cannot quietly go unlocked.
      expect(Object.keys(actual).sort()).toEqual(Object.keys(reference).sort())

      const moved: string[] = []
      for (const [field, want] of Object.entries(reference)) {
        const got = actual[field]
        if (got.length !== want.length) {
          moved.push(`${field}: ${want.length} values, got ${got.length}`)
          continue
        }
        const { at, off } = worstDeviation(got, want)
        OBSERVED.push([field, off])
        if (off > TOLERANCE) {
          moved.push(
            `${field}[${at}]: ${want[at]} -> ${got[at]}` +
              ` (${off.toExponential(1)} of series scale)`
          )
        }
      }
      expect(moved).toEqual([])
    }

    const OBSERVED: Array<[string, number]> = []

    /**
     * One household exercising every branch the loan touches: afdragsfrihed, a
     * move that swaps the loan for a bigger one, a sale that settles what is left
     * of it out of the proceeds, a second property that outlives the first, bank
     * debt serviced from the drawdown, property tax settled against it, and a
     * retirement long enough to eat the portfolio and start borrowing against the
     * house.
     */
    it("reproduces the whole projection of a plan that uses every loan branch", () => {
      const r = simulatePlanning(
        makeState({
          currentAge: 40,
          endAge: 90,
          retirementAge: 66,
          startInvestments: 900_000,
          cashBuffer: 120_000,
          monthlyContribution: 9_000,
          annualSpending: 700_000,
          properties: [
            property({
              value: 3_600_000,
              landValue: 1_100_000,
              acquisitionAge: 0,
              disposalAge: 78,
            }),
            property({
              value: 1_400_000,
              landValue: 500_000,
              kind: "fritidsbolig",
              acquisitionAge: 58,
            }),
          ],
          includePropertyTax: true,
          mortgageBalance: 2_400_000,
          mortgageRate: 0.042,
          mortgageBidragssats: 0.0085,
          mortgageTermYears: 28,
          mortgageInterestOnlyYears: 6,
          mortgageBudgetedMonthly: 11_500,
          otherDebtBalance: 420_000,
          otherDebtRate: 0.069,
          otherDebtTermYears: 9,
          events: [
            {
              id: "e1",
              type: "expense",
              label: "Bil",
              age: 47,
              amount: 250_000,
            },
            {
              id: "e2",
              type: "property",
              label: "Nyt hus",
              age: 52,
              newValue: 5_200_000,
              mortgageLtv: 0.78,
              housingReturnOverride: 0.03,
            },
            {
              id: "e3",
              type: "recurring",
              label: "Lønhop",
              age: 55,
              monthlyDelta: 2_500,
            },
            {
              id: "e4",
              type: "windfall",
              label: "Arv",
              age: 61,
              amount: 400_000,
            },
          ],
          pension: {
            ...DEFAULT_PLANNING_STATE.pension,
            person1: {
              ...DEFAULT_PENSION_PERSON,
              ratepensionBalance: 1_800_000,
              livrenteBalance: 900_000,
              aldersopsparingBalance: 300_000,
              ratepensionAnnual: 40_000,
              folkepensionAge: 69,
            },
            ratepensionYears: 12,
          },
        })
      )
      // The fixture is only worth its size while it still reaches the branches
      // it was built for, and nothing else here would notice if it stopped.
      const borrowingAges = r.points
        .filter((p) => p.borrowed > 0)
        .map((p) => p.age)
      expect(borrowingAges.some((age) => age < 78)).toBe(true) // loan still live
      expect(borrowingAges.some((age) => age > 78)).toBe(true) // loan settled
      expect(r.points.every((p) => p.age === 40 || p.propertyTax > 0)).toBe(
        true
      )
      expect(r.ruinAge).toBe(86)

      expectMatchesReference(r, EVERY_LOAN_BRANCH)
    })

    /**
     * Two moves at the same age, which is the one case where the loan a move
     * leaves behind is read again before the year is out: the second sale
     * realises the equity in the home the first one bought, so it has to see the
     * first move's loan and not the one the household woke up with.
     *
     * Paired at the starting age as well as mid-plan, because those are two
     * different loops — events at `currentAge` fire before year 1 — and the
     * first of them is the only reader of today's balance.
     */
    it("chains a second move at the same age onto the first one's loan", () => {
      const r = simulatePlanning(
        makeState({
          currentAge: 40,
          endAge: 50,
          startInvestments: 300_000,
          monthlyContribution: 5_000,
          homeValue: 2_000_000,
          mortgageBalance: 1_200_000,
          mortgageRate: 0.04,
          mortgageBidragssats: 0.008,
          events: [
            {
              id: "m0a",
              type: "property",
              label: "Straks-flytning",
              age: 40,
              newValue: 2_600_000,
              mortgageLtv: 0.7,
            },
            {
              id: "m0b",
              type: "property",
              label: "Straks-flytning igen",
              age: 40,
              newValue: 2_100_000,
              mortgageLtv: 0.5,
            },
            {
              id: "m1",
              type: "property",
              label: "Første flytning",
              age: 44,
              newValue: 3_000_000,
              mortgageLtv: 0.6,
            },
            {
              id: "m2",
              type: "property",
              label: "Anden flytning",
              age: 44,
              newValue: 4_500_000,
              mortgageLtv: 0.85,
            },
          ],
        })
      )
      expectMatchesReference(r, CHAINED_MOVES)
    })

    it("PROBE", () => {
      const over = OBSERVED.filter(([, off]) => off > 1e-11)
      expect(over.map(([f, off]) => `${f}: ${off.toExponential(2)}`)).toEqual([])
    })

    // The two references, kept below the fixtures that produce them so the
    // plans stay readable. Both were recorded from the engine itself and
    // written out in full — every entry is the shortest decimal that reads back
    // as the same double, so nothing here is rounded and the whole of the slack
    // in the comparison is {@link TOLERANCE} rather than the way the numbers
    // were written down. They are meant to be re-recorded, never edited, when a
    // deliberate change moves them.
    const EVERY_LOAN_BRANCH: Record<string, number[]> = {
      age: [
        40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
        58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
        76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90,
      ],
      investments: [
        900000, 1051770.48, 1213156.303416, 1384689.9596946072,
        1566932.1755106584, 1760473.3887823962, 1965935.2991762396,
        1867450.4309852743, 2016442.3122527339, 2175770.0127143506,
        2346034.269651303, 2527868.7932904153, 4196643.765466826,
        4413610.248141461, 4641793.897970375, 4881774.642495443,
        5134162.391512457, 5399598.587153652, 4034089.228646774,
        4213117.675936936, 4404004.323097466, 5007482.245134855,
        5245250.621467101, 5498235.925930495, 5767354.963116427,
        6053563.766986535, 5541494.95952065, 4958340.708592186,
        4298939.253594552, 5037905.477965486, 4385767.1539230365,
        3649846.001841573, 2823698.034533712, 1899413.432348398,
        864507.5997546103, 0, 0, 0, 8859353.390247978, 7986986.351204075,
        7021313.375515396, 5952133.278815002, 4763390.024732107,
        3449643.5797724267, 2003521.3865763806, 416499.30157295265, 0, 0, 0, 0,
        0,
      ],
      homeEquity: [
        1200000, 1272000, 1345440, 1420348.8000000003, 1496755.7760000005,
        1574690.8915200005, 1654184.7093504006, 1803086.0794837628,
        1956512.941237729, 2114622.0637787334, 2277576.188749184,
        2445544.271195628, 1144000, 1368980.2569328435, 1601594.1110035996,
        1842108.429355781, 2090799.7062039627, 2347954.4210563316,
        4013869.410655932, 4316852.255179419, 4629781.67925375,
        4952999.168373739, 5286858.425326815, 5631725.823735694,
        5987980.878984617, 6356016.73721346, 6736240.683091454,
        7129074.667110978, 7534955.853171639, 7954337.187255932,
        8387687.988030063, 8835494.560237126, 9298260.831784876,
        9776509.015466725, 10270780.29629263, 10573189.764092663,
        10166739.054279054, 9665141.508982893, -109976.47960460279,
        -68369.95251720818, -25931.294888066128, 17356.135893658735,
        61509.31529101776, 106545.55827632407, 152482.5261213365,
        199338.23332324903, 0, 0, 0, 0, 0,
      ],
      cash: [
        120000, 122400, 124848, 127344.96, 129891.8592, 132489.696384,
        135139.49031168, 137842.28011791361, 140599.1257202719,
        143411.10823467735, 146279.3303993709, 149204.9170073583,
        152189.01534750548, 129181.97644270619, 108186.23340124369,
        89293.76257317301, 65249.99670741278, 43214.529727528236, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0,
      ],
      otherDebt: [
        420000, 385113.7728946289, 347742.79187518795, 307710.0815985185,
        264826.06174198724, 218887.64922018675, 169677.2964574732,
        116961.96116195152, 60492.00272213245, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      netWorth: [
        1800000, 2061056.7071053712, 2335701.511540812, 2624673.638096089,
        2928753.748968672, 3248766.32746621, 3585582.202380847,
        3691416.829424999, 4053062.3764886023, 4433803.184727762,
        4769889.788799858, 5122617.981493402, 5492832.780814332,
        5911772.48151701, 6351574.242375217, 6813176.834424397,
        7290212.094423832, 7790767.537937511, 8047958.639302706,
        8529969.931116356, 9033786.002351215, 9960481.413508594,
        10532109.046793915, 11129961.74966619, 11755335.842101045,
        12409580.504199995, 12277735.642612103, 12087415.375703163,
        11833895.10676619, 12992242.66522142, 12773455.1419531,
        12485340.5620787, 12121958.866318587, 11675922.447815124,
        11135287.89604724, 10573189.764092663, 10166739.054279054,
        9665141.508982893, 8749376.910643376, 7918616.398686867,
        6995382.08062733, 5969489.414708661, 4824899.340023125,
        3556189.138048751, 2156003.912697717, 615837.5348962017, 0, 0, 0, 0, 0,
      ],
      bandLow: [
        1800000, 1641001.176445935, 1722746.4755846974, 1894672.9219763475,
        2083931.1184522584, 2274769.074876596, 2548293.2724697413,
        2492975.4909819793, 2798269.032355214, 2999511.469204924,
        3176257.935095505, 3332241.3134110477, 3613196.3929965417,
        3767124.6037609987, 4011259.543249519, 4218811.00987291,
        4270298.379564274, 4617917.6608688515, 4730816.004127557,
        4816798.099483011, 4992832.427552246, 5482538.918281749,
        5823151.505414728, 6180309.7754011955, 6297859.222741865,
        6790300.63260125, 6380707.890908861, 6001217.526619455,
        5637622.077211678, 6278605.536890329, 5872731.01778208,
        5474115.982439546, 4756580.487329607, 4296960.485179695,
        3892444.2199191963, 3359664.268301932, 2246489.586839269,
        1592732.8287434112, -10295.778464850038, -1373388.9506597025,
        -2629065.982574136, -3477126.4328195034, -3927978.397576104,
        -4392100.728311874, -4452379.2754920395, -4842958.264463956,
        -4893874.5261434475, -4778023.031967991, -4830269.209782914,
        -4756988.601189813, -4719422.048134677,
      ],
      bandHigh: [
        1800000, 2435642.9826185782, 2891040.410514124, 3408407.0619665524,
        3844410.5357520226, 4406090.729590356, 4873141.807756215,
        5128737.106252438, 5448231.238562058, 5999716.605053401,
        6484373.0162494825, 6997654.974404663, 7374795.85230264,
        8186811.689378431, 8978529.578933991, 9600311.408003619,
        10455108.385737281, 11015439.761415591, 11060324.792493893,
        12081427.247972103, 13396825.599890672, 14309428.166855192,
        15517122.308780242, 16549417.092392495, 17647050.03403633,
        18612771.11548637, 18375478.393617906, 18213496.75039091,
        18331978.361305594, 20242857.89319262, 20658450.50193937,
        20060812.85734187, 20952827.11840425, 20143435.723059736,
        20256879.907253183, 20296703.120879453, 20222260.644604344,
        19889471.776856367, 19159882.5981712, 18154691.90862251,
        17746774.08302421, 17434804.369605653, 16641347.050998386,
        15256577.222736541, 13996188.670926128, 12670040.062734703,
        11494698.72192089, 9673809.23896584, 8604535.32897495,
        6563968.214511424, 4756400.786154389,
      ],
      investmentsBandLow: [
        900000, 910955.4652610498, 1007415.5656719212, 1095321.86665991,
        1209061.1343854596, 1314357.3257726356, 1480472.9596479915,
        1312184.7387365322, 1353993.479133304, 1407041.087991839,
        1478142.735679965, 1582307.5130001009, 2317007.3776490362,
        2329185.2807193534, 2313769.3698610114, 2340488.1816842826,
        2423859.93504723, 2508131.36003634, 1062050.7011810194,
        1173411.1608750813, 1156556.469965274, 1552852.178273249,
        1593504.571003345, 1611815.503952672, 1643952.6550864773,
        1746877.0149305991, 1153590.5692304764, 370888.19843745546, 0,
        144202.20636499382, 0, 0, 0, 0, 0, 0, 0, 0, 4197965.121216737,
        2828402.8082169537, 1322618.2536339436, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ],
      investmentsBandHigh: [
        900000, 1193543.8243708268, 1431441.117699259, 1686536.1227907431,
        1944579.440570611, 2245494.7154691294, 2572022.2830376243,
        2535974.9231767077, 2719974.4745450304, 3052575.199152102,
        3356819.619768479, 3622200.1627127435, 6078606.836955134,
        6769762.150113864, 7321470.7047399655, 7617459.433407829,
        8174695.793456485, 8263047.835452204, 7098145.39890666,
        7648229.189342222, 8293616.644882884, 8994920.976884665,
        9410715.967826746, 10633412.677858502, 10427997.100876316,
        11216855.957206277, 10568912.262700817, 10917130.059450692,
        10769592.882893087, 11182292.28223032, 10741941.921437705,
        10958228.3186346, 10606222.407986574, 9539828.316412939,
        8390613.351685299, 7201584.675806573, 6704853.521419317,
        5769288.415999751, 18338304.50127512, 17637177.396805678,
        16886393.784867298, 16845194.73697128, 15418880.46679404,
        13802315.01263488, 12981904.079004599, 11115848.351135336,
        10028592.657385066, 8370285.026185488, 6585788.253272203,
        4760110.613665327, 3160202.0800745236,
      ],
      contributionsTotal: [
        0, 105240.48, 212249.7696, 321063.244992, 431716.98989183997,
        544247.8096896767, 658693.2458834703, 708569.5227250934,
        761014.2167106142, 816091.8496287643, 873868.7969083849,
        934413.3488065249, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565, 997795.7738528565, 997795.7738528565,
        997795.7738528565,
      ],
      housingGainsTotal: [
        0, 72000, 145440, 220348.80000000028, 296755.77600000054,
        374690.8915200005, 454184.7093504006, 603086.0794837628,
        756512.941237729, 914622.0637787334, 1077576.188749184,
        1245544.2711956282, 1418701.7305169646, 1643681.987449808,
        1876295.8415205642, 2116810.1598727456, 2365501.4367209272,
        2622656.151573296, 2888571.1411728966, 3191553.9856963838,
        3504483.409770714, 3827700.898890704, 4161560.1558437794,
        4506427.554252659, 4862682.609501582, 5230718.467730424,
        5610942.413608419, 6003776.397627942, 6409657.583688604,
        6829038.917772897, 7262389.718547028, 7710196.290754091,
        8172962.562301841, 8651210.74598369, 9145482.026809594,
        9447891.494609628, 9041440.784796018, 8539843.239499858,
        8907263.309356695, 8948869.83644409, 8991308.49407323,
        9034595.924854957, 9078749.104252316, 9123785.347237622,
        9169722.315082636, 9216578.022284549, 9017239.788961299,
        9017239.788961299, 9017239.788961299, 9017239.788961299,
        9017239.788961299,
      ],
      investmentGainsTotal: [
        0, 46530, 100906.53381600001, 163626.71470260722, 235215.18561881842,
        316225.5790927195, 407242.05329276936, 508880.90826018096,
        605428.0955421197, 709678.163085586, 822165.472742918,
        943455.4444838903, 1074146.2610970049, 1291112.74377164,
        1519296.3936005535, 1759277.138125622, 2011664.8871426363,
        2277101.0827838304, 2556260.329739674, 2764822.742860712,
        2982640.9267066517, 3210327.9502107906, 3469214.7822842626,
        3740394.2394141117, 4024653.0367847183, 4322825.288377837,
        4635794.535131041, 4922289.824538259, 5178636.039172475,
        5400891.198583313, 5661350.911794129, 5888095.07365195,
        6076792.111947159, 6222777.300332552, 6320976.974784964,
        6365672.017692277, 6365672.017692277, 6365672.017692277,
        6365672.017692277, 6823700.587968098, 7236627.782325349,
        7599629.683839494, 7907354.97435423, 8153622.23863288,
        8331968.811707115, 8435550.867393114, 8457083.881284436,
        8457083.881284436, 8457083.881284436, 8457083.881284436,
        8457083.881284436,
      ],
      contributionYoY: [
        0, 105240.48, 107009.2896, 108813.47539200001, 110653.74489983998,
        112530.81979783678, 114445.43619379353, 49876.27684162316,
        52444.69398552076, 55077.63291815013, 57776.94727962062,
        60544.551898140024, 63382.42504633163, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0,
      ],
      housingGainYoY: [
        0, 72000, 73440, 74908.80000000028, 76406.97600000026,
        77935.11551999999, 79493.81783040008, 148901.37013336224,
        153426.8617539662, 158109.12254100433, 162954.12497045053,
        167968.0824464443, 173157.45932133636, 224980.25693284348,
        232613.85407075612, 240514.31835218146, 248691.27684818162,
        257154.71485236892, 265914.98959960043, 302982.84452348715,
        312929.42407433037, 323217.4891199898, 333859.2569530755,
        344867.3984088795, 356255.05524892267, 368035.8582288427,
        380223.9458779944, 392833.9840195235, 405881.18606066145,
        419381.3340842929, 433350.80077413097, 447806.57220706344,
        462766.27154774964, 478248.1836818494, 494271.28082590364,
        302409.4678000342, -406450.7098136097, -501597.5452961605,
        367420.0698568374, 41606.527087394614, 42438.65762914205,
        43287.43078172486, 44153.179397359025, 45036.24298530631,
        45936.967845012434, 46855.70720191253, -199338.23332324903, 0, 0, 0, 0,
      ],
      investmentGainYoY: [
        0, 46530, 54376.533816, 62720.1808866072, 71588.4709162112,
        81010.39347390104, 91016.4742000499, 101638.8549674116,
        96547.18728193869, 104250.06754346634, 112487.30965733193,
        121289.97174097238, 130690.81661311448, 216966.48267463493,
        228183.64982891356, 239980.74452506838, 252387.74901701443,
        265436.19564119406, 279159.2469558438, 208562.41312103823,
        217818.18384593964, 227687.02350413898, 258886.832073472,
        271179.4571298492, 284258.7973706066, 298172.2515931193,
        312969.24675320386, 286495.28940721764, 256346.214634216,
        222255.15941083836, 260459.71321081565, 226744.161857821,
        188697.03829520935, 145985.18838539292, 98199.67445241219,
        44695.04290731336, 0, 0, 0, 458028.5702758205, 412927.1943572507,
        363001.90151414595, 307725.2905147356, 246267.26427864996,
        178346.57307423447, 103582.05568599889, 21533.013891321654, 0, 0, 0, 0,
      ],
      retirementIncome: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 837437.0120244767, 834681.9527068245, 831674.6885343273,
        2074624.2815070753, 873993.230189053, 869822.5630462336,
        865015.710128552, 858767.35118216, 848110.7517347882, 834988.3679101084,
        819846.009536373, 775111.0570356192, 301690.32347340166,
        301995.09788988414, 302283.52785367245, 302554.8480414853,
        302791.96459445223, 302991.3138162689, 303135.6909132821,
        303195.9066937403, 303138.2795115822, 306151.64733931737,
        306226.33978954627, 305657.84189514484, 299489.1905914968,
      ],
      taxPaid: [
        0, 19559.52, 19950.7104, 20349.724608000004, 20756.71910016,
        21171.853482163202, 21595.290551806465, 22027.196362842595,
        22467.74029009945, 22917.095095901437, 23375.436997819466,
        23842.945737775855, 24319.804652531373, 28530.494234658483,
        29384.79205341017, 30267.233060571358, 31174.59057690272,
        32110.336224920688, 301025.7486166608, 45407.34743651896,
        46487.86428318283, 47538.87487635831, 48314.95667108781,
        49355.37006992657, 50361.778718318805, 51349.3270207516,
        590084.0423197452, 605779.1312193583, 622118.4385679235,
        442275.8959632594, 642872.1511757057, 659908.8401005265,
        677526.2645910141, 696429.9260620113, 720049.3071062871,
        661232.2879184192, 418223.0463053591, 380347.15387476503,
        64974.892219277586, 81687.3585198042, 98750.13655252176,
        120527.28102126946, 152319.74806677073, 182649.8073028042,
        213130.15502849835, 244483.1111565019, 95466.93251742003,
        51520.821168890776, 49237.20042844383, 46553.99604445161,
        40756.10589265663,
      ],
      spending: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1171392.6800478178, 1194820.533648774, 1218716.9443217497,
        1243091.2832081846, 1267953.1088723484, 1293312.1710497953,
        1319178.4144707911, 1345561.982760207, 1372473.2224154111,
        1399922.6868637195, 1427921.1406009938, 1456479.563413014,
        1485609.154681274, 1515321.3377748996, 1545627.7645303975,
        1576540.3198210057, 1608071.1262174258, 1640232.5487417744,
        1673037.19971661, 1706497.943710942, 1740627.902585161,
        1775440.460636864, 1810949.2698496017, 1847168.2552465936,
        1884111.6203515255,
      ],
      investmentsSold: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1644668.6054627218, 29533.96583087527, 26931.536685411294,
        24209.101466750108, 21118.455741225764, 18194.152666455084,
        15139.760184675222, 11963.447723011344, 825038.0542190884,
        869649.5403356819, 915747.6696318496, 0, 912598.0372532652,
        962665.3139392846, 1014845.0056030705, 1070269.790570707,
        1133105.5070461999, 909202.6426619237, 0, 0, 1283184.6681963538,
        1330395.6093197244, 1378600.1700459295, 1432181.9982145394,
        1496468.5445976304, 1560013.7092383306, 1624468.7662702808,
        1690604.1406894268, 438032.3154642743, 0, 0, 0, 0,
      ],
      borrowed: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 208445.78135321068, 934471.2262907866,
        1047385.8263303019, 0, 0, 0, 0, 0, 0, 0, 0, 247131.05466919998,
        48748.67777286982, 49723.6513283276, 50718.12435489381,
        51732.48684199201,
      ],
      propertyTax: [
        0, 19559.52, 19950.7104, 20349.724608000004, 20756.71910016,
        21171.853482163202, 21595.290551806465, 22027.196362842595,
        22467.74029009945, 22917.095095901437, 23375.436997819466,
        23842.945737775855, 24319.804652531373, 28530.494234658483,
        29384.79205341017, 30267.233060571358, 31174.59057690272,
        32110.336224920688, 40824.9907407202, 41972.186691698415,
        43151.912379211426, 44366.58521857997, 45614.13018624235,
        46900.13791558056, 48219.3403020178, 49580.75375871862,
        50979.00943568102, 52416.776811171716, 53896.88635052629,
        55420.561094801466, 56985.435435891544, 58598.126881450444,
        60254.416351249434, 61959.28484329965, 63714.12833658743,
        65518.381634774734, 67375.43907558604, 69286.81351664766,
        7273.117961561037, 7418.580320792258, 7566.951927208103,
        8607.910146222692, 11787.16135517373, 12716.488631459442,
        12970.81840408863, 13230.234772170405, 8521.616888799066,
        8692.049226575047, 8865.890211106549, 9043.20801532868,
        9224.072175635254,
      ],
      scalars: [51, -1, -1, 86, 0.1775],
    }
    const CHAINED_MOVES: Record<string, number[]> = {
      age: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
      investments: [
        50000, 43915.60566522069, 38788.086123289715, 34735.42764417947,
        658597.4708883043, 505352.31706029363, 343645.48749971297,
        173196.63456937353, 0, 0, 0,
      ],
      homeEquity: [
        1050000, 1110490.8825491457, 1172575.1121832926, 1236300.181425037,
        675000, 832359.6435718881, 994263.6229534224, 1160859.7466197778,
        1326324.5642397031, 1325387.4347939014, 1324561.2448453596,
      ],
      cash: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      otherDebt: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      netWorth: [
        1100000, 1154406.4882143664, 1211363.1983065824, 1271035.6090692165,
        1333597.4708883043, 1337711.9606321817, 1337909.1104531353,
        1334056.3811891512, 1326324.5642397031, 1325387.4347939014,
        1324561.2448453596,
      ],
      bandLow: [
        1100000, 924345.8688538995, 889280.4539106498, 902944.6417208313,
        882611.6154809858, 728294.7109410884, 608628.4781878231,
        407928.1103676057, 264719.4286839113, 206773.4823998023,
        150692.4125670276,
      ],
      bandHigh: [
        1100000, 1342657.1178856522, 1483888.7781337346, 1649818.9633361008,
        1779772.6247057207, 2002910.8257628367, 2216106.2658782513,
        2430753.6124560647, 2501407.2543431055, 2698125.5858897367,
        2890477.404768124,
      ],
      investmentsBandLow: [
        50000, 35442.72472191697, 28915.11165493095, 23135.220034726215,
        207611.61548098584, 28589.819603273558, 0, 0, 0, 0, 0,
      ],
      investmentsBandHigh: [
        50000, 51234.88929777518, 48424.58372642381, 46309.09165018957,
        1104772.6247057207, 962289.6826832867, 828286.2423483108,
        656868.0884127261, 506607.0205614066, 333836.40201353986,
        159563.40632805365,
      ],
      contributionsTotal: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      housingGainsTotal: [
        0, 60490.882549145725, 122575.11218329263, 186300.1814250371,
        251715.1692577037, 409074.8128295918, 570978.7922111261,
        737574.9158774815, 903039.7334974068, 902102.6040516051,
        901276.4141030633,
      ],
      investmentGainsTotal: [
        0, 2585, 4855.43681289191, 6860.780865465989, 8656.602474670068,
        42706.091719595395, 68832.80651161258, 86599.27821534775,
        95553.54422258436, 95553.54422258436, 95553.54422258436,
      ],
      contributionYoY: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      housingGainYoY: [
        0, 60490.882549145725, 62084.229634146905, 63725.069241744466,
        65414.98783266661, 157359.6435718881, 161903.97938153427,
        166596.1236663554, 165464.81761992536, -937.1294458017219,
        -826.1899485418107,
      ],
      investmentGainYoY: [
        0, 2585, 2270.43681289191, 2005.3440525740784, 1795.8216092040789,
        34049.48924492533, 26126.71479201718, 17766.471703735162,
        8954.266007236612, 0, 0,
      ],
      retirementIncome: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      taxPaid: [
        0, 115.26, 191.4336, 229.22092800000004, 229.47561792, 2507.3675040672,
        4884.166412347969, 7151.716966784417, 8998.344046097402, 0, 0,
      ],
      spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      investmentsSold: [
        0, 8669.394334779314, 7397.956354822881, 6058.002531684325,
        4648.9476227829755, 187294.64307293596, 187833.54435259776,
        188215.3246340746, 182150.90057661015, 0, 0,
      ],
      borrowed: [
        0, 0, 0, 0, 0, 0, 0, 0, 5976.53405621514, 177382.2680943895,
        182439.35760697268,
      ],
      propertyTax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      scalars: [11, -1, -1, -1, 0.895],
    }
  })

  it("is deterministic across runs and keeps p10 <= median <= p90", () => {
    const state = makeState({
      currentAge: 30,
      endAge: 60,
      startInvestments: 200000,
      monthlyContribution: 10000,
    })
    const a = simulatePlanning(state)
    const b = simulatePlanning(state)
    expect(a.points.at(-1)!.band).toEqual(b.points.at(-1)!.band)

    const last = a.points.at(-1)!
    expect(last.band[0]).toBeLessThanOrEqual(last.netWorth)
    expect(last.netWorth).toBeLessThanOrEqual(last.band[1])
  })
})
