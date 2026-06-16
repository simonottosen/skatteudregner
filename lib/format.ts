export function formatDKK(amount: number): string {
  const rounded = Math.round(amount)
  const formatted = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return rounded < 0 ? `-${formatted} kr.` : `${formatted} kr.`
}

export function formatPercent(rate: number): string {
  return (rate * 100).toFixed(2).replace(".", ",") + "%"
}

/**
 * Compact DKK for large figures and chart labels, e.g. 13_970_000 → "13,97M kr.",
 * 850_000 → "850k kr.", 4_200 → "4.200 kr.". Falls back to {@link formatDKK} for
 * amounts below 10.000.
 */
export function formatCompactDKK(amount: number): string {
  const rounded = Math.round(amount)
  const abs = Math.abs(rounded)
  const sign = rounded < 0 ? "-" : ""
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(2).replace(".", ",")}M kr.`
  }
  if (abs >= 10_000) {
    return `${sign}${Math.round(abs / 1_000)}k kr.`
  }
  return formatDKK(rounded)
}

/** Compact number only (no "kr."), for chart axis ticks: 13_500_000 → "13,5M". */
export function formatCompactNumber(amount: number): string {
  const abs = Math.abs(Math.round(amount))
  const sign = amount < 0 ? "-" : ""
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000
    const text = m >= 10 ? m.toFixed(1) : m.toFixed(2)
    return `${sign}${text.replace(/[.,]?0+$/, "").replace(".", ",")}M`
  }
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`
  return `${sign}${abs}`
}

export function parseDKK(str: string): number {
  const cleaned = str.replace(/\s*kr\.?\s*$/i, "").trim()
  if (cleaned.includes(",")) {
    const [whole, decimal] = cleaned.split(",")
    return parseFloat(whole.replace(/\./g, "") + "." + decimal)
  }
  return parseInt(cleaned.replace(/\./g, ""), 10) || 0
}
