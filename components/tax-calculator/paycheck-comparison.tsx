"use client"

import { useCallback, useId, useMemo, useRef, useState } from "react"
import { UploadIcon, FileTextIcon } from "lucide-react"
import {
  Button,
  InlineNotification,
  Select,
  SelectItem,
  TextInput,
  TextArea,
} from "@carbon/react"
import {
  Add,
  TrashCan,
  Copy,
  Checkmark,
  ChevronDown,
  ChevronUp,
} from "@carbon/icons-react"
import dynamic from "next/dynamic"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { CommuteDeduction } from "./commute-deduction"

// recharts is ~400 KB of JS. The chart is only rendered after the user has
// entered/uploaded paycheck data, so load it lazily to keep it off the
// initial /skat critical path.
const PaycheckChart = dynamic(
  () => import("./paycheck-chart").then((m) => m.PaycheckChart),
  {
    ssr: false,
    loading: () => <div className="h-72 w-full" />,
  },
)
import { comparePaycheckToCalculation } from "@/lib/paycheck/compare"
import { generateOptimizationPrompt } from "@/lib/paycheck/generate-prompt"
import type { CommuteInfo } from "@/lib/paycheck/generate-prompt"
import { formatDKK } from "@/lib/format"
import type { TaxInput, TaxResult } from "@/lib/tax/types"
import type {
  PaycheckData,
  PaycheckParseResult,
  ExpectedAdjustment,
} from "@/lib/paycheck/types"

type UploadState =
  | { status: "idle" }
  | { status: "parsing"; message?: string }
  | { status: "success"; parseResult: PaycheckParseResult }
  | { status: "error"; message: string }

const MONTH_OPTIONS = [
  { value: 1, label: "Jan" },
  { value: 2, label: "Feb" },
  { value: 3, label: "Mar" },
  { value: 4, label: "Apr" },
  { value: 5, label: "Maj" },
  { value: 6, label: "Jun" },
  { value: 7, label: "Jul" },
  { value: 8, label: "Aug" },
  { value: 9, label: "Sep" },
  { value: 10, label: "Okt" },
  { value: 11, label: "Nov" },
  { value: 12, label: "Dec" },
]

let nextAdjId = 1

interface PaycheckComparisonProps {
  input: TaxInput
  result: TaxResult
}

