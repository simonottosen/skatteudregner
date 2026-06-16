"use client"

import dynamic from "next/dynamic"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Button,
  InlineNotification,
  ContentSwitcher,
  Switch,
  Accordion,
  AccordionItem,
  TextArea,
  CopyButton,
  Modal,
  NumberInput,
} from "@carbon/react"
import { Calculator, Wallet, Edit } from "@carbon/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useTax } from "@/components/tax-provider"
import { useBudget } from "@/components/budget-provider"
import { UNCATEGORIZED_ID } from "@/lib/budget/categories"
import { comparePeers } from "@/lib/budget/peer-benchmark"
import type { BudgetAssumptions } from "@/hooks/use-budget"
import { formatDKK, formatPercent } from "@/lib/format"
import { buildEconomyPrompt } from "@/lib/result/economy-prompt"
import type { Slice, SankeyData, SliceDetails } from "./result-charts"

function AssumptionsModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  initial: BudgetAssumptions
  onClose: () => void
  onSave: (a: BudgetAssumptions) => void
}) {
  const [adults, setAdults] = useState(initial.adults)
  const [children, setChildren] = useState(initial.children)
  const [cars, setCars] = useState(initial.cars)

  // Re-seed from the current assumptions whenever the modal is opened.
  useEffect(() => {
    if (open) {
      setAdults(initial.adults)
      setChildren(initial.children)
      setCars(initial.cars)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const num = (
    value: number | string,
    fallback: number,
    min: number,
    max: number
  ) => {
    const n = typeof value === "number" ? value : parseInt(value, 10)
    return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n))
  }

  return (
    <Modal
      open={open}
      modalHeading="Antagelser om husstanden"
      modalLabel="Sammenligningsgrundlag"
      primaryButtonText="Gem"
      secondaryButtonText="Annullér"
      onRequestClose={onClose}
      onRequestSubmit={() => {
        onSave({ adults, children, cars })
        onClose()
      }}
    >
      <p className="text-muted-foreground mb-4 text-sm">
        Vi sammenligner dit forbrug med en typisk dansk husstand af samme
        størrelse. Justér antagelserne, så de passer til din husstand.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NumberInput
          id="assume-adults"
          label="Voksne"
          min={1}
          max={2}
          value={adults}
          onChange={(_e, { value }) => setAdults(num(value, 2, 1, 2))}
        />
        <NumberInput
          id="assume-children"
          label="Hjemmeboende børn"
          min={0}
          max={10}
          value={children}
          onChange={(_e, { value }) => setChildren(num(value, 0, 0, 10))}
        />
        <NumberInput
          id="assume-cars"
          label="Antal biler"
          min={0}
          max={4}
          value={cars}
          onChange={(_e, { value }) => setCars(num(value, 0, 0, 4))}
        />
      </div>
    </Modal>
  )
}

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
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)
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

  // Per-category monthly totals + line items (unknown category → catch-all).
  const known = new Set(budget.state.categories.map((c) => c.id))
  const byCat = new Map<string, number>()
  const itemsByCat = new Map<string, { label: string; amount: number }[]>()
  for (const it of positiveExpenses) {
    const cid = known.has(it.categoryId) ? it.categoryId : UNCATEGORIZED_ID
    byCat.set(cid, (byCat.get(cid) ?? 0) + it.amount)
    const arr = itemsByCat.get(cid) ?? []
    arr.push({ label: it.label, amount: it.amount })
    itemsByCat.set(cid, arr)
  }
  const categoryTotals = budget.state.categories
    .map((c) => ({ id: c.id, name: c.name, value: byCat.get(c.id) ?? 0 }))
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

  // Line items per category (period-scaled), keyed by category name, for the
  // clickable donut detail panel.
  const categoryDetails: SliceDetails = {}
  for (const c of categoryTotals) {
    const items = itemsByCat.get(c.id) ?? []
    if (items.length > 0) {
      categoryDetails[c.name] = items
        .map((it) => ({
          label: it.label,
          value: Math.round(it.amount * mult),
        }))
        .sort((a, b) => b.value - a.value)
    }
  }

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

  // Period-independent prompt the user can paste into an external LLM.
  const promptPeople = (
    twoPeople
      ? [
          { cfg: budget.state.person1, income: budget.p1Income },
          { cfg: budget.state.person2, income: budget.p2Income },
        ]
      : [{ cfg: budget.state.person1, income: budget.p1Income }]
  ).map(({ cfg, income }) => ({
    name: cfg.name,
    monthlyNet: income,
    source: cfg.incomeSource,
  }))

  // Annual tax components (household), largest-relevant first, only > 0.
  const sumResults = (f: (r: (typeof results)[number]) => number) =>
    results.reduce((s, r) => s + f(r), 0)
  const taxBreakdown = hasTax
    ? [
        { label: "AM-bidrag", yearly: sumResults((r) => r.amBidragTotal) },
        { label: "Bundskat", yearly: sumResults((r) => r.bundSkat) },
        {
          label: "Topskat",
          yearly: sumResults((r) => r.topSkat + r.topTopSkat),
        },
        { label: "Kommuneskat", yearly: sumResults((r) => r.kommuneSkat) },
        { label: "Kirkeskat", yearly: sumResults((r) => r.kirkeSkat) },
        { label: "Aktieskat", yearly: sumResults((r) => r.totalStockTax) },
        { label: "Ejendomsskat", yearly: sumResults((r) => r.totalPropertyTax) },
      ]
        .map((t) => ({ label: t.label, yearly: Math.round(t.yearly) }))
        .filter((t) => t.yearly > 0)
    : undefined

  const economyPrompt = buildEconomyPrompt({
    mode,
    people: promptPeople,
    hasTax,
    grossMonthly,
    taxMonthly,
    effectiveRate,
    budgetIncomeMonthly: budgetIncome,
    budgetExpensesMonthly: budgetExpenses,
    remainingMonthly: remaining,
    savingsRate,
    taxBreakdown,
    categories: [...categoryTotals]
      .sort((a, b) => b.value - a.value)
      .map((c) => ({
        name: c.name,
        monthly: c.value,
        items: (itemsByCat.get(c.id) ?? [])
          .map((it) => ({ label: it.label, monthly: it.amount }))
          .sort((a, b) => b.monthly - a.monthly),
      })),
  })

  const copyPrompt = () => {
    navigator.clipboard?.writeText(economyPrompt).catch(() => {})
  }

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

  // Peer comparison — where the user spends notably more/less than a typical
  // household of the assumed composition.
  const assumptions = budget.state.assumptions
  const catNameById = new Map(budget.state.categories.map((c) => [c.id, c.name]))
  const peerInsights = comparePeers(assumptions, byCat)
    .slice(0, 3)
    .map((c) => {
      const name = catNameById.get(c.categoryId) ?? c.categoryId
      const deviation = formatPercent(Math.abs(c.ratio - 1))
      return {
        tone: c.direction === "more" ? ("warning" as const) : ("info" as const),
        text:
          c.direction === "more"
            ? `Du bruger ${deviation} mere på ${name} end en typisk husstand (${fmt(c.userMonthly)} mod ${fmt(c.peerMonthly)} ${word}).`
            : `Du bruger ${deviation} mindre på ${name} end en typisk husstand (${fmt(c.userMonthly)} mod ${fmt(c.peerMonthly)} ${word}).`,
      }
    })

  const assumptionSummary = `${assumptions.adults} ${
    assumptions.adults === 1 ? "voksen" : "voksne"
  }, ${assumptions.children} ${
    assumptions.children === 1 ? "barn" : "børn"
  }, ${assumptions.cars} ${assumptions.cars === 1 ? "bil" : "biler"}`

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
                categoryDetails={categoryDetails}
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

                {positiveExpenses.length > 0 && (
                  <>
                    <Separator className="my-4" />
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">
                        Sammenlignet med en typisk husstand
                      </h3>
                      <Button
                        kind="ghost"
                        size="sm"
                        renderIcon={Edit}
                        onClick={() => setAssumptionsOpen(true)}
                      >
                        Opdatér antagelser
                      </Button>
                    </div>
                    <p className="text-muted-foreground mb-2 text-xs">
                      Grundlag: en dansk husstand med {assumptionSummary}.
                    </p>
                    {peerInsights.length > 0 ? (
                      <ul className="space-y-2">
                        {peerInsights.map((ins, i) => (
                          <li
                            key={i}
                            className={`text-sm ${
                              ins.tone === "warning" ? "text-warning" : ""
                            }`}
                          >
                            {ins.text}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm">
                        Dit forbrug ligner en typisk husstand på de fleste
                        områder.
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <AssumptionsModal
            open={assumptionsOpen}
            initial={assumptions}
            onClose={() => setAssumptionsOpen(false)}
            onSave={budget.setAssumptions}
          />

          {/* AI prompt */}
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Få AI-hjælp til din økonomi</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-3 text-sm">
                Kopiér en klar-til-brug prompt med dine tal, og indsæt den i din
                foretrukne AI-chat (fx ChatGPT, Claude eller Gemini) for at få
                personlig sparring om din økonomi. Ingen data forlader din
                browser, før du selv indsætter prompten.
              </p>
              <Accordion>
                <AccordionItem title="Vis og kopiér prompt">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">
                      Prompt ({economyPrompt.length} tegn)
                    </span>
                    <CopyButton
                      feedback="Kopieret!"
                      feedbackTimeout={2000}
                      iconDescription="Kopiér prompt til udklipsholder"
                      onClick={copyPrompt}
                    />
                  </div>
                  <TextArea
                    id="economy-prompt"
                    labelText="Prompt til AI"
                    hideLabel
                    readOnly
                    rows={14}
                    value={economyPrompt}
                  />
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>

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
