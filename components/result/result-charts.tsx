"use client"

import { useState } from "react"
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  Sankey,
  Layer,
  Rectangle,
} from "recharts"
import { ContentSwitcher, Switch } from "@carbon/react"
import { formatDKK } from "@/lib/format"

export interface Slice {
  name: string
  value: number
}

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
}: {
  data: Slice[]
  colors: string[]
  unitSuffix: string
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip unitSuffix={unitSuffix} />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
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
  sankey,
  unitSuffix,
}: {
  taxSplit: Slice[] | null
  categorySplit: Slice[]
  categoryBars: Slice[]
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
        <div className="grid gap-6 md:grid-cols-2">
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
              Fordeling pr. kategori
            </h4>
            <Donut
              data={categorySplit}
              colors={categorySplit.map((s, i) =>
                s.name.startsWith("Til rådighed")
                  ? "#24a148"
                  : PALETTE[i % PALETTE.length]
              )}
              unitSuffix={unitSuffix}
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
