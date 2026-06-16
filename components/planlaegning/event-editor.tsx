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

const TYPE_LABEL: Record<PlanningEventType, string> = {
  expense: "Stor engangsudgift (fx bryllup)",
  windfall: "Engangsindtægt (fx arv, bonus)",
  recurring: "Ændring i månedlig opsparing",
  property: "Køb/salg af bolig",
}

interface Draft {
  type: PlanningEventType
  label: string
  age: number
  amount: number
  monthlyDelta: number
  newValue: number
  mortgageLtv: number
  housingReturnPct: number
}

function toDraft(event: PlanningEvent | null, fallbackAge: number): Draft {
  const base: Draft = {
    type: "expense",
    label: "",
    age: fallbackAge,
    amount: 100000,
    monthlyDelta: 2000,
    newValue: 3000000,
    mortgageLtv: 80,
    housingReturnPct: 2,
  }
  if (!event) return base
  const d: Draft = { ...base, type: event.type, label: event.label, age: event.age }
  if (event.type === "expense" || event.type === "windfall") d.amount = event.amount
  if (event.type === "recurring") d.monthlyDelta = event.monthlyDelta
  if (event.type === "property") {
    d.newValue = event.newValue
    d.mortgageLtv = Math.round(event.mortgageLtv * 100)
    d.housingReturnPct =
      event.housingReturnOverride != null
        ? Math.round(event.housingReturnOverride * 1000) / 10
        : 2
  }
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
    case "property":
      return {
        type: "property",
        label: d.label,
        age: d.age,
        newValue: d.newValue,
        mortgageLtv: d.mortgageLtv / 100,
        housingReturnOverride: d.housingReturnPct / 100,
      }
  }
}

function num(value: number | string, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(value)
  return Number.isNaN(n) ? fallback : n
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
          <NumberInput
            id="event-amount"
            label="Beløb (kr.)"
            min={0}
            step={10000}
            value={draft.amount}
            onChange={(_e, { value }) => set("amount", num(value, 0))}
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

        {draft.type === "property" && (
          <>
            <NumberInput
              id="event-newvalue"
              label="Pris på ny bolig (kr.)"
              min={0}
              step={100000}
              value={draft.newValue}
              onChange={(_e, { value }) => set("newValue", num(value, 0))}
            />
            <NumberInput
              id="event-ltv"
              label="Belåningsgrad / LTV (%)"
              min={0}
              max={100}
              step={5}
              value={draft.mortgageLtv}
              onChange={(_e, { value }) => set("mortgageLtv", num(value, 80))}
            />
            <NumberInput
              id="event-housing-roi"
              label="Forventet afkast på den nye bolig (% pr. år)"
              step={0.5}
              value={draft.housingReturnPct}
              onChange={(_e, { value }) =>
                set("housingReturnPct", num(value, 2))
              }
            />
            <p className="text-muted-foreground text-xs">
              Den nuværende friværdi frigøres til investeringer, udbetalingen
              (boligpris × (1 − LTV)) trækkes fra igen, og restgælden bliver
              boligpris × LTV.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
