"use client"

import { useMemo, useState } from "react"
import {
  Button,
  NumberInput,
  ContentSwitcher,
  Switch,
  Checkbox,
  Dropdown,
  RadioButtonGroup,
  RadioButton,
  InlineNotification,
  Tag,
  Toggletip,
  ToggletipButton,
  ToggletipContent,
} from "@carbon/react"
import {
  Add,
  Edit,
  TrashCan,
  Reset,
  Information,
  Calculator,
  Download,
} from "@carbon/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { usePlanning } from "@/hooks/use-planning"
import {
  simulatePlanning,
  solveRequiredMonthlyContribution,
} from "@/lib/planning/simulate"
import type {
  InvestmentTaxMode,
  NewPlanningEvent,
  PensionPerson,
  PlanningEvent,
  PlanningResult,
} from "@/lib/planning/types"
import { formatCompactDKK, formatDKK } from "@/lib/format"
import { PlanningChart, type WealthView } from "./planning-chart"
import { MoneyInput } from "./money-input"
import { EventEditor } from "./event-editor"
import { MunicipalitySelect } from "@/components/tax-calculator/municipality-select"

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

/** The pot/contribution inputs for one person's pension. */
function PensionPersonFields({
  idPrefix,
  person,
  onChange,
}: {
  idPrefix: string
  person: PensionPerson
  onChange: <K extends keyof PensionPerson>(key: K, value: PensionPerson[K]) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MoneyInput
        id={`${idPrefix}-rate-bal`}
        label="Ratepension — saldo"
        value={person.ratepensionBalance}
        onChange={(v) => onChange("ratepensionBalance", v)}
      />
      <MoneyInput
        id={`${idPrefix}-liv-bal`}
        label="Livrente — saldo"
        value={person.livrenteBalance}
        onChange={(v) => onChange("livrenteBalance", v)}
      />
      <MoneyInput
        id={`${idPrefix}-alder-bal`}
        label="Aldersopsparing — saldo"
        value={person.aldersopsparingBalance}
        onChange={(v) => onChange("aldersopsparingBalance", v)}
      />
      <MoneyInput
        id={`${idPrefix}-rate-ann`}
        label="Ratepension — pr. år (maks. 68.700 kr. i 2026)"
        value={person.ratepensionAnnual}
        onChange={(v) => onChange("ratepensionAnnual", v)}
      />
      <MoneyInput
        id={`${idPrefix}-liv-ann`}
        label="Livrente — pr. år"
        value={person.livrenteAnnual}
        onChange={(v) => onChange("livrenteAnnual", v)}
      />
      <MoneyInput
        id={`${idPrefix}-alder-ann`}
        label="Aldersopsparing — pr. år (maks. 9.900 / 64.200 kr. i 2026)"
        value={person.aldersopsparingAnnual}
        onChange={(v) => onChange("aldersopsparingAnnual", v)}
      />
      <NumberInput
        id={`${idPrefix}-folke-age`}
        label="Folkepensionsalder"
        min={60}
        max={75}
        value={person.folkepensionAge}
        onChange={(_e, { value }) =>
          onChange("folkepensionAge", num(value, person.folkepensionAge))
        }
      />
    </div>
  )
}

