"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Button,
  TextInput,
  NumberInput,
  ProgressBar,
  InlineNotification,
  RadioButtonGroup,
  RadioButton,
  Checkbox,
  Select,
  SelectItem,
} from "@carbon/react"
import { Add, TrashCan, MagicWand, Draggable } from "@carbon/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useBudget } from "@/components/budget-provider"
import {
  type BudgetItem,
  type BudgetCategory,
  type CategoryKind,
  type ExpenseList,
} from "@/hooks/use-budget"
import { CATEGORY_KINDS, UNCATEGORIZED_ID } from "@/lib/budget/categories"
import { computeMortgage, looksLikeMortgage } from "@/lib/budget/mortgage"
import {
  DEFAULT_SAVINGS_SPLIT,
  SAVINGS_SPLITS,
  statedSavingsPatch,
  type SavingsAttribution,
  type SavingsConfig,
  type SavingsSplit,
} from "@/lib/budget/savings-split"
import {
  CATEGORY_KIND_LABELS,
  SAVINGS_SPLIT_LABELS,
  savingsBreakdownView,
  savingsSplitView,
  type SavingsBreakdownView,
  type SavingsSplitView,
} from "@/lib/budget/savings-view"
import { MoneyInput } from "@/components/planlaegning/money-input"
import { BudgetWizard } from "./budget-wizard"
import { formatDKK } from "@/lib/format"

interface ExpenseHandlers {
  onAdd: (list: ExpenseList, categoryId: string) => void
  onUpdate: (
    list: ExpenseList,
    id: string,
    field: "label" | "amount",
    value: string | number
  ) => void
  onRemove: (list: ExpenseList, id: string) => void
  onMove: (list: ExpenseList, id: string, categoryId: string) => void
  onAddCategory: (name: string) => void
  onRenameCategory: (id: string, name: string) => void
  onRemoveCategory: (id: string) => void
  onSetCategoryKind: (id: string, kind: CategoryKind) => void
}

function ItemRow({
  list,
  item,
  onUpdate,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  list: ExpenseList
  item: BudgetItem
  onUpdate: ExpenseHandlers["onUpdate"]
  onRemove: ExpenseHandlers["onRemove"]
  onDragStart: () => void
  onDragEnd: () => void
}) {
  return (
    <div className="flex items-end gap-2 border bg-background p-2">
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", item.id)
          e.dataTransfer.effectAllowed = "move"
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        aria-label="Træk for at flytte til en anden kategori"
        title="Træk for at flytte"
        className="mb-1 shrink-0 cursor-grab text-[var(--cds-icon-secondary)] active:cursor-grabbing"
      >
        <Draggable size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <TextInput
          id={`exp-label-${item.id}`}
          size="sm"
          labelText="Beskrivelse"
          placeholder="F.eks. Husleje"
          value={item.label}
          onChange={(e) => onUpdate(list, item.id, "label", e.target.value)}
        />
      </div>
      <div className="w-28 shrink-0">
        <TextInput
          id={`exp-amount-${item.id}`}
          type="number"
          size="sm"
          labelText="Beløb / md."
          placeholder="0"
          min={0}
          value={item.amount || ""}
          onChange={(e) =>
            onUpdate(
              list,
              item.id,
              "amount",
              Math.round(parseFloat(e.target.value) || 0)
            )
          }
        />
      </div>
      <Button
        kind="danger--ghost"
        size="sm"
        hasIconOnly
        renderIcon={TrashCan}
        iconDescription="Fjern udgift"
        onClick={() => onRemove(list, item.id)}
      />
    </div>
  )
}

