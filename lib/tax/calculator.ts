import type { TaxInput, TaxResult } from "./types"
import { getRates } from "./rates"
import { getMunicipality } from "./municipalities"
import { calculateAmBidrag } from "./calculations/am-bidrag"
import { calculatePersonalIncome } from "./calculations/personal-income"
import { calculateCapitalIncome } from "./calculations/capital-income"
import {
  calculateItemizedDeductions,
  calculateAge,
  calculateRetirementAge,
} from "./calculations/itemized-deductions"
import { calculateTaxableIncome } from "./calculations/taxable-income"
import { calculateIncomeTax } from "./calculations/income-tax"
import { calculateStockTax } from "./calculations/stock-tax"
import { calculatePropertyTax } from "./calculations/property-tax"

export function calculateTax(input: TaxInput): TaxResult {
  const rates = getRates(input.year)
  const municipality = getMunicipality(input.municipality, input.year)
  if (!municipality) {
    throw new Error(`Unknown municipality: ${input.municipality}`)
  }

  // Step 1: AM-bidrag
  const amResult = calculateAmBidrag(input, rates)

  // Step 2: Personal income
  const piResult = calculatePersonalIncome(input, rates, amResult)

  // Step 3: Capital income
  const capitalResult = calculateCapitalIncome(input)

  // Step 4: Itemized deductions
  const deductionsResult = calculateItemizedDeductions(
    input,
    rates,
    piResult,
    municipality,
    capitalResult.totalCapitalIncome,
  )

  // Step 5: Taxable income
  // Uses total capital income (can be negative) and positive deductions
  const { taxableIncome } = calculateTaxableIncome(
    piResult.personalIncome,
    capitalResult.totalCapitalIncome,
    deductionsResult.totalItemizedDeductions,
  )

  // Step 6: Income tax
  const incomeTaxResult = calculateIncomeTax(
    rates,
    municipality,
    input.churchMember,
    amResult.amBidrag + amResult.amBidragInsurance,
    piResult.personalIncome,
    capitalResult.positiveCapitalIncome,
    taxableIncome,
    input.married,
    input.spousePersonalIncome,
  )

  // Step 7: Stock tax
  const stockResult = calculateStockTax(input, rates)

  // Step 8: Property tax
  const summerMunicipality = input.summerHouse?.municipality
    ? getMunicipality(input.summerHouse.municipality, input.year)
    : undefined
  const propertyResult = calculatePropertyTax(
    input,
    rates,
    municipality,
    summerMunicipality,
  )

  // Credits
  const foreignDividendCredit = Math.min(
    input.foreignDividendTaxPaid,
    stockResult.totalStockTax,
  )

  // Ekstra rentefradrag for negative capital income
  let ekstraRentefradrag = 0
  if (capitalResult.totalCapitalIncome < 0) {
    const foreignInterestAbs = Math.abs(input.foreignInterestNet)
    ekstraRentefradrag = Math.max(
      capitalResult.totalCapitalIncome * rates.ekstraRentefradragRate +
        foreignInterestAbs * rates.ekstraRentefradragRate,
      -rates.ekstraRentefradragThreshold * rates.ekstraRentefradragRate +
        foreignInterestAbs * rates.ekstraRentefradragRate,
    )
    ekstraRentefradrag = Math.min(0, ekstraRentefradrag)
  }

  // Grøn check (only for pensioners or parents)
  const age = calculateAge(input.birthDate, input.year)
  const retAge = calculateRetirementAge(input.birthDate)
  const isOverRetirement = age >= retAge
  const totalIncomeForGrøn =
    piResult.personalIncome + capitalResult.positiveCapitalIncome

  let groenCheckPensioner = 0
  let groenCheckTillaeg = 0
  let groenCheckForsorger = 0

  if (isOverRetirement) {
    groenCheckPensioner = Math.max(
      0,
      Math.min(
        rates.groenCheckPensioner,
        rates.groenCheckPensioner -
          (totalIncomeForGrøn - rates.groenCheckIncomeLimit) *
            rates.groenCheckReductionRate,
      ),
    )
    groenCheckTillaeg = Math.max(
      0,
      Math.min(
        rates.groenCheckPensionerTillaeg,
        rates.groenCheckPensionerTillaeg -
          (totalIncomeForGrøn - rates.groenCheckTillaegIncomeLimit) *
            rates.groenCheckReductionRate,
      ),
    )
  }

  if (input.singleParent && input.childrenUnder18 > 0) {
    const childCount = Math.min(input.childrenUnder18, 2)
    groenCheckForsorger = Math.max(
      0,
      Math.min(
        rates.groenCheckChildAmount * childCount,
        rates.groenCheckChildAmount * childCount -
          (totalIncomeForGrøn - rates.groenCheckIncomeLimit) *
            rates.groenCheckReductionRate,
      ),
    )
  }

  // Total tax
  const totalTax = Math.max(
    0,
    incomeTaxResult.totalIncomeTax +
      stockResult.totalStockTax +
      propertyResult.totalPropertyTax -
      foreignDividendCredit -
      input.danishDividendTaxWithheld +
      ekstraRentefradrag -
      groenCheckPensioner -
      groenCheckTillaeg -
      groenCheckForsorger,
  )

  const grossIncome =
    amResult.amBasis + amResult.insuranceBasis + piResult.nonAmIncome
  const effectiveTaxRate = grossIncome > 0 ? totalTax / grossIncome : 0
  const netIncome = grossIncome - totalTax

  return {
    // Income basis
    amBasis: amResult.amBasis,
    insuranceBasis: amResult.insuranceBasis,
    totalAmBasis: amResult.totalAmBasis,
    pensionBasis: piResult.pensionBasis,
    ekstraPensionBasis: piResult.ekstraPensionBasis,
    fradragBasis: piResult.fradragBasis,
    nonAmIncome: piResult.nonAmIncome,

    // Personal income
    amBidrag: amResult.amBidrag,
    amBidragInsurance: amResult.amBidragInsurance,
    pensionLivrenteDeduction: piResult.pensionLivrenteDeduction,
    pensionRatepensionDeduction: piResult.pensionRatepensionDeduction,
    personalIncomeDeductions: piResult.personalIncomeDeductions,
    personalIncome: piResult.personalIncome,

    // Capital income
    netCapitalIncome: capitalResult.netCapitalIncome,
    netFinancialContracts: capitalResult.netFinancialContracts,
    totalCapitalIncome: capitalResult.totalCapitalIncome,
    positiveCapitalIncome: capitalResult.positiveCapitalIncome,

    // Itemized deductions
    ...deductionsResult,
    taxableIncome,

    // Income tax
    amBidragTotal: incomeTaxResult.amBidragTotal,
    bundSkat: incomeTaxResult.bundSkat,
    mellemSkat: incomeTaxResult.mellemSkat,
    mellemSkatCapital: incomeTaxResult.mellemSkatCapital,
    topSkat: incomeTaxResult.topSkat,
    topTopSkat: incomeTaxResult.topTopSkat,
    personFradragStatCredit: incomeTaxResult.personFradragStatCredit,
    kommuneSkat: incomeTaxResult.kommuneSkat,
    kirkeSkat: incomeTaxResult.kirkeSkat,
    personFradragKommuneCredit: incomeTaxResult.personFradragKommuneCredit,
    totalIncomeTax: incomeTaxResult.totalIncomeTax,
    marginalTaxRate: incomeTaxResult.marginalTaxRate,
    netIncomeAfterIncomeTax: grossIncome - incomeTaxResult.totalIncomeTax,

    // Stock
    stockIncome: stockResult.stockIncome,
    stockTaxLow: stockResult.stockTaxLow,
    stockTaxHigh: stockResult.stockTaxHigh,
    totalStockTax: stockResult.totalStockTax,

    // Property
    ...propertyResult,

    // Credits
    foreignDividendCredit,
    ekstraRentefradrag,
    groenCheckPensioner,
    groenCheckTillaeg,
    groenCheckForsorger,

    // Final
    totalTax,
    effectiveTaxRate,
    netIncome,
  }
}
