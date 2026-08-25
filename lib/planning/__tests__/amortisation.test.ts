import { describe, it, expect } from "vitest"
import { amortizeYear } from "../amortisation"

/**
 * Walk a loan year by year the way the simulation does: the maturity clock ticks
 * down twelve months every year, afdragsfrihed or not.
 */
function schedule(
  principal: number,
  rate: number,
  termYears: number,
  interestOnlyYears = 0
): { balances: number[]; interest: number[]; payments: number[] } {
  const balances = [principal]
  const interest: number[] = []
  const payments: number[] = []
  let monthsLeft = termYears * 12
  for (let y = 1; y <= termYears; y++) {
    const before = balances[y - 1]
    const step = amortizeYear(before, rate, monthsLeft, y <= interestOnlyYears)
    balances.push(step.balance)
    interest.push(step.interest)
    payments.push(before - step.balance + step.interest)
    monthsLeft -= 12
  }
  return { balances, interest, payments }
}

describe("amortizeYear", () => {
  it("reproduces the pre-extraction schedule", () => {
    // Pinned to the numbers the inline version in simulate.ts produced, so the
    // extraction can't quietly change the projection.
    const { balance, interest } = amortizeYear(2_000_000, 0.04, 240)
    expect(balance).toBeCloseTo(1_933_351.6442713784, 6)
    expect(interest).toBeCloseTo(78_786.92330323666, 6)
  })

  it("repays the loan exactly at maturity", () => {
    expect(schedule(2_000_000, 0.04, 20).balances.at(-1)).toBeCloseTo(0, 6)
  })

  it("charges a level annual payment", () => {
    // Twelve annuity instalments a year — the split between interest and
    // principal shifts, the total does not.
    const { payments } = schedule(2_000_000, 0.04, 20)
    for (const payment of payments) expect(payment).toBeCloseTo(payments[0], 6)
  })

  it("leaves the balance flat through an afdragsfrihed period", () => {
    const { balances, interest } = schedule(2_000_000, 0.04, 20, 5)
    for (let y = 1; y <= 5; y++) expect(balances[y]).toBe(2_000_000)
    // Only interest falls due, on a balance that never moves.
    for (let y = 0; y < 5; y++) expect(interest[y]).toBeCloseTo(80_000, 6)
  })

  it("steps the payment up when the period ends, keeping the maturity", () => {
    const plain = schedule(2_000_000, 0.04, 20)
    const io = schedule(2_000_000, 0.04, 20, 5)
    // Lower outgoings during the period (interest only, no afdrag)...
    expect(io.payments[0]).toBeLessThan(plain.payments[0])
    // ...then the untouched principal is squeezed into the 15 years left.
    expect(io.payments[5]).toBeGreaterThan(plain.payments[5] * 1.2)
    // The loan still runs out at its original maturity.
    expect(io.balances.at(-1)).toBeCloseTo(0, 6)
  })

  it("never amortizes when afdragsfrihed outlasts the term", () => {
    // The clock runs out mid-period, and past maturity there are no scheduled
    // payments left to catch up with — the balance is simply never repaid.
    const { balances } = schedule(2_000_000, 0.04, 20, 20)
    expect(balances.at(-1)).toBe(2_000_000)
    expect(amortizeYear(2_000_000, 0.04, 0).balance).toBe(2_000_000)
  })

  it("reports no balance and no interest once the loan is gone", () => {
    expect(amortizeYear(0, 0.04, 240)).toEqual({ balance: 0, interest: 0 })
    expect(amortizeYear(-5, 0.04, 240)).toEqual({ balance: 0, interest: 0 })
  })

  it("accrues interest on a balance past its maturity", () => {
    // Equity borrowed during retirement sits outside any repayment schedule.
    expect(amortizeYear(500_000, 0.04, 0)).toEqual({
      balance: 500_000,
      interest: 20_000,
    })
  })

  it("splits an interest-free loan evenly over its term", () => {
    const { balances, interest } = schedule(200_000, 0, 10)
    expect(balances[1]).toBeCloseTo(180_000, 6)
    expect(balances[5]).toBeCloseTo(100_000, 6)
    expect(balances.at(-1)).toBeCloseTo(0, 6)
    expect(interest.every((i) => i === 0)).toBe(true)
  })
})
