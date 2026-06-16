"use client"

import { useMemo, useState } from "react"
import {
  Button,
  NumberInput,
  ContentSwitcher,
  Switch,
  InlineNotification,
  Tag,
} from "@carbon/react"
import { Add, Edit, TrashCan, Reset } from "@carbon/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { usePlanning } from "@/hooks/use-planning"
import { simulatePlanning } from "@/lib/planning/simulate"
import type {
  NewPlanningEvent,
  PlanningEvent,
  PlanningResult,
} from "@/lib/planning/types"
import { formatCompactDKK, formatDKK } from "@/lib/format"
import { PlanningChart, type WealthView } from "./planning-chart"
import { EventEditor } from "./event-editor"

function num(value: number | string, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(value)
  return Number.isNaN(n) ? fallback : n
}

/** NumberInput bound to a fraction but shown as a percentage. */
function PercentField({
  id,
  label,
  value,
  step = 0.1,
  onChange,
}: {
  id: string
  label: string
  value: number
  step?: number
  onChange: (fraction: number) => void
}) {
  return (
    <NumberInput
      id={id}
      label={label}
      step={step}
      value={Math.round(value * 10000) / 100}
      onChange={(_e, { value: v }) => onChange(num(v, value * 100) / 100)}
    />
  )
}

const EVENT_TYPE_LABEL: Record<PlanningEvent["type"], string> = {
  expense: "Engangsudgift",
  windfall: "Engangsindtægt",
  recurring: "Opsparingsændring",
  property: "Bolighandel",
}

function eventSummary(e: PlanningEvent): string {
  switch (e.type) {
    case "expense":
      return `−${formatDKK(e.amount)}`
    case "windfall":
      return `+${formatDKK(e.amount)}`
    case "recurring":
      return `${e.monthlyDelta >= 0 ? "+" : ""}${formatDKK(e.monthlyDelta)}/md.`
    case "property":
      return `${formatDKK(e.newValue)} · ${Math.round(e.mortgageLtv * 100)}% lån`
  }
}

