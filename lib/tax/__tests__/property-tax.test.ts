import { describe, it, expect } from "vitest"
import { calculatePropertyTax } from "@/lib/tax/calculations/property-tax"
import { calculateTax } from "@/lib/tax/calculator"
import { getRates } from "@/lib/tax/rates"
import { getMunicipality } from "@/lib/tax/municipalities"
import type { PropertyInput, TaxInput, TaxYear } from "@/lib/tax/types"
import { makeInput } from "./helpers"

const rates = getRates(2026)
const rates2025 = getRates(2025)
const kbh = getMunicipality("København", 2026)!

/** Zero land by default, so grundskyld only appears where a test asks for it. */
const dwelling = (
  assessmentBasis: number,
  overrides: Partial<PropertyInput> = {},
): PropertyInput => ({
  propertyValue: assessmentBasis,
  assessmentBasis,
  landValue: 0,
  landAssessmentBasis: 0,
  purchasedBefore19980701: false,
  isCondo: false,
  ownershipShare: 1,
  personalTaxDiscount: 0,
  ...overrides,
})

const sommerhus = (
  assessmentBasis: number,
  overrides: Partial<PropertyInput> = {},
) => ({ ...dwelling(assessmentBasis, overrides), municipality: "Odsherred" })

/** Every figure below is for a København owner whose sommerhus is in Odsherred. */
const taxIn = (year: TaxYear, input: Partial<TaxInput>) =>
  calculatePropertyTax(
    makeInput({ year, ...input }),
    getRates(year),
    // §§ 22-24 do not consult income. The §§ 25-26 cases that do go through
    // `calculateTax`, which assembles the real § 26 base.
    { personalIncome: 0, positiveCapitalIncome: 0, positiveStockIncome: 0 },
    getMunicipality("København", year)!,
    getMunicipality("Odsherred", year),
  )

/** Ejendomsværdiskat alone, since a bare `dwelling` carries no land. */
const evs = (assessmentBasis: number, isCondo = false) =>
  taxIn(2026, { property: dwelling(assessmentBasis, { isCondo }) })
    .ejendomsvaerdiSkatPrimary

