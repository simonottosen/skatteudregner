/**
 * Taxation for the planning simulation, built on the real Danish tax engine in
 * `@/lib/tax`. This replaces the earlier hand-rolled approximation so the
 * projection uses the same rules as the /skat page: AM-bidrag, bund/mellem/top/
 * top-top-skat, kommune- + kirkeskat, personfradrag, rentefradrag (incl.
 * personskattelovens § 11 nedslag), and the aktieindkomst progression limit
 * (incl. the married doubling).
 *
 * Multi-decade bracket creep is avoided by holding the rules at a fixed year and
 * applying them to *real* (today's-kroner) income: a nominal amount at year
 * offset `t` is deflated by (1+inflation)^t, taxed, and the resulting tax is
 * re-inflated. So an income that is constant in real terms pays a constant real
 * tax — exactly how indexed brackets behave.
 */

import type {
  InvestmentTaxMode,
  PlanningTaxProfile,
  PropertyKind,
} from "./types"
import { createDefaultInput } from "@/lib/tax/defaults"
import { calculateTax } from "@/lib/tax/calculator"
import { getRates } from "@/lib/tax/rates"
import { getMunicipality } from "@/lib/tax/municipalities"
import { calculateStockTax } from "@/lib/tax/calculations/stock-tax"
import { calculatePropertyTax } from "@/lib/tax/calculations/property-tax"
import {
  calculateAge,
  calculateRetirementAge,
} from "@/lib/tax/calculations/itemized-deductions"

/** Aktiesparekonto: a flat 17 % lagerbeskatning on the yearly gain. */
export const ASK_TAX_RATE = 0.17

/**
 * Forsigtighedsprincip: property tax bases are ~80 % of the value. The rate
 * thresholds in `rates.ts` are stated on that *basis*, not on the valuation, so
 * a threshold of 9.200.000 means the high rate starts at a 11.500.000 valuation.
 */
export const ASSESSMENT_FACTOR = 0.8

/** Per-call context: where the household lives and how far out we are. */
export interface TaxContext {
  /** Year offset from the start of the projection (0 = today). */
  t: number
  /** General inflation, used to index the brackets to real terms. */
  inflation: number
  profile: PlanningTaxProfile
  /** Couple vs. single — doubles the aktieindkomst limit + transfers thresholds. */
  married: boolean
}

/** Deflation factor that turns a nominal year-`t` amount into today's kroner. */
function realFactor(ctx: TaxContext): number {
  return Math.pow(1 + ctx.inflation, ctx.t)
}

/**
 * Personal income tax on a year's taxable pension income for one person
 * (ratepension + livrente + folkepension). Pension payouts carry no AM-bidrag
 * and earn no beskæftigelsesfradrag, so the gross amount is mapped to non-AM
 * personal income. `spouseTaxableNominal` lets the mellem-/topskat thresholds
 * transfer between partners.
 *
 * `nominalDeductibleInterest` is the person's share of the household's interest
 * expense — realkredit, other debt, equity borrowed against the home. It enters
 * as negative kapitalindkomst and buys relief twice over: it lowers the
 * skattepligtige indkomst that kommune- and kirkeskat are levied on, and it earns
 * personskattelovens § 11 nedslag on top. One number rather than one field per
 * loan, because {@link calculateCapitalIncome} nets every interest field into a
 * single kapitalindkomst before anything is applied — so which field carries it
 * cannot matter, while *how many calls* it is spread over decides how many § 11
 * beløbsgrænser the household gets. Aggregating here is what makes the threshold
 * come out right by construction (issue #8).
 */
export function pensionIncomeTax(
  nominalTaxable: number,
  ctx: TaxContext,
  spouseTaxableNominal?: number,
  nominalDeductibleInterest = 0
): number {
  // No personal income, no tax for a deduction to reduce: § 11's nedslag is a
  // credit in the tax, not a refundable one, so it cannot go below zero either.
  if (nominalTaxable <= 0) return 0
  const f = realFactor(ctx)
  const input = createDefaultInput()
  input.year = ctx.profile.year
  input.municipality = ctx.profile.municipality
  input.churchMember = ctx.profile.churchMember
  input.married = ctx.married
  input.otherNonAmIncome = nominalTaxable / f
  input.mortgageInterest = Math.max(0, nominalDeductibleInterest) / f
  if (ctx.married && spouseTaxableNominal !== undefined) {
    input.spousePersonalIncome = Math.max(0, spouseTaxableNominal / f)
  }
  const result = calculateTax(input)
  // § 11's nedslag is a credit applied *outside* the bracket arithmetic, so
  // `totalIncomeTax` does not carry it (`lib/tax/calculator.ts`). It is already
  // signed as a reduction — never positive — hence added rather than subtracted.
  const realTax = Math.max(0, result.totalIncomeTax + result.ekstraRentefradrag)
  return realTax * f
}

