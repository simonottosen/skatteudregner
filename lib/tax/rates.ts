import type { TaxRates, TaxYear } from "./types"

const RATES_2024: TaxRates = {
  year: 2024,
  amBidragRate: 0.08,
  bundSkatRate: 0.1201,
  mellemSkatRate: 0.15,
  mellemSkatThreshold: 588900,
  topSkatRate: 0,
  topSkatThreshold: Infinity,
  topTopSkatRate: 0,
  topTopSkatThreshold: Infinity,
  skatteLoft: 0.5207,
  capitalSkatteLoft: 0.42,
  personFradrag: 49700,

  beskaeftigelsesFradragRate: 0.1065,
  beskaeftigelsesFradragMax: 45100,
  ekstraBeskaeftigelseForsorgereRate: 0.0625,
  ekstraBeskaeftigelseForsorgereMax: 25300,
  ekstraBeskaeftigelseSeniorRate: 0,
  ekstraBeskaeftigelseSeniorMax: 0,

  jobFradragRate: 0.045,
  jobFradragMax: 2800,
  jobFradragThreshold: 216100,

  ekstraPensionsFradragRate: 0.12,
  ekstraPensionsFradragRateNear: 0.32,
  ekstraPensionsFradragMax: 80600,

  unionFeesMax: 7000,
  doubleHouseholdMax: 31600,
  charitableDonationsMax: 18300,
  otherEmployeeExpensesThreshold: 7000,
  greenRenovationMax: 0,
  serviceDeductionMax: 11900,
  ratepensionMax: 63100,

  mellemSkatCapitalRate: 0.0459,
  capitalKapitalindkomstThreshold: 50500,

  stockTaxLowRate: 0.27,
  stockTaxHighRate: 0.42,
  stockProgressionLimit: 61000,

  ejendomsvaerdiSkatLowRate: 0.0051,
  ejendomsvaerdiSkatHighRate: 0.014,
  ejendomsvaerdiSkatThreshold: 9200000,
  ejendomsvaerdiSkatPre1998Rate: 0.00204,
  ejendomsvaerdiSkatPre1998MaxReduction: 1200,
  ejendomsvaerdiSkatPensionerReduction: 6000,
  ejendomsvaerdiSkatPensionerReductionSummer: 2000,
  ejendomsvaerdiSkatPensionerIncomeRate: 0.05,
  ejendomsvaerdiSkatPensionerIncomeThresholdSingle: 220200,
  ejendomsvaerdiSkatPensionerIncomeThresholdMarried: 338800,

  commuteRate25to120: 2.23,
  commuteRateOver120: 1.12,
  commuteRate25to120Rural: 2.47,
  commuteRateOver120Rural: 2.47,
  commuteExtraDeductionRate: 0.64,
  commuteExtraDeductionMax: 15400,
  commuteExtraDeductionIncomeLimit: 313700,

  ekstraRentefradragThreshold: 50000,
  ekstraRentefradragRate: 0.08,

  groenCheckPensioner: 875,
  groenCheckPensionerTillaeg: 280,
  groenCheckChildAmount: 240,
  groenCheckIncomeLimit: 457500,
  groenCheckTillaegIncomeLimit: 267400,
  groenCheckReductionRate: 0.075,
}

const RATES_2025: TaxRates = {
  year: 2025,
  amBidragRate: 0.08,
  bundSkatRate: 0.1201,
  mellemSkatRate: 0.15,
  mellemSkatThreshold: 611800,
  topSkatRate: 0,
  topSkatThreshold: Infinity,
  topTopSkatRate: 0,
  topTopSkatThreshold: Infinity,
  skatteLoft: 0.5207,
  capitalSkatteLoft: 0.42,
  personFradrag: 51600,

  beskaeftigelsesFradragRate: 0.123,
  beskaeftigelsesFradragMax: 55600,
  ekstraBeskaeftigelseForsorgereRate: 0.115,
  ekstraBeskaeftigelseForsorgereMax: 48300,
  ekstraBeskaeftigelseSeniorRate: 0,
  ekstraBeskaeftigelseSeniorMax: 0,

  jobFradragRate: 0.045,
  jobFradragMax: 2900,
  jobFradragThreshold: 224500,

  ekstraPensionsFradragRate: 0.12,
  ekstraPensionsFradragRateNear: 0.32,
  ekstraPensionsFradragMax: 83800,

  unionFeesMax: 7000,
  doubleHouseholdMax: 32800,
  charitableDonationsMax: 19000,
  otherEmployeeExpensesThreshold: 7300,
  greenRenovationMax: 8600,
  serviceDeductionMax: 17500,
  ratepensionMax: 65500,

  mellemSkatCapitalRate: 0.0459,
  capitalKapitalindkomstThreshold: 52400,

  stockTaxLowRate: 0.27,
  stockTaxHighRate: 0.42,
  stockProgressionLimit: 67500,

  ejendomsvaerdiSkatLowRate: 0.0051,
  ejendomsvaerdiSkatHighRate: 0.014,
  ejendomsvaerdiSkatThreshold: 9200000,
  ejendomsvaerdiSkatPre1998Rate: 0.00204,
  ejendomsvaerdiSkatPre1998MaxReduction: 1200,
  ejendomsvaerdiSkatPensionerReduction: 6000,
  ejendomsvaerdiSkatPensionerReductionSummer: 2000,
  ejendomsvaerdiSkatPensionerIncomeRate: 0.05,
  ejendomsvaerdiSkatPensionerIncomeThresholdSingle: 228800,
  ejendomsvaerdiSkatPensionerIncomeThresholdMarried: 351900,

  commuteRate25to120: 2.23,
  commuteRateOver120: 1.12,
  commuteRate25to120Rural: 2.47,
  commuteRateOver120Rural: 2.47,
  commuteExtraDeductionRate: 0.64,
  commuteExtraDeductionMax: 15400,
  commuteExtraDeductionIncomeLimit: 325800,

  ekstraRentefradragThreshold: 50000,
  ekstraRentefradragRate: 0.08,

  groenCheckPensioner: 875,
  groenCheckPensionerTillaeg: 280,
  groenCheckChildAmount: 240,
  groenCheckIncomeLimit: 475300,
  groenCheckTillaegIncomeLimit: 277800,
  groenCheckReductionRate: 0.075,
}

