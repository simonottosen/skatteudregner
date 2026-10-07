import { describe, it, expect } from "vitest"
import { simulatePlanning, solveRequiredMonthlyContribution } from "../simulate"
import {
  DEFAULT_PENSION_PERSON,
  DEFAULT_PLANNING_STATE,
  DEFAULT_TAX_PROFILE,
  type PlannedLoan,
  type PlannedProperty,
  type PlanningPoint,
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
import { maxInterestOnlyYears, normalizeLoans } from "../loans"
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
    // Owner-occupied, which is what every expectation below was recorded
    // against. The engine does not read `use` at all — `RunProperty` does not
    // carry it — so no recorded number here turns on this line.
    use: "own",
    landValue: 0,
    // A sale that costs nothing. Deliberately *not* DEFAULT_SALE_COSTS_PCT:
    // zero is what the field defaulted to when every expectation below was
    // recorded, and stating it here is what holds the fixtures at those numbers
    // now that the default is a real 3 %. Change this line and all three locks
    // move.
    saleCostsPct: 0,
    acquisitionAge: 0,
    disposalAge: null,
    // All-equity, and the plan's own housing return: the two defaults every
    // expectation below predates. The tests about financing pass their own.
    financing: null,
    housingReturn: null,
    ...fields,
  }
}

let loanIds = 0

/**
 * A plan loan with the fields these tests rarely care about filled in: a
 * 30-year realkreditlån at 4 %, repaying from the first year, free of bidrag.
 *
 * `propertyId` is left null and the loan is still a claim on the home — see
 * `reducesHomeEquity` in `../simulate` — which is what lets the one-home
 * shorthand below stay a shorthand. The property list is built inside
 * {@link makeState} and has no id a call site could name; the tests that are
 * about which property secures what pass `properties` and `loans` together.
 *
 * Which property's *sale* settles such a loan is the household's last, and in a
 * one-home plan that is the home — so the shorthand means what it has always
 * meant. A plan with a second property has to say: `propertyId` is what the
 * engine settles on, and a loan that names none outlives the first sale.
 */
