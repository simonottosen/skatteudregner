import { describe, it, expect } from "vitest"
import { parseLoenseddelFromText } from "../parse-loenseddel"

const SAMPLE_ENGLISH_PAYCHECK = `
CVR/SE number: 30825837
Personal identification number (CPR)  021096-0775
Seniority date  01-10-2020

Employee  1210-392117
Employer  Boston Consulting Group

Pay specification

Pay period: 01-03-2026 - 31-03-2026

Paytype  Description  Units  Rate  Balance  Amount
1000  Salary  173,33  102.083,34
6200  AM-contribution  8,00 %  7.339,00
6560  Used personal deduction  -32,00
6600  Tax  44,00 %  34.627,00
4600  Danica pension, employee (mandatory)  10,00 %  2.552,08
4610  Danica pension, employer (insurance)  1,00 %  581,88
4910  ATP contribution  297,00
8500  Net salary  48.838,05

Opening balance  Period  Year to date
(13) AM-income  91.731,89  331.764,49
(15) TAX-contribution  34.627,00  126.781,00
(16) AM-contribution  7.339,00  26.542,00
(46) ATP  297,00  891,00
(147) Employee's pension  2.552,08  7.656,24
(148) Employer's pension  581,88  1.745,64
`

const SAMPLE_DANISH_PAYCHECK = `
CVR/SE nummer: 12345678
Personnummer  150385-1234

Lønspecifikation

Lønperiode: 01-02-2026 - 28-02-2026

Beskrivelse  Beløb
Månedsløn  45.000,00
AM-bidrag  3.600,00
Skat  15.750,00
Pension, medarbejder  2.250,00
Pension, arbejdsgiver  4.500,00
ATP  99,00
Nettoløn  23.301,00

Saldo  Periode  År til dato
(13) AM-indkomst  45.000,00  90.000,00
(15) Skat  15.750,00  31.500,00
(16) AM-bidrag  3.600,00  7.200,00
(46) ATP  99,00  198,00
(147) Medarbejderpension  2.250,00  4.500,00
(148) Arbejdsgiverpension  4.500,00  9.000,00
`

describe("parseLoenseddelFromText", () => {
  describe("English paycheck", () => {
    it("extracts pay period", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data).not.toBeNull()
      expect(result.data!.payPeriod.from).toBe("2026-03-01")
      expect(result.data!.payPeriod.to).toBe("2026-03-31")
      expect(result.data!.month).toBe(3)
      expect(result.data!.year).toBe(2026)
    })

    it("extracts gross salary", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.grossSalary).toBeCloseTo(102083.34, 0)
      expect(result.fieldsFound).toContain("grossSalary")
    })

    it("extracts AM-contribution", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.amContribution).toBeCloseTo(7339, 0)
      expect(result.fieldsFound).toContain("amContribution")
    })

    it("extracts tax paid", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.taxPaid).toBeCloseTo(34627, 0)
      expect(result.fieldsFound).toContain("taxPaid")
    })

    it("extracts net salary", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.netSalary).toBeCloseTo(48838.05, 0)
      expect(result.fieldsFound).toContain("netSalary")
    })

    it("extracts employee pension", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.employeePension).toBeCloseTo(2552.08, 0)
      expect(result.fieldsFound).toContain("employeePension")
    })

    it("extracts employer pension", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.employerPension).toBeCloseTo(581.88, 0)
      expect(result.fieldsFound).toContain("employerPension")
    })

    it("extracts YTD AM-income", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.ytd.amIncome).toBeCloseTo(331764.49, 0)
      expect(result.fieldsFound).toContain("ytd.amIncome")
    })

    it("extracts YTD tax paid", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.ytd.taxPaid).toBeCloseTo(126781, 0)
      expect(result.fieldsFound).toContain("ytd.taxPaid")
    })

    it("extracts YTD AM-contribution", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.ytd.amContribution).toBeCloseTo(26542, 0)
      expect(result.fieldsFound).toContain("ytd.amContribution")
    })

    it("extracts YTD employee pension", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.ytd.employeePension).toBeCloseTo(7656.24, 0)
      expect(result.fieldsFound).toContain("ytd.employeePension")
    })

    it("extracts YTD employer pension", () => {
      const result = parseLoenseddelFromText(SAMPLE_ENGLISH_PAYCHECK)
      expect(result.data!.ytd.employerPension).toBeCloseTo(1745.64, 0)
      expect(result.fieldsFound).toContain("ytd.employerPension")
    })
  })

  describe("Danish paycheck", () => {
    it("extracts pay period", () => {
      const result = parseLoenseddelFromText(SAMPLE_DANISH_PAYCHECK)
      expect(result.data).not.toBeNull()
      expect(result.data!.month).toBe(2)
      expect(result.data!.year).toBe(2026)
    })

    it("extracts gross salary from Månedsløn", () => {
      const result = parseLoenseddelFromText(SAMPLE_DANISH_PAYCHECK)
      expect(result.data!.grossSalary).toBeCloseTo(45000, 0)
    })

    it("extracts AM-bidrag", () => {
      const result = parseLoenseddelFromText(SAMPLE_DANISH_PAYCHECK)
      expect(result.data!.amContribution).toBeCloseTo(3600, 0)
    })

    it("extracts Skat", () => {
      const result = parseLoenseddelFromText(SAMPLE_DANISH_PAYCHECK)
      expect(result.data!.taxPaid).toBeCloseTo(15750, 0)
    })

    it("extracts nettoløn", () => {
      const result = parseLoenseddelFromText(SAMPLE_DANISH_PAYCHECK)
      expect(result.data!.netSalary).toBeCloseTo(23301, 0)
    })

    it("extracts YTD values", () => {
      const result = parseLoenseddelFromText(SAMPLE_DANISH_PAYCHECK)
      expect(result.data!.ytd.amIncome).toBeCloseTo(90000, 0)
      expect(result.data!.ytd.taxPaid).toBeCloseTo(31500, 0)
      expect(result.data!.ytd.amContribution).toBeCloseTo(7200, 0)
    })
  })

  describe("edge cases", () => {
    it("returns null for non-paycheck PDFs", () => {
      const result = parseLoenseddelFromText("This is a random document with no paycheck data.")
      expect(result.data).toBeNull()
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it("returns null when no pay period is found", () => {
      const result = parseLoenseddelFromText("Pay specification\nSalary  50.000,00")
      expect(result.data).toBeNull()
    })
  })
})