/**
 * Annual investment tax under the lagerprincip. Returns 0 for the realisation
 * model (gains are taxed at the drawdown instead). For `lager` the year's gain
 * is taxed as aktieindkomst (27/42 %), and a loss yields a credit at the low
 * rate; for `ask` it's a flat 17 % on the gain (or credit on a loss). The gain
 * can be negative (a down year), in which case the result is a negative tax.
 */
export function annualInvestmentTax(
  nominalGain: number,
  mode: InvestmentTaxMode,
  ctx: TaxContext
): number {
  if (mode === "realisation" || nominalGain === 0) return 0
  if (mode === "ask") return ASK_TAX_RATE * nominalGain
  // lager: positive gains use the full progressive schedule; losses are
  // deductible against aktieindkomst at the low rate.
  if (nominalGain > 0) return stockGainTax(nominalGain, ctx)
  return getRates(ctx.profile.year).stockTaxLowRate * nominalGain
}

/** Aktieindkomst tax on a year's realised investment gain (27 % / 42 %). */
export function stockGainTax(nominalGain: number, ctx: TaxContext): number {
  if (nominalGain <= 0) return 0
  const f = realFactor(ctx)
  const input = createDefaultInput()
  input.year = ctx.profile.year
  input.married = ctx.married
  input.stockSaleGains = nominalGain / f
  const realTax = calculateStockTax(input, getRates(ctx.profile.year)).totalStockTax
  return realTax * f
}

/**
 * The year's income for ejendomsskattelovens § 26, which grades the § 25
 * pensioner nedslag down by 5 % of the part above a grundbeløb. Nominal kroner,
 * deflated here along with everything else.
 *
 * A household total: § 26 grades spouses who are married and cohabiting on their
 * *combined* amounts, and `ctx.married` already picks the matching grundbeløb.
 */
export interface PensionerIncomeYear {
  /**
   * Personlig indkomst. Pension payouts carry no AM-bidrag, so the gross amount
   * is the personal income — the same quantity `pensionIncomeTax` is handed.
   */
  personalIncome: number
  /** Positiv aktieindkomst realised or accrued in the year. */
  positiveStockIncome: number
}

/**
 * The birth date the tax engine is handed for a household aged `age` in `year`.
 * Synthesised because the plan carries an age and the engine wants a date.
 *
 * Every question about whether the household is old enough has to be asked of
 * *this* string. `calculateRetirementAge` reads the birth month — and since June
 * is month index 5, every date below falls in the first half-year band — against
 * a schedule (65 … 78, in half-year steps) finer than `pension.ts`'s
 * `folkepensionAge`. A predicate written against the latter would disagree with
 * the engine in the years between the two, which is why this lives in one place.
 */
function syntheticBirthDate(age: number, year: number): string {
  return `${year - Math.round(age)}-06-15`
}

/** One dwelling as the property tax sees it: nominal kroner and its § 25 kind. */
export interface TaxableProperty {
  /** Market value in nominal DKK. */
  value: number
  /** Grundværdi in nominal DKK. */
  landValue: number
  kind: PropertyKind
}

/** Annual property holding tax for one household, bound to its fixed inputs. */
export type PropertyPortfolioTax = (
  properties: readonly TaxableProperty[],
  age: number,
  ctx: TaxContext,
  income: PensionerIncomeYear
) => number

/** The engine's mutable per-property input, zeroed to mean "no such property". */
function blankPropertyInput() {
  return {
    propertyValue: 0,
    assessmentBasis: 0,
    landValue: 0,
    landAssessmentBasis: 0,
    purchasedBefore19980701: false,
    isCondo: false,
    ownershipShare: 1,
    personalTaxDiscount: 0,
  }
}