describe("Property tax", () => {
  it("7.1 - basic ejendomsværdiskat", () => {
    expect(evs(3_000_000)).toBe(Math.round(0.0051 * 3_000_000))
  })

  it("7.2 - progressive ejendomsværdiskat", () => {
    // Ejendomsskatteloven § 22, stk. 2: 5,1 ‰ of the part not exceeding the
    // progression limit, 14 ‰ of the rest. 2026: 9.007.000 × 0,51 % = 45.935,70
    // plus 2.993.000 × 1,4 % = 41.902,00. Pinned as an absolute so the test
    // cannot drift along with the implementation.
    expect(evs(12_000_000)).toBe(87_838)
  })

  /**
   * Reproduces Vurderingsstyrelsen's own worked example for 2026:
   * 12.000.000 kr. valuation → 9.600.000 kr. basis → 9.007.000 × 0,51 % +
   * 593.000 × 1,4 % = 54.237,70 kr.
   * https://www.vurderingsportalen.dk/ejerbolig/boligskat/forstaa-din-boligskat/ejendomsvaerdiskat/
   */
  it("7.2a - matches Vurderingsstyrelsen's published example", () => {
    expect(evs(9_600_000)).toBe(54_238)
  })

  it("7.2b - taxes the top bracket at 14 ‰, not 5,1 + 14 ‰", () => {
    const limit = rates.ejendomsvaerdiSkatThreshold
    const excess = 1_000_000
    // The marginal krone above the limit must move rate, not gain a second one.
    // Stacking would add another 5.100 kr. here, far outside the ±5 kr. that
    // differencing two rounded kroner figures can cost.
    expect(evs(limit + excess) - evs(limit)).toBeCloseTo(
      rates.ejendomsvaerdiSkatHighRate * excess,
      -1,
    )
  })

  it("7.2c - pins the boundary from both sides", () => {
    const limit = rates.ejendomsvaerdiSkatThreshold
    const low = rates.ejendomsvaerdiSkatLowRate
    const high = rates.ejendomsvaerdiSkatHighRate
    expect(evs(limit - 1_000)).toBe(Math.round(low * (limit - 1_000)))
    expect(evs(limit)).toBe(Math.round(low * limit))
    expect(evs(limit + 1_000)).toBe(Math.round(low * limit + high * 1_000))
  })

  it("7.3 - with ownership share 50%", () => {
    const result = taxIn(2026, {
      property: dwelling(3_000_000, {
        landAssessmentBasis: 1_000_000,
        ownershipShare: 0.5,
      }),
    })
    expect(result.ejendomsvaerdiSkatPrimary).toBe(
      Math.round(0.0051 * 3_000_000 * 0.5),
    )
  })

  it("7.4 - grundskyld", () => {
    const result = taxIn(2026, {
      property: dwelling(3_000_000, { landAssessmentBasis: 1_000_000 }),
    })
    expect(result.grundskyldPrimary).toBe(
      Math.round((kbh.grundskyldRate / 1000) * 1_000_000),
    )
  })

  it("7.5 - no property", () => {
    expect(taxIn(2026, {}).totalPropertyTax).toBe(0)
  })

  it("7.6 - both primary and summer house", () => {
    const result = taxIn(2026, {
      property: dwelling(3_000_000, { landAssessmentBasis: 1_000_000 }),
      summerHouse: sommerhus(2_000_000, { landAssessmentBasis: 500_000 }),
    })
    expect(result.ejendomsvaerdiSkatPrimary).toBeGreaterThan(0)
    expect(result.ejendomsvaerdiSkatSummer).toBeGreaterThan(0)
    expect(result.grundskyldPrimary).toBeGreaterThan(0)
    expect(result.grundskyldSummer).toBeGreaterThan(0)
  })
})

/**
 * Skattestyrelsen's worked examples are stated against the 9.200.000 kr.
 * progression limit, which is the 2024 and 2025 level — 2026 indexes it. So the
 * statutory figures below run on the 2025 rates.
 */
const in2025 = (input: Partial<TaxInput>) => taxIn(2025, input)

/**
 * Ejendomsskatteloven (LOV nr 678 af 03/06/2023) § 23 gives every owner who
 * acquired the property on or before 1 July 1998 an uncapped 1,0 ‰ of the
 * basis; § 24 adds a further 2,1 ‰ capped at 1.200 kr. per boligenhed, which
 * § 24, stk. 2 denies to ejerlejligheder and to fredede ejendomme under
 * ligningslovens § 15 K.
 *
 * The absolute figures are Skattestyrelsen's own, from the two "Eksempler"
 * tables in Den juridiske vejledning C.H.4.2.5.1 for owners below
 * folkepensionsalderen.
 */
