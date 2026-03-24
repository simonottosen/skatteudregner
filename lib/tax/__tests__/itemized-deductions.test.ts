import { describe, it, expect } from "vitest"
import { calculateItemizedDeductions } from "@/lib/tax/calculations/itemized-deductions"
import { calculateAmBidrag } from "@/lib/tax/calculations/am-bidrag"
import { calculatePersonalIncome } from "@/lib/tax/calculations/personal-income"
import { getRates } from "@/lib/tax/rates"
import { getMunicipality } from "@/lib/tax/municipalities"
import { makeInput } from "./helpers"
import type { TaxInput, MunicipalityData } from "@/lib/tax/types"

const rates = getRates(2026)
const kbh = getMunicipality("København", 2026)!

function calcDeductions(
  overrides: Partial<TaxInput>,
  municipality: MunicipalityData = kbh,
  capitalIncome = 0,
) {
  const input = makeInput(overrides)
  const am = calculateAmBidrag(input, rates)
  const pi = calculatePersonalIncome(input, rates, am)
  return calculateItemizedDeductions(input, rates, pi, municipality, capitalIncome)
}

describe("Itemized deductions", () => {
  describe("Beskæftigelsesfradrag", () => {
    it("3.1 - basic calculation", () => {
      // fradragBasis = AM basis + employer pension + ratepension grossed up
      // workIncome=500k, fradragBasis = 500000 + 0 + 0 = 500000
      const result = calcDeductions({
        workIncome: 500000,
      })
      // 12.75% × 500000 = 63750 → capped at 63300
      expect(result.beskaeftigelsesFradrag).toBe(63300)
    })

    it("3.2 - hits cap with large pension basis", () => {
      const result = calcDeductions({
        workIncome: 1000000,
        employeePension: 300000,
        employerPension: 300000,
      })
      expect(result.beskaeftigelsesFradrag).toBe(63300)
    })

    it("3.3 - zero for non-workers", () => {
      const result = calcDeductions({ transferIncome: 200000 })
      expect(result.beskaeftigelsesFradrag).toBe(0)
    })
  })

  describe("Jobfradrag", () => {
    it("3.4 - above threshold", () => {
      const result = calcDeductions({
        workIncome: 500000,
        employeePension: 200000,
        employerPension: 200000,
      })
      // fradragBasis = (200000+200000)*0.92 = 368000
      // jobfradrag = min(0.045 * max(0, 368000-235200), 3100) = min(5976, 3100) = 3100
      expect(result.jobFradrag).toBe(3100)
    })

    it("3.5 - below threshold", () => {
      const result = calcDeductions({
        workIncome: 200000,
        employeePension: 50000,
      })
      // fradragBasis = 50000*0.92 = 46000, well below 235200
      expect(result.jobFradrag).toBe(0)
    })
  })

  describe("Ekstra pensionsfradrag", () => {
    it("3.6 - basic pension fradrag", () => {
      const result = calcDeductions({
        workIncome: 500000,
        privatePensionRatepension: 50000,
      })
      // ekstraPensionBasis = 0 + 50000 = 50000
      // rate = 0.12 (more than 15 years to retirement for birth 1980)
      // fradrag = min(0.12 * min(50000, 87800), 87800) = 6000
      expect(result.ekstraPensionsFradrag).toBe(6000)
    })
  })

  describe("Capped deductions", () => {
    it("3.7 - union fees capped at 7000", () => {
      const result = calcDeductions({ workIncome: 500000, unionFees: 10000 })
      expect(result.unionFeesDeduction).toBe(7000)
    })

    it("3.7b - union fees below cap", () => {
      const result = calcDeductions({ workIncome: 500000, unionFees: 3000 })
      expect(result.unionFeesDeduction).toBe(3000)
    })

    it("3.8 - charitable donations capped at 20000", () => {
      const result = calcDeductions({
        workIncome: 500000,
        charitableDonations: 30000,
      })
      expect(result.charitableDonationsDeduction).toBe(20000)
    })

    it("3.9 - service deduction capped at 18300", () => {
      const result = calcDeductions({
        workIncome: 500000,
        serviceDeduction: 25000,
      })
      expect(result.serviceDeductionAmount).toBe(18300)
    })

    it("3.10 - green renovation capped at 9000", () => {
      const result = calcDeductions({
        workIncome: 500000,
        greenRenovation: 12000,
      })
      expect(result.greenRenovationDeduction).toBe(9000)
    })

    it("3.11 - other employee expenses with threshold 7600", () => {
      const result = calcDeductions({
        workIncome: 500000,
        otherEmployeeExpenses: 10000,
      })
      expect(result.otherEmployeeExpensesDeduction).toBe(2400)
    })

    it("3.11b - below threshold gives 0", () => {
      const result = calcDeductions({
        workIncome: 500000,
        otherEmployeeExpenses: 5000,
      })
      expect(result.otherEmployeeExpensesDeduction).toBe(0)
    })

    it("double household capped at 34400", () => {
      const result = calcDeductions({
        workIncome: 500000,
        doubleHousehold: 40000,
      })
      expect(result.doubleHouseholdDeduction).toBe(34400)
    })
  })

  describe("Befordringsfradrag", () => {
    it("3.12 - 30km, 220 days, non-rural", () => {
      const result = calcDeductions({
        workIncome: 500000,
        commuteDistanceKm: 30,
        workDaysPerYear: 220,
      })
      // km25to120 = min(30-25, 95) = 5
      // fradrag = -(5 * 2.23 * 220) = -2453
      expect(result.befordringsFradrag).toBe(2453)
    })

    it("3.13 - 150km, 220 days", () => {
      const result = calcDeductions({
        workIncome: 500000,
        commuteDistanceKm: 150,
        workDaysPerYear: 220,
      })
      // km25to120 = 95, kmOver120 = 30
      // fradrag = -(95 * 2.23 + 30 * 1.12) * 220 = -(211.85 + 33.6) * 220 = -53999
      expect(result.befordringsFradrag).toBe(Math.floor((95 * 2.23 + 30 * 1.12) * 220))
    })

    it("3.14 - rural commune bonus", () => {
      const langeland = getMunicipality("Langeland", 2026)!
      expect(langeland.isRural).toBe(true)
      const result = calcDeductions(
        { workIncome: 500000, commuteDistanceKm: 30, workDaysPerYear: 220 },
        langeland,
      )
      // Rural rate = 2.47 instead of 2.23
      expect(result.befordringsFradrag).toBe(Math.floor((5 * 2.47) * 220))
    })

    it("zero distance gives zero", () => {
      const result = calcDeductions({
        workIncome: 500000,
        commuteDistanceKm: 0,
        workDaysPerYear: 220,
      })
      expect(result.befordringsFradrag).toBe(0)
    })

    it("under 25km gives zero", () => {
      const result = calcDeductions({
        workIncome: 500000,
        commuteDistanceKm: 20,
        workDaysPerYear: 220,
      })
      expect(result.befordringsFradrag).toBe(0)
    })
  })

  describe("Ekstra beskæftigelsesfradrag", () => {
    it("3.15 - single parent gets extra deduction", () => {
      const result = calcDeductions({
        workIncome: 500000,
        singleParent: true,
        employeePension: 100000,
      })
      expect(result.ekstraBeskaeftigelseForsorgere).toBeGreaterThan(0)
    })

    it("non-single-parent gets zero", () => {
      const result = calcDeductions({
        workIncome: 500000,
        singleParent: false,
        employeePension: 100000,
      })
      expect(result.ekstraBeskaeftigelseForsorgere).toBe(0)
    })
  })

  describe("Capital income deduction", () => {
    it("negative capital income creates deduction", () => {
      const result = calcDeductions({ workIncome: 500000 }, kbh, -30000)
      expect(result.capitalIncomeDeduction).toBe(-30000)
    })

    it("positive capital income creates no deduction", () => {
      const result = calcDeductions({ workIncome: 500000 }, kbh, 20000)
      expect(result.capitalIncomeDeduction).toBe(0)
    })
  })
})
