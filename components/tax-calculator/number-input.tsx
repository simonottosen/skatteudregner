"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  const displayValue = String(value)

  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs">
        {label}
        {hint && (
          <span className="text-muted-foreground ml-1 font-normal">
            ({hint})
          </span>
        )}
      </Label>
      <div className="relative">
        <Input
          type="number"
          value={displayValue}
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
          className="pr-10 text-right"
          min={negative ? undefined : 0}
          max={max}
        />
        {suffix && (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
            {suffix}
          </span>
        )}
      </div>
    </div>
  )
}