describe("Pre-1998 nedslag (ejendomsskatteloven §§ 23-24)", () => {
  const skatExamples = [
    { boligtype: "sommerhus", basis: 1_600_000, isCondo: false, after: 8_160, upTo: 5_360 },
    { boligtype: "ejerlejlighed", basis: 1_760_000, isCondo: true, after: 8_976, upTo: 7_216 },
    { boligtype: "parcelhus", basis: 2_880_000, isCondo: false, after: 14_688, upTo: 10_608 },
    { boligtype: "parcelhus over grænsen", basis: 9_600_000, isCondo: false, after: 52_520, upTo: 41_720 },
  ]

  const primary2025 = (basis: number, overrides: Partial<PropertyInput>) =>
    in2025({ property: dwelling(basis, overrides) }).ejendomsvaerdiSkatPrimary

  it.each(skatExamples)(
    "$boligtype acquired after 1 July 1998 pays $after kr.",
    ({ basis, isCondo, after }) => {
      expect(primary2025(basis, { isCondo })).toBe(after)
    },
  )

  it.each(skatExamples)(
    "$boligtype acquired on or before 1 July 1998 pays $upTo kr.",
    ({ basis, isCondo, upTo }) => {
      expect(
        primary2025(basis, { isCondo, purchasedBefore19980701: true }),
      ).toBe(upTo)
    },
  )

  /** Both nedslag together, isolated by differencing the two acquisition dates. */
  const nedslag = (basis: number, isCondo: boolean) =>
    primary2025(basis, { isCondo }) -
    primary2025(basis, { isCondo, purchasedBefore19980701: true })

  it("denies an ejerlejlighed the § 24 nedslag but not § 23", () => {
    // 2,1 ‰ of 4.000.000 kr. is 8.400 kr., so § 24 would pay its full 1.200 kr.
    // cap to a house. An ejerlejlighed must be left with § 23's 4.000 kr. alone.
    expect(nedslag(4_000_000, true)).toBe(4_000)
    expect(nedslag(4_000_000, false)).toBe(4_000 + 1_200)
  })

  it("caps § 24 at 1.200 kr. only once 2,1 ‰ exceeds it", () => {
    // 2,1 ‰ of 400.000 kr. is 840 kr., below the cap, so the cap must not bind.
    expect(nedslag(400_000, false)).toBe(400 + 840)
  })

  it.each([2024, 2025, 2026] as const)(
    "keeps both nedslag unindexed in %i",
    (year) => {
      // Neither the promille rates nor the 1.200 kr. cap carries a
      // "(20xx-niveau)" tag or a regulation clause the way § 22's grundbeløb
      // does, so every tax year owes the same figures.
      const taxFor = (purchasedBefore19980701: boolean) =>
        taxIn(year, {
          property: dwelling(4_000_000, { purchasedBefore19980701 }),
        }).ejendomsvaerdiSkatPrimary

      expect(taxFor(false) - taxFor(true)).toBe(4_000 + 1_200)
    },
  )

  it("leaves a pre-1998 owner paying 4,1 ‰ and 13,0 ‰", () => {
    // SKAT states § 23's effect as those two rates replacing 5,1 ‰ and 14,0 ‰.
    // An ejerlejlighed isolates § 23, since § 24 does not reach it.
    const limit = rates2025.ejendomsvaerdiSkatThreshold
    const condo = (basis: number) =>
      primary2025(basis, { isCondo: true, purchasedBefore19980701: true })

    expect(condo(limit)).toBe(Math.round(0.0041 * limit))
    expect(condo(limit + 1_000_000)).toBe(
      Math.round(0.0041 * limit + 0.013 * 1_000_000),
    )
  })

  it("surfaces the acquisition date through the whole calculator", () => {
    // The figure /skat renders comes from calculateTax, not from
    // calculatePropertyTax directly, so pin the ejerlejlighed case end to end:
    // § 23 alone, 4,1 ‰ of 3.000.000 kr., with no § 24 nedslag reaching a condo.
    const forCondo = (purchasedBefore19980701: boolean) =>
      calculateTax(
        makeInput({
          year: 2025,
          property: dwelling(3_000_000, {
            isCondo: true,
            purchasedBefore19980701,
          }),
        }),
      ).totalEjendomsvaerdiSkat

    expect(forCondo(false)).toBe(15_300)
    expect(forCondo(true)).toBe(12_300)
  })
})

/**
 * § 25 gives 6.000 kr. per helårsbolig and 2.000 kr. per fritidsbolig once the
 * owner *or a cohabiting spouse* has reached folkepensionsalderen. § 26 then
 * reduces "nedslaget efter § 25" by 5 % of the taxpayer's personlige indkomst
 * plus positiv kapitalindkomst plus positiv aktieindkomst above a grundbeløb —
 * for a cohabiting couple, the spouses' combined amounts.
 *
 * The income cases run through `calculateTax` rather than `calculatePropertyTax`,
 * because the § 26 base is assembled in the calculator out of the personal-,
 * capital- and stock-income steps. Handing the property step a base built by the
 * test would exercise the arithmetic and leave that wiring — the part that was
 * wrong — unchecked.
 */
