"use client"

import { useState } from "react"
import {
  Button,
  Dropdown,
  InlineNotification,
  NumberInput,
  Tag,
  TextInput,
} from "@carbon/react"
import { Add, ChevronDown, ChevronUp, TrashCan } from "@carbon/icons-react"
import { MoneyInput, PercentField, num } from "./money-input"
import {
  LOAN_TYPES,
  LOAN_TYPE_LABEL,
  clampBidragssats,
  clampLoanRate,
  clampPrincipal,
  clampTermMonths,
  hasDanglingSecurity,
  loanSummary,
  maxInterestOnlyYears,
  missingSecurityNotice,
  newPlannedLoan,
  removeLoan,
  replaceLoan,
  securitySummary,
} from "@/lib/planning/loans"
import type {
  LoanType,
  PlannedLoan,
  PlannedProperty,
} from "@/lib/planning/types"

/**
 * The security dropdown's stand-in for "no property at all". Its items are
 * property *ids* rather than labels, because two properties may share a label
 * and picking one by name would then edit the wrong loan's pant — and no id
 * collides with the empty string.
 */
const NO_SECURITY = ""

/**
 * The household's debts: what each one owes, what it costs and what secures it.
 *
 * Shaped like {@link PropertyList} — inline editing, one open row — for the same
 * reason: a loan is a set of numbers the user checks against each other and
 * against the other loans, and a dialog would hide the rest of the list exactly
 * when it is being compared.
 *
 * `bidragssats` is shown for realkredit loans only, since a banklån carries
 * none, and is the one field the user is not asked to guess at: it arrives with
 * /budget's own figure, the only place the fee and the payment it is reconciled
 * against are guaranteed to describe one loan. Editable all the same, because a
 * second realkreditlån has a bidragssats of its own that the budget's single
 * housing line cannot carry.
 */
