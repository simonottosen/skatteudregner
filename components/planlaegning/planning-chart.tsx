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

export type WealthView = "total" | "detailed"

interface ChartRow {
  age: number
  netWorth: number
  investments: number
  homeEquity: number
  cash: number
  otherDebt: number
  band: [number, number]
  investmentsBand: [number, number]
  contributionYoY: number
  housingGainYoY: number
  investmentGainYoY: number
  retirementIncome: number
  taxPaid: number
  spending: number
  investmentsSold: number
  borrowed: number
  propertyTax: number
}

/** "1,2M kr. – 3,4M kr." percentile range. */
function pctRange(b: [number, number]): string {
  return `${formatDKK(b[0])} – ${formatDKK(b[1])}`
}

interface TooltipEntry {
  name: string
  value: number
  color: string
  dataKey: string
  payload: ChartRow
}

/** "+1.200 kr." / "−400.000 kr." with an explicit sign. */
function signed(n: number): string {
  return (n < 0 ? "−" : "+") + formatDKK(Math.abs(Math.round(n)))
}

function WealthTooltip({
  active,
  payload,
  label,
  realSuffix,
  yearFor,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: number
  realSuffix?: string
  yearFor?: (age: number) => number
}) {
  if (!active || !payload || payload.length === 0) return null
  const rows = payload.filter(
    (p) => p.dataKey !== "band" && p.dataKey !== "investmentsBand"
  )
  const row = payload[0].payload
  const year = yearFor && label != null ? ` · ${yearFor(label)}` : ""
  const hasNet = rows.some((r) => r.dataKey === "netWorth")
  const hasInv = rows.some((r) => r.dataKey === "investments")
  return (
    <div className="rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
      <p className="mb-1 text-xs font-medium">
        Alder {label}
        {year}
        {realSuffix}
      </p>
      {rows.map((p, i) => (
        <p key={i} className="text-xs" style={{ color: p.color }}>
          {p.name}: {formatDKK(p.value)}
        </p>
      ))}
      {hasNet && (
        <p className="text-muted-foreground mt-1 text-[11px]">
          10.–90. percentil: {pctRange(row.band)}
        </p>
      )}
      {hasInv && (
        <p className="text-muted-foreground mt-1 text-[11px]">
          Investeringer 10.–90. pct.: {pctRange(row.investmentsBand)}
        </p>
      )}
    </div>
  )
}