/**
 * Bind the property tax to a household's kommune, rules year and marital status.
 *
 * A simulation asks for the tax tens of thousands of times, and three of the four
 * things behind each call never change: `getMunicipality` scans every Danish
 * kommune linearly, `getRates` looks the year up, and `createDefaultInput` builds
 * a 65-field object. Hoisting them and rewriting only the per-year fields takes
 * ~120 ns off a ~530 ns call — worth having, but measured rather than assumed,
 * and not the bulk of it: `calculatePropertyTax` spends ~390 ns of its ~410 in
 * `calculateAge` + `calculateRetirementAge`, which parse `birthDate` afresh every
 * time. That cost lives in `@/lib/tax` and is the same on every caller.
 *
 * ## Why the portfolio is taxed here rather than one property at a time
 *
 * The § 25 pensionistnedslag is an amount *per boligenhed* — up to 6.000 kr. for
 * a helårsbolig and 2.000 kr. for a fritidsbolig — but § 26's income graduation
 * is spent *once per person*, against those amounts combined. The engine's
 * `pensionerNedslagFactor` is built for exactly that: it grades once and returns
 * a factor, so each of its two slots keeps its own statutory amount. Handing it
 * one property at a time and adding the results up would grade afresh on every
 * call, which is the mistake this function exists to make impossible.
 *
 * So one call carries the pensioner gate and both § 25 dwellings — the first
 * helårsbolig and the first fritidsbolig — and every *further* property is taxed
 * in a call of its own that claims no nedslag. § 25 attaches to the bolig the
 * pensioner actually lives in and the fritidsbolig they actually use, so a third
 * dwelling has none to claim; a household owning two of one kind is the case
 * this understates, and it understates rather than invents.
 *
 * Each property keeps its own § 22 progression either way, because the engine
 * applies the brackets per property and this makes one call per property.
 *
 * The returned function reuses one mutable input object, so it is not reentrant;
 * `calculatePropertyTax` reads the input synchronously and keeps no reference to
 * it, which is what makes that safe. `profile` and `married` are fixed here, and
 * the per-call `ctx` supplies only the year offset the amounts are deflated by.
 */
export function createPropertyPortfolioTax(
  profile: PlanningTaxProfile,
  married: boolean
): PropertyPortfolioTax {
  const muni = getMunicipality(profile.municipality, profile.year)
  const rates = getRates(profile.year)
  const input = createDefaultInput()
  input.year = profile.year
  input.municipality = profile.municipality
  input.married = married
  const home = blankPropertyInput()
  const summer = { ...blankPropertyInput(), municipality: profile.municipality }
  input.property = home
  input.summerHouse = summer
  // A newborn cannot have reached folkepensionsalderen in the rules year, so
  // `pensionerNedslagFactor` returns 0 and the call grants no § 25 nedslag —
  // asked of the same synthesised date the gate is asked of everywhere else.
  const noNedslagBirthDate = syntheticBirthDate(0, profile.year)

  const setSlot = (
    slot: ReturnType<typeof blankPropertyInput>,
    p: TaxableProperty | undefined,
    f: number
  ) => {
    const value = p ? Math.max(0, p.value) / f : 0
    const land = p ? Math.max(0, p.landValue) / f : 0
    slot.propertyValue = value
    slot.assessmentBasis = value * ASSESSMENT_FACTOR
    slot.landValue = land
    slot.landAssessmentBasis = land * ASSESSMENT_FACTOR
  }

  return (properties, age, ctx, income) => {
    if (!muni || properties.length === 0) return 0
    const f = realFactor(ctx)
    const basis = {
      personalIncome: Math.max(0, income.personalIncome) / f,
      // The projection holds no interest-bearing assets, and the one piece of
      // kapitalindkomst it does model — mortgage interest — is a deduction, so
      // the net is negative and § 26 counts only the positive part.
      positiveCapitalIncome: 0,
      positiveStockIncome: Math.max(0, income.positiveStockIncome) / f,
    }
    let homeIdx = -1
    let summerIdx = -1
    for (let i = 0; i < properties.length; i++) {
      if (properties[i].kind === "fritidsbolig") {
        if (summerIdx < 0) summerIdx = i
      } else if (homeIdx < 0) {
        homeIdx = i
      }
    }

    // The nedslag-bearing call: both § 25 dwellings at once, so the graduation
    // is applied to their combined amounts exactly once. A missing kind indexes
    // at -1 and reads `undefined`, which `setSlot` zeroes — the engine then
    // returns nothing for that slot rather than taxing a property of 0 kr.
    setSlot(home, properties[homeIdx], f)
    setSlot(summer, properties[summerIdx], f)
    input.birthDate = syntheticBirthDate(age, profile.year)
    let realTax = calculatePropertyTax(input, rates, basis, muni, muni)
      .totalPropertyTax

    const withNedslag = (homeIdx < 0 ? 0 : 1) + (summerIdx < 0 ? 0 : 1)
    if (properties.length > withNedslag) {
      input.birthDate = noNedslagBirthDate
      for (let i = 0; i < properties.length; i++) {
        if (i === homeIdx || i === summerIdx) continue
        const p = properties[i]
        const isSummer = p.kind === "fritidsbolig"
        setSlot(home, isSummer ? undefined : p, f)
        setSlot(summer, isSummer ? p : undefined, f)
        realTax += calculatePropertyTax(input, rates, basis, muni, muni)
          .totalPropertyTax
      }
    }
    return realTax * f
  }
}