function CategorizedExpenses({
  list,
  items,
  categories,
  handlers,
}: {
  list: ExpenseList
  items: BudgetItem[]
  categories: BudgetCategory[]
  handlers: ExpenseHandlers
}) {
  const [overCat, setOverCat] = useState<string | null>(null)

  // Group items by category (unknown category → catch-all).
  const known = new Set(categories.map((c) => c.id))
  const byCategory = new Map<string, BudgetItem[]>()
  for (const c of categories) byCategory.set(c.id, [])
  for (const item of items) {
    const cid = known.has(item.categoryId) ? item.categoryId : UNCATEGORIZED_ID
    byCategory.get(cid)?.push(item)
  }

  return (
    <div className="space-y-3">
      {categories.map((cat) => {
        const catItems = byCategory.get(cat.id) ?? []
        const subtotal = catItems.reduce((s, i) => s + (i.amount || 0), 0)
        const isOver = overCat === cat.id
        return (
          <div
            key={cat.id}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = "move"
              if (overCat !== cat.id) setOverCat(cat.id)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData("text/plain")
              if (id) handlers.onMove(list, id, cat.id)
              setOverCat(null)
            }}
            className={`border p-3 transition-colors ${
              isOver
                ? "bg-[var(--cds-layer-hover)] outline outline-2 outline-[var(--cds-focus)]"
                : "bg-muted/20"
            }`}
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <TextInput
                  id={`cat-${list}-${cat.id}`}
                  size="sm"
                  hideLabel
                  labelText="Kategorinavn"
                  value={cat.name}
                  onChange={(e) =>
                    handlers.onRenameCategory(cat.id, e.target.value)
                  }
                />
              </div>
              {/* The tag is a suggestion the user can always overrule — it only
                  moves money between the summary's buckets, never out of the
                  budget. */}
              <div className="w-32 shrink-0">
                <Select
                  id={`cat-kind-${list}-${cat.id}`}
                  size="sm"
                  hideLabel
                  labelText="Kategoritype"
                  value={cat.kind ?? "expense"}
                  onChange={(e) =>
                    handlers.onSetCategoryKind(
                      cat.id,
                      e.target.value as CategoryKind
                    )
                  }
                >
                  {CATEGORY_KINDS.map((kind) => (
                    <SelectItem
                      key={kind}
                      value={kind}
                      text={CATEGORY_KIND_LABELS[kind]}
                    />
                  ))}
                </Select>
              </div>
              <span className="text-sm font-semibold whitespace-nowrap tabular-nums">
                {formatDKK(subtotal)}
              </span>
              <Button
                kind="ghost"
                size="sm"
                hasIconOnly
                renderIcon={Add}
                iconDescription="Tilføj udgift i kategorien"
                onClick={() => handlers.onAdd(list, cat.id)}
              />
              {cat.id !== UNCATEGORIZED_ID && (
                <Button
                  kind="danger--ghost"
                  size="sm"
                  hasIconOnly
                  renderIcon={TrashCan}
                  iconDescription="Slet kategori"
                  onClick={() => handlers.onRemoveCategory(cat.id)}
                />
              )}
            </div>
            <div className="space-y-2">
              {catItems.map((item) => (
                <ItemRow
                  key={item.id}
                  list={list}
                  item={item}
                  onUpdate={handlers.onUpdate}
                  onRemove={handlers.onRemove}
                  onDragStart={() => {}}
                  onDragEnd={() => setOverCat(null)}
                />
              ))}
              {catItems.length === 0 && (
                <p className="text-muted-foreground py-1 text-xs italic">
                  Træk udgifter hertil, eller tilføj en med +.
                </p>
              )}
            </div>
          </div>
        )
      })}
      <Button
        kind="ghost"
        size="sm"
        renderIcon={Add}
        onClick={() => handlers.onAddCategory("Ny kategori")}
      >
        Tilføj kategori
      </Button>
    </div>
  )
}

function Figure({
  label,
  amount,
  tone,
}: {
  label: string
  amount: number
  tone?: "income" | "remaining"
}) {
  const cls =
    tone === "remaining"
      ? amount < 0
        ? "text-error"
        : "text-success"
      : tone === "income"
        ? "text-link"
        : ""
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`text-xl font-bold ${cls}`}>{formatDKK(amount)}</p>
    </div>
  )
}

function SavingsBreakdown({ view }: { view: SavingsBreakdownView }) {
  return (
    <div className="space-y-3">
      <Separator />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {view.figures.map((f) => (
          <Figure
            key={f.id}
            label={f.label}
            amount={f.amount}
            tone={f.highlight ? "remaining" : undefined}
          />
        ))}
      </div>
      {view.notes.map((note) => (
        <p key={note} className="text-muted-foreground text-xs">
          {note}
        </p>
      ))}
    </div>
  )
}

/**
 * Lets a couple say "we save X together and Y each". Only the attribution of an
 * already-computed household figure changes here — no amount moves in or out of
 * the budget, so every downstream total is untouched by the choice.
 */