function DetailedTooltip({
  active,
  payload,
  label,
  realSuffix,
  yearFor,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: number
  realSuffix?: string
  yearFor?: (age: number) => number
}) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  const yr = yearFor && label != null ? yearFor(label) : null
  const inYear = yr != null ? `i ${yr}` : "i år"
  const year = yr != null ? ` · ${yr}` : ""
  return (
    <div className="rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
      <p className="mb-1 text-xs font-medium">
        Alder {label}
        {year}
        {realSuffix}
      </p>
      <p className="text-xs font-semibold">
        Samlet formue: {formatDKK(row.netWorth)}
      </p>
      <p className="text-muted-foreground pl-2 text-[11px]">
        10.–90. pct.: {pctRange(row.band)}
      </p>
      <p className="mt-1 text-xs font-medium" style={{ color: GREEN }}>
        Investeringer: {formatDKK(row.investments)}
      </p>
      <p className="text-muted-foreground pl-2 text-[11px]">
        10.–90. pct.: {pctRange(row.investmentsBand)}
      </p>
      <p className="text-muted-foreground pl-2 text-[11px]">
        Indbetalt: {signed(row.contributionYoY)} {inYear}
      </p>
      <p className="text-muted-foreground pl-2 text-[11px]">
        Investeringsgevinst: {signed(row.investmentGainYoY)} {inYear}
      </p>
      <p className="mt-1 text-xs font-medium" style={{ color: TEAL }}>
        Friværdi i bolig: {formatDKK(row.homeEquity)}
      </p>
      <p className="text-muted-foreground pl-2 text-[11px]">
        Boliggevinst: {signed(row.housingGainYoY)} {inYear}
      </p>
      {row.cash > 0 && (
        <p className="mt-1 text-xs font-medium">
          Kontant buffer: {formatDKK(row.cash)}
        </p>
      )}
      {row.otherDebt > 0 && (
        <p className="mt-1 text-xs font-medium" style={{ color: "#da1e28" }}>
          Anden gæld: {signed(-row.otherDebt)}
        </p>
      )}
      {(row.spending > 0 || row.retirementIncome > 0) && (
        <>
          <p className="mt-1 text-xs font-medium">Pension {inYear}</p>
          <p className="text-muted-foreground pl-2 text-[11px]">
            Pensionsudbetaling (e. skat): {formatDKK(row.retirementIncome)}
          </p>
          {row.spending > 0 && (
            <p className="text-muted-foreground pl-2 text-[11px]">
              Forbrug: {signed(-row.spending)}
            </p>
          )}
          {row.spending > 0 && (
            <p className="text-muted-foreground pl-2 text-[11px]">
              = Efter forbrug: {signed(row.retirementIncome - row.spending)}
            </p>
          )}
          {row.investmentsSold > 0 && (
            <p className="text-muted-foreground pl-2 text-[11px]">
              Solgt fra investeringer: {formatDKK(row.investmentsSold)}
            </p>
          )}
          {row.borrowed > 0 && (
            <p className="text-muted-foreground pl-2 text-[11px]">
              Lånt i friværdi: {formatDKK(row.borrowed)}
            </p>
          )}
          {row.propertyTax > 0 && (
            <p className="text-muted-foreground pl-2 text-[11px]">
              Ejendomsskat: {formatDKK(row.propertyTax)}
            </p>
          )}
        </>
      )}
      {row.taxPaid > 0 && (
        <p className="text-muted-foreground mt-1 text-[11px]">
          Skat betalt {inYear}: {formatDKK(row.taxPaid)}
        </p>
      )}
    </div>
  )
}

export function PlanningChart({
  result,
  view,
  retirementAge,
  real,
  currentAge,
  currentYear,
}: {
  result: PlanningResult
  view: WealthView
  retirementAge: number
  /** When true the values are already in today's kroner. */
  real?: boolean
  /** For mapping chart ages to calendar years. */
  currentAge: number
  currentYear: number
}) {
  const data: ChartRow[] = result.points.map((p) => ({
    age: p.age,
    netWorth: p.netWorth,
    investments: p.investments,
    homeEquity: p.homeEquity,
    cash: p.cash,
    otherDebt: p.otherDebt,
    band: p.band,
    investmentsBand: p.investmentsBand,
    contributionYoY: p.contributionYoY,
    housingGainYoY: p.housingGainYoY,
    investmentGainYoY: p.investmentGainYoY,
    retirementIncome: p.retirementIncome,
    taxPaid: p.taxPaid,
    spending: p.spending,
    investmentsSold: p.investmentsSold,
    borrowed: p.borrowed,
    propertyTax: p.propertyTax,
  }))

  const realSuffix = real ? " · nutidskroner" : ""
  const yearFor = (age: number) => currentYear + (age - currentAge)

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
              view === "detailed" ? (
                <DetailedTooltip realSuffix={realSuffix} yearFor={yearFor} />
              ) : (
                <WealthTooltip realSuffix={realSuffix} yearFor={yearFor} />
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

          {view === "detailed" && (
            <>
              <Area
                type="monotone"
                dataKey="investmentsBand"
                name="Usikkerhed, investeringer (10–90 %)"
                stroke="none"
                fill={GREEN_BAND}
                isAnimationActive={false}
                connectNulls
                legendType="none"
                activeDot={false}
              />
              <Line
                type="monotone"
                dataKey="investments"
                name="Investeringer (i alt)"
                stroke={GREEN}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="homeEquity"
                name="Friværdi i bolig"
                stroke={TEAL}
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
          {result.debtFreeAge != null && (
            <ReferenceLine
              x={result.debtFreeAge}
              stroke={BLUE}
              strokeDasharray="2 3"
              label={{
                value: `Gældfri · ${result.debtFreeAge}`,
                position: "insideTopRight",
                fontSize: 11,
                fill: BLUE,
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