const INV_TAX_MODES: { id: InvestmentTaxMode; label: string }[] = [
  { id: "realisation", label: "Realisation — aktier (27/42 %, ved salg)" },
  { id: "lager", label: "Lager — ETF/investeringsforening (27/42 %, årligt)" },
  { id: "ask", label: "Aktiesparekonto (17 %, årligt)" },
]

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
  const [real, setReal] = useState(true)
  const currentYear = new Date().getFullYear()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<PlanningEvent | null>(null)
  // Goal solver: required monthly saving to reach FI by the retirement age.
  const [solved, setSolved] = useState<{ value: number | null } | null>(null)

  const result = useMemo(() => simulatePlanning(state), [state])

  // Optionally deflate to today's kroner for display.
  const displayResult: PlanningResult = useMemo(() => {
    if (!real) return result
    const inf = state.assumptions.inflation
    return {
      fiAge: result.fiAge,
      debtFreeAge: result.debtFreeAge,
      ruinAge: result.ruinAge,
      successProbability: result.successProbability,
      points: result.points.map((p) => {
        const f = Math.pow(1 + inf, p.age - state.currentAge)
        return {
          age: p.age,
          investments: p.investments / f,
          homeEquity: p.homeEquity / f,
          cash: p.cash / f,
          otherDebt: p.otherDebt / f,
          netWorth: p.netWorth / f,
          band: [p.band[0] / f, p.band[1] / f] as [number, number],
          investmentsBand: [
            p.investmentsBand[0] / f,
            p.investmentsBand[1] / f,
          ] as [number, number],
          contributionsTotal: p.contributionsTotal / f,
          housingGainsTotal: p.housingGainsTotal / f,
          investmentGainsTotal: p.investmentGainsTotal / f,
          contributionYoY: p.contributionYoY / f,
          housingGainYoY: p.housingGainYoY / f,
          investmentGainYoY: p.investmentGainYoY / f,
          retirementIncome: p.retirementIncome / f,
          taxPaid: p.taxPaid / f,
          spending: p.spending / f,
          investmentsSold: p.investmentsSold / f,
          borrowed: p.borrowed / f,
          propertyTax: p.propertyTax / f,
        }
      }),
    }
  }, [result, real, state.assumptions.inflation, state.currentAge])

  const retirementPoint =
    displayResult.points.find((p) => p.age === state.retirementAge) ??
    displayResult.points.at(-1)
  const endPoint = displayResult.points.at(-1)
  // Steady-state yearly pension income: the year after the latest
  // folkepensionsalder, so the one-off (tax-free) aldersopsparing lump that
  // pays out *on* the folkepension date doesn't distort the figure.
  const folkepensionAge = state.pension.single
    ? state.pension.person1.folkepensionAge
    : Math.max(
        state.pension.person1.folkepensionAge,
        state.pension.person2.folkepensionAge
      )
  const pensionIncomePoint =
    displayResult.points.find((p) => p.age === folkepensionAge + 1) ??
    displayResult.points.find(
      (p) => p.age >= folkepensionAge && p.retirementIncome > 0
    ) ??
    displayResult.points.find((p) => p.retirementIncome > 0)

  // Export the year-by-year projection as a CSV the user can open in Excel.
  const exportCsv = () => {
    const cols: [string, (p: PlanningResult["points"][number]) => number][] = [
      ["Alder", (p) => p.age],
      ["År", (p) => currentYear + (p.age - state.currentAge)],
      ["Investeringer", (p) => p.investments],
      ["Kontant", (p) => p.cash],
      ["Friværdi", (p) => p.homeEquity],
      ["Anden gæld", (p) => p.otherDebt],
      ["Samlet formue", (p) => p.netWorth],
      ["Formue p10", (p) => p.band[0]],
      ["Formue p90", (p) => p.band[1]],
      ["Pension e. skat", (p) => p.retirementIncome],
      ["Forbrug", (p) => p.spending],
      ["Solgt invest.", (p) => p.investmentsSold],
      ["Lånt i bolig", (p) => p.borrowed],
      ["Skat betalt", (p) => p.taxPaid],
    ]
    const header = cols.map((c) => c[0]).join(";")
    const rows = displayResult.points.map((p) =>
      cols.map((c) => Math.round(c[1](p))).join(";")
    )
    const basis = real ? "nutidskroner" : "nominelt"
    const csv = `﻿${header}\n${rows.join("\n")}`
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `planlaegning-${basis}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
          <CardTitle className="text-lg">Formueudvikling</CardTitle>
          <div className="mt-3 flex flex-wrap gap-3">
            <div style={{ width: "16rem", maxWidth: "100%" }}>
              <ContentSwitcher
                size="sm"
                selectedIndex={view === "total" ? 0 : 1}
                onChange={({ index }) => setView(index === 1 ? "detailed" : "total")}
              >
                <Switch name="total" text="Samlet" />
                <Switch name="detailed" text="Detaljeret" />
              </ContentSwitcher>
            </div>
            <div style={{ width: "18rem", maxWidth: "100%" }}>
              <ContentSwitcher
                size="sm"
                selectedIndex={real ? 1 : 0}
                onChange={({ index }) => setReal(index === 1)}
              >
                <Switch name="nominal" text="Nominelt" />
                <Switch name="real" text="Nutidskroner" />
              </ContentSwitcher>
            </div>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={Download}
              onClick={exportCsv}
            >
              Eksportér (CSV)
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-2 text-[11px]">
            Beløb vist i {real ? "nutidskroner (dagens værdi)" : "nominelle kroner"}
          </p>
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
                Årlig pension e. skat
                {pensionIncomePoint ? ` (${pensionIncomePoint.age})` : ""}
              </p>
              <p className="text-xl font-bold">
                {pensionIncomePoint
                  ? formatCompactDKK(pensionIncomePoint.retirementIncome)
                  : "–"}
              </p>
            </div>
            <div>
              <div className="flex items-center gap-1">
                <p className="text-muted-foreground text-xs">Økonomisk uafhængig</p>
                <Toggletip align="bottom">
                  <ToggletipButton label="Sådan beregnes det">
                    <Information size={14} />
                  </ToggletipButton>
                  <ToggletipContent>
                    <p className="text-sm">
                      Du er økonomisk uafhængig, når dine investeringer kan dække
                      dit forbrug uden løn — her sat til <strong>25×</strong> dit
                      årlige forbrug (en sikker udtræksrate på 4 %).
                    </p>
                    <p className="mt-2 text-sm">
                      Med et årligt forbrug på{" "}
                      {formatCompactDKK(state.annualSpending)} er målet ca.{" "}
                      {formatCompactDKK(state.annualSpending * 25)}{" "}
                      {result.fiAge != null
                        ? `— dine investeringer (ekskl. bolig) når det ved alder ${result.fiAge}.`
                        : "— dine investeringer når det ikke inden for perioden."}
                    </p>
                  </ToggletipContent>
                </Toggletip>
              </div>
              <p className="text-xl font-bold">
                {result.fiAge != null ? `Alder ${result.fiAge}` : "Ikke nået"}
              </p>
            </div>
          </div>
          {(() => {
            const pct = Math.round(result.successProbability * 100)
            const kind = pct >= 90 ? "success" : pct >= 75 ? "warning" : "error"
            const title =
              pct >= 90
                ? "Planen ser robust ud"
                : pct >= 75
                  ? "Planen er lidt presset"
                  : "Planen risikerer at løbe tør"
            const ruin =
              result.ruinAge != null
                ? ` I det forventede forløb løber pengene tør ved alder ${result.ruinAge}.`
                : ""
            return (
              <InlineNotification
                className="mb-3 max-w-full"
                kind={kind}
                lowContrast
                hideCloseButton
                title={title}
                subtitle={`Dine penge rækker hele perioden (til alder ${state.endAge}) i ${pct} % af simuleringerne.${ruin}`}
              />
            )
          })()}
          <PlanningChart
            result={displayResult}
            view={view}
            retirementAge={state.retirementAge}
            real={real}
            currentAge={state.currentAge}
            currentYear={currentYear}
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
              id="plan-cash"
              label="Kontant buffer (opsparingskonto)"
              value={state.cashBuffer}
              onChange={(v) => planning.patch({ cashBuffer: v })}
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
            <MoneyInput
              id="plan-other-debt"
              label="Anden gæld (forbrugs-/billån, SU mv.)"
              value={state.otherDebtBalance}
              onChange={(v) => planning.patch({ otherDebtBalance: v })}
            />
            <PercentField
              id="plan-other-debt-rate"
              label="Rente på anden gæld"
              value={state.otherDebtRate}
              onChange={(v) => planning.patch({ otherDebtRate: v })}
            />
            <NumberInput
              id="plan-other-debt-term"
              label="Afdragstid på anden gæld (år)"
              min={1}
              max={40}
              value={state.otherDebtTermYears}
              onChange={(_e, { value }) =>
                planning.patch({
                  otherDebtTermYears: num(value, state.otherDebtTermYears),
                })
              }
            />
          </div>
          <Separator />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              kind="tertiary"
              size="sm"
              renderIcon={Calculator}
              onClick={() =>
                setSolved({ value: solveRequiredMonthlyContribution(state) })
              }
            >
              Beregn nødvendig opsparing
            </Button>
            {solved && (
              <p className="text-sm">
                {solved.value === null ? (
                  <span className="text-muted-foreground">
                    Økonomisk uafhængighed nås ikke inden pension ({state.retirementAge})
                    — prøv en senere pensionsalder eller lavere forbrug.
                  </span>
                ) : solved.value <= state.monthlyContribution ? (
                  <span className="text-success">
                    Du er på vej: din nuværende opsparing er nok til at blive
                    økonomisk uafhængig inden pension.
                  </span>
                ) : (
                  <>
                    Du skal spare ca.{" "}
                    <strong>{formatDKK(solved.value)}/md.</strong> op for at blive
                    økonomisk uafhængig som {state.retirementAge}-årig (du sparer{" "}
                    {formatDKK(state.monthlyContribution)}/md. nu).
                  </>
                )}
              </p>
            )}
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
              label="Volatilitet, investeringer"
              value={state.assumptions.volatility}
              onChange={(v) => planning.setAssumption("volatility", v)}
            />
            <PercentField
              id="a-vol-housing"
              label="Volatilitet, bolig"
              value={state.assumptions.housingVolatility}
              onChange={(v) => planning.setAssumption("housingVolatility", v)}
            />
            <PercentField
              id="a-infl"
              label="Prisinflation (forbrug & skat)"
              value={state.assumptions.inflation}
              onChange={(v) => planning.setAssumption("inflation", v)}
            />
            <PercentField
              id="a-contrib"
              label="Lønstigning (vækst i opsparing)"
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
            indkomst som pensionist — inkl. folkepension med modregning
            (aldersopsparing er fritaget) — og beskatter udbetalingerne med de
            samme danske skatteregler som skattesiden (AM-bidrag, bund-/mellem-/
            top-skat, kommune- og kirkeskat). Beløb fra skattesiden er hentet,
            hvor de findes. De årlige indbetalinger antages at stige med
            inflationen hvert år.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
          <div className="flex flex-wrap items-center gap-8">
            <RadioButtonGroup
              legendText="Husstand"
              name="pen-household"
              valueSelected={state.pension.single ? "single" : "couple"}
              onChange={(value) =>
                planning.setPension("single", value === "single")
              }
            >
              <RadioButton labelText="Enlig" value="single" id="pen-h-single" />
              <RadioButton
                labelText="Par / samlevende"
                value="couple"
                id="pen-h-couple"
              />
            </RadioButtonGroup>
            <Checkbox
              id="pen-include-folke"
              labelText="Medregn folkepension"
              checked={state.pension.includeFolkepension}
              onChange={(_e, { checked }) =>
                planning.setPension("includeFolkepension", checked)
              }
            />
          </div>

          {!state.pension.single && (
            <h4 className="text-sm font-medium">Person 1</h4>
          )}
          <PensionPersonFields
            idPrefix="pen1"
            person={state.pension.person1}
            onChange={(key, value) =>
              planning.setPensionPerson("person1", key, value)
            }
          />

          {!state.pension.single && (
            <>
              <Separator />
              <h4 className="text-sm font-medium">Person 2</h4>
              <PensionPersonFields
                idPrefix="pen2"
                person={state.pension.person2}
                onChange={(key, value) =>
                  planning.setPensionPerson("person2", key, value)
                }
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Tax */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Skat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Skatten på pensionsudbetalinger og investeringsgevinster beregnes med
            de gældende {state.tax.year}-regler for din kommune. Skattegrænserne
            (personfradrag, topskattegrænse, aktieindkomstgrænse mv.) reguleres
            med inflationen hvert år — ligesom de danske skatteregler — så du ikke
            havner i fx topskat alene på grund af inflation.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MunicipalitySelect
              value={state.tax.municipality}
              year={state.tax.year}
              onChange={(v) => planning.setTax("municipality", v)}
            />
            <div className="flex items-end">
              <Checkbox
                id="plan-church"
                labelText="Medlem af folkekirken (kirkeskat)"
                checked={state.tax.churchMember}
                onChange={(_e, { checked }) =>
                  planning.setTax("churchMember", checked)
                }
              />
            </div>
            <Dropdown
              id="plan-inv-tax-mode"
              titleText="Investeringsbeskatning"
              label="Vælg beskatning"
              items={INV_TAX_MODES}
              selectedItem={INV_TAX_MODES.find(
                (m) => m.id === state.investmentTaxMode
              )}
              itemToString={(m) => (m ? m.label : "")}
              onChange={({ selectedItem }) => {
                if (selectedItem)
                  planning.patch({ investmentTaxMode: selectedItem.id })
              }}
            />
          </div>
          <Separator />
          <div className="flex flex-wrap items-center gap-8">
            <Checkbox
              id="plan-include-prop-tax"
              labelText="Medregn ejendomsskat (ejendomsværdiskat + grundskyld)"
              checked={state.includePropertyTax}
              onChange={(_e, { checked }) =>
                planning.patch({ includePropertyTax: checked })
              }
            />
          </div>
          {state.includePropertyTax && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <MoneyInput
                id="plan-land-value"
                label="Grundværdi (til grundskyld)"
                value={state.landValue}
                onChange={(v) => planning.patch({ landValue: v })}
              />
            </div>
          )}
          {state.includePropertyTax && (
            <p className="text-muted-foreground text-[11px]">
              Bemærk: medregn kun ejendomsskat her, hvis den ikke allerede indgår
              i dit månedlige forbrug ovenfor — ellers tæller den dobbelt.
            </p>
          )}
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
