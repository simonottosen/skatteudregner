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
  ReferenceDot,
  Legend,
} from "recharts"
import type {
  NewPlanningEvent,
  PlanningEvent,
  PlanningResult,
} from "@/lib/planning/types"
import {
  eventMarks,
  milestoneMarks,
  type MilestoneMetric,
  type WealthView,
} from "@/lib/planning/chart-marks"
import { formatCompactNumber, formatDKK } from "@/lib/format"

const GREEN = "#198038"
const GREEN_BAND = "rgba(25, 128, 56, 0.14)"
const BLUE = "#1192e8"
const TEAL = "#005d5d"
const PURPLE = "#8a3ffc"
const ORANGE = "#ff832b"
const GREY = "var(--cds-text-secondary, #6f6f6f)"

export type { WealthView }

/**
 * Per-metric styling for the milestone lines. Scenario counterparts are purple
 * to match the scenario curve.
 *
 * A contrasted pair is separated *vertically* (`scenarioDy`), never by leaning
 * the two labels to opposite sides of their lines: the sides anchor text toward
 * the line rather than away from it, so two nearby ages overlap into unreadable
 * mush. A scenario can also move a milestone in either direction, so no
 * horizontal arrangement is safe. One text line of offset always is.
 */
const MILESTONE_STYLE: Record<
  MilestoneMetric,
  {
    color: string
    dash: string
    base: LabelPosition
    scenario: LabelPosition
    scenarioDy: number
  }
> = {
  fi: {
    color: GREEN,
    dash: "4 4",
    base: "top",
    scenario: "insideTop",
    scenarioDy: 0,
  },
  debtFree: {
    color: BLUE,
    dash: "2 3",
    base: "insideTopRight",
    scenario: "insideTopRight",
    scenarioDy: 13,
  },
  retirement: {
    color: GREY,
    dash: "4 4",
    base: "insideBottomRight",
    scenario: "insideBottomRight",
    scenarioDy: -13,
  },
}

type LabelPosition = "top" | "insideTop" | "insideTopRight" | "insideBottomRight"

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
  /** The active scenario's curve, if one is being compared. Undefined when the
   * scenario's horizon doesn't reach this age, which `connectNulls` handles. */
  scenarioNetWorth?: number
  scenarioInvestments?: number
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
    (p) =>
      p.dataKey !== "band" &&
      p.dataKey !== "investmentsBand" &&
      // The scenario series is undefined past its own horizon.
      p.value != null
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
      {row.scenarioNetWorth != null && (
        <p className="text-muted-foreground pl-2 text-[11px]">
          Forskel: {signed(row.scenarioNetWorth - row.netWorth)}
        </p>
      )}
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
  scenarioName,
}: {
  active?: boolean
  payload?: TooltipEntry[]
  label?: number
  realSuffix?: string
  yearFor?: (age: number) => number
  scenarioName?: string
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
      {row.scenarioInvestments != null && (
        <>
          <p className="mt-1 text-xs font-medium" style={{ color: PURPLE }}>
            {scenarioName ?? "Scenarie"}: {formatDKK(row.scenarioInvestments)}
          </p>
          <p className="text-muted-foreground pl-2 text-[11px]">
            Forskel: {signed(row.scenarioInvestments - row.investments)}
          </p>
        </>
      )}
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
  scenarioResult,
  scenarioName,
  events,
  scenarioEvents,
  view,
  retirementAge,
  scenarioRetirementAge,
  real,
  currentAge,
  currentYear,
}: {
  result: PlanningResult
  /** The active scenario, drawn as a dashed comparison curve. */
  scenarioResult?: PlanningResult | null
  scenarioName?: string
  /** One-off events, marked on the curve so they can be read off the chart. */
  events?: PlanningEvent[]
  /** Events the scenario adds on top of the base plan, marked on its curve. */
  scenarioEvents?: NewPlanningEvent[]
  view: WealthView
  retirementAge: number
  /** The scenario's retirement age, which it may override. */
  scenarioRetirementAge?: number
  /** When true the values are already in today's kroner. */
  real?: boolean
  /** For mapping chart ages to calendar years. */
  currentAge: number
  currentYear: number
}) {
  // Joined on age rather than by index: a scenario can end at a different age,
  // and Recharts needs both series on one row to share the x-axis.
  const scenarioByAge = new Map(
    (scenarioResult?.points ?? []).map((p) => [p.age, p])
  )
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
    scenarioNetWorth: scenarioByAge.get(p.age)?.netWorth,
    scenarioInvestments: scenarioByAge.get(p.age)?.investments,
  }))

  const realSuffix = real ? " · nutidskroner" : ""
  const yearFor = (age: number) => currentYear + (age - currentAge)
  const scenarioLabel = scenarioName ? `${scenarioName} (scenarie)` : "Scenarie"

  const marks = eventMarks(data, view, events ?? [], scenarioEvents ?? [])
  const milestones = milestoneMarks(
    result,
    retirementAge,
    scenarioResult,
    scenarioRetirementAge
  )

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
                <DetailedTooltip
                  realSuffix={realSuffix}
                  yearFor={yearFor}
                  scenarioName={scenarioName}
                />
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
              {scenarioResult && (
                <Line
                  type="monotone"
                  dataKey="scenarioNetWorth"
                  name={scenarioLabel}
                  stroke={PURPLE}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
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
              {scenarioResult && (
                <Line
                  type="monotone"
                  dataKey="scenarioInvestments"
                  name={scenarioLabel}
                  stroke={PURPLE}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </>
          )}

          {milestones.map((m) => {
            const style = MILESTONE_STYLE[m.metric]
            const scenario = m.origin === "scenario"
            const color = scenario ? PURPLE : style.color
            return (
              <ReferenceLine
                key={m.key}
                x={m.age}
                stroke={color}
                strokeDasharray={scenario ? "5 4" : style.dash}
                label={{
                  value: m.label,
                  position: scenario ? style.scenario : style.base,
                  dy: scenario ? style.scenarioDy : 0,
                  fontSize: 11,
                  fill: color,
                }}
              />
            )
          })}

          {marks.map((m) => {
            const color = m.origin === "scenario" ? PURPLE : ORANGE
            return (
              <ReferenceDot
                key={m.key}
                x={m.age}
                y={m.y}
                r={4}
                fill={color}
                stroke="var(--cds-layer, #ffffff)"
                strokeWidth={1.5}
                label={{
                  value: m.label,
                  position: "top",
                  // Clears the curve the dot sits on, which is often steep here.
                  offset: 10,
                  fontSize: 10,
                  fill: color,
                }}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
