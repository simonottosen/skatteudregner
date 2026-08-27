"use client"

import { TextInput } from "@carbon/react"

/**
 * Carbon's `NumberInput` reports an empty or half-typed field as a string, so
 * every caller needs the same reading of it: the number if there is one, and the
 * value already held if there is not — never NaN, which would reach the state.
 */
export function num(value: number | string, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(value)
  return Number.isNaN(n) ? fallback : n
}

/** Group whole kroner with Danish thousand separators: 2000000 → "2.000.000". */
function group(n: number): string {
  if (!Number.isFinite(n) || n === 0) return n === 0 ? "0" : ""
  const sign = n < 0 ? "-" : ""
  return (
    sign +
    Math.abs(Math.round(n))
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  )
}

/**
 * A money field that shows large amounts with thousand separators (e.g.
 * "2.000.000 kr.") so they're easy to read and verify, while reporting a plain
 * number to the caller.
 */
export function MoneyInput({
  id,
  label,
  value,
  onChange,
  allowNegative = false,
}: {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
  allowNegative?: boolean
}) {
  return (
    <div className="relative">
      <TextInput
        id={id}
        labelText={label}
        inputMode={allowNegative ? "text" : "numeric"}
        value={group(value)}
        onChange={(e) => {
          const raw = e.target.value
          const negative = allowNegative && raw.trim().startsWith("-")
          const digits = raw.replace(/\D/g, "")
          const n = digits ? parseInt(digits, 10) : 0
          onChange(negative ? -n : n)
        }}
      />
      <span className="text-muted-foreground pointer-events-none absolute right-3 bottom-0 flex h-10 items-center text-sm">
        kr.
      </span>
    </div>
  )
}
