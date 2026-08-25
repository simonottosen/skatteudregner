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

  if (property.purchasedBefore19980701) {
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
 * The share of the § 25 pensioner nedslag that survives § 26's income
 * graduation.
 *
 * § 26 reduces "nedslaget efter § 25" — one amount belonging to the person — by
 * 5 % of income above the grundbeløb. Someone who owns both a helårsbolig and a
 * fritidsbolig meets that clawback once, against the combined 6.000 + 2.000 kr.,
 * so it cannot be recomputed against each property's own maximum. Expressing it
 * as a factor spends the graduation exactly once while leaving each property
 * with its own statutory amount.
 */
function pensionerNedslagFactor(
  input: TaxInput,
  rates: TaxRates,
  income: PensionerIncomeBasis,
): number {
  const age = calculateAge(input.birthDate, input.year)
  const ownerQualifies = age >= calculateRetirementAge(input.birthDate)
  // § 25, stk. 1 asks whether "den skattepligtige eller dennes samlevende
  // ægtefælle" has reached folkepensionsalderen, so a younger owner qualifies on
  // the spouse's age alone.
  const spouseQualifies = input.married && !!input.spouseOverRetirementAge
  if (!ownerQualifies && !spouseQualifies && !input.singleParent) return 0

  const fullNedslag =
    (hasBasis(input.property) ? rates.ejendomsvaerdiSkatPensionerReduction : 0) +
    (hasBasis(input.summerHouse)
      ? rates.ejendomsvaerdiSkatPensionerReductionSummer
      : 0)
  if (fullNedslag === 0) return 0

  const threshold = input.married
    ? rates.ejendomsvaerdiSkatPensionerIncomeThresholdMarried
    : rates.ejendomsvaerdiSkatPensionerIncomeThresholdSingle
  const graduation = Math.max(
    0,
    (graduationBase(input, income) - threshold) *
      rates.ejendomsvaerdiSkatPensionerIncomeRate,
  )

  return Math.max(0, fullNedslag - graduation) / fullNedslag
}

export function calculatePropertyTax(
  input: TaxInput,
  rates: TaxRates,
  income: PensionerIncomeBasis,
  primaryMunicipality: MunicipalityData,
  summerMunicipality?: MunicipalityData,
): PropertyTaxResult {
  // Ejendomsværdiskat
  const nedslagFactor = pensionerNedslagFactor(input, rates, income)

  const ejendomsvaerdiSkatPrimary = Math.round(
    calculateEjendomsvaerdiSkat(
      input.property,
      rates,
      rates.ejendomsvaerdiSkatPensionerReduction * nedslagFactor,
    ),
  )

  const ejendomsvaerdiSkatSummer = Math.round(
    calculateEjendomsvaerdiSkat(
      input.summerHouse,
      rates,
      rates.ejendomsvaerdiSkatPensionerReductionSummer * nedslagFactor,
    ),
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
