"use client"

import { useMemo, useState } from "react"
import {
  Button,
  NumberInput,
  ContentSwitcher,
  Switch,
  Toggle,
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
import { MoneyInput } from "./money-input"
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
      label={`${label} (%)`}
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
          contributionsTotal: p.contributionsTotal / f,
          housingGainsTotal: p.housingGainsTotal / f,
          investmentGainsTotal: p.investmentGainsTotal / f,
          contributionYoY: p.contributionYoY / f,
          housingGainYoY: p.housingGainYoY / f,
          investmentGainYoY: p.investmentGainYoY / f,
          retirementIncome: p.retirementIncome / f,
        }
      }),
    }
  }, [result, real, state.assumptions.inflation, state.currentAge])

  const retirementPoint =
    displayResult.points.find((p) => p.age === state.retirementAge) ??
    displayResult.points.at(-1)
  const endPoint = displayResult.points.at(-1)
  // Retirement income once folkepension is included (fullest year).
  const pensionIncomePoint =
    displayResult.points.find((p) => p.age === state.pension.folkepensionAge) ??
    displayResult.points.find((p) => p.retirementIncome > 0)

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
              <div className="w-72 max-w-full">
                <ContentSwitcher
                  size="sm"
                  selectedIndex={view === "total" ? 0 : view === "split" ? 1 : 2}
                  onChange={({ index }) =>
                    setView(
                      index === 2 ? "sources" : index === 1 ? "split" : "total"
                    )
                  }
                >
                  <Switch name="total" text="Samlet" />
                  <Switch name="split" text="Opdelt" />
                  <Switch name="sources" text="Vækstkilder" />
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
          <div className="mb-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div>
              <p className="text-muted-foreground text-xs">
                Formue ved pension ({state.retirementAge})
              </p>
              <p className="text-success text-xl font-bold">
                {retirementPoint ? formatCompactDKK(retirementPoint.netWorth) : "–"}
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
              <p className="text-muted-foreground text-xs">
                Pensionsindkomst/år ({state.pension.folkepensionAge})
              </p>
              <p className="text-xl font-bold">
                {pensionIncomePoint
                  ? formatCompactDKK(pensionIncomePoint.retirementIncome)
                  : "–"}
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
            retirementAge={state.retirementAge}
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
              id="plan-retire-age"
              label="Pensionsalder"
              min={state.currentAge}
              max={state.endAge}
              value={state.retirementAge}
              onChange={(_e, { value }) =>
                planning.patch({ retirementAge: num(value, state.retirementAge) })
              }
            />
            <MoneyInput
              id="plan-investments"
              label="Nuværende investeringer"
              value={state.startInvestments}
              onChange={(v) => planning.patch({ startInvestments: v })}
            />
            <MoneyInput
              id="plan-monthly"
              label="Månedlig opsparing"
              value={state.monthlyContribution}
              onChange={(v) => planning.patch({ monthlyContribution: v })}
            />
            <MoneyInput
              id="plan-spending"
              label="Månedligt forbrug"
              value={Math.round(state.annualSpending / 12)}
              onChange={(v) => planning.patch({ annualSpending: v * 12 })}
            />
            <MoneyInput
              id="plan-home"
              label="Boligværdi"
              value={state.homeValue}
              onChange={(v) => planning.patch({ homeValue: v })}
            />
            <MoneyInput
              id="plan-mortgage"
              label="Restgæld på bolig"
              value={state.mortgageBalance}
              onChange={(v) => planning.patch({ mortgageBalance: v })}
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
          </div>
        </CardContent>
      </Card>

      {/* Pension */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Pension</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Indbetalinger og nuværende saldi på dine pensioner. Vi beregner din
            indkomst som pensionist — inkl. folkepension med modregning. Beløb
            fra skattesiden er hentet, hvor de findes.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <MoneyInput
              id="pen-rate-bal"
              label="Ratepension — saldo"
              value={state.pension.ratepensionBalance}
              onChange={(v) => planning.setPension("ratepensionBalance", v)}
            />
            <MoneyInput
              id="pen-liv-bal"
              label="Livrente — saldo"
              value={state.pension.livrenteBalance}
              onChange={(v) => planning.setPension("livrenteBalance", v)}
            />
            <MoneyInput
              id="pen-alder-bal"
              label="Aldersopsparing — saldo"
              value={state.pension.aldersopsparingBalance}
              onChange={(v) => planning.setPension("aldersopsparingBalance", v)}
            />
            <MoneyInput
              id="pen-rate-ann"
              label="Ratepension — pr. år"
              value={state.pension.ratepensionAnnual}
              onChange={(v) => planning.setPension("ratepensionAnnual", v)}
            />
            <MoneyInput
              id="pen-liv-ann"
              label="Livrente — pr. år"
              value={state.pension.livrenteAnnual}
              onChange={(v) => planning.setPension("livrenteAnnual", v)}
            />
            <MoneyInput
              id="pen-alder-ann"
              label="Aldersopsparing — pr. år"
              value={state.pension.aldersopsparingAnnual}
              onChange={(v) => planning.setPension("aldersopsparingAnnual", v)}
            />
            <PercentField
              id="pen-roi"
              label="Afkast på pension"
              value={state.pension.pensionReturn}
              onChange={(v) => planning.setPension("pensionReturn", v)}
            />
            <NumberInput
              id="pen-rate-years"
              label="Ratepension — udbetalingsår"
              min={10}
              max={30}
              value={state.pension.ratepensionYears}
              onChange={(_e, { value }) =>
                planning.setPension(
                  "ratepensionYears",
                  num(value, state.pension.ratepensionYears)
                )
              }
            />
            <NumberInput
              id="pen-folke-age"
              label="Folkepensionsalder"
              min={60}
              max={75}
              value={state.pension.folkepensionAge}
              onChange={(_e, { value }) =>
                planning.setPension(
                  "folkepensionAge",
                  num(value, state.pension.folkepensionAge)
                )
              }
            />
          </div>
          <div className="flex flex-wrap gap-6">
            <Toggle
              id="pen-single"
              size="sm"
              labelText="Husstand"
              labelA="Par"
              labelB="Enlig"
              toggled={state.pension.single}
              onToggle={(checked) => planning.setPension("single", checked)}
            />
            <Toggle
              id="pen-include-folke"
              size="sm"
              labelText="Medregn folkepension"
              labelA="Nej"
              labelB="Ja"
              toggled={state.pension.includeFolkepension}
              onToggle={(checked) =>
                planning.setPension("includeFolkepension", checked)
              }
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