function SavingsSplitCard({
  view,
  config,
  attribution,
  onChange,
}: {
  view: SavingsSplitView
  config: SavingsConfig | undefined
  attribution: SavingsAttribution
  onChange: (patch: Partial<SavingsConfig>) => void
}) {
  const split = config?.split ?? DEFAULT_SAVINGS_SPLIT
  const manual = config?.manual === true
  const allocation = config?.allocation ?? { p1: 0, p2: 0 }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Opsparing — fælles og hver for sig</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioButtonGroup
          legendText="Hvordan deler I opsparingen?"
          name="savings-split"
          valueSelected={split}
          onChange={(value) => onChange({ split: value as SavingsSplit })}
        >
          {SAVINGS_SPLITS.map((option) => (
            <RadioButton
              key={option}
              labelText={SAVINGS_SPLIT_LABELS[option]}
              value={option}
              id={`savings-split-${option}`}
            />
          ))}
        </RadioButtonGroup>

        {split === "individual" && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MoneyInput
                id="savings-shared"
                label="Fælles opsparing / md."
                value={config?.sharedPortion ?? 0}
                onChange={(v) => onChange({ sharedPortion: v })}
              />
              {manual && (
                <>
                  <MoneyInput
                    id="savings-p1"
                    label={`${view.p1Label} / md.`}
                    value={allocation.p1}
                    onChange={(v) =>
                      onChange({ allocation: { ...allocation, p1: v } })
                    }
                  />
                  <MoneyInput
                    id="savings-p2"
                    label={`${view.p2Label} / md.`}
                    value={allocation.p2}
                    onChange={(v) =>
                      onChange({ allocation: { ...allocation, p2: v } })
                    }
                  />
                </>
              )}
            </div>
            <Checkbox
              id="savings-manual"
              labelText="Vi lægger forskellige beløb til side hver især"
              checked={manual}
              onChange={(_e, { checked }) =>
                onChange(statedSavingsPatch(config, checked, attribution))
              }
            />
          </>
        )}

        {view.warning && (
          <InlineNotification
            className="max-w-full"
            kind="warning"
            lowContrast
            hideCloseButton
            title="Mere fordelt end sparet op"
            subtitle={view.warning}
          />
        )}
        <SavingsBreakdown view={view} />
      </CardContent>
    </Card>
  )
}

