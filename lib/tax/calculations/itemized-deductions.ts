import type { TaxInput, TaxRates, MunicipalityData } from "../types"
import type { PersonalIncomeResult } from "./personal-income"

export interface ItemizedDeductionsResult {
  beskaeftigelsesFradrag: number
  ekstraBeskaeftigelseForsorgere: number
  ekstraBeskaeftigelseSenior: number
  jobFradrag: number
  ekstraPensionsFradrag: number
  befordringsFradrag: number
  forhoejetBefordringsFradrag: number
  unionFeesDeduction: number
  aKasseDeduction: number
  charitableDonationsDeduction: number
  greenRenovationDeduction: number
  serviceDeductionAmount: number
  alimonyDeduction: number
  doubleHouseholdDeduction: number
  researchDonationsDeduction: number
  otherEmployeeExpensesDeduction: number
  otherDeductionsAmount: number
  capitalIncomeDeduction: number
  totalItemizedDeductions: number
}

export function calculateAge(birthDate: string, year: number): number {
  const bd = new Date(birthDate)
  const refDate = new Date(year, 11, 31)
  return (refDate.getTime() - bd.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
}

export function calculateRetirementAge(birthDate: string): number {
  const bd = new Date(birthDate)
  const year = bd.getFullYear()
  const halfYear = bd.getMonth() < 6 ? 1 : 2

  if (year < 1954) return 65
  if (year === 1954 && halfYear === 1) return 65.5
  if (year === 1954 && halfYear === 2) return 66
  if (year === 1955 && halfYear === 1) return 66.5
  if (year === 1955 && halfYear === 2) return 67
  if (year <= 1962) return 67
  if (year <= 1966) return 68
  if (year <= 1969) return 69
  if (year <= 1974) return 70
  if (year === 1975 && halfYear === 1) return 70
  if (year === 1975 && halfYear === 2) return 70.5
  if (year <= 1978) return 71
  if (year === 1979 && halfYear === 1) return 71
  if (year === 1979 && halfYear === 2) return 71.5
  if (year <= 1983) return 71.5
  if (year <= 1986) return 72
  if (year <= 1989) return 72.5
  if (year <= 1993) return 73
  if (year <= 1996) return 73.5
  if (year <= 1999) return 74
  if (year <= 2002) return 74.5
  if (year <= 2005) return 75
  if (year <= 2008) return 75.5
  if (year <= 2011) return 76
  if (year <= 2014) return 76.5
  if (year <= 2017) return 77
  if (year <= 2019) return 77.5
  return 78
}

function isNearRetirement(birthDate: string, year: number): boolean {
  const age = calculateAge(birthDate, year)
  const retAge = calculateRetirementAge(birthDate)
  return retAge - age <= 15
}

function isSenior(birthDate: string, year: number): boolean {
  const age = calculateAge(birthDate, year)
  const retAge = calculateRetirementAge(birthDate)
  return retAge - age <= 5 && retAge - age > 0
}

function isOverRetirementAge(birthDate: string, year: number): boolean {
  const age = calculateAge(birthDate, year)
  const retAge = calculateRetirementAge(birthDate)
  return age >= retAge
}

export function calculateBefordringsFradrag(
  input: TaxInput,
  rates: TaxRates,
  municipality: MunicipalityData,
  totalIncome: number,
): { befordringsFradrag: number; forhoejetBefordringsFradrag: number } {
  const km = input.commuteDistanceKm
  const days = input.workDaysPerYear

  if (km <= 24 || days <= 0) {
    return { befordringsFradrag: 0, forhoejetBefordringsFradrag: 0 }
  }

  const isRural = municipality.isRural
  const rate25to120 = isRural ? rates.commuteRate25to120Rural : rates.commuteRate25to120
  const rateOver120 = isRural ? rates.commuteRateOver120Rural : rates.commuteRateOver120

  const km25to120 = Math.min(km - 25, 120 - 25)
  const kmOver120 = Math.max(km - 120, 0)

  const baseFradrag = Math.floor(
    (km25to120 * rate25to120 + kmOver120 * rateOver120) * days,
  )

  // Extra deduction for low-income earners
  let forhoejetRate = 0
  if (totalIncome < rates.commuteExtraDeductionIncomeLimit) {
    forhoejetRate = rates.commuteExtraDeductionRate / 100
  } else if (totalIncome < rates.commuteExtraDeductionIncomeLimit + 50000) {
    const pct =
      rates.commuteExtraDeductionRate -
      Math.floor((totalIncome - rates.commuteExtraDeductionIncomeLimit) / 1000) * 0.5
    forhoejetRate = Math.max(pct, 0) / 100
  }

  const forhoejetBefordringsFradrag = Math.floor(
    Math.min(rates.commuteExtraDeductionMax, forhoejetRate * baseFradrag),
  )

  return { befordringsFradrag: baseFradrag, forhoejetBefordringsFradrag }
}

export function calculateItemizedDeductions(
  input: TaxInput,
  rates: TaxRates,
  personalIncomeResult: PersonalIncomeResult,
  municipality: MunicipalityData,
  capitalIncome: number,
): ItemizedDeductionsResult {
  const basis = personalIncomeResult.fradragBasis

  // Beskæftigelsesfradrag
  const beskaeftigelsesFradrag = Math.floor(
    Math.min(rates.beskaeftigelsesFradragRate * basis, rates.beskaeftigelsesFradragMax),
  )

  // Ekstra beskæftigelsesfradrag for enlige forsørgere
  const ekstraBeskaeftigelseForsorgere = input.singleParent
    ? Math.floor(
        Math.min(
          rates.ekstraBeskaeftigelseForsorgereRate * basis,
          rates.ekstraBeskaeftigelseForsorgereMax,
        ),
      )
    : 0

  // Ekstra beskæftigelsesfradrag for seniorer
  const ekstraBeskaeftigelseSenior =
    isSenior(input.birthDate, input.year)
      ? Math.floor(
          Math.min(
            rates.ekstraBeskaeftigelseSeniorRate * basis,
            rates.ekstraBeskaeftigelseSeniorMax,
          ),
        )
      : 0

  // Jobfradrag
  const jobFradragBasis = Math.max(0, basis - rates.jobFradragThreshold)
  const jobFradrag = Math.floor(
    Math.min(rates.jobFradragRate * jobFradragBasis, rates.jobFradragMax),
  )

  // Ekstra pensionsfradrag
  const pensionFradragRate = isNearRetirement(input.birthDate, input.year)
    ? rates.ekstraPensionsFradragRateNear
    : rates.ekstraPensionsFradragRate
  const ekstraPensionsFradrag = Math.floor(
    Math.min(
      pensionFradragRate * Math.min(personalIncomeResult.ekstraPensionBasis, rates.ekstraPensionsFradragMax),
      rates.ekstraPensionsFradragMax,
    ),
  )

  // Befordringsfradrag
  const totalIncome =
    input.workIncome +
    input.honorarIncome +
    input.otherAmIncome +
    input.transferIncome +
    input.suIncome +
    input.otherTransferIncome +
    input.otherNonAmIncome
  const { befordringsFradrag, forhoejetBefordringsFradrag } =
    calculateBefordringsFradrag(input, rates, municipality, totalIncome)

  // Capped deductions
  const unionFeesDeduction = Math.min(input.unionFees, rates.unionFeesMax)
  const aKasseDeduction = input.aKasse
  const charitableDonationsDeduction = Math.min(
    input.charitableDonations,
    rates.charitableDonationsMax,
  )
  const greenRenovationDeduction = Math.min(
    input.greenRenovation,
    rates.greenRenovationMax,
  )
  const serviceDeductionAmount = Math.min(
    input.serviceDeduction,
    rates.serviceDeductionMax,
  )
  const doubleHouseholdDeduction = Math.min(
    input.doubleHousehold,
    rates.doubleHouseholdMax,
  )
  const alimonyDeduction = input.alimony
  const researchDonationsDeduction = input.researchDonations

  // Other employee expenses (above threshold)
  const otherEmployeeExpensesDeduction = Math.max(
    0,
    input.otherEmployeeExpenses - rates.otherEmployeeExpensesThreshold,
  )

  const otherDeductionsAmount = input.otherDeductions

  // Capital income deduction (negative capital income reduces taxable income)
  const capitalIncomeDeduction = capitalIncome < 0 ? capitalIncome : 0

  // Total ligningsmæssige fradrag (all positive values that reduce taxable income)
  // Note: capitalIncomeDeduction is NOT included here — capital income is handled
  // separately in the taxable income calculation
  const totalItemizedDeductions =
    beskaeftigelsesFradrag +
    ekstraBeskaeftigelseForsorgere +
    ekstraBeskaeftigelseSenior +
    jobFradrag +
    ekstraPensionsFradrag +
    befordringsFradrag +
    forhoejetBefordringsFradrag +
    unionFeesDeduction +
    aKasseDeduction +
    charitableDonationsDeduction +
    greenRenovationDeduction +
    serviceDeductionAmount +
    alimonyDeduction +
    doubleHouseholdDeduction +
    researchDonationsDeduction +
    otherEmployeeExpensesDeduction +
    otherDeductionsAmount

  return {
    beskaeftigelsesFradrag,
    ekstraBeskaeftigelseForsorgere,
    ekstraBeskaeftigelseSenior,
    jobFradrag,
    ekstraPensionsFradrag,
    befordringsFradrag,
    forhoejetBefordringsFradrag,
    unionFeesDeduction,
    aKasseDeduction,
    charitableDonationsDeduction,
    greenRenovationDeduction,
    serviceDeductionAmount,
    alimonyDeduction,
    doubleHouseholdDeduction,
    researchDonationsDeduction,
    otherEmployeeExpensesDeduction,
    otherDeductionsAmount,
    capitalIncomeDeduction,
    totalItemizedDeductions,
  }
}
