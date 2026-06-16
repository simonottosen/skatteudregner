"use client"

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from "recharts"
import type { PlanningResult } from "@/lib/planning/types"
import { formatCompactDKK, formatCompactNumber, formatDKK } from "@/lib/format"

const GREEN = "#198038"
const GREEN_BAND = "rgba(25, 128, 56, 0.14)"
const BLUE = "#1192e8"

export type WealthView = "total" | "split"

interface ChartRow {
  age: number
  netWorth: number
  investments: number
  homeEquity: number
  band: [number, number]
}

function PlanningTooltip({
  active,
  payload,
  label,
  realSuffix,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>
  label?: number
  realSuffix?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  // Skip the band series in the tooltip (it's a range, not a point value).
  const rows = payload.filter((p) => p.dataKey !== "band")
  return (
    <div className="rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
      <p className="mb-1 text-xs font-medium">
        Alder {label}
        {realSuffix}
      </p>
      {rows.map((p, i) => (
        <p key={i} className="text-xs" style={{ color: p.color }}>
          {p.name}: {formatDKK(p.value)}
        </p>
      ))}
    </div>
  )
}

export function PlanningChart({
  result,
  view,
  goalAge,
  real,
}: {
  result: PlanningResult
  view: WealthView
  goalAge: number
  /** When true the values are already in today's kroner. */
  real?: boolean
}) {
  const data: ChartRow[] = result.points.map((p) => ({
    age: p.age,
    netWorth: p.netWorth,
    investments: p.investments,
    homeEquity: p.homeEquity,
    band: p.band,
  }))

  const realSuffix = real ? " · nutidskroner" : ""

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 16, right: 16, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="age"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `${v}`}
            className="fill-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => formatCompactNumber(v)}
            width={52}
            className="fill-muted-foreground"
          />
          <Tooltip content={<PlanningTooltip realSuffix={realSuffix} />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />

          {/* Confidence band (p10–p90 of total wealth). */}
          <Area
            type="monotone"
            dataKey="band"
            name="Usikkerhed (10–90 %)"
            stroke="none"
            fill={GREEN_BAND}
            isAnimationActive={false}
            connectNulls
            legendType="none"
            activeDot={false}
          />

          {view === "total" ? (
            <Area
              type="monotone"
              dataKey="netWorth"
              name="Formue (forventet)"
              stroke={GREEN}
              strokeWidth={2.5}
              fill={GREEN_BAND}
              dot={false}
              isAnimationActive={false}
            />
          ) : (
            <>
              <Line
                type="monotone"
                dataKey="investments"
                name="Investeringer"
                stroke={GREEN}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="homeEquity"
                name="Friværdi i bolig"
                stroke={BLUE}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            </>
          )}

          {result.fiAge != null && (
            <ReferenceLine
              x={result.fiAge}
              stroke={GREEN}
              strokeDasharray="4 4"
              label={{
                value: `Økonomisk fri · ${result.fiAge}`,
                position: "top",
                fontSize: 11,
                fill: GREEN,
              }}
            />
          )}
          <ReferenceLine
            x={goalAge}
            stroke="var(--cds-text-secondary, #6f6f6f)"
            strokeDasharray="4 4"
            label={{
              value: `Mål · ${goalAge}`,
              position: "insideBottomRight",
              fontSize: 11,
              fill: "var(--cds-text-secondary, #6f6f6f)",
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Small helper used by the overview for the callout above the chart. */
export function formatWealthCallout(value: number): string {
  return formatCompactDKK(value)
}