export function BudgetPlanner() {
  const router = useRouter()
  const budget = useBudget()
  const {
    state,
    monthlyNetIncome,
    person2MonthlyNetIncome,
    p1Income,
    p2Income,
    sharedTotal,
    p1Total,
    p2Total,
    budgetIncome,
    budgetExpenses,
    remaining,
    setMode,
    setPersonField,
    addItem,
    updateItem,
    removeItem,
    setItemCategory,
    replaceItems,
    addCategory,
    renameCategory,
    removeCategory,
    setCategoryKind,
    setAssumptions,
    setMortgage,
    setSavings,
    mortgageMonthly,
    savingsAttribution,
  } = budget
  const savingsView = savingsBreakdownView(budget)
  const splitView = savingsSplitView({
    attribution: savingsAttribution,
    mode: state.mode,
    p1Name: state.person1.name,
    p2Name: state.person2.name,
    mortgageMonthly,
  })
  const [wizardOpen, setWizardOpen] = useState(false)
  const mortgage = state.mortgage
  const mortgageBreakdown = computeMortgage(mortgage)
  // Existing expense lines that look like a mortgage (to warn about double-counting).
  const mortgageLikeItems = [
    ...state.sharedItems,
    ...state.person1.items,
    ...state.person2.items,
  ].filter((i) => i.amount > 0 && looksLikeMortgage(i.label))

  const handlers: ExpenseHandlers = {
    onAdd: addItem,
    onUpdate: updateItem,
    onRemove: removeItem,
    onMove: setItemCategory,
    onAddCategory: addCategory,
    onRenameCategory: renameCategory,
    onRemoveCategory: removeCategory,
    onSetCategoryKind: setCategoryKind,
  }

  const twoPeople = state.mode !== "single"
  const primaryList: ExpenseList = state.mode === "separate" ? "p1" : "shared"

  const skatMissing =
    state.person1.incomeSource === "skat" && monthlyNetIncome <= 0

  // Household totals come off the shared summary rather than being derived here
  // — the same re-derivation is what let /resultat and /planlaegning drift
  // apart (issue #2). The mortgage sits outside the categorised lines, so it is
  // added back for display.
  const combinedSpent = budgetExpenses + mortgageMonthly
  const combinedSpentLabel =
    mortgageMonthly > 0 ? "Udgifter (inkl. lån)" : "Udgifter i alt"
  const spentPct =
    budgetIncome > 0 ? Math.min((combinedSpent / budgetIncome) * 100, 100) : 0

  return (
    <main
      style={{
        maxWidth: state.mode === "separate" ? "1100px" : "880px",
        margin: "0 auto",
        padding: "2rem 1.5rem 4rem",
      }}
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <header className="border-l-4 border-[var(--cds-border-interactive)] pl-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Månedligt budget
          </h1>
          <p className="text-muted-foreground text-sm">
            Grupperet i kategorier — træk udgifter mellem kategorier, og opret
            dine egne.
          </p>
        </header>
        <Button
          kind="tertiary"
          size="md"
          renderIcon={MagicWand}
          onClick={() => setWizardOpen(true)}
        >
          Generér startbudget
        </Button>
      </div>

      <BudgetWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onGenerate={(items, assumptions, ownsHome) => {
          replaceItems(primaryList, items)
          if (ownsHome) setMortgage({ enabled: true })
          setAssumptions(assumptions)
        }}
      />

      {/* Household mode */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <RadioButtonGroup
            legendText="Husstand"
            name="budget-mode"
            valueSelected={state.mode}
            onChange={(value) => setMode(value as typeof state.mode)}
          >
            <RadioButton labelText="Én person" value="single" id="mode-single" />
            <RadioButton
              labelText="To personer · delte udgifter"
              value="shared"
              id="mode-shared"
            />
            <RadioButton
              labelText="To personer · separat økonomi"
              value="separate"
              id="mode-separate"
            />
          </RadioButtonGroup>
        </CardContent>
      </Card>

      {/* Income */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Indkomst</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Person 1 */}
          <div className="space-y-3">
            {twoPeople && (
              <TextInput
                id="p1-name"
                size="sm"
                labelText="Navn (person 1)"
                value={state.person1.name}
                onChange={(e) => setPersonField("person1", "name", e.target.value)}
              />
            )}
            <RadioButtonGroup
              legendText={twoPeople ? `Indkomst – ${state.person1.name}` : "Indkomst"}
              name="p1-source"
              valueSelected={state.person1.incomeSource}
              onChange={(value) =>
                setPersonField(
                  "person1",
                  "incomeSource",
                  value as "skat" | "manual"
                )
              }
            >
              <RadioButton
                labelText="Fra skatteberegner"
                value="skat"
                id="p1-src-skat"
              />
              <RadioButton
                labelText="Indtast manuelt"
                value="manual"
                id="p1-src-manual"
              />
            </RadioButtonGroup>

            {state.person1.incomeSource === "manual" ? (
              <div className="w-48">
                <TextInput
                  id="p1-manual-income"
                  type="number"
                  size="md"
                  labelText="Nettoløn / md. (kr.)"
                  min={0}
                  value={state.person1.manualIncome || ""}
                  onChange={(e) =>
                    setPersonField(
                      "person1",
                      "manualIncome",
                      Math.round(parseFloat(e.target.value) || 0)
                    )
                  }
                />
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Nettoløn fra skatteberegner:{" "}
                <span className="text-foreground font-medium">
                  {formatDKK(monthlyNetIncome)}/md.
                </span>
              </p>
            )}
          </div>

          {/* Person 2 */}
          {twoPeople && (
            <>
              <Separator />
              <div className="space-y-3">
                <TextInput
                  id="p2-name"
                  size="sm"
                  labelText="Navn (person 2)"
                  value={state.person2.name}
                  onChange={(e) =>
                    setPersonField("person2", "name", e.target.value)
                  }
                />
                <RadioButtonGroup
                  legendText={`Indkomst – ${state.person2.name}`}
                  name="p2-source"
                  valueSelected={state.person2.incomeSource}
                  onChange={(value) =>
                    setPersonField(
                      "person2",
                      "incomeSource",
                      value as "skat" | "manual"
                    )
                  }
                >
                  <RadioButton
                    labelText="Fra skatteberegner (person 2)"
                    value="skat"
                    id="p2-src-skat"
                  />
                  <RadioButton
                    labelText="Indtast manuelt"
                    value="manual"
                    id="p2-src-manual"
                  />
                </RadioButtonGroup>

                {state.person2.incomeSource === "manual" ? (
                  <div className="w-48">
                    <TextInput
                      id="p2-manual-income"
                      type="number"
                      size="md"
                      labelText="Nettoløn / md. (kr.)"
                      min={0}
                      value={state.person2.manualIncome || ""}
                      onChange={(e) =>
                        setPersonField(
                          "person2",
                          "manualIncome",
                          Math.round(parseFloat(e.target.value) || 0)
                        )
                      }
                    />
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Nettoløn fra skatteberegner (person 2):{" "}
                    <span className="text-foreground font-medium">
                      {formatDKK(person2MonthlyNetIncome)}/md.
                    </span>
                    {person2MonthlyNetIncome <= 0 &&
                      " — tilføj person 2 i skatteberegneren."}
                  </p>
                )}
              </div>
            </>
          )}

          {skatMissing && (
            <div className="space-y-2">
              <InlineNotification
                className="max-w-full"
                kind="info"
                lowContrast
                hideCloseButton
                title="Ingen nettoløn endnu"
                subtitle="Beregn din skat, eller vælg “Indtast manuelt”."
              />
              <Button
                kind="tertiary"
                size="sm"
                onClick={() => router.push("/skat")}
              >
                Gå til skatteberegner
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mortgage */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Realkreditlån</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Checkbox
            id="mortgage-enabled"
            labelText="Jeg ejer boligen og afdrager på et realkreditlån"
            checked={mortgage.enabled}
            onChange={(_e, { checked }) => setMortgage({ enabled: checked })}
          />
          {mortgage.enabled && (
            <>
              {mortgageLikeItems.length > 0 && (
                <InlineNotification
                  className="max-w-full"
                  kind="warning"
                  lowContrast
                  hideCloseButton
                  title="Muligt dobbelt-tal"
                  subtitle={`Du har også en udgiftslinje, der ligner et boliglån (${mortgageLikeItems
                    .map((i) => i.label)
                    .join(", ")}). Sæt den til 0, så lånet ikke tælles med to gange.`}
                />
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <MoneyInput
                  id="m-home"
                  label="Boligværdi"
                  value={mortgage.homeValue}
                  onChange={(v) => setMortgage({ homeValue: v })}
                />
                <NumberInput
                  id="m-years"
                  label="Restløbetid (år)"
                  min={1}
                  max={40}
                  value={mortgage.remainingYears}
                  onChange={(_e, { value }) =>
                    setMortgage({
                      remainingYears: Math.max(
                        1,
                        Math.round(
                          typeof value === "number"
                            ? value
                            : parseFloat(value) || mortgage.remainingYears
                        )
                      ),
                    })
                  }
                />
                <NumberInput
                  id="m-ltv"
                  label="Belåningsgrad (%)"
                  min={0}
                  max={100}
                  value={Math.round(mortgage.ltv * 100)}
                  onChange={(_e, { value }) =>
                    setMortgage({
                      ltv:
                        Math.min(
                          100,
                          Math.max(
                            0,
                            typeof value === "number"
                              ? value
                              : parseFloat(value) || 0
                          )
                        ) / 100,
                    })
                  }
                />
                <NumberInput
                  id="m-rate"
                  label="Rente (% p.a.)"
                  step={0.1}
                  value={Math.round(mortgage.interestRate * 1000) / 10}
                  onChange={(_e, { value }) =>
                    setMortgage({
                      interestRate:
                        (typeof value === "number"
                          ? value
                          : parseFloat(value) || 0) / 100,
                    })
                  }
                />
                <NumberInput
                  id="m-bidrag"
                  label="Bidragssats (% p.a.)"
                  step={0.05}
                  value={Math.round(mortgage.bidragssats * 1000) / 10}
                  onChange={(_e, { value }) =>
                    setMortgage({
                      bidragssats:
                        (typeof value === "number"
                          ? value
                          : parseFloat(value) || 0) / 100,
                    })
                  }
                />
                <div className="flex items-end">
                  <Checkbox
                    id="m-io"
                    labelText="Afdragsfrihed"
                    checked={mortgage.interestOnly}
                    onChange={(_e, { checked }) =>
                      setMortgage({ interestOnly: checked })
                    }
                  />
                </div>
              </div>

              <Separator />
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Figure label="Renter / md." amount={mortgageBreakdown.monthlyInterest} />
                <Figure label="Bidrag / md." amount={mortgageBreakdown.monthlyBidrag} />
                <Figure label="Afdrag / md." amount={mortgageBreakdown.monthlyAfdrag} />
                <Figure
                  label="Ydelse i alt / md."
                  amount={mortgageBreakdown.monthlyTotal}
                  tone="income"
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Restgæld: {formatDKK(mortgageBreakdown.loan)} ·{" "}
                {mortgage.interestOnly
                  ? "Afdragsfrit — gælden afdrages ikke"
                  : `Gældfri om ${mortgage.remainingYears} år`}
                . Afdraget tæller ikke som forbrug i Planlægning — det bygger
                friværdi.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Joint vs. personal savings — a couple only */}
      {splitView && (
        <SavingsSplitCard
          view={splitView}
          config={state.savings}
          attribution={savingsAttribution}
          onChange={setSavings}
        />
      )}

      {/* Summary + expenses */}
      {state.mode === "separate" ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {(["p1", "p2"] as const).map((key) => {
              const person = key === "p1" ? state.person1 : state.person2
              const income = key === "p1" ? p1Income : p2Income
              const exp = key === "p1" ? p1Total : p2Total
              return (
                <Card
                  key={key}
                  className="border-t-4 border-[var(--cds-border-interactive)]"
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{person.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-3">
                      <Figure label="Indkomst" amount={income} tone="income" />
                      <Figure label="Udgifter" amount={exp} />
                      {/* The realkredit payment is a household obligation with no
                          stated split, so it is not apportioned to either person
                          — the label says so, and the card below carries it. */}
                      <Figure
                        label={
                          mortgageMonthly > 0
                            ? "Til rådighed før lån"
                            : "Til rådighed"
                        }
                        amount={income - exp}
                        tone="remaining"
                      />
                    </div>
                    <CategorizedExpenses
                      list={key}
                      items={person.items}
                      categories={state.categories}
                      handlers={handlers}
                    />
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {(mortgageMonthly > 0 || savingsView) && (
            <Card className="mt-4 border-t-4 border-[var(--cds-border-interactive)]">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Husstanden samlet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-4">
                  <Figure
                    label="Samlet indkomst"
                    amount={budgetIncome}
                    tone="income"
                  />
                  <Figure label={combinedSpentLabel} amount={combinedSpent} />
                  <Figure
                    label="Til rådighed"
                    amount={remaining}
                    tone="remaining"
                  />
                </div>
                {mortgageMonthly > 0 && (
                  <p className="text-muted-foreground text-xs">
                    Realkreditlånet ({formatDKK(mortgageMonthly)}/md.) er en fælles
                    udgift og er ikke fordelt mellem jer. Derfor er summen af de to
                    beløb ovenfor højere end husstandens reelle rådighedsbeløb.
                  </p>
                )}
                {savingsView && <SavingsBreakdown view={savingsView} />}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
          <Card className="mb-6 border-t-4 border-[var(--cds-border-interactive)]">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Oversigt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Figure
                  label={twoPeople ? "Samlet indkomst" : "Nettoløn / md."}
                  amount={budgetIncome}
                  tone="income"
                />
                <Figure label={combinedSpentLabel} amount={combinedSpent} />
                <Figure
                  label="Til rådighed"
                  amount={remaining}
                  tone="remaining"
                />
              </div>
              {budgetIncome > 0 && (
                <ProgressBar
                  label="Andel af indkomst brugt"
                  helperText={`${Math.round(spentPct)}% af indkomsten er disponeret`}
                  value={spentPct}
                  max={100}
                  status={remaining < 0 ? "error" : "active"}
                />
              )}
              {twoPeople && (
                <p className="text-muted-foreground text-xs">
                  Delte udgifter pr. person (50/50): {formatDKK(sharedTotal / 2)}
                  /md.
                </p>
              )}
              {savingsView && <SavingsBreakdown view={savingsView} />}
            </CardContent>
          </Card>

          <h2 className="mb-2 text-sm font-medium">Delte udgifter</h2>
          <CategorizedExpenses
            list="shared"
            items={state.sharedItems}
            categories={state.categories}
            handlers={handlers}
          />

          <Separator className="my-4" />

          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Til rådighed efter udgifter</span>
            <span
              className={`text-lg font-bold ${
                remaining < 0 ? "text-error" : "text-success"
              }`}
            >
              {formatDKK(remaining)} / md.
            </span>
          </div>
        </>
      )}
    </main>
  )
}