export function PlanningOverview() {
  const planning = usePlanning()
  const { state } = planning
  const [view, setView] = useState<WealthView>("total")
  const [real, setReal] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<PlanningEvent | null>(null)

  const result = useMemo(() => simulatePlanning(state), [state])

  // Optionally deflate to today's kroner for display.
  const displayResult: PlanningResult = useMemo(() => {
    if (!real) return result
    const inf = state.assumptions.inflation
    return {
      fiAge: result.fiAge,
      points: result.points.map((p) => {
        const f = Math.pow(1 + inf, p.age - state.currentAge)
        return {
          age: p.age,
          investments: p.investments / f,
          homeEquity: p.homeEquity / f,
          netWorth: p.netWorth / f,
          band: [p.band[0] / f, p.band[1] / f] as [number, number],
        }
      }),
    }
  }, [result, real, state.assumptions.inflation, state.currentAge])

  const goalPoint =
    displayResult.points.find((p) => p.age === state.goalAge) ??
    displayResult.points.at(-1)
  const endPoint = displayResult.points.at(-1)

  const openAdd = () => {
    setEditing(null)
    setEditorOpen(true)
  }
  const openEdit = (e: PlanningEvent) => {
    setEditing(e)
    setEditorOpen(true)
  }
  const saveEvent = (draft: NewPlanningEvent, id?: string) => {
    if (id) planning.updateEvent({ ...draft, id } as PlanningEvent)
    else planning.addEvent(draft)
  }

  return (
    <main
      style={{ maxWidth: "1120px", margin: "0 auto", padding: "2rem 1.5rem 4rem" }}
    >
      <header className="mb-6 border-l-4 border-[var(--cds-border-interactive)] pl-3">
        <h1 className="text-2xl font-semibold tracking-tight">Planlægning</h1>
        <p className="text-muted-foreground text-sm">
          Simulér din formue mange år frem — med afkast, bolig, inflation og
          større livsbegivenheder.
        </p>
      </header>

      {/* Chart */}
      <Card className="mb-6 border-t-4 border-[var(--cds-border-interactive)]">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg">Formueudvikling</CardTitle>
            <div className="flex flex-wrap gap-2">
              <div className="w-48 max-w-full">
                <ContentSwitcher
                  size="sm"
                  selectedIndex={view === "total" ? 0 : 1}
                  onChange={({ index }) => setView(index === 1 ? "split" : "total")}
                >
                  <Switch name="total" text="Samlet" />
                  <Switch name="split" text="Opdelt" />
                </ContentSwitcher>
              </div>
              <div className="w-56 max-w-full">
                <ContentSwitcher
                  size="sm"
                  selectedIndex={real ? 1 : 0}
                  onChange={({ index }) => setReal(index === 1)}
                >
                  <Switch name="nominal" text="Nominelt" />
                  <Switch name="real" text="Nutidskroner" />
                </ContentSwitcher>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground text-xs">
                Formue ved alder {state.goalAge}
              </p>
              <p className="text-success text-xl font-bold">
                {goalPoint ? formatCompactDKK(goalPoint.netWorth) : "–"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">
                Formue ved alder {state.endAge}
              </p>
              <p className="text-xl font-bold">
                {endPoint ? formatCompactDKK(endPoint.netWorth) : "–"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Økonomisk uafhængig</p>
              <p className="text-xl font-bold">
                {result.fiAge != null ? `Alder ${result.fiAge}` : "Ikke nået"}
              </p>
            </div>
          </div>
          <PlanningChart
            result={displayResult}
            view={view}
            goalAge={state.goalAge}
            real={real}
          />
        </CardContent>
      </Card>

      {/* Your figures */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">Dine tal</CardTitle>
            {planning.linked ? (
              <Tag type="green" size="sm">
                Hentet fra skat &amp; budget
              </Tag>
            ) : (
              <Button
                kind="ghost"
                size="sm"
                renderIcon={Reset}
                onClick={planning.pullFromSources}
              >
                Hent fra skat &amp; budget
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {planning.linked && (
            <InlineNotification
              className="max-w-full"
              kind="info"
              lowContrast
              hideCloseButton
              title="Pre-udfyldt"
              subtitle="Tallene er hentet fra dine skat- og budgetsider. Ret dem frit — så holder de op med at opdatere automatisk."
            />
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumberInput
              id="plan-current-age"
              label="Nuværende alder"
              min={0}
              max={100}
              value={state.currentAge}
              onChange={(_e, { value }) =>
                planning.patch({ currentAge: num(value, state.currentAge) })
              }
            />
            <NumberInput
              id="plan-end-age"
              label="Slutalder for simulering"
              min={state.currentAge + 1}
              max={120}
              value={state.endAge}
              onChange={(_e, { value }) =>
                planning.patch({ endAge: num(value, state.endAge) })
              }
            />
            <NumberInput
              id="plan-goal-age"
              label="Målalder (pension)"
              min={state.currentAge}
              max={state.endAge}
              value={state.goalAge}
              onChange={(_e, { value }) =>
                planning.patch({ goalAge: num(value, state.goalAge) })
              }
            />
            <NumberInput
              id="plan-investments"
              label="Nuværende investeringer (kr.)"
              min={0}
              step={50000}
              value={state.startInvestments}
              onChange={(_e, { value }) =>
                planning.patch({ startInvestments: num(value, 0) })
              }
            />
            <NumberInput
              id="plan-monthly"
              label="Månedlig opsparing (kr.)"
              min={0}
              step={1000}
              value={state.monthlyContribution}
              onChange={(_e, { value }) =>
                planning.patch({ monthlyContribution: num(value, 0) })
              }
            />
            <NumberInput
              id="plan-spending"
              label="Årligt forbrug (kr.)"
              min={0}
              step={10000}
              value={state.annualSpending}
              onChange={(_e, { value }) =>
                planning.patch({ annualSpending: num(value, 0) })
              }
            />
            <NumberInput
              id="plan-home"
              label="Boligværdi (kr.)"
              min={0}
              step={100000}
              value={state.homeValue}
              onChange={(_e, { value }) =>
                planning.patch({ homeValue: num(value, 0) })
              }
            />
            <NumberInput
              id="plan-mortgage"
              label="Restgæld på bolig (kr.)"
              min={0}
              step={100000}
              value={state.mortgageBalance}
              onChange={(_e, { value }) =>
                planning.patch({ mortgageBalance: num(value, 0) })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Assumptions */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Antagelser</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <PercentField
              id="a-housing"
              label="Afkast på bolig"
              value={state.assumptions.housingReturn}
              onChange={(v) => planning.setAssumption("housingReturn", v)}
            />
            <PercentField
              id="a-invest"
              label="Afkast på investeringer"
              value={state.assumptions.investmentReturn}
              onChange={(v) => planning.setAssumption("investmentReturn", v)}
            />
            <PercentField
              id="a-fee"
              label="Årligt investeringsgebyr"
              value={state.assumptions.investmentFee}
              onChange={(v) => planning.setAssumption("investmentFee", v)}
            />
            <PercentField
              id="a-vol"
              label="Årlig volatilitet"
              value={state.assumptions.volatility}
              onChange={(v) => planning.setAssumption("volatility", v)}
            />
            <PercentField
              id="a-infl"
              label="Inflation"
              value={state.assumptions.inflation}
              onChange={(v) => planning.setAssumption("inflation", v)}
            />
            <PercentField
              id="a-contrib"
              label="Vækst i opsparing pr. år"
              value={state.assumptions.contributionGrowth}
              onChange={(v) => planning.setAssumption("contributionGrowth", v)}
            />
            <PercentField
              id="a-swr"
              label="Sikker udtræksrate (FI)"
              value={state.assumptions.safeWithdrawalRate}
              onChange={(v) => planning.setAssumption("safeWithdrawalRate", v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Events */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">Større ændringer</CardTitle>
            <Button kind="tertiary" size="sm" renderIcon={Add} onClick={openAdd}>
              Tilføj begivenhed
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {state.events.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Tilføj fx et bryllup, en arv, eller et boligkøb for at se effekten
              på din formue.
            </p>
          ) : (
            <ul className="space-y-2">
              {[...state.events]
                .sort((a, b) => a.age - b.age)
                .map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center gap-2 border bg-muted/20 p-2"
                  >
                    <Tag type="cool-gray" size="sm">
                      {EVENT_TYPE_LABEL[e.type]}
                    </Tag>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {e.label || "(uden navn)"}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        Alder {e.age} · {eventSummary(e)}
                      </p>
                    </div>
                    <Button
                      kind="ghost"
                      size="sm"
                      hasIconOnly
                      renderIcon={Edit}
                      iconDescription="Redigér"
                      onClick={() => openEdit(e)}
                    />
                    <Button
                      kind="danger--ghost"
                      size="sm"
                      hasIconOnly
                      renderIcon={TrashCan}
                      iconDescription="Fjern"
                      onClick={() => planning.removeEvent(e.id)}
                    />
                  </li>
                ))}
            </ul>
          )}
          <Separator className="my-4" />
          <p className="text-muted-foreground text-xs">
            Simuleringen er et estimat og ikke økonomisk rådgivning. Faktiske
            afkast svinger fra år til år — det grønne bånd viser et 10–90 %
            usikkerhedsinterval.
          </p>
        </CardContent>
      </Card>

      <EventEditor
        open={editorOpen}
        initial={editing}
        minAge={state.currentAge}
        maxAge={state.endAge}
        onClose={() => setEditorOpen(false)}
        onSave={saveEvent}
      />
    </main>
  )
}