const RATES_2026: TaxRates = {
  year: 2026,
  amBidragRate: 0.08,
  bundSkatRate: 0.1201,
  mellemSkatRate: 0.075,
  mellemSkatThreshold: 641200,
  topSkatRate: 0.075,
  topSkatThreshold: 777900,
  topTopSkatRate: 0.05,
  topTopSkatThreshold: 2592700,
  skatteLoft: 0.4457,
  capitalSkatteLoft: 0.42,
  personFradrag: 54100,

  beskaeftigelsesFradragRate: 0.1275,
  beskaeftigelsesFradragMax: 63300,
  ekstraBeskaeftigelseForsorgereRate: 0.115,
  ekstraBeskaeftigelseForsorgereMax: 50600,
  ekstraBeskaeftigelseSeniorRate: 0.014,
  ekstraBeskaeftigelseSeniorMax: 6100,

  jobFradragRate: 0.045,
  jobFradragMax: 3100,
  jobFradragThreshold: 235200,

  ekstraPensionsFradragRate: 0.12,
  ekstraPensionsFradragRateNear: 0.32,
  ekstraPensionsFradragMax: 87800,

  unionFeesMax: 7000,
  doubleHouseholdMax: 34400,
  charitableDonationsMax: 20000,
  otherEmployeeExpensesThreshold: 7600,
  greenRenovationMax: 9000,
  serviceDeductionMax: 18300,
  ratepensionMax: 68700,

  mellemSkatCapitalRate: 0.0459,
  capitalKapitalindkomstThreshold: 55000,

  stockTaxLowRate: 0.27,
  stockTaxHighRate: 0.42,
  stockProgressionLimit: 79400,

  ejendomsvaerdiSkatLowRate: 0.0051,
  ejendomsvaerdiSkatHighRate: 0.014,
  ejendomsvaerdiSkatThreshold: 9007000,
  ejendomsvaerdiSkatPre1998Rate: 0.00204,
  ejendomsvaerdiSkatPre1998MaxReduction: 1201,
  ejendomsvaerdiSkatPensionerReduction: 6000,
  ejendomsvaerdiSkatPensionerReductionSummer: 2000,
  ejendomsvaerdiSkatPensionerIncomeRate: 0.05,
  ejendomsvaerdiSkatPensionerIncomeThresholdSingle: 239800,
  ejendomsvaerdiSkatPensionerIncomeThresholdMarried: 368800,

  commuteRate25to120: 2.23,
  commuteRateOver120: 1.12,
  commuteRate25to120Rural: 2.47,
  commuteRateOver120Rural: 2.47,
  commuteExtraDeductionRate: 0.64,
  commuteExtraDeductionMax: 15400,
  commuteExtraDeductionIncomeLimit: 341500,

  ekstraRentefradragThreshold: 50000,
  ekstraRentefradragRate: 0.08,

  groenCheckPensioner: 875,
  groenCheckPensionerTillaeg: 280,
  groenCheckChildAmount: 240,
  groenCheckIncomeLimit: 498200,
  groenCheckTillaegIncomeLimit: 291100,
  groenCheckReductionRate: 0.075,
}

export const TAX_RATES: Record<TaxYear, TaxRates> = {
  2024: RATES_2024,
  2025: RATES_2025,
  2026: RATES_2026,
}

export function getRates(year: TaxYear): TaxRates {
  const rates = TAX_RATES[year]
  if (!rates) {
    throw new Error(`Unsupported tax year: ${year}`)
  }
  return rates
}
