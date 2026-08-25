import { describe, it, expect } from "vitest"
import {
  simulatePlanning,
  solveRequiredMonthlyContribution,
} from "../simulate"
import {
  DEFAULT_PENSION_PERSON,
  DEFAULT_PLANNING_STATE,
  DEFAULT_TAX_PROFILE,
  type PlanningState,
} from "../types"
import { amortizeYear } from "../amortisation"
import { applyScenario } from "../scenario"
import { pensionIncomeTax, type TaxContext } from "../taxation"
import { afterPalReturn } from "../pension"

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
 * A year's loan service (principal repaid + interest), from the loan module
 * rather than restated from the simulation — so the mortgage expectations below
 * are independent figures and not a copy of the implementation.
 */
function serviceOf(
  balance: number,
  rate: number,
  months: number,
  interestOnly = false
): number {
  const y = amortizeYear(balance, rate, months, interestOnly)
  return balance - y.balance + y.interest
}

function makeState(overrides: Partial<PlanningState> = {}): PlanningState {
  return {
    ...DEFAULT_PLANNING_STATE,
    assumptions: { ...DEFAULT_PLANNING_STATE.assumptions, ...(overrides.assumptions ?? {}) },
    ...overrides,
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
      events: [{ id: "e1", type: "expense", label: "Bryllup", age: 32, amount: 200000 }],
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
          { id: "r1", type: "recurring", label: "Lønhop", age: 31, monthlyDelta: 5000 },
        ],
      })
    )
    // Age 31: +100k windfall, contribution still 0 that year → 100k.
    expect(res.points.find((p) => p.age === 31)!.investments).toBeCloseTo(100000, 0)
    // Age 32: +60k/yr from the recurring change → 160k.
    expect(res.points.find((p) => p.age === 32)!.investments).toBeCloseTo(160000, 0)
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
    expect(res.points.find((p) => p.age === 31)!.investments).toBeCloseTo(12000, 0)
    expect(res.points.find((p) => p.age === 32)!.investments).toBeCloseTo(12000, 0)
    expect(res.points.find((p) => p.age === 34)!.investments).toBeCloseTo(12000, 0)
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
    const run = (mortgageInterestOnlyYears: number) =>
      simulatePlanning(makeState({ ...base, mortgageInterestOnlyYears }))
    const contribAt = (r: ReturnType<typeof run>, age: number) =>
      r.points.find((p) => p.age === age)!.contributionYoY

    const IO_YEARS = 5
    const service = (balance: number, months: number, interestOnly = false) =>
      serviceOf(balance, 0.04, months, interestOnly)
    const payment = service(2_000_000, 20 * 12) // level annuity, ~145.435/yr
    const ioService = service(2_000_000, 20 * 12, true) // balance stands still
    // Maturity is fixed: the term lost the afdragsfri years.
    const stepUp = service(2_000_000, (20 - IO_YEARS) * 12) - ioService

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
          ...base,
          retirementAge: 44,
          startInvestments: 5_000_000, // deep enough never to run dry
          annualSpending: 100_000,
          mortgageInterestOnlyYears: IO_YEARS,
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
            ...base,
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
        pension: { ...DEFAULT_PLANNING_STATE.pension, includeFolkepension: false },
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
      makeState({ currentAge: 30, endAge: 60, homeValue: 0, mortgageBalance: 0 })
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
    expect(at65(couple)).toBeCloseTo(2 * (100000 - pTax(100000, true, 100000)), 0)
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
    expect(withGain.points.find((p) => p.age === 65)!.taxPaid).toBeGreaterThan(0)
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
    expect(res.points.find((p) => p.age === 67)!.retirementIncome).toBeCloseTo(0, 0)
    expect(res.points.find((p) => p.age === 69)!.retirementIncome).toBeCloseTo(0, 0)
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
    // Ages 66–67: no pension income → borrow 100k/yr → equity falls to 4.8M.
    const at67 = res.points.find((p) => p.age === 67)!
    expect(at67.homeEquity).toBeCloseTo(4_800_000, -3)
    expect(at67.borrowed).toBeCloseTo(100_000, 0)
    // Age 68: 500k lump − 100k spending = 400k surplus. It first repays the
    // 200k of borrowed equity (equity back to 5M), then 200k tops up investments.
    const at68 = res.points.find((p) => p.age === 68)!
    expect(at68.homeEquity).toBeCloseTo(5_000_000, -3)
    expect(at68.investments).toBeCloseTo(200_000, 0)
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
      simulatePlanning(makeState({ ...common, investmentTaxMode: mode })).points.find(
        (p) => p.age === 50
      )!.investments
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
        pension: { ...DEFAULT_PLANNING_STATE.pension, includeFolkepension: false },
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
        pension: { ...DEFAULT_PLANNING_STATE.pension, includeFolkepension: false },
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
      pension: { ...DEFAULT_PLANNING_STATE.pension, includeFolkepension: false },
    }
    const off = simulatePlanning(makeState({ ...base, includePropertyTax: false }))
    const on = simulatePlanning(makeState({ ...base, includePropertyTax: true }))
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
      pension: { ...DEFAULT_PLANNING_STATE.pension, includeFolkepension: false },
    }
    const inBudget = simulatePlanning(makeState({ ...base, propertyTaxInBudget: true }))
    const onTop = simulatePlanning(makeState({ ...base, propertyTaxInBudget: false }))
    expect(inBudget.points.find((p) => p.age === 66)!.propertyTax).toBe(0)
    expect(onTop.points.find((p) => p.age === 66)!.propertyTax).toBeGreaterThan(0)
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
        pension: { ...DEFAULT_PLANNING_STATE.pension, includeFolkepension: false },
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
      expect(res.points.find((p) => p.age === 41)!.propertyTax).toBeGreaterThan(0)
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
