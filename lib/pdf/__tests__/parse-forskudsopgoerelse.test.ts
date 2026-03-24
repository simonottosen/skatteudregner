import { describe, it, expect } from "vitest"
import {
  parseSkatNumber,
  parseForskudsopgoerelsFromText,
} from "../parse-forskudsopgoerelse"

// Sample text that mimics the extracted text from the example forskudsopgørelse PDF
const SAMPLE_FORSKUDSOPGOERELSE = `
Skattestyrelsen er en del af Skatteforvaltningen
Forskudsopgørelse 2026
Personnummer 021096-0775
Skattekommune
Københavns Kommune
Skatteprocent  23,39
Personfradrag  54.100
Fuldt skattepligtig

Opgørelse af indkomst
Personlig indkomst
Lønindkomst, fri telefon og fri bil mv.  1. 600.000  128. 000  1. 472. 000
Arbg. alderspens., gruppeliv fratrukket i løn  2.500  0  2. 500

Kapitalindkomst
Renteudgifter, gæld til realkreditinstitut  - 130. 000  - 130. 000

Sådan er forskudsskatten beregnet
AM-bidrag 8,00% af (1.600.000)  128. 000, 00
Bundskat 12,01% af (1.474.500)  177. 087, 45
Kommuneskat 23,39% af (1.270.240)  297. 109, 13
Ejendomsværdiskat  24. 610, 56

Andre oplysninger:
Indskud til arbejdsgiveradministreret ratepension mv.  65. 500

Specifikation af ejendomsskatter

Ejendomsværdiskat
Ejendomsnr. 101 144410 Flensborggade 40 04 tv
5,1 promille af ejendommens beskatningsgrundlag på 4.825.600 kr.

Grundskyld
Ejendomsnr. 101 144410, Flensborggade 40 4 TV, 1669, København V
Beregnet grundskyld af ejendommens beskatningsgrundlag på 3.049.600 kr.
`

describe("parseSkatNumber", () => {
  it("15.9: parses SKAT spaced numbers", () => {
    expect(parseSkatNumber("1. 600.000")).toBe(1600000)
    expect(parseSkatNumber("1. 600. 000")).toBe(1600000)
  })

  it("15.10: parses numbers with decimal comma", () => {
    expect(parseSkatNumber("128. 000, 00")).toBe(128000)
    expect(parseSkatNumber("177. 087, 45")).toBe(177087)
  })

  it("parses simple numbers", () => {
    expect(parseSkatNumber("2.500")).toBe(2500)
    expect(parseSkatNumber("65. 500")).toBe(65500)
    expect(parseSkatNumber("54.100")).toBe(54100)
  })

  it("parses negative numbers", () => {
    expect(parseSkatNumber("- 130. 000")).toBe(-130000)
    expect(parseSkatNumber("-130.000")).toBe(-130000)
  })

  it("returns null for empty/invalid", () => {
    expect(parseSkatNumber("")).toBeNull()
    expect(parseSkatNumber("abc")).toBeNull()
  })
})

describe("parseForskudsopgoerelsFromText", () => {
  it("15.1: extracts municipality", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.municipality).toBe("København")
    expect(result.fieldsFound).toContain("municipality")
  })

  it("15.2: extracts work income", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.workIncome).toBe(1600000)
    expect(result.fieldsFound).toContain("workIncome")
  })

  it("15.3: extracts employer pension", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.employerPension).toBe(2500)
    expect(result.fieldsFound).toContain("employerPension")
  })

  it("15.4: extracts mortgage interest as positive value", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.mortgageInterest).toBe(130000)
    expect(result.fieldsFound).toContain("mortgageInterest")
  })

  it("15.5: extracts ratepension", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.privatePensionRatepension).toBe(65500)
    expect(result.fieldsFound).toContain("privatePensionRatepension")
  })

  it("15.6: extracts property assessment basis", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.property).toBeDefined()
    expect(result.data.property?.assessmentBasis).toBe(4825600)
    expect(result.fieldsFound).toContain("property.assessmentBasis")
  })

  it("15.7: extracts land assessment basis", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.property?.landAssessmentBasis).toBe(3049600)
    expect(result.fieldsFound).toContain("property.landAssessmentBasis")
  })

  it("15.8: extracts year", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.year).toBe(2026)
    expect(result.fieldsFound).toContain("year")
  })

  it("extracts birthday from personnummer", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.birthDate).toBe("1996-10-02")
    expect(result.fieldsFound).toContain("birthDate")
  })

  it("15.6: extracts DIFFERENT values for ejendom vs grundskyld", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.property?.assessmentBasis).toBe(4825600)
    expect(result.data.property?.landAssessmentBasis).toBe(3049600)
    // They must be DIFFERENT values
    expect(result.data.property?.assessmentBasis).not.toBe(result.data.property?.landAssessmentBasis)
  })

  it("15.11: handles non-forskudsopgørelse text gracefully", () => {
    const result = parseForskudsopgoerelsFromText(
      "This is a random document about cooking recipes."
    )
    expect(result.data).toEqual({})
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.fieldsFound).toEqual([])
  })

  it("extracts churchMember as false when no kirkeskat", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.churchMember).toBe(false)
    expect(result.fieldsFound).toContain("churchMember")
  })

  it("extracts churchMember as true when kirkeskat present", () => {
    const textWithKirke = SAMPLE_FORSKUDSOPGOERELSE + "\nKirkeskat 0,67% af (1.270.240) 8.510,61"
    const result = parseForskudsopgoerelsFromText(textWithKirke)
    expect(result.data.churchMember).toBe(true)
  })

  it("sets property defaults correctly", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    expect(result.data.property?.ownershipShare).toBe(1)
    expect(result.data.property?.purchasedBefore19980701).toBe(false)
    expect(result.data.property?.isCondo).toBe(false)
    expect(result.data.property?.personalTaxDiscount).toBe(0)
  })

  it("returns multiple found fields", () => {
    const result = parseForskudsopgoerelsFromText(SAMPLE_FORSKUDSOPGOERELSE)
    // Should find at least: year, municipality, churchMember, workIncome, employerPension,
    // mortgageInterest, ratepension, property, property.assessmentBasis, property.landAssessmentBasis
    expect(result.fieldsFound.length).toBeGreaterThanOrEqual(8)
  })
})

