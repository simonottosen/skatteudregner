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

export function parseDKK(str: string): number {
  const cleaned = str.replace(/\s*kr\.?\s*$/i, "").trim()
  if (cleaned.includes(",")) {
    const [whole, decimal] = cleaned.split(",")
    return parseFloat(whole.replace(/\./g, "") + "." + decimal)
  }
  return parseInt(cleaned.replace(/\./g, ""), 10) || 0
}
