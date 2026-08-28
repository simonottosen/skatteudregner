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
  /**
   * The date on which a længstlevende ægtefælle entered a new marriage, as
   * `YYYY-MM-DD`.
   *
   * Ejendomsskatteloven § 25, stk. 3, 3. pkt. ends the right to succeed to the
   * pensionistnedslag "med virkning fra og med det indkomstår, hvori ægteskabet
   * indgås", so the rule turns on the year rather than on the bare fact — a
   * remarriage in 2026 must leave 2024 and 2025 alone. Absent for everyone who
   * has not remarried, which is what an old saved row means too.
   */
  remarriageDate?: string
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

/**
 * The scalar `TaxInput` fields. The two property sub-objects are excluded
 * because they are merged field-by-field through their own setters rather than
 * assigned whole.
 */
export type TaxInputField = Exclude<keyof TaxInput, "property" | "summerHouse">

/** Setter for one scalar field, shared by the form and every section. */
export type SetTaxField = <K extends TaxInputField>(
  field: K,
  value: TaxInput[K],
) => void

export interface PropertyInput {
  propertyValue: number
  assessmentBasis: number
  landValue: number
  landAssessmentBasis: number
  purchasedBefore19980701: boolean
  isCondo: boolean
  ownershipShare: number
  personalTaxDiscount: number
  /**
   * The taxpayer is a længstlevende ægtefælle who keeps rådigheden over this
   * dwelling after the other spouse's death or move to a plejehjem, the dwelling
   * belonged to that spouse, and the two were not separated at the time.
   *
   * Both § 23, stk. 3 and § 25, stk. 3 hang succession on the dwelling rather
   * than on the person, so a survivor who succeeded to one and bought another
   * themselves is covered only on the first. The two differ in reach — § 25,
   * stk. 3 says "en ejendom, som har tilhørt *en af* ægtefællerne" where § 23,
   * stk. 3 needs "den anden ægtefælle" — and this flag is drawn to the narrower
   * of the two so that one answer can safely serve both.
   *
   * Optional: absent reads as false, which is what every saved row predating the
   * field means. The same holds for `spouseAcquiredBefore19980701`.
   */
  retainedFromSpouse?: boolean
  /**
   * The spouse this dwelling was retained from acquired it no later than
   * 1 July 1998. Only meaningful together with `retainedFromSpouse`: §§ 23-24
   * succession runs on *their* acquisition, so a survivor who owned nothing on
   * that date still inherits the nedslag.
   */
  spouseAcquiredBefore19980701?: boolean
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