/**
 * Annual property holding tax (ejendomsværdiskat + grundskyld) on one owned
 * helårsbolig, via the real engine. `age` lets the pensioner reduction apply once
 * the household is retired, and `income` grades it under § 26. Values are
 * deflated to real terms (forsigtighedsprincippet ≈ 80 % of value) so the rate
 * brackets index with inflation, then the resulting tax is re-inflated.
 *
 * A one-shot binding of {@link createPropertyPortfolioTax}. Anything that asks
 * repeatedly, or owns more than one property, should use that instead.
 */
export function propertyHoldingTax(
  nominalHomeValue: number,
  nominalLandValue: number,
  age: number,
  ctx: TaxContext,
  income: PensionerIncomeYear
): number {
  if (nominalHomeValue <= 0) return 0
  return createPropertyPortfolioTax(ctx.profile, ctx.married)(
    [
      {
        value: nominalHomeValue,
        landValue: nominalLandValue,
        kind: "helaarsbolig",
      },
    ],
    age,
    ctx,
    income
  )
}

/**
 * The combined § 25 amounts a year's dwellings can claim, before § 26 grades
 * them — i.e. the most the pensionistnedslag can be worth that year, and the
 * width of the band {@link nedslagRespondsToStockIncome} tests against.
 *
 * Mirrors which properties {@link createPropertyPortfolioTax} gives the nedslag
 * to: one helårsbolig and one fritidsbolig. Pure in the kinds owned, so a
 * simulation computes it once per year rather than once per Monte Carlo path.
 */
export function pensionerNedslagInPlay(
  properties: readonly TaxableProperty[],
  profile: PlanningTaxProfile
): number {
  const rates = getRates(profile.year)
  const hasSummer = properties.some((p) => p.kind === "fritidsbolig")
  const hasHome = properties.some((p) => p.kind !== "fritidsbolig")
  return (
    (hasHome ? rates.ejendomsvaerdiSkatPensionerReduction : 0) +
    (hasSummer ? rates.ejendomsvaerdiSkatPensionerReductionSummer : 0)
  )
}

/**
 * Whether the household is old enough for a § 25 pensionistnedslag at all, asked
 * the way {@link createPropertyPortfolioTax} asks it: of the synthesised birth
 * date, so the two can never disagree about a boundary year.
 *
 * Memoised on (rules year, whole age) — the only two things it depends on, since
 * that pair is what {@link syntheticBirthDate} is built from. Both halves of the
 * answer parse a date string, ~400 ns a pair, and a simulation asks once per year
 * of every Monte Carlo path while the answer takes a few dozen distinct values.
 * A pure function of its key, so the cache cannot go stale.
 */
