"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Button,
  TextInput,
  ProgressBar,
  InlineNotification,
  RadioButtonGroup,
  RadioButton,
} from "@carbon/react"
import { Add, TrashCan, MagicWand, Draggable } from "@carbon/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useBudget } from "@/components/budget-provider"
import {
  type BudgetItem,
  type BudgetCategory,
  type ExpenseList,
} from "@/hooks/use-budget"
import { UNCATEGORIZED_ID } from "@/lib/budget/categories"
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
    setAssumptions,
  } = budget
  const [wizardOpen, setWizardOpen] = useState(false)

  const handlers: ExpenseHandlers = {
    onAdd: addItem,
    onUpdate: updateItem,
    onRemove: removeItem,
    onMove: setItemCategory,
    onAddCategory: addCategory,
    onRenameCategory: renameCategory,
    onRemoveCategory: removeCategory,
  }

  const twoPeople = state.mode !== "single"
  const primaryList: ExpenseList = state.mode === "separate" ? "p1" : "shared"

  const skatMissing =
    state.person1.incomeSource === "skat" && monthlyNetIncome <= 0

  const combinedIncome = twoPeople ? p1Income + p2Income : p1Income
  const combinedRemaining = combinedIncome - sharedTotal
  const spentPct =
    combinedIncome > 0 ? Math.min((sharedTotal / combinedIncome) * 100, 100) : 0

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
        onGenerate={(items, assumptions) => {
          replaceItems(primaryList, items)
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

      {/* Summary + expenses */}
      {state.mode === "separate" ? (
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
                    <Figure
                      label="Til rådighed"
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
                  amount={combinedIncome}
                  tone="income"
                />
                <Figure label="Udgifter i alt" amount={sharedTotal} />
                <Figure
                  label="Til rådighed"
                  amount={combinedRemaining}
                  tone="remaining"
                />
              </div>
              {combinedIncome > 0 && (
                <ProgressBar
                  label="Andel af indkomst brugt"
                  helperText={`${Math.round(spentPct)}% af indkomsten er disponeret`}
                  value={spentPct}
                  max={100}
                  status={combinedRemaining < 0 ? "error" : "active"}
                />
              )}
              {twoPeople && (
                <p className="text-muted-foreground text-xs">
                  Delte udgifter pr. person (50/50): {formatDKK(sharedTotal / 2)}
                  /md.
                </p>
              )}
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
                combinedRemaining < 0 ? "text-error" : "text-success"
              }`}
            >
              {formatDKK(combinedRemaining)} / md.
            </span>
          </div>
        </>
      )}
    </main>
  )
}
