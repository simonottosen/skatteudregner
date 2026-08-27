import { describe, it, expect } from "vitest"
import {
  ASSESSMENT_FACTOR,
  createPropertyHoldingTax,
  grossUpStockSale,
  nedslagRespondsToStockIncome,
  pensionIncomeTax,
  propertyHoldingTax,
  qualifiesForPensionerNedslag,
  stockGainTax,
  type PensionerIncomeYear,
  type TaxContext,
} from "../taxation"
import { DEFAULT_TAX_PROFILE } from "../types"
import { getRates } from "@/lib/tax/rates"

const ctx: TaxContext = {
  t: 0,
  inflation: 0,
  profile: DEFAULT_TAX_PROFILE,
  married: false,
}
const rates = getRates(DEFAULT_TAX_PROFILE.year)

describe("stockGainTax", () => {
  it("is zero for no gain and ~27 % up to the progression limit", () => {
    expect(stockGainTax(0, ctx)).toBe(0)
    expect(stockGainTax(rates.stockProgressionLimit, ctx)).toBeCloseTo(
      rates.stockProgressionLimit * rates.stockTaxLowRate,
      -1
    )
  })
  it("is the high rate on the part above the limit", () => {
    const gain = rates.stockProgressionLimit + 100_000
    const expected =
      rates.stockProgressionLimit * rates.stockTaxLowRate +
      100_000 * rates.stockTaxHighRate
    expect(stockGainTax(gain, ctx)).toBeCloseTo(expected, -1)
  })
  it("doubles the low-rate band for a couple", () => {
    const gain = rates.stockProgressionLimit * 2
    const single = stockGainTax(gain, ctx)
    const couple = stockGainTax(gain, { ...ctx, married: true })
    // The couple keeps the whole gain in the low bracket → less tax.
    expect(couple).toBeLessThan(single)
    expect(couple).toBeCloseTo(gain * rates.stockTaxLowRate, -1)
  })
})

describe("grossUpStockSale", () => {
  it("returns the net amount when there is no embedded gain", () => {
    expect(grossUpStockSale(100_000, 0, ctx)).toBeCloseTo(100_000, 4)
  })
  it("sells exactly enough to net the target after stock tax", () => {
    for (const [net, g, married] of [
      [50_000, 0.5, false],
      [200_000, 0.8, false],
      [500_000, 1, true],
      [1_000_000, 0.95, true],
    ] as const) {
      const c = { ...ctx, married }
      const sell = grossUpStockSale(net, g, c)
      const proceeds = sell - stockGainTax(sell * g, c)
      expect(proceeds).toBeCloseTo(net, -1)
    }
  })
})

describe("pensionIncomeTax", () => {
  it("is ~zero at or below the personfradrag", () => {
    expect(pensionIncomeTax(0, ctx)).toBe(0)
    expect(pensionIncomeTax(rates.personFradrag, ctx)).toBeLessThan(1500)
  })
  it("rises with income and is steeper above the topskat threshold", () => {
    expect(pensionIncomeTax(300_000, ctx)).toBeGreaterThan(0)
    // Topskat kicks in above topSkatThreshold (2026: 777.900).
    const below = rates.topSkatThreshold - 100_000
    const above = rates.topSkatThreshold + 100_000
    const marginalBelow =
      (pensionIncomeTax(below, ctx) - pensionIncomeTax(below - 100_000, ctx)) /
      100_000
    const marginalAbove =
      (pensionIncomeTax(above, ctx) - pensionIncomeTax(rates.topSkatThreshold, ctx)) /
      100_000
    expect(marginalAbove).toBeGreaterThan(marginalBelow)
  })
  it("indexes brackets to inflation so real income pays constant real tax", () => {
    const real = pensionIncomeTax(300_000, ctx)
    // The same income 20 years out, inflated, should pay the same *real* tax.
    const t = 20
    const f = Math.pow(1.02, t)
    const nominal = pensionIncomeTax(300_000 * f, {
      ...ctx,
      t,
      inflation: 0.02,
    })
    expect(nominal / f).toBeCloseTo(real, 0)
  })
})

