"use client"

import { useEffect, useState } from "react"
import { Modal, TextInput, NumberInput, Checkbox } from "@carbon/react"
import type {
  NewPlanningEvent,
  PlanningScenario,
  ScenarioChanges,
} from "@/lib/planning/types"
import { MoneyInput } from "./money-input"

interface Draft {
  name: string
  /** Extra monthly saving from now on (kr./md.); can be negative; 0 = none. */
  monthlySavingDelta: number
  setRetirementAge: boolean
  retirementAge: number
  /** One-off windfall (kr.); 0 = none. */
  windfallAmount: number
  windfallAge: number
}

function toDraft(
  scenario: PlanningScenario | null,
  currentAge: number,
  retirementAge: number
): Draft {
  const base: Draft = {
    name: "",
    monthlySavingDelta: 2000,
    setRetirementAge: false,
    retirementAge,
    windfallAmount: 0,
    windfallAge: currentAge + 5,
  }
  if (!scenario) return base
  const d: Draft = { ...base, name: scenario.name }
  const c = scenario.changes
  const recurring = c.addEvents?.find((e) => e.type === "recurring")
  if (recurring && recurring.type === "recurring") d.monthlySavingDelta = recurring.monthlyDelta
  const windfall = c.addEvents?.find((e) => e.type === "windfall")
  if (windfall && windfall.type === "windfall") {
    d.windfallAmount = windfall.amount
    d.windfallAge = windfall.age
  }
  if (c.overrides?.retirementAge != null) {
    d.setRetirementAge = true
    d.retirementAge = c.overrides.retirementAge
  }
  return d
}

function fromDraft(d: Draft, currentAge: number): ScenarioChanges {
  const addEvents: NewPlanningEvent[] = []
  if (d.monthlySavingDelta !== 0) {
    addEvents.push({
      type: "recurring",
      label: d.name || "Opsparingsændring",
      age: currentAge,
      monthlyDelta: d.monthlySavingDelta,
    })
  }
  if (d.windfallAmount > 0) {
    addEvents.push({
      type: "windfall",
      label: d.name || "Engangsindtægt",
      age: d.windfallAge,
      amount: d.windfallAmount,
    })
  }
  const changes: ScenarioChanges = {}
  if (addEvents.length > 0) changes.addEvents = addEvents
  if (d.setRetirementAge) changes.overrides = { retirementAge: d.retirementAge }
  return changes
}

function num(value: number | string, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(value)
  return Number.isNaN(n) ? fallback : n
}

export function ScenarioEditor({
  open,
  initial,
  currentAge,
  retirementAge,
  endAge,
  onClose,
  onSave,
}: {
  open: boolean
  /** Scenario being edited, or null when adding a new one. */
  initial: PlanningScenario | null
  currentAge: number
  retirementAge: number
  endAge: number
  onClose: () => void
  onSave: (name: string, changes: ScenarioChanges, id?: string) => void
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    toDraft(initial, currentAge, retirementAge)
  )

  useEffect(() => {
    if (open) setDraft(toDraft(initial, currentAge, retirementAge))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  return (
    <Modal
      open={open}
      modalHeading={initial ? "Redigér scenarie" : "Nyt scenarie"}
      modalLabel="Sammenlign et hvad-nu-hvis med din basisplan"
      primaryButtonText="Gem"
      secondaryButtonText="Annullér"
      primaryButtonDisabled={!draft.name.trim()}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        onSave(draft.name, fromDraft(draft, currentAge), initial?.id)
        onClose()
      }}
    >
      <div className="space-y-4">
        <TextInput
          id="scenario-name"
          labelText="Navn"
          placeholder="F.eks. Løn +5 %"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
        />
        <NumberInput
          id="scenario-saving"
          label="Ændring i månedlig opsparing fra nu (kr./md., kan være negativ)"
          step={500}
          value={draft.monthlySavingDelta}
          onChange={(_e, { value }) => set("monthlySavingDelta", num(value, 0))}
        />
        <Checkbox
          id="scenario-set-retire"
          labelText="Ændr pensionsalder i scenariet"
          checked={draft.setRetirementAge}
          onChange={(_e, { checked }) => set("setRetirementAge", checked)}
        />
        {draft.setRetirementAge && (
          <NumberInput
            id="scenario-retire-age"
            label="Pensionsalder i scenariet"
            min={currentAge}
            max={endAge}
            value={draft.retirementAge}
            onChange={(_e, { value }) =>
              set("retirementAge", num(value, retirementAge))
            }
          />
        )}
        <MoneyInput
          id="scenario-windfall"
          label="Engangsindtægt i scenariet (kr., 0 = ingen)"
          value={draft.windfallAmount}
          onChange={(v) => set("windfallAmount", v)}
        />
        {draft.windfallAmount > 0 && (
          <NumberInput
            id="scenario-windfall-age"
            label="Alder ved engangsindtægten"
            min={currentAge}
            max={endAge}
            value={draft.windfallAge}
            onChange={(_e, { value }) => set("windfallAge", num(value, currentAge))}
          />
        )}
        <p className="text-muted-foreground text-xs">
          Scenariet lægges oven på din basisplan, så du kan se forskellen — din
          basisplan ændres ikke.
        </p>
      </div>
    </Modal>
  )
}
