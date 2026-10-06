"use client"

import { useEffect, useState } from "react"
import {
  Modal,
  Select,
  SelectItem,
  TextInput,
  NumberInput,
} from "@carbon/react"
import type {
  NewPlanningEvent,
  PlanningEvent,
  PlanningEventType,
} from "@/lib/planning/types"
import { MoneyInput, num } from "./money-input"

/**
 * No "Køb/salg af bolig" here any more: moving house is stated in the property
 * list — a salgsalder on the home being left and a second entry bought the same
 * year, with its own belåningsgrad — so that the plan can also say "keep both"
 * and so that each sale settles the loans secured on that house and no others
 * (issue #9).
 */
const TYPE_LABEL: Record<PlanningEventType, string> = {
  expense: "Stor engangsudgift (fx bryllup)",
  windfall: "Engangsindtægt (fx arv, bonus)",
  recurring: "Ændring i månedlig opsparing",
}

interface Draft {
  type: PlanningEventType
  label: string
  age: number
  amount: number
  monthlyDelta: number
}

function toDraft(event: PlanningEvent | null, fallbackAge: number): Draft {
  const base: Draft = {
    type: "expense",
    label: "",
    age: fallbackAge,
    amount: 100000,
    monthlyDelta: 2000,
  }
  if (!event) return base
  const d: Draft = { ...base, type: event.type, label: event.label, age: event.age }
  if (event.type === "expense" || event.type === "windfall") d.amount = event.amount
  if (event.type === "recurring") d.monthlyDelta = event.monthlyDelta
  return d
}

function fromDraft(d: Draft): NewPlanningEvent {
  switch (d.type) {
    case "expense":
      return { type: "expense", label: d.label, age: d.age, amount: d.amount }
    case "windfall":
      return { type: "windfall", label: d.label, age: d.age, amount: d.amount }
    case "recurring":
      return {
        type: "recurring",
        label: d.label,
        age: d.age,
        monthlyDelta: d.monthlyDelta,
      }
  }
}

export function EventEditor({
  open,
  initial,
  minAge,
  maxAge,
  onClose,
  onSave,
}: {
  open: boolean
  /** Event being edited, or null when adding a new one. */
  initial: PlanningEvent | null
  minAge: number
  maxAge: number
  onClose: () => void
  onSave: (event: NewPlanningEvent, id?: string) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial, minAge + 5))

  useEffect(() => {
    if (open) setDraft(toDraft(initial, minAge + 5))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  return (
    <Modal
      open={open}
      modalHeading={initial ? "Redigér begivenhed" : "Tilføj begivenhed"}
      modalLabel="Større ændringer i økonomien"
      primaryButtonText="Gem"
      secondaryButtonText="Annullér"
      onRequestClose={onClose}
      onRequestSubmit={() => {
        onSave(fromDraft(draft), initial?.id)
        onClose()
      }}
    >
      <div className="space-y-4">
        <Select
          id="event-type"
          labelText="Type"
          value={draft.type}
          onChange={(e) => set("type", e.target.value as PlanningEventType)}
        >
          {(Object.keys(TYPE_LABEL) as PlanningEventType[]).map((t) => (
            <SelectItem key={t} value={t} text={TYPE_LABEL[t]} />
          ))}
        </Select>

        <TextInput
          id="event-label"
          labelText="Navn"
          placeholder="F.eks. Bryllup"
          value={draft.label}
          onChange={(e) => set("label", e.target.value)}
        />

        <NumberInput
          id="event-age"
          label="Alder når det sker"
          min={minAge}
          max={maxAge}
          value={draft.age}
          onChange={(_e, { value }) => set("age", num(value, minAge))}
        />

        {(draft.type === "expense" || draft.type === "windfall") && (
          <MoneyInput
            id="event-amount"
            label="Beløb"
            value={draft.amount}
            onChange={(v) => set("amount", v)}
          />
        )}

        {draft.type === "recurring" && (
          <NumberInput
            id="event-delta"
            label="Ændring i månedlig opsparing (kr./md., kan være negativ)"
            step={500}
            value={draft.monthlyDelta}
            onChange={(_e, { value }) => set("monthlyDelta", num(value, 0))}
          />
        )}
      </div>
    </Modal>
  )
}