describe("Pensionistnedslag (ejendomsskatteloven §§ 25-26)", () => {
  const pensioner = { birthDate: "1940-01-01" }
  const threshold = rates2025.ejendomsvaerdiSkatPensionerIncomeThresholdSingle
  const marriedThreshold =
    rates2025.ejendomsvaerdiSkatPensionerIncomeThresholdMarried

  // Den juridiske vejledning C.H.4.2.5.1, the folkepensionist table, before any
  // income graduation. Same properties as the §§ 23-24 table above.
  it("matches SKAT's folkepensionist figures", () => {
    expect(
      in2025({
        ...pensioner,
        summerHouse: sommerhus(1_600_000, { purchasedBefore19980701: true }),
      }).ejendomsvaerdiSkatSummer,
    ).toBe(3_360)

    const primary = (basis: number, isCondo = false) =>
      in2025({
        ...pensioner,
        property: dwelling(basis, { isCondo, purchasedBefore19980701: true }),
      }).ejendomsvaerdiSkatPrimary

    expect(primary(1_760_000, true)).toBe(1_216)
    expect(primary(2_880_000)).toBe(4_608)
    expect(primary(9_600_000)).toBe(35_720)
  })

  const bothProperties = {
    property: dwelling(3_000_000),
    summerHouse: sommerhus(1_500_000),
  }

  /** Total ejendomsværdiskat as /skat renders it, i.e. through the calculator. */
  const evsFor = (input: Partial<TaxInput>) =>
    calculateTax(makeInput({ year: 2025, ...input })).totalEjendomsvaerdiSkat

  /** 8.000 kr. of § 25 nedslag, less whatever § 26 claws back. */
  const withoutPensioner = evsFor(bothProperties)
  const nedslag = (input: Partial<TaxInput>) =>
    withoutPensioner - evsFor({ ...bothProperties, ...pensioner, ...input })
  const nedslagForCouple = (input: Partial<TaxInput>) =>
    nedslag({ married: true, transferIncome: marriedThreshold, ...input })

  it("spends the § 26 income graduation once across two properties", () => {
    // 6.000 + 2.000 kr. of nedslag, less 5 % of the 40.000 kr. above the
    // grundbeløb — one clawback for the person, not one per property.
    expect(nedslag({ transferIncome: threshold + 40_000 })).toBe(
      8_000 - 0.05 * 40_000,
    )
  })

  it("never lets the § 26 graduation become a surcharge", () => {
    // 5 % of 1.000.000 kr. far exceeds the 8.000 kr. it reduces.
    expect(nedslag({ transferIncome: threshold + 1_000_000 })).toBe(0)
  })

  it("grants the nedslag on a cohabiting spouse's age alone", () => {
    // § 25, stk. 1: "den skattepligtige *eller* dennes samlevende ægtefælle".
    // Born 1975, so folkepensionsalderen is 70 and the owner is nowhere near it.
    const younger = { birthDate: "1975-01-01", married: true }
    expect(evsFor({ ...bothProperties, ...younger })).toBe(withoutPensioner)
    expect(
      withoutPensioner -
        evsFor({
          ...bothProperties,
          ...younger,
          spouseOverRetirementAge: true,
        }),
    ).toBe(8_000)
  })

  it("needs an actual ægtefælle for the spouse's age to count", () => {
    // A stale flag left behind by unticking "Gift" must not buy a nedslag.
    expect(
      evsFor({
        ...bothProperties,
        birthDate: "1975-01-01",
        married: false,
        spouseOverRetirementAge: true,
      }),
    ).toBe(withoutPensioner)
  })

  it("does not let enlig forsørger stand in for folkepensionsalderen", () => {
    // The default birth date is decades short of folkepensionsalderen, and
    // enlig forsørger is not one of § 25's groups, so the full tax stands.
    expect(evsFor({ ...bothProperties, singleParent: true })).toBe(
      withoutPensioner,
    )
  })

  it("keeps the nedslag for a single parent who has reached the age", () => {
    // The age test is the only one there is, so ticking enlig forsørger must not
    // take the nedslag away either — nor let it skip the § 26 graduation.
    expect(nedslag({ singleParent: true })).toBe(8_000)
    expect(
      nedslag({ singleParent: true, transferIncome: threshold + 40_000 }),
    ).toBe(8_000 - 2_000)
  })

  it("grades a couple on the spouses' combined personlige indkomst", () => {
    // The pensioner alone sits exactly at the couple's grundbeløb, so every
    // krone the spouse earns is above it: 5 % of 60.000 kr. = 3.000 kr.
    expect(nedslagForCouple({})).toBe(8_000)
    expect(nedslagForCouple({ spousePersonalIncome: 60_000 })).toBe(
      8_000 - 3_000,
    )
  })

  it("counts positiv kapitalindkomst in the § 26 base", () => {
    expect(nedslagForCouple({ interestIncome: 40_000 })).toBe(8_000 - 2_000)
    // § 26 adds "positiv kapitalindkomst", so a negative net is not a deduction
    // from the personlige indkomst already in the base. Measured above the
    // grundbeløb, where the floor on the graduation cannot hide the difference.
    expect(
      nedslagForCouple({
        transferIncome: marriedThreshold + 40_000,
        mortgageInterest: 40_000,
      }),
    ).toBe(8_000 - 2_000)
  })

  it("counts the couple's combined positiv aktieindkomst", () => {
    // Gains are aktieindkomst without being udbytte, so nothing is exempt.
    expect(nedslagForCouple({ stockSaleGains: 40_000 })).toBe(8_000 - 2_000)
    expect(nedslagForCouple({ spouseStockIncome: 40_000 })).toBe(8_000 - 2_000)
  })

  it("leaves the § 26 udbytte-slice out of the base", () => {
    // § 26, stk. 1 counts "positiv aktieindkomst bortset fra udbytteindkomst op
    // til 5.000 kr.", 10.000 kr. for a couple. Both cases leave 40.000 kr. above
    // the grundbeløb, so the wider couple's slice is what makes them agree.
    expect(nedslag({ transferIncome: threshold, danishDividends: 45_000 })).toBe(
      8_000 - 0.05 * 40_000,
    )
    expect(nedslagForCouple({ danishDividends: 50_000 })).toBe(
      8_000 - 0.05 * 40_000,
    )
    // The slice is a ceiling on the udbytte that escapes, not a flat deduction
    // from the aktieindkomst: 4.000 kr. of udbytte exempts 4.000 kr., not 10.000.
    expect(
      nedslagForCouple({ danishDividends: 4_000, stockSaleGains: 40_000 }),
    ).toBe(8_000 - 0.05 * 40_000)
  })

  it("grades on personlig indkomst, not on a subset of the income fields", () => {
    // otherNonAmIncome is personlig indkomst; personalIncomeDeductions comes off
    // it. The old base saw neither.
    expect(nedslag({ otherNonAmIncome: threshold + 40_000 })).toBe(
      8_000 - 2_000,
    )
    expect(
      nedslag({
        transferIncome: threshold + 40_000,
        personalIncomeDeductions: 40_000,
      }),
    ).toBe(8_000)
  })

  it("measures wage income after AM-bidrag", () => {
    // A-indkomst enters personlig indkomst net of the 8 %, so a gross wage just
    // above the grundbeløb is below it once AM-bidrag is gone.
    const gross = Math.round(threshold * 1.05)
    expect(gross).toBeGreaterThan(threshold)
    expect(gross * (1 - rates2025.amBidragRate)).toBeLessThan(threshold)
    expect(nedslag({ workIncome: gross })).toBe(8_000)
  })

  it("ignores a remarriage date on a household claiming under stk. 1", () => {
    // § 25, stk. 3, 3. pkt. ends the *succession*, not the age-based nedslag, so
    // a flag left behind from an earlier answer must not cost a pensioner
    // anything.
    expect(nedslag({ remarriageDate: "2020-01-01" })).toBe(8_000)
  })
})

