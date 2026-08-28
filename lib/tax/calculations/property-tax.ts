import type { TaxInput, TaxRates, PropertyInput, MunicipalityData } from "../types"
import { calculateAge, calculateRetirementAge } from "./itemized-deductions"

export interface PropertyTaxResult {
  ejendomsvaerdiSkatPrimary: number
  ejendomsvaerdiSkatSummer: number
  totalEjendomsvaerdiSkat: number
  grundskyldPrimary: number
  grundskyldSummer: number
  personalTaxDiscount: number
  totalPropertyTax: number
}

/**
 * The taxpayer's own share of the § 26 beskatningsgrundlag, handed over from the
 * steps that already computed it. Re-deriving personal, capital and stock income
 * from the raw input fields here would create a second definition of each, free
 * to drift from the one the rest of the engine taxes — which is exactly how this
 * base came to be a sum of five salary fields.
 */
export interface PensionerIncomeBasis {
  /** Personlig indkomst, net of AM-bidrag and personal-income deductions. */
  personalIncome: number
  /** Positiv nettokapitalindkomst; zero when the net is negative. */
  positiveCapitalIncome: number
  /** Positiv aktieindkomst. */
  positiveStockIncome: number
}

/** Ejendomsskatteloven § 24, stk. 1. The rate carries no indexation clause. */
const PRE_1998_EXTRA_RATE = 0.0021

/**
 * Ejendomsskatteloven § 26, stk. 1 keeps udbytteindkomst up to 5.000 kr. out of
 * the base, 10.000 kr. for a couple. Unlike the grundbeløb in the same stykke
 * these two amounts carry no "(2010-niveau)" tag, so stk. 2's regulation by
 * personskattelovens § 20 does not reach them.
 */
const PENSIONER_DIVIDEND_EXEMPTION = 5000
const PENSIONER_DIVIDEND_EXEMPTION_MARRIED = 10000

function hasBasis(
  property: PropertyInput | undefined,
): property is PropertyInput {
  return !!property && property.assessmentBasis > 0
}

/**
 * Whether §§ 23-24's "erhvervet senest den 1. juli 1998" is met for a dwelling.
 *
 * § 23, stk. 1 asks it of *den skattepligtige*, but stk. 3 gives the nedslag
 * "tilsvarende" to a længstlevende ægtefælle who does not meet that condition
 * themselves and who keeps rådigheden over a property that belonged to the other
 * spouse; § 24, stk. 3 applies stk. 3 to the second nedslag as well. So for a
 * survivor the date that counts is the deceased's, not their own — the point Den
 * juridiske vejledning C.H.4.2.5.1 makes in prose.
 *
 * Unlike § 25, stk. 3, neither § 23, stk. 3 nor § 24, stk. 3 carries a
 * remarriage clause, so a new marriage leaves these two nedslag standing.
 */
function acquiredBefore19980701(property: PropertyInput): boolean {
  return (
    property.purchasedBefore19980701 ||
    !!(property.retainedFromSpouse && property.spouseAcquiredBefore19980701)
  )
}

function calculateEjendomsvaerdiSkat(
  property: PropertyInput | undefined,
  rates: TaxRates,
  pensionerNedslag: number,
): number {
  if (!hasBasis(property)) return 0

  const basis = property.assessmentBasis

  // § 22, stk. 2: the low rate covers only the part of the basis that does not
  // exceed the progression limit, and the high rate applies to the rest
  // *instead of* — not on top of — the low one.
  const progressionLimit = rates.ejendomsvaerdiSkatThreshold
  let tax = rates.ejendomsvaerdiSkatLowRate * Math.min(basis, progressionLimit)
  if (basis > progressionLimit) {
    tax += rates.ejendomsvaerdiSkatHighRate * (basis - progressionLimit)
  }

  if (acquiredBefore19980701(property)) {
    // § 23, stk. 1: 1,0 promille of the basis, uncapped and open to every
    // property type. SKAT states the effect as paying 4,1 ‰ / 13,0 ‰ instead
    // of 5,1 ‰ / 14,0 ‰.
    tax -= rates.ejendomsvaerdiSkatPre1998Rate * basis

    // § 24: a *further* 2,1 promille, capped at 1.200 kr. per boligenhed.
    // Stk. 2 denies this second nedslag to ejerlejligheder and to fredede
    // ejendomme under ligningslovens § 15 K — the two cases the isCondo flag
    // marks ("Ejerlejlighed/fredet" in the form).
    if (!property.isCondo) {
      tax -= Math.min(
        rates.ejendomsvaerdiSkatPre1998MaxReduction,
        PRE_1998_EXTRA_RATE * basis,
      )
    }
  }

  tax -= pensionerNedslag

  // § 16: the tax on a jointly owned property falls on each owner by ejerandel,
  // after the nedslag in §§ 23-26. § 25, 3. pkt. floors the result at zero.
  return Math.max(0, tax * property.ownershipShare)
}

