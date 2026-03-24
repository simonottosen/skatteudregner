import type { TaxInput, TaxYear, PropertyInput } from "@/lib/tax/types"
import { getMunicipalityList } from "@/lib/tax/municipalities"
import {
  normalizeDanish,
  parseSkatNumber,
  extractNumbersFromLine,
  extractNumber,
  extractFirstNumber,
  extractTextFromPDF,
} from "./pdf-utils"

export { parseSkatNumber }

export type ParsedTaxData = Omit<Partial<TaxInput>, "property" | "summerHouse"> & {
  property?: Partial<PropertyInput>
  summerHouse?: Partial<PropertyInput & { municipality: string }>
}

export interface ParseResult {
  data: ParsedTaxData
  warnings: string[]
  fieldsFound: string[]
}

/**
 * Levenshtein distance between two strings (case-insensitive).
 */
function levenshtein(a: string, b: string): number {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  const m = al.length
  const n = bl.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[])
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = al[i - 1] === bl[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

/**
 * Find the closest matching municipality name from the known list.
 * Uses Levenshtein distance for fuzzy matching.
 * Returns the canonical name if found within a reasonable threshold, otherwise the raw input.
 */
function matchMunicipality(raw: string, year: TaxYear = 2026): string {
  let candidate = raw.trim()
  // Strip trailing "s" (e.g. "Københavns" → "København")
  candidate = candidate.replace(/s$/, "")

  const municipalities = getMunicipalityList(year)

  // First try exact match (case-insensitive)
  const exact = municipalities.find(
    (m) => m.name.toLowerCase() === candidate.toLowerCase()
  )
  if (exact) return exact.name

  // Fuzzy match using Levenshtein distance
  let bestMatch = ""
  let bestDist = Infinity
  for (const m of municipalities) {
    const dist = levenshtein(candidate, m.name)
    if (dist < bestDist) {
      bestDist = dist
      bestMatch = m.name
    }
  }

  // Accept if distance is within ~30% of the shorter string's length
  const threshold = Math.max(3, Math.ceil(Math.min(candidate.length, bestMatch.length) * 0.3))
  if (bestDist <= threshold) {
    return bestMatch
  }

  return candidate
}

/**
 * Core extraction logic shared by both PDF and text-based parsing.
 * Works on already-split lines and full text.
 */
function extractFields(
  lines: string[],
  fullText: string
): ParseResult {
  const warnings: string[] = []
  const fieldsFound: string[] = []
  const data: ParsedTaxData = {}

  // Check if this looks like a forskudsopgørelse
  const textLower = fullText.toLowerCase()
  if (
    !textLower.includes("forskudsopg") &&
    !textLower.includes("forskudsskat")
  ) {
    return {
      data: {},
      warnings: [
        "Denne PDF ligner ikke en forskudsopgørelse fra SKAT.",
      ],
      fieldsFound: [],
    }
  }

  // --- Year ---
  // Try to find year near "Forskudsopg" or standalone in first lines
  const yearMatch = fullText.match(/Forskudsopg\S*\s+(\d{4})/i)
    || fullText.match(/Forskudsopg[^\n]*?(\d{4})/i)
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10)
    if (year >= 2024 && year <= 2026) {
      data.year = year as TaxYear
      fieldsFound.push("year")
    }
  }
  if (!data.year) {
    // Fallback: look in first 30 lines for a standalone year
    for (const line of lines.slice(0, 30)) {
      const m = line.match(/\b(2024|2025|2026)\b/)
      if (m) {
        data.year = parseInt(m[1], 10) as TaxYear
        fieldsFound.push("year")
        break
      }
    }
  }
  if (!data.year) warnings.push("Kunne ikke finde indkomstår")

  // --- Birthday from personnummer (DDMMYY-XXXX) ---
  for (const line of lines) {
    // Match CPR-number format: 6 digits, dash, 4 digits (e.g. "021096-0775")
    const cprMatch = line.match(/(\d{2})(\d{2})(\d{2})-\d{4}/)
    if (cprMatch) {
      const day = cprMatch[1]
      const month = cprMatch[2]
      const yearShort = parseInt(cprMatch[3], 10)
      // Determine century: 00-36 → 2000s, 37-99 → 1900s
      const century = yearShort <= 36 ? 2000 : 1900
      const fullYear = century + yearShort
      // Format as YYYY-MM-DD for the date input
      data.birthDate = `${fullYear}-${month}-${day}`
      fieldsFound.push("birthDate")
      break
    }
  }

  // --- Municipality ---
  // Search line by line for "X Kommune" or "Xs Kommune"
  // Must skip "Skattekommune" which is a label, not a municipality name
  let foundMunicipality = false
  for (const line of lines) {
    // Match "Something Kommune" where Something is the municipality name
    const m = line.match(/(\S[\S ]*?)\s+Kommune/i)
    if (m) {
      const candidate = m[1].trim()
      // Skip known labels and irrelevant lines
      if (
        candidate.length < 30 &&
        candidate.length > 2 &&
        !candidate.toLowerCase().includes("skattestyrelse") &&
        !candidate.toLowerCase().includes("skatteforvaltning") &&
        candidate.toLowerCase() !== "skatte"
      ) {
        data.municipality = matchMunicipality(candidate, data.year || 2026)
        fieldsFound.push("municipality")
        foundMunicipality = true
        break
      }
    }
  }
  if (!foundMunicipality) {
    warnings.push("Kunne ikke finde skattekommune")
  }

  // --- Church membership ---
  data.churchMember = textLower.includes("kirkeskat")
  fieldsFound.push("churchMember")

  // --- Work income (Lønindkomst / Loenindkomst) ---
  // Handle garbled encoding: "L»nindkomst" = "Lånindkomst" after normalization = "Lønindkomst"
  // Use very permissive pattern: "L" + any chars + "nindkomst"
  const workIncome = extractFirstNumber(
    lines,
    /l.nindkomst/i
  )
  if (workIncome !== null && workIncome > 0) {
    data.workIncome = workIncome
    fieldsFound.push("workIncome")
  }

  // --- Employer pension (Arbg. alderspens.) ---
  const employerPension = extractFirstNumber(
    lines,
    /arbg\.\s*alderspens/i
  )
  if (employerPension !== null && employerPension > 0) {
    data.employerPension = employerPension
    fieldsFound.push("employerPension")
  }

  // --- Mortgage interest ---
  // "Renteudgifter, gæld til realkreditinstitut" or garbled "Renteudgifter, g{ld til realkreditinstitut"
  const mortgageInterest = extractNumber(
    lines,
    /renteudgifter.+realkreditinstitut/i
  )
  if (mortgageInterest !== null) {
    data.mortgageInterest = Math.abs(mortgageInterest)
    fieldsFound.push("mortgageInterest")
  }

  // --- Ratepension ---
  const ratepension = extractNumber(
    lines,
    /indskud\s+til\s+arbejdsgiveradministreret\s+ratepension/i
  )
  if (ratepension !== null && ratepension > 0) {
    data.privatePensionRatepension = ratepension
    fieldsFound.push("privatePensionRatepension")
  }

  // --- Property: Ejendomsværdi & Grundskyld beskatningsgrundlag ---
  // Extract from specific lines rather than fullText to avoid cross-section matches.
  // Ejendomsværdi: "X promille af ejendommens beskatningsgrundlag på 4.825.600 kr."
  // Grundskyld: "Beregnet grundskyld af ejendommens beskatningsgrundlag på 3.049.600 kr."
  let ejendomsAssessment: number | null = null
  let landAssessment: number | null = null

  for (const line of lines) {
    // Ejendomsværdi: line contains "promille" and "beskatningsgrundlag"
    if (/promille/i.test(line) && /beskatningsgrundlag/i.test(line)) {
      const m = line.match(/beskatningsgrundlag\s*p.\s*([\d\s.]+)\s*kr/i)
      if (m) {
        const val = parseSkatNumber(m[1])
        if (val !== null && ejendomsAssessment === null) ejendomsAssessment = val
      }
    }
    // Grundskyld: line contains "grundskyld" and "beskatningsgrundlag"
    if (/grundskyld/i.test(line) && /beskatningsgrundlag/i.test(line)) {
      const m = line.match(/beskatningsgrundlag\s*p.\s*([\d\s.]+)\s*kr/i)
      if (m) {
        const val = parseSkatNumber(m[1])
        if (val !== null) landAssessment = val
      }
    }
  }

  if (ejendomsAssessment !== null || landAssessment !== null) {
    const propertyData: Partial<PropertyInput> = {
      ownershipShare: 1,
      purchasedBefore19980701: false,
      isCondo: false,
      personalTaxDiscount: 0,
    }

    if (ejendomsAssessment !== null) {
      propertyData.assessmentBasis = ejendomsAssessment
      fieldsFound.push("property.assessmentBasis")
    }

    if (landAssessment !== null) {
      propertyData.landAssessmentBasis = landAssessment
      fieldsFound.push("property.landAssessmentBasis")
    }

    data.property = propertyData
    fieldsFound.push("property")
  }

  if (fieldsFound.length === 0) {
    warnings.push(
      "Ingen felter kunne genkendes fra denne PDF. Er det en forskudsopgørelse?"
    )
  }

  return { data, warnings, fieldsFound }
}

/**
 * Parse a forskudsopgørelse PDF and extract TaxInput fields.
 * All processing happens client-side — the file never leaves the browser.
 */
export async function parseForskudsopgoerelse(
  file: File
): Promise<ParseResult> {
  let lines: string[]
  try {
    lines = await extractTextFromPDF(file)
  } catch {
    return {
      data: {},
      warnings: ["Kunne ikke læse PDF-filen. Kontroller at det er en gyldig forskudsopgørelse."],
      fieldsFound: [],
    }
  }

  // Normalize Danish characters (PDF may use garbled encoding)
  const normalizedLines = lines.map(normalizeDanish)
  const fullText = normalizedLines.join("\n")

  return extractFields(normalizedLines, fullText)
}

/**
 * Parse forskudsopgørelse from raw text (for testing without pdfjs-dist).
 */
export function parseForskudsopgoerelsFromText(
  text: string
): ParseResult {
  const normalized = normalizeDanish(text)
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean)
  const fullText = normalized

  return extractFields(lines, fullText)
}