describe("propertyHoldingTax progression", () => {
  const NO_INCOME: PensionerIncomeYear = {
    personalIncome: 0,
    positiveStockIncome: 0,
  }
  /** No inflation, so nominal == real and the figures below are exact. */
  const at = (
    year: 2025 | 2026,
    homeValue: number,
    age = 40,
    income: PensionerIncomeYear = NO_INCOME
  ) =>
    propertyHoldingTax(
      homeValue,
      0,
      age,
      {
        t: 0,
        inflation: 0,
        profile: { ...DEFAULT_TAX_PROFILE, year },
        married: false,
      },
      income
    )

  /**
   * The ejendomsværdiskat threshold in `rates.ts` is stated on the taxable
   * *basis*, which forsigtighedsprincippet sets at 80 % of the valuation. The
   * two ways this gets broken are (a) "fixing" the constant to 11_500_000,
   * which slides the progression out to a 14.375.000 valuation, and (b)
   * comparing the raw valuation against 9.200.000, which starts it 2,3 mio.
   * early. Both are caught below.
   */
  const progressionValuation = (year: 2025 | 2026) =>
    getRates(year).ejendomsvaerdiSkatThreshold / ASSESSMENT_FACTOR

  it("puts the 2025 progression at a valuation of 11.500.000 DKK", () => {
    expect(progressionValuation(2025)).toBe(11_500_000)
  })

  it("taxes everything up to 11.500.000 at the low rate (2025)", () => {
    const r = getRates(2025)
    const below = at(2025, 11_000_000)
    const edge = at(2025, 11_500_000)
    // 500.000 of valuation is 400.000 of basis, entirely in the low bracket.
    expect(edge - below).toBeCloseTo(
      500_000 * ASSESSMENT_FACTOR * r.ejendomsvaerdiSkatLowRate,
      0
    )
    expect(below).toBe(44_880)
    expect(edge).toBe(46_920)
  })

  it("switches to the high rate above 11.500.000 (2025)", () => {
    const r = getRates(2025)
    const edge = at(2025, 11_500_000)
    const above = at(2025, 12_000_000)
    // Ejendomsskatteloven § 22, stk. 2: the excess is taxed at 14 ‰ *instead
    // of* 5,1 ‰, so the two rates must not stack.
    expect(above - edge).toBeCloseTo(
      500_000 * ASSESSMENT_FACTOR * r.ejendomsvaerdiSkatHighRate,
      0
    )
    expect(above).toBe(52_520)
    // The marginal rate must actually step up at the threshold, not before.
    expect(above - edge).toBeGreaterThan(edge - at(2025, 11_000_000))
  })

  it("follows the year's own threshold rather than a hardcoded valuation", () => {
    // 2026 lowers the threshold to 9.007.000, i.e. an 11.258.750 valuation.
    expect(progressionValuation(2026)).toBe(11_258_750)
    expect(at(2026, 11_258_750)).toBe(45_936)
    // Same valuation, different year → different tax, because 11.5M is above
    // the 2026 threshold but exactly at the 2025 one.
    expect(at(2026, 11_500_000)).toBe(48_638)
    expect(at(2025, 11_500_000)).toBe(46_920)
  })

  it("gives the pensioner nedslag only once the owner is old enough", () => {
    // Charging property tax in working years must not leak the reduction to
    // someone below the qualifying age.
    expect(at(2025, 11_500_000, 40)).toBe(46_920)
    expect(at(2025, 11_500_000, 70)).toBeLessThan(at(2025, 11_500_000, 40))
  })

  describe("grades the § 25 nedslag on the year's own income", () => {
    // Ejendomsskatteloven § 26: 5 % of the beskatningsgrundlag above a
    // grundbeløb comes off the nedslag. The projection used to pass a zero base,
    // which handed every retired household the whole 6.000 kr. however large its
    // pension payouts were — understating the tax by up to that much a year for
    // the rest of the plan, always in the household's favour.
    const r = getRates(2025)
    const nedslag = r.ejendomsvaerdiSkatPensionerReduction
    const threshold = r.ejendomsvaerdiSkatPensionerIncomeThresholdSingle
    /** Income that grades away exactly `share` of the nedslag. */
    const gradedBy = (share: number) =>
      threshold + (nedslag * share) / r.ejendomsvaerdiSkatPensionerIncomeRate
    const full = at(2025, 11_500_000, 40) // too young for any nedslag
    const kept = (income: PensionerIncomeYear) =>
      full - at(2025, 11_500_000, 70, income)

    it("leaves it whole up to the grundbeløb", () => {
      expect(kept({ ...NO_INCOME, personalIncome: threshold })).toBe(nedslag)
    })

    it("takes 5 % of every krone above it", () => {
      expect(kept({ ...NO_INCOME, personalIncome: gradedBy(0.5) })).toBe(
        nedslag / 2
      )
    })

    it("grades it away entirely for a large pension", () => {
      expect(kept({ ...NO_INCOME, personalIncome: gradedBy(2) })).toBe(0)
    })

    it("counts aktieindkomst in the base as well as personal income", () => {
      const split = (threshold + 120_000) / 2
      expect(
        kept({ personalIncome: split, positiveStockIncome: split })
      ).toBe(nedslag - 120_000 * r.ejendomsvaerdiSkatPensionerIncomeRate)
    })

    it("indexes the grundbeløb with inflation, like every other bracket", () => {
      // The base is nominal and the rules are held at a fixed year, so an income
      // that is constant in real terms must keep grading the nedslag the same
      // amount however far out the year is.
      const t = 20
      const f = Math.pow(1.02, t)
      const nominal = propertyHoldingTax(
        11_500_000 * f,
        0,
        70,
        {
          t,
          inflation: 0.02,
          profile: { ...DEFAULT_TAX_PROFILE, year: 2025 },
          married: false,
        },
        { ...NO_INCOME, personalIncome: gradedBy(0.5) * f }
      )
      expect(nominal / f).toBeCloseTo(at(2025, 11_500_000, 70, {
        ...NO_INCOME,
        personalIncome: gradedBy(0.5),
      }), 0)
    })

    /**
     * `simulate.ts` iterates the § 26 base and the drawdown that produces it
     * onto each other, and skips the whole thing whenever it can prove the
     * answer cannot move. Both proofs are checked below against the engine
     * itself rather than against a restatement of the rules.
     */
    const ctxFor = (year: 2025 | 2026): TaxContext => ({
      t: 0,
      inflation: 0,
      profile: { ...DEFAULT_TAX_PROFILE, year },
      married: false,
    })
    /** Whether the engine has a nedslag to grade at this age at all. */
    const engineGrantsNedslag = (age: number, year: 2025 | 2026) =>
      at(year, 11_500_000, age, NO_INCOME) <
      at(year, 11_500_000, age, {
        personalIncome: 100_000_000,
        positiveStockIncome: 0,
      })

    it("is asked of the same age the engine asks of itself", () => {
      // `propertyHoldingTax` synthesises a June birth date, and
      // `calculateRetirementAge` reads the birth month — so the qualifying age
      // steps on a finer schedule than folkepensionsalderen does. A predicate
      // written against anything but that same date would disagree here.
      let qualified = 0
      let tooYoung = 0
      for (const year of [2025, 2026] as const) {
        for (let age = 60; age <= 80; age++) {
          const answer = engineGrantsNedslag(age, year)
          expect(qualifiesForPensionerNedslag(age, ctxFor(year))).toBe(answer)
          if (answer) qualified++
          else tooYoung++
        }
      }
      // The sweep has to cross the boundary, or it agrees about nothing.
      expect(qualified).toBeGreaterThan(0)
      expect(tooYoung).toBeGreaterThan(0)
    })

    /**
     * The response test is what lets the settlement charge nothing in the common
     * case, so it has to be a *bound*, not a guess: whenever it says no, no gain
     * the feedback could still reach may move the charge. The feedback can add at
     * most the whole nedslag to the charge, and a krone of charge sells at most
     * 1/(1 − 42 %) kroner of gain once the sale is grossed up for its own tax.
     */
    it("never says no while a reachable gain could still move the charge", () => {
      const headroom = nedslag / (1 - r.stockTaxHighRate)
      const charge = (personalIncome: number, positiveStockIncome: number) =>
        at(2025, 11_500_000, 70, { personalIncome, positiveStockIncome })
      let saidNo = 0
      let saidYes = 0
      for (const personal of [0, threshold - 50_000, gradedBy(0.5), gradedBy(2)]) {
        for (const gain of [0, 20_000, 60_000, 200_000]) {
          if (nedslagRespondsToStockIncome(ctxFor(2025), personal, gain)) {
            saidYes++
            continue
          }
          saidNo++
          // The settlement stops at its gain-0 seed, so that seed must already
          // be the answer for every gain still in reach.
          expect(charge(personal, gain + headroom)).toBe(charge(personal, 0))
        }
      }
      // Neither branch is vacuous — the sweep exercises both answers.
      expect(saidNo).toBeGreaterThan(0)
      expect(saidYes).toBeGreaterThan(0)
    })

    it("says yes inside the graduation band and no outside it", () => {
      const ctx2025 = ctxFor(2025)
      expect(nedslagRespondsToStockIncome(ctx2025, gradedBy(0.5), 0)).toBe(true)
      // Personal income alone has already taken the whole nedslag.
      expect(nedslagRespondsToStockIncome(ctx2025, gradedBy(2), 0)).toBe(false)
      // Far below the grundbeløb, with no gain in sight to close the distance.
      expect(nedslagRespondsToStockIncome(ctx2025, 0, 0)).toBe(false)
    })
  })
})