export function PaycheckComparison({
  input,
  result,
}: PaycheckComparisonProps) {
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
  })
  const [paycheck, setPaycheck] = useState<PaycheckData | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [adjustments, setAdjustments] = useState<ExpectedAdjustment[]>([])
  const [commuteInfo, setCommuteInfo] = useState<CommuteInfo | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const promptFieldId = useId()

  const comparison = useMemo(
    () =>
      paycheck
        ? comparePaycheckToCalculation(input, result, paycheck, adjustments)
        : null,
    [input, result, paycheck, adjustments]
  )

  const prompt = useMemo(
    () =>
      paycheck && comparison
        ? generateOptimizationPrompt(
            input,
            result,
            paycheck,
            comparison,
            adjustments,
            commuteInfo ?? undefined
          )
        : null,
    [input, result, paycheck, comparison, adjustments, commuteInfo]
  )

  const handleFile = useCallback(async (file: File) => {
    if (file.type !== "application/pdf") {
      setUploadState({
        status: "error",
        message:
          "Filen skal være en PDF. Vælg venligst din lønseddel som PDF.",
      })
      return
    }

    setUploadState({ status: "parsing" })

    try {
      const { parseLoenseddel } = await import(
        "@/lib/pdf/parse-loenseddel"
      )
      const parseResult = await parseLoenseddel(file, {
        onOcrProgress: (fraction) => {
          setUploadState({
            status: "parsing",
            message: `Læser scannet lønseddel (OCR)… ${Math.round(fraction * 100)}%`,
          })
        },
      })

      if (!parseResult.data) {
        setUploadState({
          status: "error",
          message:
            parseResult.warnings[0] ||
            "Kunne ikke genkende lønsedlen.",
        })
        return
      }

      setUploadState({ status: "success", parseResult })
      setPaycheck(parseResult.data)
    } catch {
      setUploadState({
        status: "error",
        message: "Kunne ikke læse PDF-filen. Prøv venligst igen.",
      })
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
      e.target.value = ""
    },
    [handleFile]
  )

  const addAdjustment = useCallback(() => {
    const defaultMonth = paycheck
      ? Math.min(paycheck.month + 1, 12)
      : 6
    setAdjustments((prev) => [
      ...prev,
      {
        id: `adj-${nextAdjId++}`,
        label: "",
        amount: 0,
        month: defaultMonth,
        type: "income",
      },
    ])
  }, [paycheck])

  const updateAdjustment = useCallback(
    (
      id: string,
      field: keyof ExpectedAdjustment,
      value: string | number
    ) => {
      setAdjustments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
      )
    },
    []
  )

  const removeAdjustment = useCallback((id: string) => {
    setAdjustments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const dismiss = useCallback(() => {
    setUploadState({ status: "idle" })
    setPaycheck(null)
    setShowPrompt(false)
    setAdjustments([])
    setCommuteInfo(null)
  }, [])

  const copyPrompt = useCallback(() => {
    if (!prompt) return
    navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [prompt])

  return (
    <div className="mt-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">
            Lønseddel-sammenligning
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            Upload din seneste lønseddel for at sammenligne med din
            forskudsopgørelse
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Upload zone */}
          {!paycheck && (
            <>
              {uploadState.status === "error" && (
                <InlineNotification
                  className="max-w-full"
                  kind="error"
                  lowContrast
                  title="Kunne ikke indlæse lønseddel"
                  subtitle={uploadState.message}
                  onCloseButtonClick={dismiss}
                />
              )}

              <div
                role="button"
                tabIndex={0}
                onClick={handleClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") handleClick()
                }}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/50"
                } ${uploadState.status === "parsing" ? "pointer-events-none opacity-60" : ""}`}
              >
                {uploadState.status === "parsing" ? (
                  <>
                    <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                    <p className="text-sm text-muted-foreground">
                      {uploadState.message ?? "Indlæser lønseddel..."}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {isDragging ? (
                        <FileTextIcon className="size-5" />
                      ) : (
                        <UploadIcon className="size-5" />
                      )}
                      <p className="text-sm">
                        {isDragging
                          ? "Slip filen her"
                          : "Upload din lønseddel (PDF) for at sammenligne"}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground/70">
                      Din fil forbliver i din browser og uploades ikke til
                      nogen server
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleInputChange}
                className="hidden"
                aria-label="Upload lønseddel PDF"
              />
            </>
          )}

          {/* Results */}
          {paycheck && comparison && (
            <>
              {/* Success banner */}
              <InlineNotification
                className="max-w-full"
                kind="success"
                lowContrast
                title="Lønseddel indlæst"
                subtitle={`${paycheck.payPeriod.from} til ${paycheck.payPeriod.to}${
                  uploadState.status === "success"
                    ? ` — ${uploadState.parseResult.fieldsFound.length} felter fundet`
                    : ""
                }`}
                onCloseButtonClick={dismiss}
              />

              {/* Summary KPIs */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-muted-foreground text-xs">
                    Betalt skat (YTD)
                  </p>
                  <p className="text-lg font-bold">
                    {formatDKK(comparison.ytdTaxPaid)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">
                    Forventet skat (år, din indkomst)
                  </p>
                  <p className="text-lg font-bold">
                    {formatDKK(comparison.expectedAnnualIncomeTax)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">
                    Forskudsopgørelse (skat/år)
                  </p>
                  <p className="text-lg font-bold">
                    {formatDKK(comparison.calculatedAnnualTax)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  {/* Driven by the estimated year-end restskat (actual income),
                      so it agrees with the restskat figure shown further down. */}
                  <p
                    className={`text-lg font-bold ${
                      comparison.estimatedRestskat > 1000
                        ? "text-error"
                        : comparison.estimatedRestskat < -1000
                          ? "text-success"
                          : ""
                    }`}
                  >
                    {formatDKK(Math.abs(comparison.estimatedRestskat))}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {comparison.estimatedRestskat > 1000
                      ? "Skylder restskat"
                      : comparison.estimatedRestskat < -1000
                        ? "Får penge tilbage"
                        : "Ca. som forventet"}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Chart */}
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  Kumulativ skat — forventet vs. faktisk
                </h3>
                <PaycheckChart data={comparison.monthlyData} />
              </div>

              {/* Expected adjustments */}
              <Separator />
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-medium">
                    Forventede ændringer resten af året
                  </h3>
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={Add}
                    onClick={addAdjustment}
                  >
                    Tilføj
                  </Button>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  Forventer du bonus, lønstigning, eller andre ændringer? Tilføj
                  dem her for en mere præcis fremskrivning.
                </p>

                {adjustments.length > 0 && (
                  <div className="space-y-2">
                    {adjustments.map((adj) => (
                      <div
                        key={adj.id}
                        className="flex flex-wrap items-end gap-2 border bg-muted/30 p-2"
                      >
                        <div className="min-w-[8rem] flex-1">
                          <TextInput
                            id={`adj-label-${adj.id}`}
                            size="sm"
                            labelText="Beskrivelse"
                            placeholder="F.eks. Bonus, ekstra pension..."
                            value={adj.label}
                            onChange={(e) =>
                              updateAdjustment(adj.id, "label", e.target.value)
                            }
                          />
                        </div>
                        <div className="w-40 shrink-0">
                          <Select
                            id={`adj-type-${adj.id}`}
                            size="sm"
                            labelText="Type"
                            value={adj.type ?? "income"}
                            onChange={(e) =>
                              updateAdjustment(adj.id, "type", e.target.value)
                            }
                          >
                            <SelectItem value="income" text="Ekstra indkomst" />
                            <SelectItem value="pension" text="Ekstra pension" />
                            <SelectItem value="deduction" text="Andet fradrag" />
                          </Select>
                        </div>
                        <div className="w-28 shrink-0">
                          <TextInput
                            id={`adj-amount-${adj.id}`}
                            type="number"
                            size="sm"
                            labelText="Beløb (kr.)"
                            placeholder="0"
                            value={adj.amount || ""}
                            min={0}
                            onChange={(e) =>
                              updateAdjustment(
                                adj.id,
                                "amount",
                                Math.round(parseFloat(e.target.value) || 0)
                              )
                            }
                          />
                        </div>
                        <div className="w-24 shrink-0">
                          <Select
                            id={`adj-month-${adj.id}`}
                            size="sm"
                            labelText="Måned"
                            value={adj.month}
                            onChange={(e) =>
                              updateAdjustment(
                                adj.id,
                                "month",
                                parseInt(e.target.value, 10)
                              )
                            }
                          >
                            {MONTH_OPTIONS.filter(
                              (m) => m.value > (paycheck?.month ?? 0)
                            ).map((m) => (
                              <SelectItem
                                key={m.value}
                                value={m.value}
                                text={m.label}
                              />
                            ))}
                          </Select>
                        </div>
                        <Button
                          kind="danger--ghost"
                          size="sm"
                          hasIconOnly
                          renderIcon={TrashCan}
                          iconDescription="Fjern"
                          onClick={() => removeAdjustment(adj.id)}
                        />
                      </div>
                    ))}
                    {adjustments.some((a) => a.amount > 0) && (
                      <p className="text-xs text-muted-foreground">
                        {(() => {
                          const inc = adjustments
                            .filter((a) => (a.type ?? "income") === "income")
                            .reduce((s, a) => s + a.amount, 0)
                          const red = adjustments
                            .filter((a) => (a.type ?? "income") !== "income")
                            .reduce((s, a) => s + a.amount, 0)
                          const parts: string[] = []
                          if (inc > 0) parts.push(`ekstra indkomst ${formatDKK(inc)}`)
                          if (red > 0)
                            parts.push(`ekstra pension/fradrag ${formatDKK(red)}`)
                          return (
                            <>
                              Forventet {parts.join(" og ")} — inkluderet i
                              fremskrivningen ovenfor.
                            </>
                          )
                        })()}
                      </p>
                    )}
                  </div>
                )}

                {adjustments.length === 0 && (
                  <Button
                    kind="tertiary"
                    size="sm"
                    renderIcon={Add}
                    onClick={addAdjustment}
                  >
                    Tilføj bonus, lønstigning eller anden ændring
                  </Button>
                )}
              </div>

              {/* Commute deduction */}
              <Separator />
              <CommuteDeduction
                input={input}
                parsedEmployeeAddress={paycheck.employeeAddress}
                parsedEmployerAddress={paycheck.employerAddress}
                onCommuteChange={setCommuteInfo}
              />

              {/* Actionable changes + tax consequence */}
              {comparison.discrepancies.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="mb-1 text-sm font-medium">
                      Foreslåede ændringer på skat.dk
                    </h3>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Baseret på din lønseddel bør du opdatere følgende felter
                      i din forskudsopgørelse:
                    </p>
                    <div className="space-y-2">
                      {comparison.discrepancies.map((d, i) => (
                        <div
                          key={i}
                          className="rounded-md border bg-muted/50 p-3"
                        >
                          <div className="flex items-baseline justify-between text-sm">
                            <span className="font-medium">{d.label}</span>
                            <div className="text-right">
                              <span className="font-semibold">
                                {formatDKK(d.paycheckValue)}
                              </span>
                              <span className="text-muted-foreground text-xs ml-1">
                                (nu: {formatDKK(d.calculatorValue)})
                              </span>
                            </div>
                          </div>
                          <p className="text-warning mt-1.5 text-xs">
                            {d.suggestion}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Tax consequence */}
                    {(() => {
                      const restskat = comparison.estimatedRestskat
                      const isOwing = restskat > 0
                      const isSignificant = Math.abs(restskat) > 500
                      if (!isSignificant) return null
                      return (
                        <div className="mt-3 border bg-muted/50 p-3">
                          <p className="text-sm font-medium">
                            {isOwing
                              ? "Forventet restskat ved årsopgørelsen"
                              : "Forventet tilbagebetaling ved årsopgørelsen"}
                          </p>
                          <p
                            className={`text-lg font-bold ${
                              isOwing ? "text-error" : "text-success"
                            }`}
                          >
                            ca. {formatDKK(Math.abs(restskat))}
                          </p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {isOwing
                              ? "Uden ændring af din forskudsopgørelse kan du forvente at skylde dette beløb. Opdatér felterne ovenfor for at undgå restskat."
                              : "Med nuværende trækprocent betaler du mere end nødvendigt. Du kan opdatere din forskudsopgørelse for at få højere løn hver måned."}
                          </p>
                        </div>
                      )
                    })()}
                  </div>
                </>
              )}

              {/* Annual projections */}
              <Separator />
              <div>
                <h3 className="mb-2 text-sm font-medium">
                  Årlig fremskrivning
                </h3>
                <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Forventet årsindkomst
                    </p>
                    <p className="font-semibold">
                      {formatDKK(comparison.projectedAnnualIncome)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      registreret: {formatDKK(comparison.calculatedAnnualIncome)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Skat + AM (din indkomst)
                    </p>
                    <p className="font-semibold">
                      {formatDKK(
                        comparison.expectedAnnualIncomeTax +
                          comparison.projectedAnnualAm
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      forskudsopgørelse:{" "}
                      {formatDKK(
                        comparison.calculatedAnnualTax +
                          comparison.calculatedAnnualAm
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      {comparison.estimatedRestskat >= 0
                        ? "Forventet restskat"
                        : "Forventet overskydende skat"}
                    </p>
                    <p
                      className={`font-semibold ${
                        comparison.estimatedRestskat > 0
                          ? "text-error"
                          : "text-success"
                      }`}
                    >
                      {formatDKK(Math.abs(comparison.estimatedRestskat))}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      forskudsopgørelse + restskat = forventet
                    </p>
                  </div>
                </div>
              </div>

              {/* OpenAI prompt */}
              <Separator />
              <div>
                <Button
                  kind="ghost"
                  size="sm"
                  renderIcon={showPrompt ? ChevronUp : ChevronDown}
                  onClick={() => setShowPrompt(!showPrompt)}
                >
                  AI-optimeringsforslag
                </Button>
                {showPrompt && prompt && (
                  <div className="mt-2 space-y-2">
                    <p className="text-muted-foreground text-xs">
                      Kopiér denne prompt og indsæt den i ChatGPT for at
                      få forslag til ændringer i din forskudsopgørelse.
                    </p>
                    <div className="relative">
                      <TextArea
                        id={promptFieldId}
                        labelText="AI-prompt"
                        hideLabel
                        readOnly
                        rows={8}
                        value={prompt}
                        className="font-mono"
                      />
                      <div className="absolute right-2 top-2">
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          renderIcon={copied ? Checkmark : Copy}
                          iconDescription="Kopiér til udklipsholder"
                          onClick={copyPrompt}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
