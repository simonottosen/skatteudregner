import type { PaycheckData, PaycheckParseResult } from "@/lib/paycheck/types"
import {
  normalizeDanish,
  parseDanishDecimal,
  extractTextFromPDF,
} from "./pdf-utils"

/**
 * Parse a Danish decimal number from a paycheck line segment.
 * Paycheck numbers use formats like "102.083,34" or "-4.917,91" or "7.339,00"
 */
function parsePaycheckNumber(raw: string): number | null {
  return parseDanishDecimal(raw)
}

/**
 * Extract all decimal numbers from a line.
 * Splits by 2+ whitespace and parses each segment.
 */
function extractDecimalsFromLine(line: string): number[] {
  const segments = line.split(/\s{2,}/).map((s) => s.trim())
  const results: number[] = []
  for (const seg of segments) {
    if (/^[-\d]/.test(seg)) {
      const parsed = parsePaycheckNumber(seg)
      if (parsed !== null) results.push(parsed)
    }
  }
  return results
}

/**
 * Find the last number on a line matching a pattern.
 */
function findLastNumber(lines: string[], pattern: RegExp): number | null {
  for (const line of lines) {
    if (pattern.test(line)) {
      const nums = extractDecimalsFromLine(line)
      if (nums.length > 0) return nums[nums.length - 1]
    }
  }
  return null
}

/**
 * Extract YTD value from lines containing standard Danish payroll codes.
 * These lines have format: "(13) AM-income  91.731,89  331.764,49"
 * BUT because PDF extraction merges two-column tables into a single line,
 * the line may also include the right column, e.g.:
 *   "(13) AM-income  91.731,89  331.764,49  Holiday allowance, this year  1.078,02  11.263,38"
 * We extract numbers only from the segment between the code and the next text label
 * (3+ consecutive alphabetic chars), so we get [91.731,89, 331.764,49] and return
 * the 2nd as YTD.
 */
function extractYtdByCode(lines: string[], code: string): number | null {
  const codePattern = new RegExp(`\\(${code}\\)`, "i")
  for (const line of lines) {
    const match = line.match(codePattern)
    if (match && match.index !== undefined) {
      const afterCode = line.substring(match.index + match[0].length)

      // Find all Danish decimal numbers in the text after the code
      const numRegex = /-?[\d]+(?:\.[\d]{3})*,\d{2}/g
      const nums: number[] = []
      let numMatch: RegExpExecArray | null
      let lastNumEnd = 0

      while ((numMatch = numRegex.exec(afterCode)) !== null) {
        // If we already have 2 numbers, check if there's a text label between
        // the previous number and this one — that signals the right column started
        if (nums.length >= 2) {
          const between = afterCode.substring(lastNumEnd, numMatch.index)
          if (/[a-zA-ZæøåÆØÅ]{3,}/.test(between)) {
            break
          }
        }
        const parsed = parsePaycheckNumber(numMatch[0])
        if (parsed !== null) nums.push(parsed)
        lastNumEnd = numMatch.index + numMatch[0].length
      }

      if (nums.length >= 2) {
        // First number is period value, second is YTD
        return nums[1]
      }
      if (nums.length === 1) {
        return nums[0]
      }
    }
  }
  return null
}

/**
 * Extract pay period from text.
 * Matches formats: "01-03-2026 - 31-03-2026" or "01.03.2026 - 31.03.2026"
 */
function extractPayPeriod(
  lines: string[]
): { from: string; to: string; month: number; year: number } | null {
  for (const line of lines) {
    const m = line.match(
      /(\d{2})[.-](\d{2})[.-](\d{4})\s*-\s*(\d{2})[.-](\d{2})[.-](\d{4})/
    )
    if (m) {
      const fromDay = m[1]
      const fromMonth = m[2]
      const fromYear = m[3]
      const toDay = m[4]
      const toMonth = m[5]
      const toYear = m[6]
      return {
        from: `${fromYear}-${fromMonth}-${fromDay}`,
        to: `${toYear}-${toMonth}-${toDay}`,
        month: parseInt(toMonth, 10),
        year: parseInt(toYear, 10),
      }
    }
  }
  return null
}

