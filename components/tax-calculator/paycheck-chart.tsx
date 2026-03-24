"use client"

import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts"
import type { MonthlyComparisonPoint } from "@/lib/paycheck/types"
import { formatDKK } from "@/lib/format"

interface PaycheckChartProps {
  data: MonthlyComparisonPoint[]
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number | null; color: string }>
  label?: string
}) {
  if (!active || !payload) return null
  return (
    <div className="rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
      <p className="mb-1 text-xs font-medium">{label}</p>
      {payload.map(
        (entry, i) =>
          entry.value != null && (
            <p key={i} className="text-xs" style={{ color: entry.color }}>
              {entry.name}: {formatDKK(entry.value)}
            </p>
          )
      )}
    </div>
  )
}

export function PaycheckChart({ data }: PaycheckChartProps) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            className="fill-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) =>
              `${Math.round(v / 1000)}k`
            }
            className="fill-muted-foreground"
            width={50}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="expectedCumulative"
            name="Forventet skat"
            stroke="hsl(220, 70%, 55%)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="actualCumulative"
            name="Faktisk betalt"
            stroke="hsl(142, 60%, 45%)"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="projectedCumulative"
            name="Fremskrevet"
            stroke="hsl(30, 80%, 55%)"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
