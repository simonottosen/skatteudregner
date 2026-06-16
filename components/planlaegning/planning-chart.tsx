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
import { formatCompactNumber, formatDKK } from "@/lib/format"

const GREEN = "#198038"
const GREEN_BAND = "rgba(25, 128, 56, 0.14)"
const BLUE = "#1192e8"
const TEAL = "#005d5d"

export type WealthView = "total" | "split" | "sources"

interface ChartRow {
  age: number
  netWorth: number
  investments: number
  homeEquity: number
  band: [number, number]
  contributionsTotal: number
  housingGainsTotal: number
  investmentGainsTotal: number
  contributionYoY: number
  housingGainYoY: number
  investmentGainYoY: number
}

interface TooltipEntry {
  name: string
  value: number
  color: string
  dataKey: string
  payload: ChartRow
}

function WealthTooltip({
  active,
  payload,
  label,
  realSuffix,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: number
  realSuffix?: string
}) {
  if (!active || !payload || payload.length === 0) return null
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

const SOURCE_ROWS: {
  key: "contributionsTotal" | "housingGainsTotal" | "investmentGainsTotal"
  yoy: "contributionYoY" | "housingGainYoY" | "investmentGainYoY"
  name: string
  color: string
}[] = [
  { key: "contributionsTotal", yoy: "contributionYoY", name: "Indbetalinger", color: BLUE },
  { key: "housingGainsTotal", yoy: "housingGainYoY", name: "Boliggevinst", color: TEAL },
  { key: "investmentGainsTotal", yoy: "investmentGainYoY", name: "Investeringsgevinst", color: GREEN },
]

function SourcesTooltip({
  active,
  payload,
  label,
  realSuffix,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: number
  realSuffix?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  return (
    <div className="rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
      <p className="mb-1 text-xs font-medium">
        Alder {label}
        {realSuffix}
      </p>
      {SOURCE_ROWS.map((s) => (
        <p key={s.key} className="text-xs" style={{ color: s.color }}>
          {s.name}: {formatDKK(row[s.key])}{" "}
          <span className="text-muted-foreground">
            (+{formatDKK(row[s.yoy])} i år)
          </span>
        </p>
      ))}
    </div>
  )
}

export function PlanningChart({
  result,
  view,
  retirementAge,
  real,
}: {
  result: PlanningResult
  view: WealthView
  retirementAge: number
  /** When true the values are already in today's kroner. */
  real?: boolean
}) {
  const data: ChartRow[] = result.points.map((p) => ({
    age: p.age,
    netWorth: p.netWorth,
    investments: p.investments,
    homeEquity: p.homeEquity,
    band: p.band,
    contributionsTotal: p.contributionsTotal,
    housingGainsTotal: p.housingGainsTotal,
    investmentGainsTotal: p.investmentGainsTotal,
    contributionYoY: p.contributionYoY,
    housingGainYoY: p.housingGainYoY,
    investmentGainYoY: p.investmentGainYoY,
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
          <Tooltip
            content={
              view === "sources" ? (
                <SourcesTooltip realSuffix={realSuffix} />
              ) : (
                <WealthTooltip realSuffix={realSuffix} />
              )
            }
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />

          {view === "total" && (
            <>
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
            </>
          )}

          {view === "split" && (
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

          {view === "sources" && (
            <>
              <Line
                type="monotone"
                dataKey="contributionsTotal"
                name="Indbetalinger"
                stroke={BLUE}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="housingGainsTotal"
                name="Boliggevinst"
                stroke={TEAL}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="investmentGainsTotal"
                name="Investeringsgevinst"
                stroke={GREEN}
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
            x={retirementAge}
            stroke="var(--cds-text-secondary, #6f6f6f)"
            strokeDasharray="4 4"
            label={{
              value: `Pension · ${retirementAge}`,
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
