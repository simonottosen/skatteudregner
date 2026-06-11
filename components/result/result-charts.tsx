"use client"

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts"
import { formatDKK } from "@/lib/format"

export interface Slice {
  name: string
  value: number
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

export function ResultCharts({
  taxSplit,
  categorySplit,
  categoryBars,
  unitSuffix,
}: {
  taxSplit: Slice[] | null
  categorySplit: Slice[]
  categoryBars: Slice[]
  unitSuffix: string
}) {
  return (
    <div className="space-y-8">
      <div className="grid gap-6 md:grid-cols-2">
        {taxSplit && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Skat vs. nettoindkomst</h3>
            <Donut
              data={taxSplit}
              colors={["#fa4d56", "#24a148"]}
              unitSuffix={unitSuffix}
            />
          </div>
        )}
        <div>
          <h3 className="mb-2 text-sm font-medium">Sådan bruges din indkomst</h3>
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

      {categoryBars.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Forbrug pr. kategori</h3>
          <CategoryBars data={categoryBars} unitSuffix={unitSuffix} />
        </div>
      )}
    </div>
  )
}