export function LoanList({
  loans,
  properties,
  currentAge,
  onChange,
}: {
  loans: PlannedLoan[]
  properties: PlannedProperty[]
  currentAge: number
  onChange: (next: PlannedLoan[]) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const notice = missingSecurityNotice(loans, properties)

  const add = (type: LoanType) => {
    // A realkreditlån is secured on property by definition, so it starts on the
    // household's home; a banklån starts on nothing, which is what one is.
    const created = newPlannedLoan(
      type,
      type === "realkredit" ? (properties[0]?.id ?? null) : null
    )
    onChange([...loans, created])
    setOpenId(created.id)
  }

  return (
    <div className="space-y-3">
      {loans.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Ingen gæld. Tilføj dine lån for at få ydelse, rentefradrag og
          restgælden med i fremskrivningen.
        </p>
      ) : (
        <ul className="space-y-2">
          {loans.map((loan) => {
            const open = openId === loan.id
            const patch = (fields: Partial<PlannedLoan>) =>
              onChange(replaceLoan(loans, { ...loan, ...fields }))
            const dangling = hasDanglingSecurity(loan, properties)
            const securityItems = [
              NO_SECURITY,
              ...properties.map((p) => p.id),
              // A link to a property the plan no longer has stays selectable,
              // so the dropdown shows what the loan actually says instead of
              // quietly reading it as unsecured.
              ...(dangling && loan.propertyId ? [loan.propertyId] : []),
            ]
            return (
              <li key={loan.id} className="border bg-muted/20">
                <div className="flex items-center gap-2 p-2">
                  <Tag type="cool-gray" size="sm">
                    {LOAN_TYPE_LABEL[loan.type]}
                  </Tag>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {loan.label || "(uden navn)"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {loanSummary(loan, properties, currentAge)}
                    </p>
                  </div>
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    renderIcon={open ? ChevronUp : ChevronDown}
                    iconDescription={open ? "Skjul" : "Redigér"}
                    onClick={() => setOpenId(open ? null : loan.id)}
                  />
                  <Button
                    kind="danger--ghost"
                    size="sm"
                    hasIconOnly
                    renderIcon={TrashCan}
                    iconDescription="Fjern"
                    onClick={() => onChange(removeLoan(loans, loan.id))}
                  />
                </div>
                {open && (
                  <div className="grid grid-cols-1 gap-4 border-t p-3 sm:grid-cols-2">
                    <TextInput
                      id={`loan-label-${loan.id}`}
                      labelText="Navn"
                      value={loan.label}
                      onChange={(e) => patch({ label: e.target.value })}
                    />
                    <Dropdown
                      id={`loan-type-${loan.id}`}
                      titleText="Type"
                      label="Vælg type"
                      items={LOAN_TYPES}
                      selectedItem={loan.type}
                      itemToString={(t) => (t ? LOAN_TYPE_LABEL[t] : "")}
                      onChange={({ selectedItem }) => {
                        if (!selectedItem) return
                        // The fee goes with the type: a banklån has no
                        // reservefonds- og administrationsbidrag to charge, and
                        // leaving the old rate behind would bill one anyway.
                        // `clampBidragssats` owns that rule, so the dropdown
                        // and the field below cannot come to disagree on it.
                        patch({
                          type: selectedItem,
                          bidragssats: clampBidragssats(
                            loan.bidragssats,
                            selectedItem
                          ),
                        })
                      }}
                    />
                    {/* These write into the plan the projection reads, so each
                        is bounded here and not only on reload: a rate of 900 %
                        or a term of 500 years otherwise prices the household's
                        debt on screen and then comes back trimmed, leaving two
                        projections of one saved plan. The bounds belong to
                        `lib/planning/loans.ts`, where the normalizer takes them
                        from too, so the two sides cannot disagree. */}
                    <MoneyInput
                      id={`loan-principal-${loan.id}`}
                      label="Restgæld"
                      value={loan.principal}
                      onChange={(v) => patch({ principal: clampPrincipal(v) })}
                    />
                    <PercentField
                      id={`loan-rate-${loan.id}`}
                      label="Rente"
                      value={loan.rate}
                      onChange={(v) =>
                        patch({ rate: clampLoanRate(v, loan.rate) })
                      }
                    />
                    <NumberInput
                      id={`loan-term-${loan.id}`}
                      label="Afdragstid (år)"
                      min={1}
                      max={40}
                      value={Math.round(loan.termMonths / 12)}
                      onChange={(_e, { value }) => {
                        const years = num(value, loan.termMonths / 12)
                        // Carbon's min and max only mark the field invalid —
                        // the figure is reported either way.
                        const termMonths = clampTermMonths(
                          years * 12,
                          loan.termMonths
                        )
                        // The afdragsfrihed comes down with the term, so
                        // shortening a loan cannot leave one that is never
                        // repaid — which the normalizer would trim silently.
                        patch({
                          termMonths,
                          interestOnlyYears: Math.min(
                            loan.interestOnlyYears,
                            maxInterestOnlyYears({ termMonths })
                          ),
                        })
                      }}
                    />
                    <NumberInput
                      id={`loan-interest-only-${loan.id}`}
                      label="Afdragsfrihed (år tilbage)"
                      helperText="Lånet har samme udløb — restgælden afdrages bagefter over færre år, så ydelsen stiger."
                      min={0}
                      max={maxInterestOnlyYears(loan)}
                      value={loan.interestOnlyYears}
                      onChange={(_e, { value }) =>
                        patch({
                          interestOnlyYears: Math.min(
                            num(value, loan.interestOnlyYears),
                            maxInterestOnlyYears(loan)
                          ),
                        })
                      }
                    />
                    <Dropdown
                      id={`loan-security-${loan.id}`}
                      titleText="Pant i"
                      label="Vælg bolig"
                      helperText="Restgælden trækkes fra friværdien i den bolig — og afregnes, hvis den sælges."
                      items={securityItems}
                      selectedItem={loan.propertyId ?? NO_SECURITY}
                      itemToString={(id) =>
                        securitySummary(
                          { ...loan, propertyId: id || null },
                          properties
                        )
                      }
                      onChange={({ selectedItem }) =>
                        patch({ propertyId: selectedItem || null })
                      }
                    />
                    {loan.type === "realkredit" && (
                      <PercentField
                        id={`loan-bidrag-${loan.id}`}
                        label="Bidragssats"
                        step={0.01}
                        helperText="Hentes fra budgettets realkreditlån. Bidraget kan fratrækkes som renteudgift."
                        value={loan.bidragssats}
                        onChange={(v) =>
                          patch({ bidragssats: clampBidragssats(v, loan.type) })
                        }
                      />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {notice && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Lån uden bolig"
          subtitle={notice}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          kind="tertiary"
          size="sm"
          renderIcon={Add}
          onClick={() => add("realkredit")}
        >
          Tilføj realkreditlån
        </Button>
        <Button
          kind="ghost"
          size="sm"
          renderIcon={Add}
          onClick={() => add("bank")}
        >
          Tilføj banklån
        </Button>
      </div>
    </div>
  )
}