/**
 * Extract employee and employer addresses from the payslip header.
 *
 * PDF text extraction merges the two-column layout into single lines.
 * We scan the header for all Danish postal codes (4 digits + city name)
 * and extract the street from the preceding text segment.
 *
 * The first postal code found is typically the employee's address (left column),
 * the second is the employer's (right column).
 */
function extractAddresses(
  lines: string[]
): { employeeAddress: string | null; employerAddress: string | null } {
  // Find header boundaries
  const headerEnd = lines.findIndex((l) => {
    const lower = l.toLowerCase()
    return (
      lower.includes("pay specification") ||
      lower.includes("lønspecifikation") ||
      lower.includes("paytype") ||
      lower.includes("pay period")
    )
  })
  const endBound = headerEnd > 0 ? headerEnd : Math.min(lines.length, 30)
  const headerText = lines.slice(0, endBound).join("\n")

  // Process lines to separate left/right columns and find addresses.
  // Each merged line is split by 2+ spaces into left and right segments.
  const headerLines = lines.slice(0, endBound)

  // Find "Employee"/"Employer" marker to know where address section starts
  let markerIdx = -1
  for (let i = 0; i < headerLines.length; i++) {
    const lower = headerLines[i].toLowerCase()
    if (
      lower.includes("employee") || lower.includes("medarbejder") ||
      lower.includes("employer") || lower.includes("arbejdsgiver")
    ) {
      markerIdx = i
      break
    }
  }
  if (markerIdx < 0) {
    return { employeeAddress: null, employerAddress: null }
  }

  // Build separate left and right column arrays from lines after the marker
  const leftCol: string[] = []
  const rightCol: string[] = []

  for (let i = markerIdx + 1; i < headerLines.length; i++) {
    const line = headerLines[i]
    const parts = line.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean)
    if (parts.length >= 2) {
      leftCol.push(parts[0])
      rightCol.push(parts[parts.length - 1])
    } else if (parts.length === 1) {
      leftCol.push(parts[0])
    }
  }

  // Danish postal code pattern
  const postalPattern = /\b(\d{4})\s+([A-ZÆØÅa-zæøå][\wæøåÆØÅ\s]*)/

  function buildAddress(col: string[]): string | null {
    for (let i = 0; i < col.length; i++) {
      if (postalPattern.test(col[i])) {
        const postalLine = col[i]
        // Look backwards for a street-like line
        for (let j = i - 1; j >= 0; j--) {
          const seg = col[j]
          if (/^\d{4}\s+[A-ZÆØÅa-zæøå]/.test(seg)) continue // skip other postal codes
          if (seg.length <= 3) continue
          // Street typically has a number
          if (/\d/.test(seg)) {
            return `${seg}, ${postalLine}`
          }
        }
        return postalLine
      }
    }
    return null
  }

  return {
    employeeAddress: buildAddress(leftCol),
    employerAddress: buildAddress(rightCol),
  }
}

/**
 * Core extraction logic for paycheck PDFs.
 * Supports both English and Danish paycheck labels.
 */