const nedslagAgeGate = new Map<number, boolean>()
export function qualifiesForPensionerNedslag(
  age: number,
  ctx: TaxContext
): boolean {
  const year = ctx.profile.year
  const key = year * 1000 + Math.round(age)
  const cached = nedslagAgeGate.get(key)
  if (cached !== undefined) return cached
  const birthDate = syntheticBirthDate(age, year)
  const qualifies =
    calculateAge(birthDate, year) >= calculateRetirementAge(birthDate)
  nedslagAgeGate.set(key, qualifies)
  return qualifies
}

/**
 * Whether the year's § 25 pensionistnedslag can still move once a drawdown that
 * has already realised `nominalRealisedGain` grows to pay a larger charge — the
 * question that decides whether the coupled calculation in `simulate.ts` has any
 * work left to do.
 *
 * Two ways the answer is no, and between them they cover the common case:
 *
 * - personlig indkomst alone has already graded the whole nedslag away, so no
 *   amount of aktieindkomst can take anything further;
 * - even the largest gain the feedback can reach leaves the § 26
 *   beskatningsgrundlag under the grundbeløb, so the nedslag survives whole.
 *
 * The responsive band is exactly `grundbeløb … grundbeløb + nedslag/5 %` wide.
 * § 26 grades "nedslaget efter § 25" as one amount, so `nedslagInPlay` is the
 * year's whole § 25 entitlement — 6.000 kr. for a helårsbolig, 8.000 kr. once a
 * fritidsbolig joins it. {@link pensionerNedslagInPlay} is where that is worked
 * out; passing the helårsbolig's amount for a household that also owns a summer
 * house would make the band too narrow and skip a settlement that had work left.
 *
 * `headroom` is what makes the second test safe rather than merely plausible.
 * Grading the nedslag away can raise the charge by at most the whole amount in
 * play, a krone of extra charge sells at most 1/(1 − 42 %) kroner once the sale
 * is grossed up for its own tax, and at most every krone sold is gain — so the
 * fixed point's aktieindkomst cannot exceed this one by more than that.
 */
export function nedslagRespondsToStockIncome(
  ctx: TaxContext,
  nominalPersonalIncome: number,
  nominalRealisedGain: number,
  nedslagInPlay: number
): boolean {
  if (nedslagInPlay <= 0) return false
  const rates = getRates(ctx.profile.year)
  const threshold = ctx.married
    ? rates.ejendomsvaerdiSkatPensionerIncomeThresholdMarried
    : rates.ejendomsvaerdiSkatPensionerIncomeThresholdSingle
  const f = realFactor(ctx)
  const personal = Math.max(0, nominalPersonalIncome) / f
  const span = nedslagInPlay / rates.ejendomsvaerdiSkatPensionerIncomeRate
  if (personal >= threshold + span) return false
  const headroom = nedslagInPlay / (1 - rates.stockTaxHighRate)
  return (
    personal + Math.max(0, nominalRealisedGain) / f + headroom > threshold
  )
}

/**
 * Smallest gross sale whose proceeds, after aktieindkomst tax, net `nominalNet`,
 * when a fraction `gainFraction` of each krone sold is a taxable gain. Inverts
 * the two-bracket stock tax (using the same married-doubled progression limit as
 * `stockGainTax`) so a drawdown sells exactly enough — no spurious borrowing.
 */
export function grossUpStockSale(
  nominalNet: number,
  gainFraction: number,
  ctx: TaxContext
): number {
  if (nominalNet <= 0) return 0
  const g = Math.min(1, Math.max(0, gainFraction))
  if (g <= 0) return nominalNet
  const f = realFactor(ctx)
  const realNet = nominalNet / f
  const rates = getRates(ctx.profile.year)
  // A household pot attributes the spouse's full unused band → limit doubles.
  const limit = ctx.married
    ? rates.stockProgressionLimit * 2
    : rates.stockProgressionLimit
  // Low bracket: realNet = sell · (1 − low·g).
  const lowSell = realNet / (1 - rates.stockTaxLowRate * g)
  if (lowSell * g <= limit) return lowSell * f
  // High bracket: realNet = sell · (1 − high·g) + (high − low)·limit.
  const offset = (rates.stockTaxHighRate - rates.stockTaxLowRate) * limit
  const highSell = (realNet - offset) / (1 - rates.stockTaxHighRate * g)
  return highSell * f
}
