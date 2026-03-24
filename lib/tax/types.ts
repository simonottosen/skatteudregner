export type TaxYear = 2024 | 2025 | 2026

export interface TaxInput {
  year: TaxYear
  municipality: string
  churchMember: boolean
  birthDate: string
  married: boolean
  spousePersonalIncome?: number
  spouseStockIncome?: number
  spouseOverRetirementAge?: boolean
  singleParent: boolean
  childrenUnder18: number
  commuteDistanceKm: number
  workDaysPerYear: number

  // Income with AM-bidrag
  workIncome: number
  honorarIncome: number
  otherAmIncome: number

  // Income without AM-bidrag
  transferIncome: number
  suIncome: number
  otherTransferIncome: number
  otherNonAmIncome: number

  // Pension
  employeePension: number
  employerPension: number
  atpEmployee: number
  atpNonEmployee: number
  obligatoryPension: number
  privatePensionLivrente: number
  privatePensionRatepension: number

  // Insurance
  insuranceCostsFromSkat: number
  otherInsuranceCosts: number

  // Personal income deductions
  personalIncomeDeductions: number

  // Itemized deductions
  unionFees: number
  aKasse: number
  doubleHousehold: number
  charitableDonations: number
  alimony: number
  otherEmployeeExpenses: number
  greenRenovation: number
  serviceDeduction: number
  researchDonations: number
  otherDeductions: number

  // Capital income
  bondGains: number
  listedBondGains: number
  investmentDividends: number
  rentalIncome: number
  investmentShareGains: number
  unlistedBondGains: number
  interestIncome: number
  mortgageInterest: number
  bankInterest: number
  studentLoanInterest: number
  otherDebtInterest: number
  publicDebtInterest: number
  foreignInterestNet: number
  otherCapitalIncome: number

  // Financial contracts
  financialContractIncome: number
  financialContractPriorLoss: number

  // Stock income
  stockSaleGains: number
  danishDividends: number
  foreignDividends: number
  stockDeductions: number
  negativeStockIncomePriorYears: number
  foreignDividendTaxPaid: number
  danishDividendTaxWithheld: number

  // Property
  property?: PropertyInput
  summerHouse?: SummerHouseInput
}

export interface PropertyInput {
  propertyValue: number
  assessmentBasis: number
  landValue: number
  landAssessmentBasis: number
  purchasedBefore19980701: boolean
  isCondo: boolean
  ownershipShare: number
  personalTaxDiscount: number
}

export interface SummerHouseInput extends PropertyInput {
  municipality: string
}

export interface TaxRates {
  year: TaxYear
  amBidragRate: number
  bundSkatRate: number
  mellemSkatRate: number
  mellemSkatThreshold: number
  topSkatRate: number
  topSkatThreshold: number
  topTopSkatRate: number
  topTopSkatThreshold: number
  skatteLoft: number
  capitalSkatteLoft: number
  personFradrag: number

  // Beskæftigelsesfradrag
  beskaeftigelsesFradragRate: number
  beskaeftigelsesFradragMax: number

  // Ekstra beskæftigelsesfradrag enlige forsørgere
  ekstraBeskaeftigelseForsorgereRate: number
  ekstraBeskaeftigelseForsorgereMax: number

  // Ekstra beskæftigelsesfradrag seniorer
  ekstraBeskaeftigelseSeniorRate: number
  ekstraBeskaeftigelseSeniorMax: number

  // Jobfradrag
  jobFradragRate: number
  jobFradragMax: number
  jobFradragThreshold: number

  // Ekstra pensionsfradrag
  ekstraPensionsFradragRate: number
  ekstraPensionsFradragRateNear: number
  ekstraPensionsFradragMax: number

  // Deduction caps
  unionFeesMax: number
  doubleHouseholdMax: number
  charitableDonationsMax: number
  otherEmployeeExpensesThreshold: number
  greenRenovationMax: number
  serviceDeductionMax: number
  ratepensionMax: number

  // Capital income
  mellemSkatCapitalRate: number
  capitalKapitalindkomstThreshold: number

  // Stock tax
  stockTaxLowRate: number
  stockTaxHighRate: number
  stockProgressionLimit: number

  // Ejendomsværdiskat
  ejendomsvaerdiSkatLowRate: number
  ejendomsvaerdiSkatHighRate: number
  ejendomsvaerdiSkatThreshold: number
  ejendomsvaerdiSkatPre1998Rate: number
  ejendomsvaerdiSkatPre1998MaxReduction: number
  ejendomsvaerdiSkatPensionerReduction: number
  ejendomsvaerdiSkatPensionerReductionSummer: number
  ejendomsvaerdiSkatPensionerIncomeRate: number
  ejendomsvaerdiSkatPensionerIncomeThresholdSingle: number
  ejendomsvaerdiSkatPensionerIncomeThresholdMarried: number

  // Befordringsfradrag
  commuteRate25to120: number
  commuteRateOver120: number
  commuteRate25to120Rural: number
  commuteRateOver120Rural: number
  commuteExtraDeductionRate: number
  commuteExtraDeductionMax: number
  commuteExtraDeductionIncomeLimit: number

  // Ekstra rentefradrag
  ekstraRentefradragThreshold: number
  ekstraRentefradragRate: number

  // Grøn check
  groenCheckPensioner: number
  groenCheckPensionerTillaeg: number
  groenCheckChildAmount: number
  groenCheckIncomeLimit: number
  groenCheckTillaegIncomeLimit: number
  groenCheckReductionRate: number
}

export interface MunicipalityData {
  name: string
  region: string
  code: number
  taxRate: number
  churchTaxRate: number
  nedslag: number
  grundskyldRate: number
  isRural: boolean
}

export interface TaxResult {
  // Income basis
  amBasis: number
  insuranceBasis: number
  totalAmBasis: number
  pensionBasis: number
  ekstraPensionBasis: number
  fradragBasis: number
  nonAmIncome: number

  // Personal income deductions
  amBidrag: number
  amBidragInsurance: number
  pensionLivrenteDeduction: number
  pensionRatepensionDeduction: number
  personalIncomeDeductions: number
  personalIncome: number

  // Capital income
  netCapitalIncome: number
  netFinancialContracts: number
  totalCapitalIncome: number
  positiveCapitalIncome: number

  // Itemized deductions
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
  taxableIncome: number

  // Tax
  amBidragTotal: number
  bundSkat: number
  mellemSkat: number
  mellemSkatCapital: number
  topSkat: number
  topTopSkat: number
  personFradragStatCredit: number
  kommuneSkat: number
  kirkeSkat: number
  personFradragKommuneCredit: number
  totalIncomeTax: number
  marginalTaxRate: number
  netIncomeAfterIncomeTax: number

  // Stock
  stockIncome: number
  stockTaxLow: number
  stockTaxHigh: number
  totalStockTax: number

  // Property
  ejendomsvaerdiSkatPrimary: number
  ejendomsvaerdiSkatSummer: number
  totalEjendomsvaerdiSkat: number
  grundskyldPrimary: number
  grundskyldSummer: number
  personalTaxDiscount: number
  totalPropertyTax: number

  // Credits and adjustments
  foreignDividendCredit: number
  ekstraRentefradrag: number
  groenCheckPensioner: number
  groenCheckTillaeg: number
  groenCheckForsorger: number

  // Final
  totalTax: number
  effectiveTaxRate: number
  netIncome: number
}