function extractPaycheckFields(
  lines: string[],
  fullText: string
): PaycheckParseResult {
  const warnings: string[] = []
  const fieldsFound: string[] = []

  const textLower = fullText.toLowerCase()

  // Verify this looks like a paycheck
  const isPaycheck =
    textLower.includes("lønseddel") ||
    textLower.includes("loenseddel") ||
    textLower.includes("pay specification") ||
    textLower.includes("lønspecifikation") ||
    textLower.includes("salary") ||
    textLower.includes("net salary") ||
    textLower.includes("nettoløn") ||
    textLower.includes("am-bi") ||
    textLower.includes("am-contribution") ||
    textLower.includes("am-indkomst") ||
    textLower.includes("am-income")
  if (!isPaycheck) {
    return {
      data: null,
      warnings: [
        "Denne PDF ligner ikke en lønseddel. Upload venligst din seneste lønseddel.",
      ],
      fieldsFound: [],
    }
  }

  // --- Pay period ---
  const period = extractPayPeriod(lines)
  if (!period) {
    warnings.push("Kunne ikke finde lønperiode")
    return { data: null, warnings, fieldsFound }
  }
  fieldsFound.push("payPeriod")

  // --- Gross salary (EN: Salary / DA: Løn / Månedsløn / Bruttoløn) ---
  let grossSalary: number | null = null
  // Try specific paycheck line patterns - look for the main salary line
  // The salary line typically has "Salary" or "Løn" as description with the amount
  for (const line of lines) {
    const lower = line.toLowerCase()
    // Match "Salary" or "Løn" or "Månedsløn" but not "Net salary" or "Holiday"
    if (
      (/\bsalary\b/i.test(line) && !lower.includes("net") && !lower.includes("holiday") && !lower.includes("basis")) ||
      (/\bløn\b/i.test(line) && !lower.includes("netto") && !lower.includes("ferie") && !lower.includes("seddel"))  ||
      /\bmånedsløn\b/i.test(line) ||
      /\bbruttoløn\b/i.test(line)
    ) {
      const nums = extractDecimalsFromLine(line)
      if (nums.length > 0) {
        // Take the last positive number (the amount column)
        const positiveNums = nums.filter((n) => n > 0)
        if (positiveNums.length > 0) {
          grossSalary = positiveNums[positiveNums.length - 1]
          break
        }
      }
    }
  }
  if (grossSalary !== null) {
    fieldsFound.push("grossSalary")
  } else {
    warnings.push("Kunne ikke finde bruttoløn")
  }

  // --- AM-contribution (EN: AM-contribution / DA: AM-bidrag) ---
  const amContribution = findLastNumber(
    lines,
    /am-(?:bidrag|contribution|kontribution)/i
  )
  if (amContribution !== null) {
    fieldsFound.push("amContribution")
  }

  // --- Tax (EN: Tax / DA: Skat / A-skat) ---
  let taxPaid: number | null = null
  for (const line of lines) {
    // Match "Tax" or "Skat" or "A-skat" but not "AM-" or "ejendomsværdiskat"
    if (
      (/\bskat\b/i.test(line) || /\btax\b/i.test(line) || /\ba-skat\b/i.test(line)) &&
      !line.toLowerCase().includes("am-") &&
      !line.toLowerCase().includes("ejendom") &&
      !line.toLowerCase().includes("forskel") &&
      !line.toLowerCase().includes("skatte")
    ) {
      const nums = extractDecimalsFromLine(line)
      if (nums.length > 0) {
        // Tax is typically a negative (deducted) or positive large number
        const lastNum = nums[nums.length - 1]
        if (Math.abs(lastNum) > 100) {
          taxPaid = Math.abs(lastNum)
          break
        }
      }
    }
  }
  if (taxPaid !== null) {
    fieldsFound.push("taxPaid")
  }

  // --- Employee pension (EN: pension, employee / DA: pension, medarbejder) ---
  let employeePension: number | null = null
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (
      (lower.includes("pension") && (lower.includes("employee") || lower.includes("medarbejder"))) ||
      (lower.includes("pension") && lower.includes("mandatory") && !lower.includes("employer"))
    ) {
      const nums = extractDecimalsFromLine(line)
      if (nums.length > 0) {
        const val = nums[nums.length - 1]
        employeePension = Math.abs(val)
        break
      }
    }
  }
  if (employeePension !== null) {
    fieldsFound.push("employeePension")
  }

  // --- Employer pension (EN: pension, employer / DA: pension, arbejdsgiver) ---
  let employerPension: number | null = null
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (
      lower.includes("pension") &&
      (lower.includes("employer") || lower.includes("arbejdsgiver") || lower.includes("insurance"))
    ) {
      const nums = extractDecimalsFromLine(line)
      if (nums.length > 0) {
        const val = nums[nums.length - 1]
        employerPension = Math.abs(val)
        break
      }
    }
  }
  if (employerPension !== null) {
    fieldsFound.push("employerPension")
  }

  // --- ATP ---
  const atp = findLastNumber(lines, /\batp\b/i)
  if (atp !== null) {
    fieldsFound.push("atp")
  }

  // --- Net salary (EN: Net salary / DA: Nettoløn / Udbetalt) ---
  let netSalary: number | null = null
  for (const line of lines) {
    if (
      /net\s*salary/i.test(line) ||
      /\bnettoløn\b/i.test(line) ||
      /\bnettol.n\b/i.test(line) ||
      /\budbetalt\b/i.test(line)
    ) {
      const nums = extractDecimalsFromLine(line)
      if (nums.length > 0) {
        netSalary = nums[nums.length - 1]
        break
      }
    }
  }
  if (netSalary !== null) {
    fieldsFound.push("netSalary")
  }

  // --- YTD values from standard payroll codes ---
  const ytdAmIncome = extractYtdByCode(lines, "13")
  const ytdTaxPaid = extractYtdByCode(lines, "15")
  const ytdAmContribution = extractYtdByCode(lines, "16")
  const ytdAtp = extractYtdByCode(lines, "46")
  const ytdEmployeePension = extractYtdByCode(lines, "147")
  const ytdEmployerPension = extractYtdByCode(lines, "148")

  if (ytdAmIncome !== null) fieldsFound.push("ytd.amIncome")
  if (ytdTaxPaid !== null) fieldsFound.push("ytd.taxPaid")
  if (ytdAmContribution !== null) fieldsFound.push("ytd.amContribution")
  if (ytdAtp !== null) fieldsFound.push("ytd.atp")
  if (ytdEmployeePension !== null) fieldsFound.push("ytd.employeePension")
  if (ytdEmployerPension !== null) fieldsFound.push("ytd.employerPension")

  if (fieldsFound.length <= 1) {
    warnings.push(
      "Kun få felter kunne genkendes. Er dette en standard dansk lønseddel?"
    )
  }

  // --- Addresses ---
  const { employeeAddress, employerAddress } = extractAddresses(lines)
  if (employeeAddress) fieldsFound.push("employeeAddress")
  if (employerAddress) fieldsFound.push("employerAddress")

  const data: PaycheckData = {
    payPeriod: { from: period.from, to: period.to },
    month: period.month,
    year: period.year,
    grossSalary: grossSalary ?? 0,
    amContribution: Math.abs(amContribution ?? 0),
    taxPaid: taxPaid ?? 0,
    employeePension: employeePension ?? 0,
    employerPension: employerPension ?? 0,
    atp: Math.abs(atp ?? 0),
    netSalary: netSalary ?? 0,
    ytd: {
      amIncome: ytdAmIncome ?? 0,
      taxPaid: ytdTaxPaid ?? 0,
      amContribution: ytdAmContribution ?? 0,
      atp: ytdAtp ?? 0,
      employeePension: ytdEmployeePension ?? 0,
      employerPension: ytdEmployerPension ?? 0,
    },
    employeeAddress: employeeAddress ?? undefined,
    employerAddress: employerAddress ?? undefined,
  }

  return { data, warnings, fieldsFound }
}

/**
 * Parse a lønseddel PDF and extract paycheck data.
 * All processing happens client-side — the file never leaves the browser.
 */
export async function parseLoenseddel(
  file: File
): Promise<PaycheckParseResult> {
  let lines: string[]
  try {
    lines = await extractTextFromPDF(file)
  } catch {
    return {
      data: null,
      warnings: ["Kunne ikke læse PDF-filen. Kontroller at det er en gyldig lønseddel."],
      fieldsFound: [],
    }
  }

  const normalizedLines = lines.map(normalizeDanish)
  const fullText = normalizedLines.join("\n")

  return extractPaycheckFields(normalizedLines, fullText)
}

/**
 * Parse lønseddel from raw text (for testing without pdfjs-dist).
 */
export function parseLoenseddelFromText(text: string): PaycheckParseResult {
  const normalized = normalizeDanish(text)
  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const fullText = normalized

  return extractPaycheckFields(lines, fullText)
}