// Simulate garbled PDF encoding: » = ø, } = å, { = æ
const GARBLED_FORSKUDSOPGOERELSE = `
Skattestyrelsen er en del af Skatteforvaltningen
Forskudsopg»relse  2026
Personnummer  021096-0775
Skattekommune
K»benhavns Kommune
Skatteprocent  23,39
Personfradrag  54.100
Fuldt skattepligtig

Opg»relse af indkomst
Personlig indkomst
L»nindkomst, fri telefon og fri bil mv.  1. 600.000  128. 000  1. 472. 000
Arbg. alderspens., gruppeliv fratrukket i l»n  2.500  0  2. 500

Kapitalindkomst
Renteudgifter, g{ld til realkreditinstitut  - 130. 000  - 130. 000

S}dan er forskudsskatten beregnet
AM-bidrag 8,00% af (1.600.000)  128. 000, 00
Bundskat 12,01% af (1.474.500)  177. 087, 45
Kommuneskat 23,39% af (1.270.240)  297. 109, 13
Ejendomsv{rdiskat  24. 610, 56

Andre oplysninger:
Indskud til arbejdsgiveradministreret ratepension mv.  65. 500

Specifikation af ejendomsskatter

Ejendomsv{rdiskat
Ejendomsnr. 101 144410 Flensborggade 40 04 tv
5,1 promille af ejendommens beskatningsgrundlag p} 4.825.600 kr.

Grundskyld
Ejendomsnr. 101 144410, Flensborggade 40 4 TV, 1669, K»benhavn V
Beregnet grundskyld af ejendommens beskatningsgrundlag p} 3.049.600 kr.
`

describe("parseForskudsopgoerelsFromText with garbled encoding", () => {
  it("extracts municipality from garbled text", () => {
    const result = parseForskudsopgoerelsFromText(GARBLED_FORSKUDSOPGOERELSE)
    expect(result.data.municipality).toBe("København")
  })

  it("extracts year from garbled text", () => {
    const result = parseForskudsopgoerelsFromText(GARBLED_FORSKUDSOPGOERELSE)
    expect(result.data.year).toBe(2026)
  })

  it("extracts work income from garbled text", () => {
    const result = parseForskudsopgoerelsFromText(GARBLED_FORSKUDSOPGOERELSE)
    expect(result.data.workIncome).toBe(1600000)
  })

  it("extracts mortgage interest from garbled text", () => {
    const result = parseForskudsopgoerelsFromText(GARBLED_FORSKUDSOPGOERELSE)
    expect(result.data.mortgageInterest).toBe(130000)
  })

  it("extracts property assessment from garbled text", () => {
    const result = parseForskudsopgoerelsFromText(GARBLED_FORSKUDSOPGOERELSE)
    expect(result.data.property?.assessmentBasis).toBe(4825600)
    expect(result.data.property?.landAssessmentBasis).toBe(3049600)
  })

  it("extracts all expected fields from garbled text", () => {
    const result = parseForskudsopgoerelsFromText(GARBLED_FORSKUDSOPGOERELSE)
    expect(result.fieldsFound.length).toBeGreaterThanOrEqual(8)
    expect(result.warnings).not.toContain("Kunne ikke finde indkomstår")
  })
})
