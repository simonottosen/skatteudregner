/**
 * Taxation for the planning simulation, built on the real Danish tax engine in
 * `@/lib/tax`. This replaces the earlier hand-rolled approximation so the
 * projection uses the same rules as the /skat page: AM-bidrag, bund/mellem/top/
 * top-top-skat, kommune- + kirkeskat, personfradrag, and the aktieindkomst
 * progression limit (incl. the married doubling).
 *
 * Multi-decade bracket creep is avoided by holding the rules at a fixed year and
 * applying them to *real* (today's-kroner) income: a nominal amount at year
 * offset `t` is deflated by (1+inflation)^t, taxed, and the resulting tax is
 * re-inflated. So an income that is constant in real terms pays a constant real
 * tax — exactly how indexed brackets behave.
 */

import type { InvestmentTaxMode, PlanningTaxProfile } from "./types"
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
 */
export function pensionIncomeTax(
  nominalTaxable: number,
  ctx: TaxContext,
  spouseTaxableNominal?: number
): number {
  if (nominalTaxable <= 0) return 0
  const f = realFactor(ctx)
  const input = createDefaultInput()
  input.year = ctx.profile.year
  input.municipality = ctx.profile.municipality
  input.churchMember = ctx.profile.churchMember
  input.married = ctx.married
  input.otherNonAmIncome = nominalTaxable / f
  if (ctx.married && spouseTaxableNominal !== undefined) {
    input.spousePersonalIncome = Math.max(0, spouseTaxableNominal / f)
  }
  const realTax = Math.max(0, calculateTax(input).totalIncomeTax)
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

/** Annual property holding tax for one household, bound to its fixed inputs. */
export type PropertyHoldingTax = (
  nominalHomeValue: number,
  nominalLandValue: number,
  age: number,
  ctx: TaxContext,
  income: PensionerIncomeYear
) => number

/**
 * Bind {@link propertyHoldingTax} to a household's kommune, rules year and
 * marital status.
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
 * The returned function reuses one mutable input object, so it is not reentrant;
 * `calculatePropertyTax` reads the input synchronously and keeps no reference to
 * it, which is what makes that safe. `profile` and `married` are fixed here, and
 * the per-call `ctx` supplies only the year offset the amounts are deflated by.
 */
export function createPropertyHoldingTax(
  profile: PlanningTaxProfile,
  married: boolean
): PropertyHoldingTax {
  const muni = getMunicipality(profile.municipality, profile.year)
  const rates = getRates(profile.year)
  const input = createDefaultInput()
  input.year = profile.year
  input.municipality = profile.municipality
  input.married = married
  const property = {
    propertyValue: 0,
    assessmentBasis: 0,
    landValue: 0,
    landAssessmentBasis: 0,
    purchasedBefore19980701: false,
    isCondo: false,
    ownershipShare: 1,
    personalTaxDiscount: 0,
  }
  input.property = property
  return (nominalHomeValue, nominalLandValue, age, ctx, income) => {
    if (nominalHomeValue <= 0 || !muni) return 0
    const f = realFactor(ctx)
    const realHome = nominalHomeValue / f
    const realLand = nominalLandValue / f
    input.birthDate = syntheticBirthDate(age, profile.year)
    property.propertyValue = realHome
    property.assessmentBasis = realHome * ASSESSMENT_FACTOR
    property.landValue = realLand
    property.landAssessmentBasis = realLand * ASSESSMENT_FACTOR
    const realTax = calculatePropertyTax(
      input,
      rates,
      {
        personalIncome: Math.max(0, income.personalIncome) / f,
        // The projection holds no interest-bearing assets, and the one piece of
        // kapitalindkomst it does model — mortgage interest — is a deduction, so
        // the net is negative and § 26 counts only the positive part.
        positiveCapitalIncome: 0,
        positiveStockIncome: Math.max(0, income.positiveStockIncome) / f,
      },
      muni
    ).totalPropertyTax
    return realTax * f
  }
}

/**
 * Annual property holding tax (ejendomsværdiskat + grundskyld) on the owned
 * home, via the real engine. `age` lets the pensioner reduction apply once the
 * household is retired, and `income` grades it under § 26. Values are deflated
 * to real terms (forsigtighedsprincippet ≈ 80 % of value) so the rate brackets
 * index with inflation, then the resulting tax is re-inflated.
 *
 * A one-shot binding of {@link createPropertyHoldingTax}. Anything that asks
 * repeatedly should hold on to the binding instead.
 */
export function propertyHoldingTax(
  nominalHomeValue: number,
  nominalLandValue: number,
  age: number,
  ctx: TaxContext,
  income: PensionerIncomeYear
): number {
  return createPropertyHoldingTax(ctx.profile, ctx.married)(
    nominalHomeValue,
    nominalLandValue,
    age,
    ctx,
    income
  )
}

/**
 * Whether the household is old enough for a § 25 pensionistnedslag at all, asked
 * the way {@link createPropertyHoldingTax} asks it: of the synthesised birth
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
 * The responsive band is exactly `grundbeløb … grundbeløb + 6.000/5 %` wide.
 * § 26 grades "nedslaget efter § 25", and the only nedslag this module can
 * produce is the helårsbolig's 6.000 kr.: it never describes a fritidsbolig, so
 * the summer-house amount never joins the total.
 *
 * `headroom` is what makes the second test safe rather than merely plausible.
 * Grading the nedslag away can raise the charge by at most the whole 6.000 kr.,
 * a krone of extra charge sells at most 1/(1 − 42 %) kroner once the sale is
 * grossed up for its own tax, and at most every krone sold is gain — so the
 * fixed point's aktieindkomst cannot exceed this one by more than that.
 */
export function nedslagRespondsToStockIncome(
  ctx: TaxContext,
  nominalPersonalIncome: number,
  nominalRealisedGain: number
): boolean {
  const rates = getRates(ctx.profile.year)
  const threshold = ctx.married
    ? rates.ejendomsvaerdiSkatPensionerIncomeThresholdMarried
    : rates.ejendomsvaerdiSkatPensionerIncomeThresholdSingle
  const f = realFactor(ctx)
  const personal = Math.max(0, nominalPersonalIncome) / f
  const span =
    rates.ejendomsvaerdiSkatPensionerReduction /
    rates.ejendomsvaerdiSkatPensionerIncomeRate
  if (personal >= threshold + span) return false
  const headroom =
    rates.ejendomsvaerdiSkatPensionerReduction / (1 - rates.stockTaxHighRate)
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
