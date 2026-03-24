/**
 * Shared PDF extraction utilities used by both forskudsopgørelse and lønseddel parsers.
 */

/**
 * Normalize garbled Danish characters from PDF extraction.
 * Many SKAT PDFs use non-standard encoding where:
 *   » (U+00BB) → ø  (e.g., "K»benhavn" = "København")
 *   } (U+007D) → å  (e.g., "p}" = "på", "S}dan" = "Sådan")
 *   { (U+007B) → æ  (e.g., "v{rdiskat" = "værdiskat")
 */
export function normalizeDanish(text: string): string {
  return text
    .replace(/»/g, "ø")
    .replace(/\}/g, "å")
    .replace(/\{/g, "æ")
}

/**
 * Parse a number from SKAT's PDF format.
 * SKAT uses spaces as thousands separators and comma for decimals:
 * "1. 600. 000" or "1.600.000" or "128. 000, 00" or "130.000"
 * Also handles negative numbers prefixed with "- " or "-".
 */
export function parseSkatNumber(raw: string): number | null {
  if (!raw || raw.trim() === "") return null

  let s = raw.trim()

  // Check for negative prefix
  const isNegative = s.startsWith("-") || s.startsWith("- ")
  if (isNegative) {
    s = s.replace(/^-\s*/, "")
  }

  // Remove all spaces
  s = s.replace(/\s+/g, "")

  // Remove trailing decimal part if comma-separated (e.g. ",00")
  s = s.replace(/,\d{2}$/, "")

  // Remove dots (thousands separators)
  s = s.replace(/\./g, "")

  const num = parseInt(s, 10)
  if (isNaN(num)) return null

  return isNegative ? -num : num
}

/**
 * Parse a Danish-formatted decimal number.
 * Handles formats like "102.083,34" or "10.208,33" or "-4.917,91"
 * Uses dot as thousands separator and comma as decimal separator.
 */
export function parseDanishDecimal(raw: string): number | null {
  if (!raw || raw.trim() === "") return null

  let s = raw.trim()

  const isNegative = s.startsWith("-") || s.startsWith("- ")
  if (isNegative) {
    s = s.replace(/^-\s*/, "")
  }

  // Remove spaces
  s = s.replace(/\s+/g, "")

  // Remove dots (thousands separators)
  s = s.replace(/\./g, "")

  // Replace comma with dot for decimal
  s = s.replace(",", ".")

  const num = parseFloat(s)
  if (isNaN(num)) return null

  return isNegative ? -num : num
}

/**
 * Split a line into number segments.
 * Numbers use spaces within (e.g. "1. 600.000") but are separated by 2+ spaces.
 */
export function extractNumbersFromLine(line: string): number[] {
  const segments = line.split(/\s{2,}/).map((s) => s.trim())
  const results: number[] = []
  for (const seg of segments) {
    if (/^[-\d]/.test(seg)) {
      const parsed = parseSkatNumber(seg)
      if (parsed !== null) results.push(parsed)
    }
  }
  return results
}

/**
 * Extract a number from lines matching a pattern.
 * Returns the LAST number on the matching line (typically the rightmost column).
 */
export function extractNumber(
  lines: string[],
  pattern: RegExp | string
): number | null {
  const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern
  for (const line of lines) {
    if (regex.test(line)) {
      const numbers = extractNumbersFromLine(line)
      if (numbers.length > 0) {
        return numbers[numbers.length - 1]
      }
    }
  }
  return null
}

/**
 * Extract the FIRST number from lines matching a pattern.
 */
export function extractFirstNumber(
  lines: string[],
  pattern: RegExp | string
): number | null {
  const regex = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern
  for (const line of lines) {
    if (regex.test(line)) {
      const numbers = extractNumbersFromLine(line)
      if (numbers.length > 0) {
        return numbers[0]
      }
    }
  }
  return null
}

/**
 * Extract text lines from a PDF using pdfjs-dist.
 */
export async function extractTextFromPDF(file: File): Promise<string[]> {
  const pdfjsLib = await import("pdfjs-dist")

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString()

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const allLines: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()

    const lineMap = new Map<number, { x: number; str: string }[]>()
    for (const item of textContent.items) {
      if (!("str" in item)) continue
      const y = Math.round(item.transform[5])
      const x = item.transform[4]
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y)!.push({ x, str: item.str })
    }

    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a)
    for (const y of sortedYs) {
      const items = lineMap.get(y)!.sort((a, b) => a.x - b.x)
      let line = ""
      for (let j = 0; j < items.length; j++) {
        if (j > 0) {
          const gap = items[j].x - (items[j - 1].x + items[j - 1].str.length * 4)
          line += gap > 20 ? "  " : " "
        }
        line += items[j].str
      }
      if (line.trim()) {
        allLines.push(line.trim())
      }
    }
  }

  return allLines
}