describe("createPropertyHoldingTax", () => {
  const NO_INCOME: PensionerIncomeYear = {
    personalIncome: 0,
    positiveStockIncome: 0,
  }
  const profile = { ...DEFAULT_TAX_PROFILE, year: 2025 as const }
  const at = (t: number): TaxContext => ({
    t,
    inflation: 0.02,
    profile,
    married: false,
  })

  it("answers exactly as the one-shot does, call after call", () => {
    // The binding reuses one mutable input object across calls, so a field left
    // behind by one call would show up in the next. The arguments below vary in
    // every dimension and are run twice in opposite orders to catch that.
    const cases: Array<
      [number, number, number, TaxContext, PensionerIncomeYear]
    > = [
      [11_500_000, 0, 40, at(0), NO_INCOME],
      [
        4_000_000,
        2_000_000,
        70,
        at(0),
        { personalIncome: 300_000, positiveStockIncome: 50_000 },
      ],
      [0, 0, 70, at(0), NO_INCOME], // no home → no charge
      [
        12_000_000 * 1.02 ** 15,
        0,
        75,
        at(15),
        { personalIncome: 0, positiveStockIncome: 900_000 },
      ],
      [4_000_000, 2_000_000, 70, at(0), NO_INCOME],
    ]
    const bound = createPropertyHoldingTax(profile, false)
    for (const c of [...cases, ...[...cases].reverse()]) {
      expect(bound(...c)).toBe(propertyHoldingTax(...c))
    }
  })
})
