"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Button,
  InlineNotification,
  ContentSwitcher,
  Switch,
} from "@carbon/react"
import { Calculator, Wallet } from "@carbon/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useTax } from "@/components/tax-provider"
import { useBudget } from "@/components/budget-provider"
import { UNCATEGORIZED_ID } from "@/lib/budget/categories"
import { formatDKK, formatPercent } from "@/lib/format"
import type { Slice, SankeyData } from "./result-charts"

const ResultCharts = dynamic(
  () => import("./result-charts").then((m) => m.ResultCharts),
  { ssr: false, loading: () => <div className="h-64 w-full" /> }
)

function Figure({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "income" | "remaining-pos" | "remaining-neg"
}) {
  const cls =
    tone === "income"
      ? "text-link"
      : tone === "remaining-pos"
        ? "text-success"
        : tone === "remaining-neg"
          ? "text-error"
          : ""
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`text-xl font-bold ${cls}`}>{value}</p>
    </div>
  )
}

export function ResultOverview() {
  const router = useRouter()
  const { results } = useTax()
  const budget = useBudget()

  const [period, setPeriod] = useState<"month" | "year">("month")
  const mult = period === "year" ? 12 : 1
  const unitSuffix = period === "year" ? "/år" : "/md."
  const word = period === "year" ? "om året" : "om måneden"
  const fmt = (n: number) => formatDKK(n * mult)

  const mode = budget.state.mode
  const twoPeople = mode !== "single"

  // Budget side — monthly base figures (may come from skat or manual income).
  const budgetIncome = twoPeople
    ? budget.p1Income + budget.p2Income
    : budget.p1Income
  const budgetExpenses =
    mode === "separate" ? budget.p1Total + budget.p2Total : budget.sharedTotal
  const remaining = budgetIncome - budgetExpenses
  const savingsRate = budgetIncome > 0 ? remaining / budgetIncome : 0

  // Tax side (household, annual → monthly base).
  const grossYear = results.reduce(
    (s, r) => s + r.amBasis + r.insuranceBasis + r.nonAmIncome,
    0
  )
  const taxYear = results.reduce((s, r) => s + r.totalTax, 0)
  const netYear = results.reduce((s, r) => s + r.netIncome, 0)
  const hasTax = grossYear > 0
  const effectiveRate = grossYear > 0 ? taxYear / grossYear : 0
  const taxMonthly = taxYear / 12
  const grossMonthly = grossYear / 12

  const expenseItems =
    mode === "separate"
      ? [...budget.state.person1.items, ...budget.state.person2.items]
      : budget.state.sharedItems
  const positiveExpenses = expenseItems.filter((i) => i.amount > 0)

  // Per-category monthly totals (unknown category → catch-all).
  const known = new Set(budget.state.categories.map((c) => c.id))
  const byCat = new Map<string, number>()
  for (const it of positiveExpenses) {
    const cid = known.has(it.categoryId) ? it.categoryId : UNCATEGORIZED_ID
    byCat.set(cid, (byCat.get(cid) ?? 0) + it.amount)
  }
  const categoryTotals = budget.state.categories
    .map((c) => ({ name: c.name, value: byCat.get(c.id) ?? 0 }))
    .filter((c) => c.value > 0)

  const taxSplit: Slice[] | null = hasTax
    ? [
        { name: "Skat & AM-bidrag", value: Math.round(taxMonthly * mult) },
        { name: "Nettoindkomst", value: Math.round((netYear / 12) * mult) },
      ]
    : null

  const categorySplit: Slice[] = [
    ...categoryTotals.map((c) => ({
      name: c.name,
      value: Math.round(c.value * mult),
    })),
    ...(remaining > 0
      ? [{ name: "Til rådighed / opsparing", value: Math.round(remaining * mult) }]
      : []),
  ]

  const categoryBars: Slice[] = [...categoryTotals]
    .sort((a, b) => b.value - a.value)
    .map((c) => ({ name: c.name, value: Math.round(c.value * mult) }))

  // Sankey flow: (brutto → skat + netto →) categories + til rådighed.
  const sankey: SankeyData | null = (() => {
    const allocations = categorySplit.filter((s) => s.value > 0)
    if (allocations.length === 0) return null
    const nodes: { name: string }[] = []
    const links: { source: number; target: number; value: number }[] = []
    const addNode = (name: string) => nodes.push({ name }) - 1

    if (hasTax) {
      const gross = Math.round(grossMonthly * mult)
      const tax = Math.round(taxMonthly * mult)
      const net = Math.max(0, gross - tax)
      const grossIdx = addNode(
        twoPeople ? "Husstandens bruttoindkomst" : "Bruttoindkomst"
      )
      const taxIdx = addNode("Skat & AM-bidrag")
      const netIdx = addNode("Nettoindkomst")
      if (tax > 0) links.push({ source: grossIdx, target: taxIdx, value: tax })
      links.push({ source: grossIdx, target: netIdx, value: net })
      const base = nodes.length
      allocations.forEach((a) => addNode(a.name))
      allocations.forEach((a, i) =>
        links.push({ source: netIdx, target: base + i, value: a.value })
      )
    } else {
      const incomeIdx = addNode("Nettoindkomst")
      const base = nodes.length
      allocations.forEach((a) => addNode(a.name))
      allocations.forEach((a, i) =>
        links.push({ source: incomeIdx, target: base + i, value: a.value })
      )
    }
    return { nodes, links }
  })()

  const nothingYet =
    !hasTax && budgetIncome <= 0 && positiveExpenses.length === 0

  // Insights (scaled to the selected period)
  const insights: { tone: "info" | "success" | "warning"; text: string }[] = []
  if (budgetIncome > 0) {
    insights.push(
      remaining >= 0
        ? {
            tone: "success",
            text: `Du har ca. ${fmt(remaining)} tilbage ${word} — det er ${formatPercent(savingsRate)} af din indkomst.`,
          }
        : {
            tone: "warning",
            text: `Dit budget er i underskud med ${fmt(-remaining)} ${word}. Skær ned på udgifter eller justér din indkomst.`,
          }
    )
  }
  if (categoryTotals.length > 0) {
    const biggest = categoryTotals.reduce((a, b) =>
      b.value > a.value ? b : a
    )
    const share = budgetExpenses > 0 ? biggest.value / budgetExpenses : 0
    insights.push({
      tone: "info",
      text: `Din største kategori er “${biggest.name}”: ${fmt(biggest.value)} ${word} (${formatPercent(share)} af dine udgifter).`,
    })
  }
  if (hasTax) {
    insights.push({
      tone: "info",
      text: `Du betaler ${formatPercent(effectiveRate)} af din bruttoindkomst i skat og AM-bidrag og beholder ${fmt(netYear / 12)} ${word} som nettoløn.`,
    })
  } else if (budgetIncome > 0) {
    insights.push({
      tone: "info",
      text: "Du har ikke beregnet din skat — budgettet bruger en manuelt indtastet nettoløn. Beregn skat for et fuldt overblik.",
    })
  }

  return (
    <main
      style={{
        maxWidth: "1000px",
        margin: "0 auto",
        padding: "2rem 1.5rem 4rem",
      }}
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <header className="border-l-4 border-[var(--cds-border-interactive)] pl-3">
          <h1 className="text-2xl font-semibold tracking-tight">Resultat</h1>
          <p className="text-muted-foreground text-sm">
            Samlet overblik og indsigt på tværs af skat og budget.
          </p>
        </header>
        {!nothingYet && (
          <div className="w-56 max-w-full">
            <ContentSwitcher
              selectedIndex={period === "year" ? 1 : 0}
              onChange={({ index }) =>
                setPeriod(index === 1 ? "year" : "month")
              }
            >
              <Switch name="month" text="Måned" />
              <Switch name="year" text="År" />
            </ContentSwitcher>
          </div>
        )}
      </div>

      {nothingYet ? (
        <div className="space-y-4">
          <InlineNotification
            className="max-w-full"
            kind="info"
            lowContrast
            hideCloseButton
            title="Ingen data endnu"
            subtitle="Beregn din skat og/eller udfyld dit budget for at se dit samlede resultat."
          />
          <div className="flex flex-wrap gap-3">
            <Button
              kind="tertiary"
              renderIcon={Calculator}
              onClick={() => router.push("/skat")}
            >
              Beregn skat
            </Button>
            <Button
              kind="tertiary"
              renderIcon={Wallet}
              onClick={() => router.push("/budget")}
            >
              Udfyld budget
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <Card className="mb-6 border-t-4 border-[var(--cds-border-interactive)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                Nøgletal pr. {period === "year" ? "år" : "måned"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Figure
                  label="Nettoindkomst"
                  value={fmt(budgetIncome)}
                  tone="income"
                />
                <Figure label="Udgifter" value={fmt(budgetExpenses)} />
                <Figure
                  label="Til rådighed"
                  value={fmt(remaining)}
                  tone={remaining < 0 ? "remaining-neg" : "remaining-pos"}
                />
                <Figure
                  label="Opsparingsrate"
                  value={budgetIncome > 0 ? formatPercent(savingsRate) : "–"}
                />
              </div>
              {hasTax && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <Figure
                      label="Effektiv skat"
                      value={formatPercent(effectiveRate)}
                    />
                    <Figure label={`Skat ${unitSuffix}`} value={fmt(taxMonthly)} />
                    <Figure
                      label={
                        twoPeople
                          ? `Husstandens bruttoløn ${unitSuffix}`
                          : `Bruttoløn ${unitSuffix}`
                      }
                      value={fmt(grossMonthly)}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Charts */}
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                Grafer ({period === "year" ? "pr. år" : "pr. måned"})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResultCharts
                taxSplit={taxSplit}
                categorySplit={categorySplit}
                categoryBars={categoryBars}
                sankey={sankey}
                unitSuffix={unitSuffix}
              />
            </CardContent>
          </Card>

          {/* Insights */}
          {insights.length > 0 && (
            <Card className="mb-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Indsigt</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {insights.map((ins, i) => (
                    <li
                      key={i}
                      className={`text-sm ${
                        ins.tone === "success"
                          ? "text-success"
                          : ins.tone === "warning"
                            ? "text-warning"
                            : ""
                      }`}
                    >
                      {ins.text}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Calculator}
              onClick={() => router.push("/skat")}
            >
              Justér skat
            </Button>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Wallet}
              onClick={() => router.push("/budget")}
            >
              Justér budget
            </Button>
          </div>
        </>
      )}
    </main>
  )
}
