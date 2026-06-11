import { describe, it, expect } from "vitest"
import { calculateAmBidrag } from "@/lib/tax/calculations/am-bidrag"
import { calculatePersonalIncome } from "@/lib/tax/calculations/personal-income"
import { getRates } from "@/lib/tax/rates"
import { makeInput } from "./helpers"

const rates = getRates(2026)

function calcPI(overrides: Parameters<typeof makeInput>[0]) {
  const input = makeInput(overrides)
  const am = calculateAmBidrag(input, rates)
  return calculatePersonalIncome(input, rates, am)
}

describe("Personal income", () => {
  it("2.5 - simple salary after AM", () => {
    const result = calcPI({ workIncome: 500000 })
    expect(result.personalIncome).toBe(460000)
  })

  it("2.6 - ratepension does NOT reduce personal income", () => {
    // Ratepension is already deducted from salary before reporting,
    // so it should not reduce personal income again
    const result = calcPI({ workIncome: 500000, privatePensionRatepension: 20000 })
    expect(result.personalIncome).toBe(460000) // same as without ratepension
    expect(result.pensionRatepensionDeduction).toBe(20000)
  })

  it("2.7 - ratepension capped at 68700 (2026)", () => {
    const result = calcPI({ workIncome: 500000, privatePensionRatepension: 200000 })
    expect(result.pensionRatepensionDeduction).toBe(68700)
    // Personal income still not reduced by ratepension
    expect(result.personalIncome).toBe(460000)
  })

  it("employer pension is NOT added to personal income (bortseelse, paid on top of A-indkomst)", () => {
    const result = calcPI({ workIncome: 500000, employerPension: 5000 })
    // 500k - 40k AM, employer pension neither added nor subtracted = 460k
    expect(result.personalIncome).toBe(460000)
    // but it qualifies for ekstra pensionsfradrag
    expect(result.ekstraPensionBasis).toBe(5000)
  })

  it("employee pension reduces personal income (bortseelse) and feeds ekstra pensionsfradrag", () => {
    const result = calcPI({ workIncome: 500000, employeePension: 50000 })
    // A-indkomst (500k) does not net out pension, so the employee's own
    // contribution is subtracted: 500k - 40k AM - 50k pension = 410k
    expect(result.personalIncome).toBe(410000)
    expect(result.ekstraPensionBasis).toBe(50000)
  })

  it("2.8 - with transfer income (no AM)", () => {
    const result = calcPI({ workIncome: 400000, transferIncome: 100000 })
    // work: 400000 - 32000 AM = 368000, plus 100000 transfer = 468000
    expect(result.personalIncome).toBe(468000)
  })

  it("transfer income only (no AM)", () => {
    const result = calcPI({ transferIncome: 200000 })
    expect(result.personalIncome).toBe(200000)
  })

  it("livrente deduction is not capped", () => {
    const result = calcPI({ workIncome: 500000, privatePensionLivrente: 100000 })
    expect(result.pensionLivrenteDeduction).toBe(100000)
    expect(result.personalIncome).toBe(460000 - 100000)
  })

  it("personal income deductions applied", () => {
    const result = calcPI({ workIncome: 500000, personalIncomeDeductions: 10000 })
    expect(result.personalIncome).toBe(450000)
  })
})