function loan(
  fields: Partial<PlannedLoan> & { principal: number }
): PlannedLoan {
  return {
    id: `l${loanIds++}`,
    label: "Realkreditlån",
    type: "realkredit",
    propertyId: null,
    rate: 0.04,
    termMonths: 30 * 12,
    interestOnlyYears: 0,
    bidragssats: 0,
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
        loans: [loan({ principal: 1_000_000 })],
        // This is a balance-sheet test: the household's budget pays the loan, so
        // the cash flow has nothing to charge and cannot borrow against the very
        // equity being measured.
        mortgageBudgetedMonthly: serviceOf(1_000_000, 0.04, 30 * 12) / 12,
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

  it("handles a move (sell + buy with mortgage) stated as two list entries", () => {
    // A move is a disposal age on the home being left and a second entry bought
    // the same year, carrying the financing that pays for it. The household's
    // old mortgage comes off that sale's proceeds and the new one is drawn
    // against the new house, so only the down payment touches the portfolio.
    const old = property({ value: 2_000_000, disposalAge: 41 })
    const next = property({
      value: 3_000_000,
      acquisitionAge: 41,
      financing: { ltv: 0.8 },
    })
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 41,
        startInvestments: 0,
        monthlyContribution: 0,
        properties: [old, next],
        // Named, because the sale of the house that secures it is what settles
        // it: an unattributed loan would attach to the property the household
        // lets go of last, which here is the one it never sells.
        loans: [loan({ principal: 500_000, propertyId: old.id })], // equity = 1.5M
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          investmentReturn: 0,
          investmentFee: 0,
          housingReturn: 0,
          volatility: 0,
        },
      })
    )
    // At age 41: realise 1.5M equity, pay 20% down (600k) → investments = 0.9M.
    const at41 = res.points.find((p) => p.age === 41)!
    expect(at41.investments).toBeCloseTo(900_000, 0)
    expect(at41.homeEquity).toBeCloseTo(600_000, 0) // 3.0M - 2.4M mortgage
  })

  it("detects FI age when investments reach 25x annual spending", () => {
    const res = simulatePlanning(
      makeState({
        currentAge: 30,
        endAge: 70,
        startInvestments: 1_000_000,
        monthlyContribution: 20000,
        homeValue: 0,
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
        loans: [loan({ principal: 2_000_000, termMonths: 20 * 12 })],
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
    const theLoan = loan({ principal: 2_000_000, termMonths: 20 * 12 })
    const base = {
      currentAge: 40,
      endAge: 90,
      retirementAge: 65,
      startInvestments: 0,
      monthlyContribution: 20_000,
      homeValue: 3_000_000,
      loans: [theLoan],
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        housingReturn: 0,
        volatility: 0,
      },
    }
    const plain = simulatePlanning(makeState(base))
    const io = simulatePlanning(
      makeState({ ...base, loans: [{ ...theLoan, interestOnlyYears: 5 }] })
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

  /**
   * Afdragsfrihed for as much of the term as a loan may carry: the whole of it
   * bar the final year.
   *
   * Version 2 of the plan let `mortgageInterestOnlyYears` reach
   * `mortgageTermYears`, and such a plan had no debt-free age at all — nothing
   * was ever scheduled to repay the principal. The move to a list settled that
   * in favour of {@link maxInterestOnlyYears}, which caps afdragsfrihed a year
   * short, on the ground that a loan nothing ever repays is not the fixed
   * maturity a `PlannedLoan` promises. So the balance now falls off a cliff in
   * that last year instead of rolling to maturity, and the milestone the
   * household is shown is the maturity age rather than "never".
   */
  it("holds the balance flat under afdragsfrihed, then clears it at maturity", () => {
    // The household never retires inside the horizon, so the balance moves only
    // with the loan schedule — a retired one would have to borrow against the
    // house to keep paying the interest, which is its own case below.
    //
    // A small loan against a big saving, so that the cliff is a payment the
    // household can actually make: nineteen years of afdragsfrihed pile the
    // whole principal into year twenty, and one it could not afford would be
    // borrowed back against the house, leaving the debt standing and telling us
    // about the equity borrowing rather than about the schedule.
    const principal = 300_000
    const termMonths = 20 * 12
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 90,
        retirementAge: 95,
        startInvestments: 0,
        monthlyContribution: 30_000,
        homeValue: 3_000_000,
        loans: [
          loan({
            principal,
            termMonths,
            interestOnlyYears: maxInterestOnlyYears({ termMonths }),
          }),
        ],
        // The budget pays this loan's interest, so the saving absorbs only the
        // principal when it falls due.
        mortgageBudgetedMonthly:
          serviceOf(principal, 0.04, termMonths, true) / 12,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          housingReturn: 0,
          volatility: 0,
        },
      })
    )
    // Nineteen years of interest only: equity is still the down payment.
    expect(res.points.find((p) => p.age === 59)!.homeEquity).toBeCloseTo(
      3_000_000 - principal,
      0
    )
    // Then the whole balance in one year, and the house is owned outright.
    expect(res.debtFreeAge).toBe(60)
    expect(res.points.find((p) => p.age === 70)!.homeEquity).toBeCloseTo(
      3_000_000,
      0
    )
  })

  it("caps afdragsfrihed a year short of maturity when migrating a plan", () => {
    // The bound above is the normalizer's, so a version-2 plan that used the
    // whole of its term arrives clamped rather than being read as a loan with
    // no repayment date. Pinned here because the projection's milestone turns
    // on it: 19 gives a debt-free age of 60, 20 gives none.
    const [migrated] = normalizeLoans(
      {
        mortgageBalance: 2_000_000,
        mortgageRate: 0.04,
        mortgageTermYears: 20,
        mortgageInterestOnlyYears: 20,
      },
      []
    )
    expect(migrated.termMonths).toBe(20 * 12)
    expect(migrated.interestOnlyYears).toBe(19)
    expect(migrated.interestOnlyYears).toBe(maxInterestOnlyYears(migrated))
  })

  it("dates the debt-free age by the home's loan, not by a bank loan", () => {
    // "Gældfri bolig" is the milestone, so a student or car loan running past
    // the mortgage neither postpones it nor brings it forward. The projection
    // reports that debt on its own line (`otherDebt`) precisely because it sits
    // outside the home equity the mortgage comes off.
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 90,
        retirementAge: 65,
        startInvestments: 0,
        monthlyContribution: 0,
        homeValue: 3_000_000,
        loans: [
          loan({ principal: 2_000_000, termMonths: 20 * 12 }),
          // Outlives the mortgage by a decade.
          loan({
            type: "bank",
            label: "SU-gæld",
            principal: 300_000,
            rate: 0.06,
            termMonths: 30 * 12,
          }),
        ],
        mortgageBudgetedMonthly: serviceOf(2_000_000, 0.04, 20 * 12) / 12,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          housingReturn: 0,
          volatility: 0,
        },
      })
    )
    expect(res.debtFreeAge).toBe(60)
    // The bank loan really is still owed in that year, so the two figures are
    // being kept apart rather than happening to agree.
    expect(res.points.find((p) => p.age === 60)!.otherDebt).toBeGreaterThan(
      100_000
    )
  })

  it("keeps a mortgage secured on the home even when the plan lists none", () => {
    // Reachable on the default path, not just in principle: `use-planning.ts`
    // infers a balance from the renteudgifter typed on /skat, while
    // `propertiesFromBudget` adds nothing to the property list until a market
    // value or a beskatningsgrundlag arrives. A realkreditlån is a lån mod pant
    // i fast ejendom — there is no unsecured kind — so such a plan has left its
    // home undescribed rather than described an unsecured loan, and reading it
    // as unsecured would move the balance off home equity and onto `otherDebt`
    // and leave the household with no debt-free age at all.
    const res = simulatePlanning(
      makeState({
        currentAge: 40,
        endAge: 70,
        retirementAge: 65,
        startInvestments: 0,
        monthlyContribution: 0,
        properties: [],
        loans: [loan({ principal: 1_000_000, termMonths: 20 * 12 })],
        mortgageBudgetedMonthly: serviceOf(1_000_000, 0.04, 20 * 12) / 12,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          housingReturn: 0,
          volatility: 0,
        },
      })
    )
    const at41 = res.points.find((p) => p.age === 41)!
    // A house worth nothing and a loan against it: equity is the debt, negative.
    expect(at41.homeEquity).toBeLessThan(-900_000)
    expect(at41.otherDebt).toBe(0)
    expect(res.debtFreeAge).toBe(60)
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

    const theLoan = loan({ principal: 2_000_000, termMonths: 20 * 12 })

    // Every source of growth is off, so a krone of net worth can only come from
    // a krone the household actually put in.
    const base = {
      currentAge: 40,
      endAge: 70,
      retirementAge: 100, // never retires — contributions run the whole horizon
      startInvestments: 0,
      monthlyContribution: 10_000,
      homeValue: 3_000_000,
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
    const withBudget = (interestOnlyYears: number) => ({
      ...base,
      loans: [{ ...theLoan, interestOnlyYears }],
      mortgageBudgetedMonthly:
        (interestOnlyYears >= 1 ? ioService : payment) / 12,
    })
    const run = (interestOnlyYears: number) =>
      simulatePlanning(makeState(withBudget(interestOnlyYears)))
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

    describe("a move re-prices the payment", () => {
      /**
       * A move is two rows of the property list: the home being left, carrying
       * a disposal age, and the one being bought, carrying the financing that
       * pays for it. Nothing else says it — there is no move event any more
       * (issue #9).
       *
       * The contribution is bigger than above, so the larger payment still fits
       * inside it and the whole reconciliation stays visible in the deposit.
       */
      const movePlan = (ltv: number, sellAt = 45, buyAt = 45) => {
        const leaving = property({ value: 3_000_000, disposalAge: sellAt })
        const arriving = property({
          value: 5_000_000,
          acquisitionAge: buyAt,
          financing: ltv > 0 ? { ltv } : null,
        })
        return makeState({
          ...withBudget(0),
          monthlyContribution: 30_000, // 360.000/yr
          // Deep enough that an all-equity purchase is paid for out of the
          // portfolio rather than by borrowing against the new house, whose
          // interest would otherwise follow the household through every later
          // year and muddy the reconciliation these tests are about. Nothing
          // grows, so the pot is inert.
          startInvestments: 6_000_000,
          // The same home `base` describes, spelled as a list because
          // `makeState`'s `homeValue` shorthand would otherwise win.
          homeValue: undefined,
          properties: [leaving, arriving],
          // Named, because the sale of the house it is lent against is what
          // settles it: an unattributed loan attaches to the property the
          // household lets go of last, which here is the one it never sells.
          loans: [{ ...theLoan, propertyId: leaving.id }],
        })
      }
      const move = (ltv: number) => simulatePlanning(movePlan(ltv))
      // The purchase's own loan: 30 years, per MORTGAGE_TERM_MONTHS in
      // simulate.ts, and priced at the mortgage it replaces.
      const newPayment = service(5_000_000 * 0.8, 30 * 12)

      it("keeps the old payment as the baseline after the loan is swapped", () => {
        // The budget was measured once, today, and never learns about the new
        // loan — so the household owes the difference between the two, not
        // nothing (which would make any move free) and not the whole new
        // payment (which would charge the old one twice).
        const r = move(0.8)
        expect(newPayment).toBeGreaterThan(payment)
        // The sale year itself is billed nothing: the old mortgage is settled
        // out of the proceeds before it is serviced, and the new one is drawn
        // at that year's close. So the budget's whole deduction comes back.
        expect(contribAt(r, 45)).toBeCloseTo(360_000 + payment, 6)
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
        const r = simulatePlanning(movePlan(0.8, 45, 50))
        // Sold at 45 and not yet re-bought: no loan to service, and the budget
        // hands its whole deduction back.
        expect(contribAt(r, 47)).toBeCloseTo(360_000 + payment, 6)
        // Bought again at 50, so the new loan is charged from the year after.
        expect(contribAt(r, 51)).toBeCloseTo(360_000 + payment - newPayment, 6)
        expect(contribAt(r, 60)).toBeCloseTo(360_000 + payment - newPayment, 6)
      })

      /**
       * Which of two realkreditlån the replacement is priced at: the bigger one.
       *
       * A move takes out a loan that does not exist yet, so it has no terms of
       * its own and the schedule has to borrow some. The household's own lender
       * is the only evidence there is, and with two loans the bigger balance is
       * the one it is mostly paying — a 2 M loan at 6 % beside a 1 M loan at 2 %
       * is not a household that borrows at 2 %. Averaging the two would be worse
       * than picking either: rates average, but afdragsfrihed windows do not, so
       * the blend would describe a loan neither lender offers.
       *
       * Asserted both ways round, because the list's order is not evidence about
       * anything — and taking the first or the last entry passes half of this.
       */
      it("prices a move's loan at the bigger of two realkreditlån", () => {
        // What the year after the move charges: the budget deducted nothing, so
        // the whole modelled payment comes off the contribution.
        const chargedAfterMove = (order: "big first" | "small first") => {
          const leaving = property({ value: 3_000_000, disposalAge: 45 })
          const arriving = property({
            value: 5_000_000,
            acquisitionAge: 45,
            financing: { ltv: 0.8 },
          })
          const big = loan({
            principal: 2_000_000,
            rate: 0.06,
            propertyId: leaving.id,
          })
          const small = loan({
            principal: 1_000_000,
            rate: 0.02,
            propertyId: leaving.id,
          })
          const r = simulatePlanning(
            makeState({
              ...base,
              monthlyContribution: 30_000, // 360.000/yr, above either payment
              homeValue: undefined,
              properties: [leaving, arriving],
              loans: order === "big first" ? [big, small] : [small, big],
              mortgageBudgetedMonthly: 0,
            })
          )
          return 360_000 - contribAt(r, 46)
        }
        const atBigRate = serviceOf(4_000_000, 0.06, 30 * 12)
        const atSmallRate = serviceOf(4_000_000, 0.02, 30 * 12)
        expect(atBigRate).toBeGreaterThan(atSmallRate)
        expect(chargedAfterMove("big first")).toBeCloseTo(atBigRate, 6)
        expect(chargedAfterMove("small first")).toBeCloseTo(atBigRate, 6)
      })

      /**
       * Buying a second house is not a move, and prices nothing off the first.
       *
       * The rule above borrows the terms of the mortgage the household hands
       * back, because a move hands one back. Issue #9's whole point is that it
       * may now buy *without* selling — and then nothing is surrendered, so the
       * loan still running on the house it keeps is not evidence about anything.
       * That is a contract the household is still a party to, at a rate it was
       * offered years ago, on a property no institut is being asked about.
       *
       * Picked to be unmistakable: the retained home borrows at 6 %, well above
       * the plan's own `equityBorrowingRate`, so pricing the second house off it
       * shows up in the first year the second house is billed.
       */
      it("does not price a kept-both purchase off the home it keeps", () => {
        const keeping = property({ value: 3_000_000 })
        const second = property({
          value: 5_000_000,
          acquisitionAge: 45,
          financing: { ltv: 0.8 },
        })
        const r = simulatePlanning(
          makeState({
            ...base,
            // Deep enough that neither year floors at nothing: the household
            // services both loans out of the deposit, so the deposit is where
            // the difference between them shows.
            monthlyContribution: 60_000,
            startInvestments: 6_000_000,
            homeValue: undefined,
            properties: [keeping, second],
            loans: [
              loan({
                principal: 2_000_000,
                rate: 0.06,
                propertyId: keeping.id,
              }),
            ],
            mortgageBudgetedMonthly: 0,
          })
        )
        const { equityBorrowingRate } = DEFAULT_PLANNING_STATE.assumptions
        const atOwnRate = serviceOf(4_000_000, equityBorrowingRate, 30 * 12)
        const atKeptHomesRate = serviceOf(4_000_000, 0.06, 30 * 12)
        expect(atKeptHomesRate).toBeGreaterThan(atOwnRate)
        // The kept home's own loan runs through both years and is billed in
        // both, so differencing them leaves only what the new loan costs.
        // Age 44 against 46, skipping the purchase year itself: the down
        // payment comes out of 45's deposit and would swamp the comparison.
        // Either side of it the kept home's own loan is billed the same level
        // annuity, so differencing leaves only what the new loan costs.
        expect(contribAt(r, 44) - contribAt(r, 46)).toBeCloseTo(atOwnRate, 6)
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
          loans: [loan({ principal: 2_000_000, termMonths: 20 * 12 })],
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
          loans: [
            loan({
              principal: quoted.loan,
              termMonths: 20 * 12,
              bidragssats: m.bidragssats,
            }),
          ],
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
      // The budget's `interestOnly` flag and the loan's `interestOnlyYears`
      // are separate inputs, so they can disagree: here the household pays
      // interest + bidrag only, while the plan amortizes from year one. The gap
      // is the afdrag, and it has to be charged — the plan cannot repay
      // principal out of money nobody paid.
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
          loans: [
            loan({
              principal: 2_000_000,
              termMonths: 20 * 12,
              bidragssats: m.bidragssats,
              // The plan disagrees with the budget: no afdragsfrihed here.
              interestOnlyYears: 0,
            }),
          ],
          mortgageBudgetedMonthly: mortgageMonthlyTotal(m),
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
        loans: [loan({ principal: 2_000_000, termMonths: 5 * 12 })],
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
    // back through `normalizePlanning`, so a `loans` override reaches the engine
    // unclamped — and `maxInterestOnlyYears` is the normalizer's bound, not the
    // engine's. That is the one way an afdragsfri period can outlast the loan it
    // belongs to. No clamp is needed at the point of use: past maturity
    // `amortizeYear` charges interest only regardless, so the extra afdragsfri
    // years ask for what already happens. This pins that, since the obvious
    // "fix" is a clamp no test can tell apart from its absence.
    const base = makeState({
      currentAge: 40,
      endAge: 90,
      retirementAge: 65,
      startInvestments: 0,
      monthlyContribution: 30_000,
      homeValue: 3_000_000,
      loans: [
        loan({
          principal: 2_000_000,
          termMonths: 30 * 12,
          interestOnlyYears: 25,
        }),
      ],
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        housingReturn: 0,
        volatility: 0,
      },
    })
    const res = simulatePlanning(
      applyScenario(base, {
        overrides: {
          loans: [{ ...base.loans[0], termMonths: 10 * 12 }],
        },
      })
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
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          equityBorrowingRate: rate,
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
    const repro = (equityBorrowingRate: number) =>
      makeState({
        currentAge: 65,
        endAge: 70,
        retirementAge: 65,
        startInvestments: 0,
        cashBuffer: 0,
        monthlyContribution: 0,
        annualSpending: 100_000,
        homeValue: 5_000_000,
        includePropertyTax: false,
        assumptions: {
          ...DEFAULT_PLANNING_STATE.assumptions,
          equityBorrowingRate,
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
          loans: [
            loan({ principal: 2_000_000, rate, termMonths: term * 12 }),
          ],
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
      // takes with it is the net equity — not a loan that follows it. Equity
      // borrowing is secured on the portfolio as a whole, so what settles it is
      // owning nothing, which is true for as long as the sale and the purchase
      // take: both are the same year here.
      const res = simulatePlanning(
        makeState({
          ...repro(0),
          endAge: 69,
          properties: [
            property({ value: 5_000_000, disposalAge: 67 }),
            property({ value: 2_000_000, acquisitionAge: 67 }),
          ],
        })
      )
      // Borrowed 100k at 66; the sale lands at the top of 67, before that
      // year's spending is funded. So 4.9M of equity is realised on the move,
      // of which 2M buys the new home outright, 2.9M lands in the portfolio and
      // the year's own 100.000 kr. then comes out of it.
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
        loans: [
          loan({
            type: "bank",
            principal: 200_000,
            rate: 0,
            termMonths: 10 * 12,
          }),
        ],
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
        loans: [
          loan({
            type: "bank",
            principal: 100_000,
            rate: 0,
            termMonths: 10 * 12, // still being paid off at 65
          }),
        ],
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

  it("charges a working household nothing for its other-debt service", () => {
    // The other side of the case above, and the asymmetry with the realkredit
    // service. /budget carries the housing loan on a line of its own that
    // `budgetExpenses` leaves out and `mortgageBudgetedMonthly` hands back, so
    // the working household can be charged what the modelled payment differs
    // from the budgeted one by. A banklån has no such line — the budget folds
    // every other repayment into its expense total — so charging it here would
    // bill the household twice, and the amortisation has to show up on the
    // balance sheet without touching the cash flow.
    const base = {
      currentAge: 40,
      endAge: 45,
      retirementAge: 65,
      startInvestments: 0,
      monthlyContribution: 10_000,
      homeValue: 0,
      assumptions: {
        ...DEFAULT_PLANNING_STATE.assumptions,
        investmentReturn: 0,
        investmentFee: 0,
        inflation: 0,
        volatility: 0,
        contributionGrowth: 0,
      },
    }
    const debtFree = simulatePlanning(makeState(base))
    const indebted = simulatePlanning(
      makeState({
        ...base,
        loans: [
          loan({
            type: "bank",
            principal: 400_000,
            rate: 0.08,
            termMonths: 10 * 12,
          }),
        ],
      })
    )
    const at = (r: typeof debtFree, age: number) =>
      r.points.find((p) => p.age === age)!

    // The whole contribution is still invested, to the krone, and nothing is
    // sold to service the loan.
    expect(at(debtFree, 45).investments).toBeCloseTo(120_000 * 5, 6)
    expect(at(indebted, 45).investments).toBeCloseTo(
      at(debtFree, 45).investments,
      6
    )
    expect(at(indebted, 45).investmentsSold).toBeCloseTo(0, 6)
    // But the loan really is being repaid — it is only the cash flow that is
    // left alone, not the balance.
    expect(at(indebted, 45).otherDebt).toBeLessThan(400_000)
    expect(at(indebted, 45).netWorth).toBeLessThan(at(debtFree, 45).netWorth)
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
          loans: [loan({ principal: 8_000_000, rate: 0 })],
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

    /**
     * Which sale settles which loan. `PlannedLoan.propertyId` used to be
     * decorative: the whole secured balance was settled against the *first*
     * property and nothing was settled against any other, whichever property
     * each loan named. So selling the home discharged a loan the summer house
     * secured, and selling the summer house discharged nothing — not even its
     * own mortgage, which the household then went on being billed for (#9).
     */
    /**
     * A working household that owns `properties`, owes `loans` and does nothing
     * else: no contribution, no spending, no pension, no property tax and no
     * cash buffer. The loan service is the only recurring flow and `still`
     * leaves the portfolio flat, so a transfer is the only thing that can move
     * `investments` by a round figure.
     */
    const settling = (properties: PlannedProperty[], loans: PlannedLoan[]) =>
      makeState({
        currentAge: 40,
        endAge: 45,
        retirementAge: 65,
        startInvestments: 2_000_000,
        monthlyContribution: 0,
        annualSpending: 0,
        properties,
        loans,
        assumptions: still,
      })

    const byAge = (properties: PlannedProperty[], loans: PlannedLoan[]) =>
      new Map(
        simulatePlanning(settling(properties, loans)).points.map((p) => [
          p.age,
          p,
        ])
      )

    /**
     * What is still owed on the properties at that age. Equity is value less
     * the secured balance, and under `still` the value is the plan's own figure
     * for as long as it is owned, so the balance is the difference.
     */
    const owed = (point: PlanningPoint, valueOwned: number) =>
      valueOwned - point.homeEquity

    describe("settling each loan against the property that secures it", () => {
      it("settles the summer house's own loan, and leaves the mortgage alone", () => {
        const theHome = home(4_000_000)
        const theSummer = { ...summer(2_000_000), disposalAge: 42 }
        const mortgage = loan({ principal: 1_000_000, propertyId: theHome.id })
        const onTheSummer = loan({
          principal: 600_000,
          propertyId: theSummer.id,
        })
        const sold = byAge([theHome, theSummer], [mortgage, onTheSummer])
        // From the sale on, the household owes its mortgage and nothing else —
        // and owes exactly what a household that never had the second loan
        // would. Both halves in one comparison: the summer house took its own
        // loan with it, and took nothing else.
        const mortgageOnly = byAge([theHome], [mortgage])
        for (const age of [42, 43, 44, 45]) {
          expect(owed(sold.get(age)!, 4_000_000)).toBeCloseTo(
            owed(mortgageOnly.get(age)!, 4_000_000),
            6
          )
        }
        // Against a mortgage large enough that settling it would have shown: a
        // loan already paid off agrees with everything.
        expect(owed(sold.get(45)!, 4_000_000)).toBeGreaterThan(800_000)

        // And out of its own proceeds, not forgiven: what reached the portfolio
        // is 2.000.000 less the balance the sale year opened with — one year of
        // a 30-year 4 % annuity, from the amortisation module rather than
        // restated from the engine. Read as the step in `investments` the sale
        // year adds over the one before it, which is what the pair above leaves
        // undetermined.
        const opening = amortizeYear(600_000, 0.04, 30 * 12, false).balance
        const banked = (at: number) =>
          sold.get(at)!.investments - mortgageOnly.get(at)!.investments
        expect(banked(42) - banked(41)).toBeCloseTo(2_000_000 - opening, 6)
      })

      it("keeps servicing a loan on the summer house after the home is sold", () => {
        const theHome = { ...home(4_000_000), disposalAge: 42 }
        const theSummer = summer(2_000_000)
        const onTheSummer = loan({
          principal: 1_000_000,
          propertyId: theSummer.id,
        })
        const after = byAge([theHome, theSummer], [onTheSummer])
        // Still owed in every year after the sale, and falling: the household
        // is paying the loan off, not carrying a balance nothing touches.
        const balances = [42, 43, 44, 45].map((age) =>
          owed(after.get(age)!, 2_000_000)
        )
        expect(balances[0]).toBeGreaterThan(800_000)
        for (let i = 1; i < balances.length; i++)
          expect(balances[i]).toBeLessThan(balances[i - 1])

        // And the whole 4.000.000 reached the portfolio, because the sale
        // settled nothing. Measured against the same plan with the home kept,
        // where the loan on the summer house costs exactly the same to service.
        const unsold = byAge([home(4_000_000), theSummer], [onTheSummer])
        for (const age of [42, 43, 44, 45]) {
          expect(
            after.get(age)!.investments - unsold.get(age)!.investments
          ).toBeCloseTo(4_000_000, 6)
        }
      })

      it("leaves a household that sold for less than it owed still owing it", () => {
        const owing = (value: number) =>
          byAge(
            [{ ...home(value), disposalAge: 42 }],
            [loan({ principal: 1_500_000, propertyId: null })]
          )
        const over = owing(2_000_000)
        const under = owing(1_000_000)
        // The two plans differ in the sale price alone, so until the sale year
        // they are the same household.
        expect(under.get(41)!.investments).toBeCloseTo(
          over.get(41)!.investments,
          6
        )
        // 500.000 banked against 500.000 drawn to cover the shortfall: the
        // whole million of difference in the price lands on the household. A
        // settlement floored at zero would have swallowed half of it.
        expect(
          over.get(42)!.investments - under.get(42)!.investments
        ).toBeCloseTo(1_000_000, 6)
      })

      it("takes the sale costs off the price the property has grown to", () => {
        const GROWTH = 0.05
        const START = 2_000_000
        // Two years of appreciation, because a percentage of the plan's own
        // figure would be a different number — and the wrong one.
        const GROWN = START * Math.pow(1 + GROWTH, 2)
        const proceeds = (saleCostsPct: number) =>
          simulatePlanning(
            makeState({
              ...settling(
                [{ ...home(START), disposalAge: 42, saleCostsPct }],
                []
              ),
              assumptions: { ...still, housingReturn: GROWTH },
            })
          ).points.find((p) => p.age === 42)!.investments - START

        // Nothing is withheld at 0, which is the field's default: every plan
        // saved before it existed projects exactly what it used to.
        expect(proceeds(0)).toBeCloseTo(GROWN, 6)
        expect(proceeds(0) - proceeds(0.03)).toBeCloseTo(GROWN * 0.03, 6)
        // 3 % of what it grew to, not 3 % of what the plan says it is worth.
        expect(GROWN * 0.03).not.toBeCloseTo(START * 0.03, 2)
      })

      it("holds an unattributed loan until the last property is gone", () => {
        const theHome = { ...home(4_000_000), disposalAge: 42 }
        const theSummer = { ...summer(2_000_000), disposalAge: 44 }
        // No pant: a realkredit whose property the plan does not name, which is
        // every migrated plan where the user detached the loan by hand.
        const detached = loan({ principal: 1_000_000, propertyId: null })
        const unnamed = byAge([theHome, theSummer], [detached])
        // The first sale settles nothing, so it is still owed afterwards.
        expect(owed(unnamed.get(43)!, 2_000_000)).toBeGreaterThan(800_000)
        // The second leaves the household owning nothing and owing nothing.
        expect(owed(unnamed.get(44)!, 0)).toBeCloseTo(0, 6)
        // And it comes due exactly where naming that property would have put
        // it — one rule, reached two ways, rather than a second settlement.
        const named = byAge(
          [theHome, theSummer],
          [{ ...detached, propertyId: theSummer.id }]
        )
        for (const age of [41, 42, 43, 44, 45]) {
          expect(unnamed.get(age)!.investments).toBeCloseTo(
            named.get(age)!.investments,
            6
          )
        }
      })

      it("settles it on the last property the household really owns", () => {
        // A flat sold at 30 and left in the list, which the form is free to
        // accept: the sale age is typed, and only the user can say whether a row
        // is history or a mistake. The projection starts at 40, so this entry
        // never changes hands inside it and carries no disposal year — the same
        // `Infinity` as a property kept for good. Reading it as the household's
        // last disposal would hang the loan on a sale that never comes.
        const longGone = { ...home(1_500_000), disposalAge: 30 }
        const theHome = { ...home(4_000_000), disposalAge: 42 }
        const detached = loan({ principal: 1_000_000, propertyId: null })
        const listed = byAge([theHome, longGone], [detached])
        // Owed up to the home's sale, and gone with it: that sale is the last
        // the plan makes, whatever the dead row says.
        expect(owed(listed.get(41)!, 4_000_000)).toBeGreaterThan(800_000)
        expect(owed(listed.get(42)!, 0)).toBeCloseTo(0, 6)
        // And settled out of the proceeds rather than forgiven — identical, year
        // for year, to the plan that names the home.
        const named = byAge(
          [theHome, longGone],
          [{ ...detached, propertyId: theHome.id }]
        )
        for (const age of [41, 42, 43, 44, 45]) {
          expect(listed.get(age)!.investments).toBeCloseTo(
            named.get(age)!.investments,
            6
          )
        }
      })
    })

    it("appreciates a property at its own rate where it states one", () => {
      // The other half of what a move event used to carry alone: its
      // `housingReturnOverride` applied to the one house it bought, and every
      // other entry was stuck with the plan's single figure. Stated per
      // property, a sommerhus and a lejlighed can grow apart — and an entry
      // that states nothing still follows the plan, which is what every plan
      // saved before the field existed says about every entry it has.
      const grown = byAge(
        [
          { ...home(4_000_000), housingReturn: 0.1 },
          { ...summer(2_000_000), housingReturn: null },
        ],
        []
      )
      // `still` zeroes the plan's own appreciation, so all of the growth here
      // is the home's own and the summer house is flat.
      expect(grown.get(41)!.homeEquity).toBeCloseTo(4_400_000 + 2_000_000, 6)
    })

    /**
     * What a purchase costs the household. A property with
     * {@link PlannedProperty.financing} draws a mortgage of its own at the close
     * of the year it is bought, so the portfolio pays the down payment and the
     * lender pays the rest; one without pays for the whole house out of the pot.
     *
     * This is the half of issue #9 the property list never had: a listed
     * acquisition used to be a house the household received for nothing — it
     * appeared on the balance sheet, no money left the portfolio and no debt
     * stood against it — and the only way to pay for a house was a move event,
     * which could buy exactly one and settled every mortgage the household had
     * on the way.
     */
    describe("paying for a property the plan buys", () => {
      const buying = (financing: { ltv: number } | null) =>
        byAge(
          [
            home(4_000_000),
            { ...summer(2_000_000), acquisitionAge: 42, financing },
          ],
          []
        )

      it("draws a loan for a financed purchase instead of paying cash", () => {
        const financed = buying({ ltv: 0.6 })
        const cash = buying(null)
        // The two plans differ in the financing alone, so until the purchase
        // they are the same household.
        expect(financed.get(41)!.investments).toBeCloseTo(
          cash.get(41)!.investments,
          6
        )
        // The portfolio pays 40 % of 2.000.000 and the lender pays the rest, so
        // what is left in it is the 1.200.000 the lender put up.
        expect(cash.get(42)!.investments).toBeCloseTo(0, 6)
        expect(
          financed.get(42)!.investments - cash.get(42)!.investments
        ).toBeCloseTo(1_200_000, 6)
        // And the debt stands against the house rather than vanishing: the same
        // 1.200.000 is missing from the household's equity.
        expect(
          cash.get(42)!.homeEquity - financed.get(42)!.homeEquity
        ).toBeCloseTo(1_200_000, 6)
        // It is a real loan, billed from the first full year the household has
        // it. Nothing here is a realkredit for it to be priced off, so it takes
        // the plan's own `equityBorrowingRate` over 30 years, with no bidrag and
        // no afdragsfrihed — the documented fallback, and the only branch of the
        // pricing rule a move cannot reach.
        expect(
          financed.get(42)!.investments - financed.get(43)!.investments
        ).toBeCloseTo(
          serviceOf(
            1_200_000,
            DEFAULT_PLANNING_STATE.assumptions.equityBorrowingRate,
            30 * 12
          ),
          6
        )
      })

      it("pays the whole price out of the portfolio when nothing finances it", () => {
        // `financing: null` is the field's default, so this is what every plan
        // saved before it existed says about every property on its list.
        const cash = buying(null)
        expect(cash.get(41)!.investments).toBeCloseTo(2_000_000, 6)
        expect(cash.get(42)!.investments).toBeCloseTo(0, 6)
        // Owned outright: both houses in full, and nothing to service, so the
        // emptied portfolio stays empty instead of being drawn on further.
        expect(cash.get(42)!.homeEquity).toBeCloseTo(6_000_000, 6)
        expect(cash.get(45)!.homeEquity).toBeCloseTo(6_000_000, 6)
        expect(cash.get(45)!.investments).toBeCloseTo(0, 6)
      })

      it("carries a second mortgage without discharging the first", () => {
        // The whole of issue #9 in one plan. Financing a second house used to
        // mean a move event, and a move settled *every* secured loan whichever
        // property it named — so buying the summer house paid off the mortgage
        // on the home. The two loans now come due at the two sales, three years
        // apart, in the order the plan makes them.
        const theHome = { ...home(4_000_000), disposalAge: 44 }
        const theSummer = {
          ...summer(2_000_000),
          acquisitionAge: 42,
          disposalAge: 43,
          financing: { ltv: 0.5 },
        }
        const mortgage = loan({ principal: 1_000_000, propertyId: theHome.id })
        const both = byAge([theHome, theSummer], [mortgage])
        const homeOnly = byAge([theHome], [mortgage])

        // The purchase leaves the mortgage exactly where it was: all the
        // household owes over the one that never bought is the new loan, drawn
        // at the close of the year of the purchase and so at full principal.
        expect(
          owed(both.get(42)!, 6_000_000) - owed(homeOnly.get(42)!, 4_000_000)
        ).toBeCloseTo(1_000_000, 6)
        // The summer house's sale settles the summer house's loan and nothing
        // else: from there on the two households owe the same mortgage, and it
        // is a balance large enough that discharging it would have shown.
        expect(owed(both.get(43)!, 4_000_000)).toBeCloseTo(
          owed(homeOnly.get(43)!, 4_000_000),
          6
        )
        expect(owed(both.get(43)!, 4_000_000)).toBeGreaterThan(900_000)
        // And the home's own sale settles the mortgage, a year later.
        expect(owed(both.get(44)!, 0)).toBeCloseTo(0, 6)

        // Each out of its own proceeds, not forgiven: the summer house is sold
        // for 2.000.000 the year after its loan is drawn, so the whole
        // 1.000.000 principal comes off the price.
        const banked = (at: number) =>
          both.get(at)!.investments - homeOnly.get(at)!.investments
        expect(banked(43) - banked(42)).toBeCloseTo(1_000_000, 6)
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
    const retiredWithLoan = (principal: number, bidragssats = BIDRAGSSATS) =>
      makeState({
        currentAge: 65,
        endAge: 80,
        retirementAge: 65,
        startInvestments: 2_000_000,
        monthlyContribution: 0,
        annualSpending: 250_000,
        homeValue: 4_000_000,
        // A real bidragssats, so the expectations below — all built from
        // `deductibleOf` — pin that the lender's fee earns the fradrag the
        // statute grants it, and that it does so without leaving the cash flow.
        loans: [loan({ principal, bidragssats })],
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
        simulatePlanning(retiredWithLoan(2_000_000, 0)),
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
          loans: [loan({ principal: 2_000_000, bidragssats: BIDRAGSSATS })],
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
        loans: [
          loan({
            type: "bank",
            principal: 500_000,
            rate: 0.08,
            termMonths: 10 * 12,
          }),
        ],
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
          assumptions: { ...base.assumptions, equityBorrowingRate: 0.04 },
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
      const stillWorking = (principal: number) =>
        simulatePlanning(
          makeState({
            currentAge: 66,
            endAge: 72,
            retirementAge: 75, // never retires inside the horizon
            startInvestments: 0,
            monthlyContribution: 30_000,
            homeValue: 4_000_000,
            // The zero-balance case is the no-loan one: a loan owing nothing
            // costs nothing and deducts nothing, which is what makes it the
            // reference the loan is compared against.
            loans: [loan({ principal })],
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
          loans: [loan({ principal: 2_000_000 })],
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
        loans: [loan({ principal: 2_000_000, interestOnlyYears: IO })],
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
  describe("regression lock", () => {
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
     * 1e-9 sits in the gap between two measured quantities.
     *
     * Under it is the disagreement between JavaScript runtimes. The engine
     * compounds with `Math.pow` — inflation in `taxation.ts`, the annuity in
     * `amortisation.ts` — and draws with `Math.log`/`Math.cos`, none of which
     * ECMAScript requires to be correctly rounded, so two V8 builds differ in
     * the last bits and half a century of compounding amplifies the difference.
     * That is why the deterministic series drift too and not just the bands.
     * These references were recorded on macOS/node 26; run against CI's
     * ubuntu/node 22, no series moved by as much as 1e-11 of its scale, so the
     * tolerance clears the observed drift by two orders of magnitude.
     *
     * Over it is the smallest change worth calling a regression. Perturbing the
     * modelled mortgage balance by 1e-7 — 0,24 kr on this fixture's 2,4 mio. —
     * moves fifteen of the series here, most of them by 1e-7 to 1e-6 of scale,
     * i.e. two to three orders of magnitude past the tolerance.
     *
     * This replaces a hash of the float64 bits. Bit-equality is the strictest
     * lock available and needs no tolerance at all, but it locks the runtime as
     * well as the behaviour: it made CI red for a difference no user could
     * observe, and a digest can only say *that* something moved, never how far —
     * which is exactly the question a cross-runtime failure turns on. Quantising
     * to a fixed precision and hashing that would keep the fixtures down to a
     * few hex strings, but a value sitting within an ULP of a quantisation
     * boundary would still fall into different buckets on different runtimes,
     * which trades a reproducible failure for an occasional one. Numbers have no
     * boundary to land on; the price is that the references below are long.
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
        // The figures the result reports once rather than per point, which the
        // series above cannot carry and nothing else here would notice.
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
        // A NaN would compare false against every threshold and slip through as
        // "unchanged", which is the one regression a lock must not miss.
        const d = Number.isNaN(got[i]) ? Infinity : Math.abs(got[i] - w) / scale
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
        if (off > TOLERANCE) {
          moved.push(
            `${field}[${at}]: ${want[at]} -> ${got[at]}` +
              ` (${off.toExponential(1)} of series scale)`
          )
        }
      }
      expect(moved).toEqual([])
    }

    /**
     * A household that says everything about its homes in the property list and
     * nothing in an event: a home sold at 55 and replaced the same year, a
     * summer house bought at 48 and sold at 72, a mortgage settled by the sale
     * that secures it, bank debt, property tax on two dwellings at once, and a
     * retirement long enough to run the portfolio down and start borrowing
     * against the house.
     *
     * This is the one fixture here that locks a *comparison* rather than a
     * projection. Every figure below was produced by the engine as it stood
     * before `PropertyEvent` was removed (05a415b) as well as by the engine as
     * it stands now — all twenty-two series and all five scalars, identical to
     * within {@link TOLERANCE}. Unifying the two mechanisms was meant to change
     * only what a move does; a plan that never had a move is where that claim is
     * falsifiable, and this is it, kept so the claim survives the branch it was
     * made on.
     *
     * Nothing here is financed: {@link PlannedProperty.financing} and
     * {@link PlannedProperty.housingReturn} are new fields and a plan saved
     * before them has neither, so leaving them at their defaults is what makes
     * the two engines comparable at all.
     */
    it("projects a plan stated only in the property list as it always did", () => {
      // Named: this household owns two properties at once from 48, so the
      // mortgage has to say which of them it is a claim on.
      const home = property({
        value: 3_200_000,
        landValue: 950_000,
        acquisitionAge: 0,
        disposalAge: 55,
        saleCostsPct: 0.03,
      })
      const r = simulatePlanning(
        makeState({
          currentAge: 40,
          endAge: 90,
          retirementAge: 66,
          startInvestments: 800_000,
          cashBuffer: 100_000,
          monthlyContribution: 8_500,
          annualSpending: 620_000,
          properties: [
            home,
            property({
              value: 2_400_000,
              landValue: 700_000,
              acquisitionAge: 55,
            }),
            property({
              value: 1_300_000,
              landValue: 450_000,
              kind: "fritidsbolig",
              acquisitionAge: 48,
              disposalAge: 72,
            }),
          ],
          includePropertyTax: true,
          loans: [
            loan({
              propertyId: home.id,
              principal: 1_900_000,
              rate: 0.043,
              bidragssats: 0.008,
              termMonths: 27 * 12,
              interestOnlyYears: 5,
            }),
            loan({
              label: "Banklån",
              type: "bank",
              principal: 300_000,
              rate: 0.071,
              termMonths: 8 * 12,
            }),
          ],
          mortgageBudgetedMonthly: 10_500,
          assumptions: {
            ...DEFAULT_PLANNING_STATE.assumptions,
            equityBorrowingRate: 0.043,
          },
          events: [
            {
              id: "e1",
              type: "expense",
              label: "Bil",
              age: 47,
              amount: 220_000,
            },
            {
              id: "e2",
              type: "recurring",
              label: "Lønhop",
              age: 57,
              monthlyDelta: 2_000,
            },
            {
              id: "e3",
              type: "windfall",
              label: "Arv",
              age: 63,
              amount: 350_000,
            },
          ],
          pension: {
            ...DEFAULT_PLANNING_STATE.pension,
            person1: {
              ...DEFAULT_PENSION_PERSON,
              ratepensionBalance: 1_500_000,
              livrenteBalance: 800_000,
              aldersopsparingBalance: 250_000,
              ratepensionAnnual: 35_000,
              folkepensionAge: 69,
            },
            ratepensionYears: 12,
          },
        })
      )
      // As above: the fixture is only worth its size while it still reaches the
      // branches it was built for, and nothing else here would notice if a later
      // edit left it describing a quieter household.
      expect(r.points.some((p) => p.borrowed > 0)).toBe(true)
      expect(r.points.every((p) => p.age === 40 || p.propertyTax > 0)).toBe(true)
      // Two dwellings at once between 48 and 54, which is where the per-property
      // ejendomsskat and the pensionistnedslag's two slots are both exercised.
      expect(r.points.find((p) => p.age === 50)!.propertyTax).toBeGreaterThan(
        r.points.find((p) => p.age === 47)!.propertyTax
      )

      expectMatchesReference(r, LIST_ONLY)
    })

    /**
     * One household exercising every branch the loan touches: afdragsfrihed, a
     * move that swaps the loan for a bigger one, a sale that settles what is left
     * of it out of the proceeds, a second property that outlives the first, bank
     * debt serviced from the drawdown, property tax settled against it, and a
     * retirement long enough to eat the portfolio and start borrowing against the
     * house.
     *
     * `equityBorrowingRate` is the realkreditlån's own rate, which is what a plan
     * saved before the loan list arrives with: the projection used to price
     * borrowing against the house at the mortgage's rate, and the migration seeds
     * the assumption from it. Naming it keeps these figures comparable to the ones
     * recorded then — the reference is only a lock while both sides describe the
     * same household.
     */
    it("reproduces the whole projection of a plan that uses every loan branch", () => {
      // Named rather than left to the shorthand, because this plan owns more
      // than one property at a time: the mortgage has to say it is the *first*
      // home's, or it would be settled by the last sale the plan makes — the
      // summer house's, which never comes — instead of by the move at 52.
      const home = property({
        value: 3_600_000,
        landValue: 1_100_000,
        acquisitionAge: 0,
        disposalAge: 52,
      })
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
            home,
            // The move: bought the year the first home is sold, financed at
            // 78 %, appreciating at a rate of its own, and sold at 78 — which
            // is what settles the loan it draws.
            property({
              value: 5_200_000,
              landValue: 1_250_000,
              acquisitionAge: 52,
              disposalAge: 78,
              financing: { ltv: 0.78 },
              housingReturn: 0.03,
            }),
            property({
              value: 1_400_000,
              landValue: 500_000,
              kind: "fritidsbolig",
              acquisitionAge: 58,
            }),
          ],
          includePropertyTax: true,
          loans: [
            loan({
              propertyId: home.id,
              principal: 2_400_000,
              rate: 0.042,
              bidragssats: 0.0085,
              termMonths: 28 * 12,
              interestOnlyYears: 6,
            }),
            loan({
              label: "Banklån",
              type: "bank",
              principal: 420_000,
              rate: 0.069,
              termMonths: 9 * 12,
            }),
          ],
          mortgageBudgetedMonthly: 11_500,
          assumptions: {
            ...DEFAULT_PLANNING_STATE.assumptions,
            equityBorrowingRate: 0.042,
          },
          events: [
            {
              id: "e1",
              type: "expense",
              label: "Bil",
              age: 47,
              amount: 250_000,
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
     * A household that moves twice, where the second move is the one case in
     * which a loan the projection itself minted is read again: the sale at 44
     * has to settle the mortgage drawn at 41 and nothing else, and the loan the
     * purchase at 44 draws has to be priced off *that* mortgage rather than off
     * the one the household woke up with.
     *
     * This is also, exactly, what a version-3 plan with four chained move events
     * migrates to — see `foldPropertyEvents` and the migration tests in
     * `normalize.test.ts`. Two moves at one age collapse, because a home owned
     * for no year at all is a window the engine reads as never owned.
     */
    it("chains a second move onto the loan the first one drew", () => {
      const home = property({ value: 2_000_000, disposalAge: 41 })
      const r = simulatePlanning(
        makeState({
          currentAge: 40,
          endAge: 50,
          startInvestments: 300_000,
          monthlyContribution: 5_000,
          properties: [
            home,
            property({
              value: 2_100_000,
              acquisitionAge: 41,
              disposalAge: 44,
              financing: { ltv: 0.5 },
            }),
            property({
              value: 4_500_000,
              acquisitionAge: 44,
              financing: { ltv: 0.85 },
            }),
          ],
          // Named, so the first home's sale is what settles it — the plan ends
          // owning a house it never sells, which is where an unattributed loan
          // would otherwise come due.
          loans: [
            loan({
              principal: 1_200_000,
              bidragssats: 0.008,
              propertyId: home.id,
            }),
          ],
          // The loan's own rate, as above.
          assumptions: {
            ...DEFAULT_PLANNING_STATE.assumptions,
            equityBorrowingRate: 0.04,
          },
        })
      )
      expectMatchesReference(r, CHAINED_MOVES)
    })

    // The three references, kept below the fixtures that produce them so the
    // plans stay readable. All were recorded from the engine itself and
    // written out in full — every entry is the shortest decimal that reads back
    // as the same double, so nothing here is rounded and the whole of the slack
    // in the comparison is {@link TOLERANCE} rather than the way the numbers
    // were written down. They are meant to be re-recorded, never edited, when a
    // deliberate change moves them.
    const LIST_ONLY: Record<string, number[]> = {
      age: [
        40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
        58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
        76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90,
      ],
      investments: [
        800000, 955189.36, 1120096.597112, 1295258.0173266903,
        1481238.3314893602, 1678632.1373875777, 1836061.594372414,
        1783925.4445642151, 632267.3145517504, 735372.3394220134,
        846130.3588957633, 964994.9968412601, 1092444.993771761,
        1228985.5608104477, 1375149.8057354132, 2133831.903244482,
        2486162.387008019, 2859028.584269447, 3236713.9712087256,
        3636003.1648354162, 4058054.6313989107, 4504087.560842568,
        4975385.02283847, 5823297.2863215655, 6367340.310982784,
        6941849.931118156, 6878258.336673848, 6775917.859299246,
        6631330.674219212, 7582362.025662536, 7481742.891081948,
        7335252.67211137, 9276253.739996826, 9183358.674102986,
        9039459.237472689, 8837939.034349745, 8569254.468514139,
        8185829.114136607, 7233233.876252037, 6180724.783973305,
        5022073.518343655, 3750717.6091781356, 2359741.535538804,
        841851.84004407, 0, 0, 0, 0, 0, 0, 0,
      ],
      homeEquity: [
        1300000, 1364000, 1429280, 1495865.6, 1563782.912, 1633058.5702400003,
        1756760.8771423777, 1884202.667709847, 3315514.2307481077,
        3476830.894901212, 3642813.2362006074, 3813617.694447077,
        3989406.6068075513, 4170348.4471854474, 4356618.075703745,
        3893291.3679440646, 3971157.1953029456, 4050580.3392090043,
        4131591.945993185, 4214223.784913048, 4298508.26061131,
        4384478.425823536, 4472167.994340006, 4561611.354226807,
        4652843.581311343, 4745900.4529375695, 4840818.461996321,
        4937634.831236248, 5036387.527860973, 5137115.278418193,
        5239857.583986556, 5344654.735666288, 3360579.4060618198,
        3427790.994183056, 3496346.8140667174, 3566273.750348052,
        3637599.2253550133, 3710351.2098621135, 3784558.2340593557,
        3860249.398740543, 3937454.386715354, 4016203.474449661,
        4096526.5005744146, 4178457.0514531876, 3682983.732672398,
        2495913.16018902, 1242668.9522759262, 0, 0, 0, 0,
      ],
      cash: [
        100000, 102000, 104040, 106120.8, 108243.216, 110408.08032000001,
        112616.2419264, 114868.56676492801, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      otherDebt: [
        300000, 271111.2003386136, 240103.21545520393, 206820.5890463636,
        171096.46105689486, 132751.73113891698, 91594.16074514535,
        47417.4093547526, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0,
      ],
      netWorth: [
        1900000, 2150078.159661386, 2413313.381656796, 2690423.828280327,
        2982167.998432466, 3289347.0568086607, 3613844.5526960464,
        3735579.269684238, 3947781.545299858, 4212203.234323225,
        4488943.59509637, 4778612.691288337, 5081851.600579312,
        5399334.007995895, 5731767.881439158, 6027123.271188546,
        6457319.582310964, 6909608.923478451, 7368305.91720191,
        7850226.949748464, 8356562.89201022, 8888565.986666104,
        9447553.017178476, 10384908.640548373, 11020183.892294127,
        11687750.384055726, 11719076.798670169, 11713552.690535493,
        11667718.202080185, 12719477.304080728, 12721600.475068504,
        12679907.407777658, 12636833.146058645, 12611149.668286042,
        12535806.051539406, 12404212.784697797, 12206853.693869151,
        11896180.323998721, 11017792.110311393, 10040974.182713848,
        8959527.90505901, 7766921.083627797, 6456268.036113218,
        5020308.891497258, 3682983.732672398, 2495913.16018902,
        1242668.9522759262, 0, 0, 0, 0,
      ],
      bandLow: [
        1900000, 1776685.3790752208, 1865349.3918134451, 2037327.402703314,
        2233834.63062095, 2411266.9455245943, 2680887.9079483827,
        2657131.1116320426, 2871716.7283316753, 3053538.874436577,
        3132324.7561121257, 3298764.5011291117, 3474883.3541713995,
        3664329.3039227827, 3884780.8560087, 4010318.0835605254,
        4286258.787861148, 4740009.908099864, 5010552.0990002435,
        5253196.787808608, 5500340.08705232, 5753465.662706818,
        6185232.117629123, 6902292.142547013, 7228292.333985981,
        7637674.91678727, 7214831.990584453, 6989378.599309404,
        6827835.824996428, 7665301.071454879, 7366946.875171311,
        7209750.6960298335, 6662712.689169868, 6371671.095977999,
        6012112.214867519, 5471599.983067714, 4941748.136772618,
        4406776.232869859, 3244731.8138906946, 2032103.2075997835,
        1040140.0743944808, 0, 0, 0, 0, -163179.42094095936,
        -281968.18036782974, -425515.948761872, -511595.36545170285,
        -594348.8263712367, -628934.524006695,
      ],
      bandHigh: [
        1900000, 2483049.857895348, 2907833.5705769095, 3393342.94213923,
        3790416.8144178838, 4328142.97951756, 4773103.966104621,
        5038639.46674816, 5193746.906514598, 5582675.32562244,
        5958085.100323929, 6475424.942307571, 6750454.2606930565,
        7264691.857200675, 7695719.932634304, 8138617.0468508545,
        8538795.712073937, 9328575.935778512, 9789124.993673522,
        10668225.756893419, 11483299.329097558, 12200650.492906604,
        13011160.757636864, 14331754.302844819, 15131250.544991467,
        16135461.555530736, 16456089.663619386, 16541335.631554015,
        16843621.354021017, 18084585.80014901, 18263887.517142344,
        18453958.880272947, 18508776.699433565, 18996389.796134517,
        19441888.586764213, 19566295.929691598, 21200548.097832557,
        21701189.479090694, 21085695.61390402, 20880812.000619803,
        21067916.249369342, 19417630.62122993, 18976694.333147943,
        18085302.1037636, 15967215.591232453, 15276838.913537754,
        14227160.393534034, 12569091.972309517, 10946785.697845614,
        9593603.973881407, 7979863.6717027575,
      ],
      investmentsBandLow: [
        800000, 830024.4246764886, 933758.1469056756, 1036261.5608242673,
        1157107.560949118, 1260788.6437722452, 1392706.786339682,
        1267700.1411306043, 143631.08315028623, 224006.861506416,
        299908.8093778203, 372570.00214955735, 461931.44473236403,
        558147.6389552862, 684678.3212041591, 382748.0872866334,
        655007.1260801306, 970323.8366444352, 1201627.2506206883,
        1473401.5365644793, 1752315.1641301902, 2016152.1635844521,
        2339133.780926285, 2859063.028087725, 3321384.956413072,
        3601885.2527514203, 3236026.962313482, 2960492.666664652,
        2532159.099770738, 3187010.814301351, 2993001.6796752475,
        2701014.9497194933, 3854221.3716356414, 3396159.5363869662,
        2984272.925839004, 2496624.7373927673, 1795355.1889046067,
        1263106.0043066042, 188429.67609093105, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0,
      ],
      investmentsBandHigh: [
        800000, 1081211.0172185127, 1316373.2629275285, 1567100.1883261676,
        1834057.1572310305, 2138692.46767867, 2402125.159036262,
        2412963.123424069, 1167747.6455355326, 1353276.358276845,
        1572325.851570692, 1718813.0819806964, 1893734.448579985,
        2027639.4729493323, 2346405.789856832, 3998960.990352235,
        4413129.596939649, 4785065.282215605, 5430224.267682266,
        6181098.837502454, 6849632.357772097, 7827584.70484066,
        8637093.89670278, 9611904.59818818, 10144038.244590001,
        10981259.16800315, 10949951.90286629, 10970583.863560732,
        10834436.356211806, 12056444.03751568, 13110230.87595068,
        12876227.654253935, 14778019.77382183, 15005097.721995905,
        15188815.4575277, 16050193.430459978, 16080984.916937543,
        16747018.422076385, 16997551.300328087, 15703422.236504693,
        16194115.059071932, 14753683.928568011, 13949751.389788352,
        12840797.179759346, 10221871.909445418, 9933141.339424487,
        8539811.300970744, 7019259.807170804, 5811742.2349751275,
        4028274.6246423777, 2198794.9937969125,
      ],
      contributionsTotal: [
        0, 113829.36, 229353.30719999998, 346605.73334399995, 465621.2080108799,
        586434.9921710975, 657079.1676529963, 730018.6334157435,
        730018.6334157435, 800435.4381236809, 873174.7076493127,
        948294.4060398985, 1025854.1616337062, 1105915.3224943927,
        1188541.013925458, 1428277.6554605537, 1670289.0298263512,
        1914620.6316794646, 2144494.240812013, 2376445.3221272123,
        2610515.4250687156, 2846746.930069049, 3085183.065169389,
        3325867.9229717357, 3568846.4779301295, 3814164.603987691,
        3814164.603987691, 3814164.603987691, 3814164.603987691,
        3814164.603987691, 3814164.603987691, 3814164.603987691,
        3814164.603987691, 3814164.603987691, 3814164.603987691,
        3814164.603987691, 3814164.603987691, 3814164.603987691,
        3814164.603987691, 3814164.603987691, 3814164.603987691,
        3814164.603987691, 3814164.603987691, 3814164.603987691,
        3814164.603987691, 3814164.603987691, 3814164.603987691,
        3814164.603987691, 3814164.603987691, 3814164.603987691,
        3814164.603987691,
      ],
      housingGainsTotal: [
        0, 64000, 129280, 195865.6000000001, 263782.912, 333058.57024000026,
        456760.87714237766, 584202.667709847, 715514.2307481077,
        876830.8949012118, 1042813.2362006074, 1213617.6944470769,
        1389406.6068075513, 1570348.4471854474, 1756618.0757037448,
        1741141.5789615167, 1819007.4063203977, 1898430.5502264565,
        1979442.1570106372, 2062073.9959305003, 2146358.471628762,
        2232328.636840988, 2320018.2053574584, 2409461.5652442593,
        2500693.7923287954, 2593750.6639550216, 2688668.673013773,
        2785485.0422537, 2884237.738878425, 2984965.489435645,
        3087707.7950040083, 3192504.9466837402, 3299398.041397066,
        3366609.629518302, 3435165.4494019635, 3505092.385683298,
        3576417.8606902594, 3649169.8451973596, 3723376.869394602,
        3799068.034075789, 3876273.0220506, 3955022.109784907,
        4035345.1359096607, 4117275.6867884337, 3621802.368007644,
        2434731.795524266, 1181487.5876111723, -61181.3646647539,
        -61181.3646647539, -61181.3646647539, -61181.3646647539,
      ],
      investmentGainsTotal: [
        0, 41360, 90743.28991200001, 148652.28398269042, 215617.12347848032,
        292197.14521648025, 378982.426719418, 473906.81114847184,
        566135.7566324418, 598823.9767947673, 636842.7267428854,
        680587.6662977964, 730477.9076344896, 786957.3138124896,
        850495.8673063897, 921591.1122629106, 1031910.2216606503,
        1160444.817068965, 1308256.5948756954, 1475594.7071871865,
        1663576.0708091776, 1873377.4952525012, 2106238.822148062,
        2363466.227828811, 2664530.697531636, 2993722.191609446,
        3352615.8330482547, 3708221.7890542927, 4058536.742380064,
        4401376.538237197, 4793384.654963951, 5180190.762432887,
        5559423.325581045, 6039005.64393888, 6513785.287390005,
        6981125.329967343, 7438046.778043225, 7881077.234065406,
        8304284.599266268, 8678242.790668499, 8997786.261999918,
        9257427.462898286, 9451339.563292796, 9573338.200680152,
        9616861.94081043, 9616861.94081043, 9616861.94081043, 9616861.94081043,
        9616861.94081043, 9616861.94081043, 9616861.94081043,
      ],
      contributionYoY: [
        0, 113829.36, 115523.9472, 117252.42614399998, 119015.47466688,
        120813.7841602176, 70644.17548189868, 72939.46576274728, 0,
        70416.8047079374, 72739.26952563178, 75119.69839058584,
        77559.75559380773, 80061.16086068653, 82625.69143106524,
        239736.64153509558, 242011.37436579744, 244331.60185311342,
        229873.6091325484, 231951.08131519935, 234070.1029415033,
        236231.5050003334, 238436.13510034006, 240684.85780234687,
        242978.55495839377, 245318.1260575617, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ],
      housingGainYoY: [
        0, 64000, 65280, 66585.6000000001, 67917.31199999992, 69275.65824000025,
        123702.3069023774, 127441.79056746932, 131311.56303826068,
        161316.66415310418, 165982.34129939554, 170804.4582464695,
        175788.91236047447, 180941.8403778961, 186269.62851829734,
        -15476.496742228046, 77865.82735888101, 79423.14390605874,
        81011.60678418074, 82631.8389198631, 84284.47569826152,
        85970.1652122261, 87689.56851647049, 89443.35988680087,
        91232.2270845361, 93056.87162622623, 94918.00905875117,
        96816.36923992727, 98752.69662472513, 100727.75055721961,
        102742.30556836352, 104797.1516797319, 106893.09471332561,
        67211.5881212363, 68555.81988366134, 69926.93628133461,
        71325.47500696126, 72751.98450710019, 74207.02419724222,
        75691.16468118737, 77204.98797481088, 78749.08773430716,
        80323.02612475352, 81930.55087877298, -495473.3187807896,
        -1187070.572483378, -1253244.2079130937, -1242668.9522759262, 0, 0, 0,
      ],
      investmentGainYoY: [
        0, 41360, 49383.289912, 57908.9940706904, 66964.83949578989,
        76580.02173799992, 86785.28150293777, 94924.38442905381,
        92228.94548396993, 32688.2201623255, 38018.74994811809,
        43744.93955491096, 49890.24133669315, 56479.40617800004,
        63538.553493900145, 71095.24495652087, 110319.10939773972,
        128534.59540831458, 147811.77780673042, 167338.11231149113,
        187981.36362199104, 209801.4244433237, 232861.32689556078,
        257227.4056807489, 301064.46970282495, 329191.49407780997,
        358893.6414388087, 355605.956006038, 350314.953325771,
        342839.7958571333, 392008.1167267531, 386806.1074689367,
        379232.56314815785, 479582.31835783593, 474779.64345112443,
        467340.04257733806, 456921.44807588187, 443030.456022181,
        423207.36520086264, 373958.1914022303, 319543.4713314199,
        259641.200898367, 193912.10039450962, 121998.63738735617,
        43523.74013027842, 0, 0, 0, 0, 0, 0,
      ],
      retirementIncome: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 692964.2343801497, 690033.18009127, 686888.1900639491,
        1736726.6495126707, 735534.8821247433, 731360.859867944,
        726615.1963624933, 721066.1186706724, 714316.731394554,
        705579.2158138579, 692909.5805501663, 647504.2618724299,
        262515.45568062493, 262875.8188090438, 263225.8863421037,
        263559.1841639026, 263868.80601370416, 264143.88684037456,
        264369.5633306281, 272341.1897925742, 289567.1902352607,
        306710.2624650557, 319352.80077984714, 317213.9829449129,
        308268.629390608,
      ],
      taxPaid: [
        0, 17270.64, 17616.0528, 17968.373856000002, 18327.74133312,
        18694.2961597824, 19068.182082978048, 19449.54572463761,
        156182.19548760203, 27518.201485097336, 28068.565514799284,
        28629.93682509527, 29202.53556159717, 29786.586272829118,
        30382.3179982857, 20850.19229731742, 21267.19614326377,
        21692.540066129044, 22126.390867451628, 22568.918684800658,
        23020.297058496675, 23480.702999666606, 23950.317059659938,
        24429.32340085314, 24917.909868870203, 25416.26806624761,
        408054.6400946573, 417238.15789605846, 427146.3607911239,
        379979.2642276264, 454481.48962103634, 465156.35061740095,
        429705.4076485313, 439906.50125519844, 450684.91407264466,
        461868.49251873634, 473015.19692282897, 477074.04236611386,
        403427.77744766197, 427078.16583847767, 451221.73741834983,
        475849.41693203105, 500957.8034615826, 526533.3900717794,
        320969.7931233162, 73152.50830150634, 54727.379413432085,
        36104.84993880823, 21516.66439619877, 20783.281683317386,
        19110.275006422613,
      ],
      spending: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 1037519.2308994957, 1058269.6155174857, 1079435.0078278354,
        1101023.707984392, 1123044.18214408, 1145505.0657869615,
        1168415.1671027008, 1191783.470444755, 1215619.13985365,
        1239931.522650723, 1264730.1531037374, 1290024.7561658123,
        1315825.2512891283, 1342141.756314911, 1368984.5914412092,
        1396364.2832700335, 1424291.568935434, 1452777.400314143,
        1481832.9483204258, 1511469.6072868344, 1541698.999432571,
        1572532.9794212223, 1603983.639009647, 1636063.31178984,
        1668784.578025637,
      ],
      investmentsSold: [
        0, 0, 0, 0, 0, 0, 0, 0, 1243887.0754964347, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 422485.23588311556, 457946.43338064,
        494902.1384058055, 0, 492627.25130734144, 533296.3264395144,
        529199.9195804948, 572477.384251677, 618679.0800814226,
        668860.2457002811, 725606.0139114881, 826455.8103997122,
        1375802.6030854343, 1426467.2836809624, 1478194.7369610688,
        1530997.1100638867, 1584888.1740338418, 1639888.33288209,
        885375.5801743484, 0, 0, 0, 0, 0, 0,
      ],
      borrowed: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        1.0433642398566008, 0, 579042.4806771381, 1272311.1176176532,
        1340189.5639500548, 1331353.2154336264, 90457.94842085429,
        92267.10738927126, 94112.4495370565,
      ],
      propertyTax: [
        0, 17270.64, 17616.0528, 17968.373856000002, 18327.74133312,
        18694.2961597824, 19068.182082978048, 19449.54572463761,
        26978.628906958173, 27518.201485097336, 28068.565514799284,
        28629.93682509527, 29202.53556159717, 29786.586272829118,
        30382.3179982857, 20850.19229731742, 21267.19614326377,
        21692.540066129044, 22126.390867451628, 22568.918684800658,
        23020.297058496675, 23480.702999666606, 23950.317059659938,
        24429.32340085314, 24917.909868870203, 25416.26806624761,
        25924.59342757256, 26443.085296124013, 26971.947002046494,
        27511.38594208742, 28061.61366092917, 28622.845934147757,
        17710.912484566423, 18065.130734257753, 18426.43334894291,
        18794.962015921767, 19170.8612562402, 19554.278481365007,
        19945.364050992303, 20344.27133201215, 20751.156758652392,
        21166.179893825443, 21589.50349170195, 22021.293561535993,
        22461.719432766713, 8283.828589613973, 8449.505161406252,
        8618.495264634377, 8790.865169927067, 8966.682473325607,
        9146.01612279212,
      ],
      scalars: [51, -1, 55, 87, 0.20750000000000002],
    }
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
        2346034.269651303, 2527868.7932904153, 4295595.239373023,
        4517677.5132486075, 4751241.44068356, 4996880.6231669,
        5255219.351384629, 5526914.191851214, 4150959.7827607673,
        4337677.715151308, 4536762.587031671, 5148977.826207816,
        5396033.803415061, 5658899.601771084, 5938521.711938892,
        6235893.015679875, 5725952.026789547, 5145013.67529073,
        4487937.046333793, 5238959.968705758, 4591020.826287815,
        3859515.455565623, 3038020.402860864, 2118642.966277327,
        1088879.5355197215, 0, 0, 0, 8864549.357898086, 7997715.99340244,
        7037933.129430924, 5975174.001409212, 4793305.278943675,
        3486841.1187015697, 2048476.2323262403, 469718.26918676845, 0, 0, 0, 0,
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
        9776509.015466725, 10270780.29629263, 10737793.670360519,
        10338896.589581173, 9845475.027144453, 70357.03855695622,
        111963.56564435083, 154402.22327349288, 197689.65405521775,
        241842.83345257677, 286879.0764378831, 332816.0442828955,
        379671.75148480805, 0, 0, 0, 0, 0,
      ],
      cash: [
        120000, 122400, 124848, 127344.96, 129891.8592, 132489.696384,
        135139.49031168, 137842.28011791361, 140599.1257202719,
        143411.10823467735, 146279.3303993709, 149204.9170073583,
        152189.01534750548, 130606.23734283583, 111104.92042513877,
        93780.88761314565, 71383.60323775762, 51074.084813455294, 0, 0, 0, 0, 0,
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
        4769889.788799858, 5122617.981493402, 5591784.254720529,
        6017264.007524286, 6463940.472112298, 6932769.940135827,
        7417402.660826349, 7925942.697721001, 8164829.1934167,
        8654529.970330726, 9166544.26628542, 10101976.994581554,
        10682892.228741877, 11290625.425506778, 11926502.590923509,
        12591909.752893336, 12462192.709881, 12274088.342401708,
        12022892.899505433, 13193297.15596169, 12978708.814317878,
        12695010.015802749, 12336281.23464574, 11895151.981744053,
        11359659.83181235, 10737793.670360519, 10338896.589581173,
        9845475.027144453, 8934906.396455042, 8109679.559046791,
        7192335.352704417, 6172863.655464429, 5035148.112396251,
        3773720.195139453, 2381292.276609136, 849390.0206715765, 0, 0, 0, 0, 0,
      ],
      bandLow: [
        1800000, 1641001.176445935, 1722746.4755846974, 1894672.9219763475,
        2083931.1184522584, 2274769.074876596, 2548293.2724697413,
        2492975.4909819793, 2798269.032355214, 2999511.469204924,
        3176257.935095505, 3332241.3134110477, 3702968.332793695,
        3861198.46718828, 4101779.2180853686, 4322842.0559383705,
        4398592.716137446, 4707559.44981229, 4803260.58096155,
        4907949.507054707, 5099858.107220837, 5569052.79768603,
        5907643.468156347, 6255616.288979294, 6396357.825723277,
        6898304.800030877, 6505277.898764101, 6068708.936375869,
        5720967.128762992, 6342502.865899529, 6012751.787722166,
        5639051.95935461, 4921979.237318874, 4436805.264488223,
        3953571.1468307734, 3451786.638261142, 2451049.2584146177,
        1797286.079986577, 76037.71007430647, -1269637.984548987,
        -2437889.0904286383, -3351475.636645717, -3798593.3588323556,
        -4211328.381555043, -4332885.6197653515, -4606297.7694556415,
        -4799906.814047801, -4586225.384210662, -4664560.41916841,
        -4616820.600937723, -4576188.28385435,
      ],
      bandHigh: [
        1800000, 2435642.9826185782, 2891040.410514124, 3408407.0619665524,
        3844410.5357520226, 4406090.729590356, 4873141.807756215,
        5128737.106252438, 5448231.238562058, 5999716.605053401,
        6484373.0162494825, 6997654.974404663, 7481335.216865705,
        8301405.734013877, 9102945.86852672, 9728457.696672268,
        10588536.433962664, 11207916.613854142, 11226203.113401953,
        12221474.151555065, 13504337.585769929, 14611963.773524398,
        15748335.238400605, 16781340.617700726, 17951237.710577536,
        18808909.19677526, 18658208.49007409, 18449392.48075977,
        18709809.352058735, 20581597.416542146, 21029743.24447222,
        20344658.95680296, 21172543.98927981, 20484977.93556031,
        20526949.274770234, 21040479.99742851, 20547852.641270272,
        20240953.67745101, 19746310.299984664, 18795266.922015622,
        18084540.134995043, 18020837.3777188, 17035194.465061326,
        15989212.743477548, 14378450.917685298, 12984291.797942901,
        11733642.512887854, 10118880.43273617, 8851762.736983292,
        7267120.782302799, 5257945.672191035,
      ],
      investmentsBandLow: [
        900000, 910955.4652610498, 1007415.5656719212, 1095321.86665991,
        1209061.1343854596, 1314357.3257726356, 1480472.9596479915,
        1312184.7387365322, 1353993.479133304, 1407041.087991839,
        1478142.735679965, 1582307.5130001009, 2410146.725559466,
        2412401.361600881, 2410964.9318002053, 2420020.380910962,
        2508247.27625089, 2611784.729688351, 1145404.1719461055,
        1276183.1848117912, 1300413.8044869774, 1632478.9357434874,
        1675901.1043439829, 1791223.151122166, 1826457.7736002426,
        1813890.9217565572, 1197011.2626227045, 454607.2778114744, 0,
        236022.02993007482, 0, 0, 0, 0, 0, 0, 0, 0, 4201688.857459381,
        2833374.8995712185, 1322618.2536339436, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ],
      investmentsBandHigh: [
        900000, 1193543.8243708268, 1431441.117699259, 1686536.1227907431,
        1944579.440570611, 2245494.7154691294, 2572022.2830376243,
        2535974.9231767077, 2719974.4745450304, 3052575.199152102,
        3356819.619768479, 3622200.1627127435, 6185146.201518199,
        6889997.714667551, 7436043.636864054, 7764400.5501603,
        8324518.566881953, 8417030.745360656, 7308603.0402005175,
        7829781.706247489, 8463417.599887114, 9166047.983333288,
        9694553.005929137, 10812528.73353892, 10750571.708520714,
        11522264.456147743, 10891232.744988047, 11250530.793665744,
        11078724.446407283, 11449398.551789016, 11091522.653258134,
        11458254.490997657, 10888774.474476816, 9823441.952584729,
        8876387.960842198, 7593698.398011198, 7058490.741555714,
        6179338.42571011, 18683038.511559073, 18152233.04679902,
        17286452.2241818, 17068659.89281965, 15837701.95956606,
        14302018.084241193, 13262058.608924266, 11317791.429663692,
        10288124.281038348, 8480145.458430802, 6795105.302991191,
        5129203.751900824, 3504168.873919234,
      ],
      contributionsTotal: [
        0, 105240.48, 212249.7696, 321063.244992, 431716.98989183997,
        544247.8096896767, 658693.2458834703, 708569.5227250934,
        761014.2167106142, 816091.8496287643, 873868.7969083849,
        934413.3488065249, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746, 1180381.7568759746, 1180381.7568759746,
        1180381.7568759746,
      ],
      housingGainsTotal: [
        0, 72000, 145440, 220348.80000000028, 296755.77600000054,
        374690.8915200005, 454184.7093504006, 603086.0794837628,
        756512.941237729, 914622.0637787334, 1077576.188749184,
        1245544.2711956282, 1335067.2214000435, 1560047.478332887,
        1792661.332403643, 2033175.6507558245, 2281866.927604006,
        2539021.642456375, 2804936.6320559755, 3107919.4765794626,
        3420848.900653793, 3744066.389773783, 4077925.6467268583,
        4422793.045135738, 4779048.100384661, 5147083.958613504,
        5527307.904491498, 5920141.888511022, 6326023.074571683,
        6745404.408655976, 7178755.209430107, 7626561.78163717,
        8089328.05318492, 8567576.236866768, 9061847.517692672,
        9528860.891760562, 9129963.810981216, 8636542.248544496,
        9003962.318401331, 9045568.845488725, 9088007.503117867,
        9131294.933899593, 9175448.113296952, 9220484.356282258,
        9266421.324127272, 9313277.031329185, 8933605.279844377,
        8933605.279844377, 8933605.279844377, 8933605.279844377,
        8933605.279844377,
      ],
      investmentGainsTotal: [
        0, 46530, 100906.53381600001, 163626.71470260722, 235215.18561881842,
        316225.5790927195, 407242.05329276936, 508880.90826018096,
        605428.0955421197, 709678.163085586, 822165.472742918,
        943455.4444838903, 1074146.2610970049, 1296228.5349725902,
        1529792.462407543, 1775431.6448908832, 2033770.373108612,
        2305465.2135751974, 2591206.677293905, 2805811.2980626365,
        3030069.235935959, 3264619.8616854963, 3530822.0153004406,
        3809796.9629369993, 4102362.0723485644, 4409383.644855805,
        4731779.313766454, 5027811.033551474, 5293808.2405640045,
        5525834.585859462, 5796688.816241549, 6034044.59296063,
        6233581.542013372, 6390647.196841279, 6500181.038197817,
        6556476.110184187, 6556476.110184187, 6556476.110184187,
        6556476.110184187, 7014773.311987518, 7428255.228846424,
        7792116.371638003, 8101032.867510859, 8348846.750432247,
        8529116.43626912, 8635022.657480385, 8659307.09199734, 8659307.09199734,
        8659307.09199734, 8659307.09199734, 8659307.09199734,
      ],
      contributionYoY: [
        0, 105240.48, 107009.2896, 108813.47539200001, 110653.74489983998,
        112530.81979783678, 114445.43619379353, 49876.27684162316,
        52444.69398552076, 55077.63291815013, 57776.94727962062,
        60544.551898140024, 245968.40806944965, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0,
      ],
      housingGainYoY: [
        0, 72000, 73440, 74908.80000000028, 76406.97600000026,
        77935.11551999999, 79493.81783040008, 148901.37013336224,
        153426.8617539662, 158109.12254100433, 162954.12497045053,
        167968.0824464443, 89522.95020441525, 224980.25693284348,
        232613.85407075612, 240514.31835218146, 248691.27684818162,
        257154.71485236892, 265914.98959960043, 302982.84452348715,
        312929.42407433037, 323217.4891199898, 333859.2569530755,
        344867.3984088795, 356255.05524892267, 368035.8582288427,
        380223.9458779944, 392833.9840195235, 405881.18606066145,
        419381.3340842929, 433350.80077413097, 447806.57220706344,
        462766.27154774964, 478248.1836818494, 494271.28082590364,
        467013.3740678895, -398897.0807793457, -493421.56243672036,
        367420.06985683553, 41606.527087394614, 42438.65762914205,
        43287.43078172486, 44153.179397359025, 45036.24298530631,
        45936.967845012434, 46855.70720191253, -379671.75148480805, 0, 0, 0, 0,
      ],
      investmentGainYoY: [
        0, 46530, 54376.533816, 62720.1808866072, 71588.4709162112,
        81010.39347390104, 91016.4742000499, 101638.8549674116,
        96547.18728193869, 104250.06754346634, 112487.30965733193,
        121289.97174097238, 130690.81661311448, 222082.2738755853,
        233563.92743495302, 245639.1824833401, 258338.72821772876,
        271694.8404665853, 285741.46371870773, 214604.6207687317,
        224257.93787332263, 234550.6257495374, 266202.1536149441,
        278974.9476365587, 292565.10941156506, 307021.5725072407,
        322395.66891064955, 296031.7197850196, 265997.20701253077,
        232026.34529545708, 270854.2303820877, 237355.77671908008,
        199536.9490527427, 157065.6548279067, 109533.84135653781,
        56295.0719863696, 0, 0, 0, 458297.2018033311, 413481.91685890616,
        363861.1427915788, 308916.4958728563, 247813.882921388,
        180269.68583687115, 105906.22121126663, 24284.43451695593, 0, 0, 0, 0,
      ],
      retirementIncome: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 837437.0120244767, 834681.9527068245, 831674.6885343273,
        2074624.2815070753, 873993.230189053, 869822.5630462336,
        865015.710128552, 858767.35118216, 848110.7517347882, 834988.3679101084,
        817675.3097477464, 773162.1904513603, 299312.2833607233,
        299616.2513036647, 299906.7594224305, 300176.4456608923,
        300414.8684901242, 300616.28523196036, 300756.3508605597,
        300820.10391966865, 300761.8916525013, 306151.64733931737,
        306226.33978954627, 305657.84189514484, 299489.1905914968,
      ],
      taxPaid: [
        0, 19559.52, 19950.7104, 20349.724608000004, 20756.71910016,
        21171.853482163202, 21595.290551806465, 22027.196362842595,
        22467.74029009945, 22917.095095901437, 23375.436997819466,
        23842.945737775855, 26316.01723717282, 27106.233334528853,
        27918.851147647318, 28757.168784971684, 29617.851587329966,
        30507.05979994536, 326070.0465679108, 43759.69400039002,
        44728.50256634446, 45665.51127530049, 46343.832590848564,
        47269.132343401354, 48166.26187278512, 49036.07256855634,
        597383.4921345573, 613098.2604311955, 629444.6684275034,
        439990.38384684664, 649067.0077933392, 666103.805399855,
        683713.2113548821, 702602.2111000728, 726241.1220154127,
        732600.3464947317, 417582.7813343454, 379401.7874980132,
        67352.93233195593, 83996.93327343967, 100990.00652461959,
        122540.82692784676, 154209.82834430147, 184488.2455247387,
        214871.35089218605, 246117.80625216188, 102858.81534723559,
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
        1661695.8728091537, 27886.68837819075, 25173.06599295966,
        22335.386573393156, 19146.17640769885, 16109.149280536083,
        12942.999243756618, 9650.268766257375, 832336.657800978,
        876970.0712838371, 923073.8359694675, 0, 918793.3728000305,
        968861.1474412727, 1021032.0017575016, 1076443.091411444,
        1139297.2721141432, 1145174.607506091, 0, 0, 1277988.7005462467,
        1325130.5662989763, 1373264.7808304226, 1426620.2708132896,
        1490785.2183383931, 1554278.0431634933, 1618634.5722122006,
        1684664.1843507385, 494002.7037037244, 0, 0, 0, 0,
      ],
      borrowed: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 43841.87508535595, 926917.5972565231,
        1039209.8434708611, 0, 0, 0, 0, 0, 0, 0, 0, 427464.572830759,
        48748.67777286982, 49723.6513283276, 50718.12435489381,
        51732.48684199201,
      ],
      propertyTax: [
        0, 19559.52, 19950.7104, 20349.724608000004, 20756.71910016,
        21171.853482163202, 21595.290551806465, 22027.196362842595,
        22467.74029009945, 22917.095095901437, 23375.436997819466,
        23842.945737775855, 26316.01723717282, 27106.233334528853,
        27918.851147647318, 28757.168784971684, 29617.851587329966,
        30507.05979994536, 39173.93807852203, 40272.08805335847,
        41401.46634674892, 42561.42660299754, 43755.86262196974,
        44985.78220885221, 46249.00467141065, 47549.68353757129,
        48887.23679273849, 50262.686077650644, 51678.821511860704,
        53135.0489783887, 54630.66537655718, 56172.24276632418,
        57757.40006671544, 59387.33922482371, 61065.25501732569,
        62790.53228494315, 64564.474315945794, 66392.58055563695,
        7273.117961561037, 7418.580320792258, 7566.951927208103,
        8569.62273845561, 11736.621976921182, 12716.488631459442,
        12970.81840408863, 13230.234772170405, 8521.616888799066,
        8692.049226575047, 8865.890211106549, 9043.20801532868,
        9224.072175635254,
      ],
      scalars: [51, -1, -1, 86, 0.18999999999999995],
    }
    const CHAINED_MOVES: Record<string, number[]> = {
      age: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
      investments: [
        300000, 163492.300015129, 164395.03640271936, 166676.23986904672,
        780237.7936535688, 631282.2497132112, 474155.6792899496,
        308592.82806246023, 134316.6771301569, 0, 0,
      ],
      homeEquity: [
        800000, 1050000, 1110490.8825491457, 1172575.1121832926, 675000,
        832359.6435718881, 994263.6229534224, 1160859.7466197778,
        1332301.0982959182, 1463150.167152389, 1467834.4864981868,
      ],
      cash: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      otherDebt: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      netWorth: [
        1100000, 1213492.300015129, 1274885.918951865, 1339251.3520523394,
        1455237.7936535687, 1463641.8932850994, 1468419.302243372,
        1469452.574682238, 1466617.775426075, 1463150.167152389,
        1467834.4864981868,
      ],
      bandLow: [
        1100000, 988686.9710907971, 953892.4105893639, 958845.9816938278,
        984859.1866366866, 810381.6612452907, 691521.6241455029,
        483840.98795780184, 391418.8985374971, 267868.7574813516,
        225349.92498181522,
      ],
      bandHigh: [
        1100000, 1410156.5475634683, 1553641.6705352645, 1736341.8810015484,
        1891265.3397411578, 2149110.6339710164, 2358496.8591833017,
        2556839.315893633, 2684958.2781783575, 2885377.2490282953,
        3020876.7021300173,
      ],
      investmentsBandLow: [
        300000, 0, 0, 0, 309859.1866366865, 121185.22879439956, 0, 0, 0, 0, 0,
      ],
      investmentsBandHigh: [
        300000, 360156.5475634683, 364918.2681998273, 398265.46336711984,
        1216265.3397411578, 1102101.7361924718, 969318.891816916,
        825060.3390224071, 666086.7097267419, 538934.8555314676,
        324178.24875216297,
      ],
      contributionsTotal: [
        0, 0, 0, 0, 63672.48, 63672.48, 63672.48, 63672.48, 63672.48, 63672.48,
        63672.48,
      ],
      housingGainsTotal: [
        0, 40000, 100490.88254914572, 162575.11218329263, 206271.91218329244,
        363631.55575518054, 525535.5351367148, 692131.6588030702,
        863573.0104792106, 994422.0793356814, 999106.3986814793,
      ],
      investmentGainsTotal: [
        0, 15510, 23962.551910782167, 32461.77529280276, 41078.93689403248,
        81417.23082592199, 114054.523136095, 138568.3717553854,
        154522.6209662146, 161466.7931738437, 161466.7931738437,
      ],
      contributionYoY: [0, 0, 0, 0, 63672.48, 0, 0, 0, 0, 0, 0],
      housingGainYoY: [
        0, 40000, 60490.882549145725, 62084.229634146905, 43696.799999999814,
        157359.6435718881, 161903.97938153427, 166596.1236663554,
        171441.35167614045, 130849.06885647075, 4684.319345797878,
      ],
      investmentGainYoY: [
        0, 15510, 8452.55191078217, 8499.223382020591, 8617.161601229716,
        40338.29393188951, 32637.29231017302, 24513.848619290395,
        15954.249210829195, 6944.172207629112, 0,
      ],
      retirementIncome: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      taxPaid: [
        0, 2017.56, 195.5952, 235.58817600000003, 0, 4505.7537578592,
        6814.408798966464, 9012.58774837625, 11101.472634996468,
        9713.712397762145, 0,
      ],
      spending: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      investmentsSold: [
        0, 152017.699984871, 7549.81552319183, 6218.01991569325, 0,
        189293.83787224707, 189763.86273343462, 190076.69984677975,
        190230.40014313255, 141260.849337786, 0,
      ],
      borrowed: [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 45596.06979211702, 176928.84831263317,
      ],
      propertyTax: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      scalars: [11, -1, -1, -1, 0.9225],
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