/**
 * The § 26, stk. 1 beskatningsgrundlag: personlig indkomst plus positiv
 * kapitalindkomst plus positiv aktieindkomst, less the exempt slice of
 * udbytteindkomst. A taxpayer who is married and cohabiting at the end of the
 * year is graded on the spouses' *combined* amounts, which is why the spouse's
 * figures join the sum.
 *
 * TaxInput models no spouse kapitalindkomst and no spouse udbytteindkomst, so
 * those two parts of a couple's total are the taxpayer's alone. The gaps pull in
 * opposite directions — a missing spouse capital income understates the base,
 * a missing spouse dividend understates the exempt slice — and neither can be
 * closed without new input fields.
 */
function graduationBase(
  input: TaxInput,
  income: PensionerIncomeBasis,
): number {
  const spousePersonalIncome = input.married
    ? (input.spousePersonalIncome ?? 0)
    : 0
  const spouseStockIncome = input.married ? (input.spouseStockIncome ?? 0) : 0
  const exemptDividends = Math.min(
    input.danishDividends + input.foreignDividends,
    input.married
      ? PENSIONER_DIVIDEND_EXEMPTION_MARRIED
      : PENSIONER_DIVIDEND_EXEMPTION,
  )
  const stockIncome = Math.max(
    0,
    income.positiveStockIncome + spouseStockIncome - exemptDividends,
  )

  return (
    income.personalIncome +
    spousePersonalIncome +
    income.positiveCapitalIncome +
    stockIncome
  )
}

/**
 * § 25, stk. 1: the taxpayer's household has reached folkepensionsalderen.
 *
 * The stykke asks whether "den skattepligtige eller dennes samlevende ægtefælle"
 * has reached it, so a younger owner qualifies on the spouse's age alone. Enlig
 * forsørger earns relief under ligningslovens § 9 J and in grøn check, neither
 * of which reaches ejendomsværdiskatten. The only other group § 25 reaches is
 * the længstlevende ægtefælle of stk. 3, handled per dwelling below.
 */
function pensionerAgeQualifies(input: TaxInput): boolean {
  const age = calculateAge(input.birthDate, input.year)
  if (age >= calculateRetirementAge(input.birthDate)) return true
  return input.married && !!input.spouseOverRetirementAge
}

/**
 * Whether a længstlevende ægtefælle may still succeed under § 25, stk. 3.
 *
 * 3. pkt. ends the right "med virkning fra og med det indkomstår, hvori
 * ægteskabet indgås", so a later remarriage leaves earlier income years intact.
 * The year is read off the ISO date's first four characters rather than through
 * `Date`, which resolves a date-only string as UTC midnight and would report the
 * previous year for a 1 January marriage west of Greenwich.
 */
function survivorSuccessionIsLive(input: TaxInput): boolean {
  const remarriageYear = Number(input.remarriageDate?.slice(0, 4))
  // An absent or unparsable date is no evidence that a remarriage happened.
  if (!remarriageYear) return true
  return input.year < remarriageYear
}

/** The § 25 nedslag each dwelling is due, after § 26's graduation. */
interface PensionerNedslag {
  primary: number
  summer: number
}

