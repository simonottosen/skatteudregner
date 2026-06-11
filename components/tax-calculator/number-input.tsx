"use client"

import { useId } from "react"
import { TextInput } from "@carbon/react"
import { cn } from "@/lib/utils"

interface NumberInputProps {
  label: string
  value: number
  onChange: (value: number) => void
  suffix?: string
  max?: number
  className?: string
  hint?: string
  negative?: boolean
}

export function NumberInput({
  label,
  value,
  onChange,
  suffix = "kr.",
  max,
  className,
  hint,
  negative,
}: NumberInputProps) {
  const id = useId()
  const labelText = hint ? `${label} (${hint})` : label

  return (
    <div className={cn("relative", className)}>
      <TextInput
        id={id}
        type="number"
        size="md"
        labelText={labelText}
        value={String(value)}
        min={negative ? undefined : 0}
        max={max}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === "") {
            onChange(0)
            return
          }
          let num = parseFloat(raw)
          if (isNaN(num)) num = 0
          if (!negative && num < 0) num = 0
          if (max !== undefined && num > max) num = max
          onChange(Math.round(num))
        }}
      />
      {suffix && (
        <span className="text-muted-foreground pointer-events-none absolute right-3 bottom-0 flex h-10 items-center text-sm">
          {suffix}
        </span>
      )}
    </div>
  )
}
