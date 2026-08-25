import { describe, it, expect } from "vitest"
import {
  ASSESSMENT_FACTOR,
  grossUpStockSale,
  pensionIncomeTax,
  propertyHoldingTax,
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
  })
})
