"use client"

import { useState } from "react"
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Sankey,
  Layer,
  Rectangle,
} from "recharts"
import { ContentSwitcher, Switch } from "@carbon/react"
import { formatDKK, formatPercent } from "@/lib/format"

export interface Slice {
  name: string
  value: number
}

/** Sub-items shown when a donut slice is selected, keyed by slice name. */
export type SliceDetails = Record<string, { label: string; value: number }[]>

export interface SankeyData {
  nodes: { name: string }[]
  links: { source: number; target: number; value: number }[]
}

// Carbon categorical data-vis palette.
const PALETTE = [
  "#6929c4",
  "#1192e8",
  "#005d5d",
  "#9f1853",
  "#fa4d56",
  "#570408",
  "#198038",
  "#002d9c",
  "#ee538b",
  "#b28600",
  "#009d9a",
  "#a56eff",
]

interface TooltipEntry {
  name: string
  value: number
  color?: string
  fill?: string
  payload?: { fill?: string }
}

function ChartTooltip({
  active,
  payload,
  unitSuffix = "",
}: {
  active?: boolean
  payload?: TooltipEntry[]
  unitSuffix?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const entry = payload[0]
  const color = entry.color ?? entry.payload?.fill ?? entry.fill
  return (
    <div className="rounded-md border bg-popover p-2 text-popover-foreground shadow-md">
      <p className="text-xs font-medium" style={{ color }}>
        {entry.name}
      </p>
      <p className="text-xs">
        {formatDKK(entry.value)}
        {unitSuffix}
      </p>
    </div>
  )
}

function Donut({
  data,
  colors,
  unitSuffix,
  details,
}: {
  data: Slice[]
  colors: string[]
  unitSuffix: string
  details?: SliceDetails
}) {
  const [active, setActive] = useState(0)
  const total = data.reduce((s, d) => s + d.value, 0)
  const activeIdx = active < data.length ? active : 0
  const sel = data[activeIdx]
  const selColor = colors[activeIdx % colors.length]
  const subItems = sel ? (details?.[sel.name] ?? []) : []

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      {/* Donut + detail for the currently selected slice */}
      <div className="w-full sm:w-1/2">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={52}
                outerRadius={82}
                paddingAngle={2}
                strokeWidth={0}
                onClick={(_, i) => setActive(i)}
              >
                {data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={colors[i % colors.length]}
                    stroke="var(--cds-layer-01, #f4f4f4)"
                    strokeWidth={i === activeIdx ? 3 : 0}
                    opacity={i === activeIdx ? 1 : 0.78}
                    style={{ cursor: "pointer", outline: "none" }}
                  />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip unitSuffix={unitSuffix} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {sel && (
          <div className="mt-3 min-h-[9rem] rounded border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: selColor }}
                />
                <span className="truncate text-sm font-medium">{sel.name}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
                {formatDKK(sel.value)}
                {unitSuffix}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {total > 0 ? formatPercent(sel.value / total) : "–"} af din
              indkomst
            </p>
            {subItems.length > 0 && (
              <ul className="mt-2 space-y-1 border-t pt-2">
                {subItems.map((it, j) => (
                  <li
                    key={j}
                    className="flex items-baseline justify-between gap-2 text-xs"
                  >
                    <span className="truncate">
                      {it.label || "(uden navn)"}
                    </span>
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                      {formatDKK(it.value)}
                      {unitSuffix}
                      {sel.value > 0 && ` · ${formatPercent(it.value / sel.value)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Static legend — clicking a row only swaps the detail above, so the
          rows themselves never move. */}
      <ul className="w-full space-y-1 sm:w-1/2">
        {data.map((d, i) => {
          const isActive = i === activeIdx
          return (
            <li key={d.name}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={isActive}
                className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                  isActive
                    ? "bg-muted font-medium ring-1 ring-[var(--cds-border-interactive)]"
                    : "hover:bg-muted/50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: colors[i % colors.length] }}
                  />
                  <span className="truncate">{d.name}</span>
                </span>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                  {formatDKK(d.value)}
                  {unitSuffix}
                  {total > 0 && ` · ${formatPercent(d.value / total)}`}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CategoryBars({
  data,
  unitSuffix,
}: {
  data: Slice[]
  unitSuffix: string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={d.name}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-foreground">{d.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {formatDKK(d.value)}
              {unitSuffix}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded"
              style={{
                width: `${(d.value / max) * 100}%`,
                backgroundColor: PALETTE[i % PALETTE.length],
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Custom Sankey node: a coloured bar with a name + amount label. */
function FlowNode({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  index = 0,
  payload,
  sourceIndices = [],
  unitSuffix = "",
}: {
  x?: number
  y?: number
  width?: number
  height?: number
  index?: number
  payload?: { name: string; value: number }
  /** Indices of left-hand source nodes (never a link target). */
  sourceIndices?: number[]
  unitSuffix?: string
}) {
  if (!payload) return null
  const color = PALETTE[index % PALETTE.length]
  // Source nodes (never a link target) sit on the left → label to their right;
  // every other node labels to its left, so text stays inside the chart.
  const isSource = sourceIndices.includes(index)
  const labelX = isSource ? x + width + 8 : x - 8
  const anchor = isSource ? "start" : "end"
  return (
    <Layer key={`flow-node-${index}`}>
      <Rectangle
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        fillOpacity={0.95}
      />
      <text
        x={labelX}
        y={y + height / 2 - 4}
        textAnchor={anchor}
        className="fill-foreground"
        fontSize={11}
        fontWeight={500}
        stroke="var(--cds-layer-01, #f4f4f4)"
        strokeWidth={3}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {payload.name}
      </text>
      <text
        x={labelX}
        y={y + height / 2 + 10}
        textAnchor={anchor}
        className="fill-muted-foreground"
        fontSize={10}
        stroke="var(--cds-layer-01, #f4f4f4)"
        strokeWidth={3}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {formatDKK(payload.value)}
        {unitSuffix}
      </text>
    </Layer>
  )
}

function FlowChart({
  data,
  unitSuffix,
}: {
  data: SankeyData
  unitSuffix: string
}) {
  // Left-hand source nodes are those that never appear as a link target.
  const targets = new Set(data.links.map((l) => l.target))
  const sourceIndices = data.nodes
    .map((_, i) => i)
    .filter((i) => !targets.has(i))

  return (
    <div className="h-[380px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={data}
          nodeWidth={12}
          nodePadding={28}
          linkCurvature={0.5}
          iterations={64}
          margin={{ left: 8, right: 8, top: 16, bottom: 16 }}
          node={
            <FlowNode unitSuffix={unitSuffix} sourceIndices={sourceIndices} />
          }
          link={{ stroke: "#a56eff", strokeOpacity: 0.4 }}
        >
          <Tooltip
            formatter={(value) => `${formatDKK(Number(value))}${unitSuffix}`}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  )
}

type ChartView = "donut" | "bars" | "flow"
const VIEWS: ChartView[] = ["donut", "bars", "flow"]

export function ResultCharts({
  taxSplit,
  categorySplit,
  categoryBars,
  categoryDetails,
  sankey,
  unitSuffix,
}: {
  taxSplit: Slice[] | null
  categorySplit: Slice[]
  categoryBars: Slice[]
  categoryDetails?: SliceDetails
  sankey: SankeyData | null
  unitSuffix: string
}) {
  const [view, setView] = useState<ChartView>("donut")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Sådan bruges din indkomst</h3>
        <div className="w-72 max-w-full">
          <ContentSwitcher
            size="sm"
            selectedIndex={VIEWS.indexOf(view)}
            onChange={({ index }) => setView(VIEWS[index ?? 0])}
          >
            <Switch name="donut" text="Cirkel" />
            <Switch name="bars" text="Søjler" />
            <Switch name="flow" text="Flow" />
          </ContentSwitcher>
        </div>
      </div>

      {view === "donut" && (
        <div className="space-y-8">
          {taxSplit && (
            <div>
              <h4 className="text-muted-foreground mb-2 text-xs font-medium">
                Skat vs. nettoindkomst
              </h4>
              <Donut
                data={taxSplit}
                colors={["#fa4d56", "#24a148"]}
                unitSuffix={unitSuffix}
              />
            </div>
          )}
          <div>
            <h4 className="text-muted-foreground mb-2 text-xs font-medium">
              Fordeling pr. kategori — klik for detaljer
            </h4>
            <Donut
              data={categorySplit}
              colors={categorySplit.map((s, i) =>
                s.name.startsWith("Til rådighed")
                  ? "#24a148"
                  : PALETTE[i % PALETTE.length]
              )}
              unitSuffix={unitSuffix}
              details={categoryDetails}
            />
          </div>
        </div>
      )}

      {view === "bars" &&
        (categoryBars.length > 0 ? (
          <CategoryBars data={categoryBars} unitSuffix={unitSuffix} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Tilføj udgifter i budgettet for at se forbrug pr. kategori.
          </p>
        ))}

      {view === "flow" &&
        (sankey && sankey.links.length > 0 ? (
          <FlowChart data={sankey} unitSuffix={unitSuffix} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Tilføj indkomst og udgifter for at se pengestrømmen.
          </p>
        ))}
    </div>
  )
}