/**
 * Ejendomsskatteloven § 25, stk. 3 gives the § 25 nedslag "tilsvarende til en
 * længstlevende ægtefælle, der ikke opfylder betingelserne for nedsættelse, hvis
 * denne efter ægtefællens død eller flytning på plejehjem bevarer rådigheden
 * over en ejendom, som har tilhørt en af ægtefællerne" (1. pkt.), on condition
 * that the spouses were not separated at the death or the move (2. pkt.), and
 * ends the right "med virkning fra og med det indkomstår, hvori ægteskabet
 * indgås" if the survivor remarries (3. pkt.).
 *
 * § 23, stk. 3 does the same for the pre-1998 nedslag — for "en ejendom, der har
 * tilhørt den anden ægtefælle" — and § 24, stk. 3 applies it to the second one.
 * Neither of those carries the remarriage clause, so it is only § 25 a new
 * marriage reaches.
 */
describe("Længstlevende ægtefælle (§ 23, stk. 3, § 24, stk. 3, § 25, stk. 3)", () => {
  // Born 1980, so folkepensionsalderen is 71 and none of these households can
  // qualify under § 25, stk. 1. Every krone of nedslag below is stk. 3's doing.
  const survivor = { birthDate: "1980-01-01", married: false }

  const evsIn = (year: TaxYear, input: Partial<TaxInput>) =>
    calculateTax(makeInput({ year, ...survivor, ...input }))
      .totalEjendomsvaerdiSkat

  const house = (overrides: Partial<PropertyInput> = {}) =>
    dwelling(3_000_000, overrides)
  const summer = (overrides: Partial<PropertyInput> = {}) =>
    sommerhus(1_500_000, overrides)

  /** Both dwellings taxed in full, so a nedslag shows up as a difference. */
  const fullTax = (year: TaxYear, input: Partial<TaxInput> = {}) =>
    evsIn(year, { property: house(), summerHouse: summer(), ...input })

  it("grants the nedslag per kept dwelling, and only per kept dwelling", () => {
    // § 25's amounts are per boligenhed, and stk. 3's condition is met by the
    // dwelling rather than by the person: a survivor who kept the house but
    // bought the sommerhus themselves is due 6.000 kr., not 8.000.
    const kept = (input: Partial<TaxInput>) => fullTax(2025) - evsIn(2025, input)

    expect(
      kept({ property: house({ retainedFromSpouse: true }), summerHouse: summer() }),
    ).toBe(6_000)
    expect(
      kept({ property: house(), summerHouse: summer({ retainedFromSpouse: true }) }),
    ).toBe(2_000)
    expect(
      kept({
        property: house({ retainedFromSpouse: true }),
        summerHouse: summer({ retainedFromSpouse: true }),
      }),
    ).toBe(8_000)
  })

  it("leaves a household that kept nothing exactly where it was", () => {
    // The two new flags are inert on their own: without the succession there is
    // no ejendom "der har tilhørt den anden ægtefælle" for either to attach to.
    expect(
      fullTax(2025, {
        property: house({ spouseAcquiredBefore19980701: true }),
        remarriageDate: "2024-05-01",
      }),
    ).toBe(fullTax(2025))
  })

  const both = {
    property: house({ retainedFromSpouse: true }),
    summerHouse: summer({ retainedFromSpouse: true }),
  }
  const nedslagIn = (year: TaxYear, input: Partial<TaxInput> = {}) =>
    fullTax(year) - evsIn(year, { ...both, ...input })

  it("ends the nedslag from and including the year of a new marriage", () => {
    expect(nedslagIn(2024, { remarriageDate: "2025-06-01" })).toBe(8_000)
    expect(nedslagIn(2025, { remarriageDate: "2025-06-01" })).toBe(0)
    expect(nedslagIn(2026, { remarriageDate: "2025-06-01" })).toBe(0)
  })

  it("reads the marriage year off the date, not off a UTC timestamp", () => {
    // A 1 January date parsed as UTC midnight and read back in local time falls
    // into the previous year west of Greenwich, which would leave the nedslag
    // standing for a year it is gone.
    expect(nedslagIn(2024, { remarriageDate: "2025-01-01" })).toBe(8_000)
    expect(nedslagIn(2025, { remarriageDate: "2025-01-01" })).toBe(0)
  })

  it("lets a remarried survivor still qualify on the new spouse's age", () => {
    // 3. pkt. ends the right to *succeed*; it says nothing about stk. 1, which
    // the new marriage can satisfy on its own.
    expect(
      nedslagIn(2026, {
        remarriageDate: "2025-06-01",
        married: true,
        spouseOverRetirementAge: true,
      }),
    ).toBe(8_000)
  })

  it("runs §§ 23-24 on the deceased spouse's acquisition date", () => {
    // § 23's 1,0 ‰ of 3.000.000 kr. plus § 24's 2,1 ‰ capped at 1.200 kr.,
    // isolated from § 25 by holding the succession fixed on both sides.
    const succeeded = evsIn(2025, {
      property: house({ retainedFromSpouse: true }),
    })
    const pre1998 = evsIn(2025, {
      property: house({
        retainedFromSpouse: true,
        spouseAcquiredBefore19980701: true,
      }),
    })
    expect(succeeded - pre1998).toBe(3_000 + 1_200)

    // And it is the same nedslag the survivor's own acquisition would buy.
    expect(pre1998).toBe(
      evsIn(2025, {
        property: house({
          retainedFromSpouse: true,
          purchasedBefore19980701: true,
        }),
      }),
    )
  })

  it("keeps §§ 23-24 after a remarriage, unlike § 25", () => {
    // Neither § 23, stk. 3 nor § 24, stk. 3 carries the remarriage clause, so a
    // new marriage costs the pensionistnedslag and leaves these two alone.
    const remarried = evsIn(2025, {
      property: house({
        retainedFromSpouse: true,
        spouseAcquiredBefore19980701: true,
      }),
      remarriageDate: "2024-01-01",
    })
    expect(evsIn(2025, { property: house() }) - remarried).toBe(3_000 + 1_200)
  })

  const single = rates2025.ejendomsvaerdiSkatPensionerIncomeThresholdSingle
  const married = rates2025.ejendomsvaerdiSkatPensionerIncomeThresholdMarried

  it("spends the § 26 graduation once, against the amounts actually due", () => {
    const income = { transferIncome: single + 40_000 }
    const kept = (input: Partial<TaxInput>) =>
      fullTax(2025, income) - evsIn(2025, { ...income, ...input })

    // One 2.000 kr. clawback for the person: measured against the 6.000 kr. the
    // survivor is actually due, not against a per-dwelling maximum and not
    // against the 8.000 kr. a household that kept both would have.
    expect(
      kept({ property: house({ retainedFromSpouse: true }), summerHouse: summer() }),
    ).toBe(6_000 - 2_000)
    expect(kept(both)).toBe(8_000 - 2_000)
  })

  it("grades the survivor against the single grundbeløb", () => {
    // § 26, stk. 1 puts the couple's wider grundbeløb and their combined income
    // behind "Er den skattepligtige gift og samlevende med ægtefællen ved
    // udgangen af indkomståret". A længstlevende ægtefælle is neither at the end
    // of the year their spouse died, so the single figure binds — at an income
    // still well short of the married grundbeløb, the clawback must bite.
    const income = single + 40_000
    expect(income).toBeLessThan(married)
    expect(nedslagIn(2025, { transferIncome: income })).toBe(8_000 - 2_000)
  })
})