/**
 * The § 25 pensioner nedslag per dwelling, net of § 26's income graduation.
 *
 * The amounts are *per boligenhed* — up to 6.000 kr. for a helårsbolig and
 * 2.000 kr. for a fritidsbolig — but § 26 reduces "nedslaget efter § 25", one
 * amount belonging to the person, by 5 % of income above the grundbeløb. Someone
 * who owns both meets that clawback once, against the combined 6.000 + 2.000 kr.,
 * so it cannot be recomputed against each dwelling's own maximum. Grading the sum
 * and scaling both slots by the surviving share spends the graduation exactly
 * once while leaving each dwelling its own statutory amount.
 *
 * Eligibility, unlike the graduation, is per dwelling: stk. 1 is a fact about the
 * person and so reaches both slots, while stk. 3 grants the nedslag
 * "tilsvarende" to a survivor "der ikke opfylder betingelserne for nedsættelse"
 * for the dwelling they keep rådigheden over. A survivor who succeeded to the
 * house but bought the sommerhus themselves is therefore graded on 6.000 kr.,
 * not on 8.000.
 */
function pensionerNedslag(
  input: TaxInput,
  rates: TaxRates,
  income: PensionerIncomeBasis,
): PensionerNedslag {
  const ageQualifies = pensionerAgeQualifies(input)
  const successionIsLive = survivorSuccessionIsLive(input)
  const amountFor = (
    property: PropertyInput | undefined,
    amount: number,
  ): number => {
    if (!hasBasis(property)) return 0
    if (ageQualifies) return amount
    return successionIsLive && !!property.retainedFromSpouse ? amount : 0
  }

  const primary = amountFor(
    input.property,
    rates.ejendomsvaerdiSkatPensionerReduction,
  )
  const summer = amountFor(
    input.summerHouse,
    rates.ejendomsvaerdiSkatPensionerReductionSummer,
  )
  const fullNedslag = primary + summer
  if (fullNedslag === 0) return { primary: 0, summer: 0 }

  // § 26, stk. 1 puts the couple's wider grundbeløb and their combined income
  // behind "Er den skattepligtige gift og samlevende med ægtefællen ved udgangen
  // af indkomståret". A længstlevende ægtefælle is neither at the end of the year
  // their spouse died, so they are graded alone against the single grundbeløb —
  // which `input.married` already says, since it is the same year-end test.
  const threshold = input.married
    ? rates.ejendomsvaerdiSkatPensionerIncomeThresholdMarried
    : rates.ejendomsvaerdiSkatPensionerIncomeThresholdSingle
  const graduation = Math.max(
    0,
    (graduationBase(input, income) - threshold) *
      rates.ejendomsvaerdiSkatPensionerIncomeRate,
  )
  const surviving = Math.max(0, fullNedslag - graduation) / fullNedslag

  return { primary: primary * surviving, summer: summer * surviving }
}

export function calculatePropertyTax(
  input: TaxInput,
  rates: TaxRates,
  income: PensionerIncomeBasis,
  primaryMunicipality: MunicipalityData,
  summerMunicipality?: MunicipalityData,
): PropertyTaxResult {
  // Ejendomsværdiskat
  const nedslag = pensionerNedslag(input, rates, income)

  const ejendomsvaerdiSkatPrimary = Math.round(
    calculateEjendomsvaerdiSkat(input.property, rates, nedslag.primary),
  )

  const ejendomsvaerdiSkatSummer = Math.round(
    calculateEjendomsvaerdiSkat(input.summerHouse, rates, nedslag.summer),
  )

  const totalEjendomsvaerdiSkat =
    ejendomsvaerdiSkatPrimary + ejendomsvaerdiSkatSummer

  // Grundskyld
  const grundskyldPrimary = input.property
    ? Math.round(
        (primaryMunicipality.grundskyldRate / 1000) *
          input.property.landAssessmentBasis *
          input.property.ownershipShare,
      )
    : 0

  const grundskyldSummer =
    input.summerHouse && summerMunicipality
      ? Math.round(
          (summerMunicipality.grundskyldRate / 1000) *
            input.summerHouse.landAssessmentBasis *
            input.summerHouse.ownershipShare,
        )
      : 0

  // Personal tax discount
  const personalTaxDiscount =
    (input.property?.personalTaxDiscount ?? 0) +
    (input.summerHouse?.personalTaxDiscount ?? 0)

  const totalPropertyTax = Math.max(
    0,
    totalEjendomsvaerdiSkat + grundskyldPrimary + grundskyldSummer - personalTaxDiscount,
  )

  return {
    ejendomsvaerdiSkatPrimary,
    ejendomsvaerdiSkatSummer,
    totalEjendomsvaerdiSkat,
    grundskyldPrimary,
    grundskyldSummer,
    personalTaxDiscount,
    totalPropertyTax,
  }
}
