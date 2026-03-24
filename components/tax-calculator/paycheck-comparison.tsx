"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import {
  UploadIcon,
  FileTextIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  XIcon,
  CopyIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { PaycheckChart } from "./paycheck-chart"
import { comparePaycheckToCalculation } from "@/lib/paycheck/compare"
import { generateOptimizationPrompt } from "@/lib/paycheck/generate-prompt"
import { formatDKK } from "@/lib/format"
import type { TaxInput, TaxResult } from "@/lib/tax/types"
import type {
  PaycheckData,
  PaycheckParseResult,
  ExpectedAdjustment,
} from "@/lib/paycheck/types"

type UploadState =
  | { status: "idle" }
  | { status: "parsing" }
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
  const fileInputRef = useRef<HTMLInputElement>(null)

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
            adjustments
          )
        : null,
    [input, result, paycheck, comparison, adjustments]
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
      const parseResult = await parseLoenseddel(file)

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
      },
    ])
  }, [paycheck])

  const updateAdjustment = useCallback(
    (id: string, field: keyof ExpectedAdjustment, value: string | number) => {
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
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                  <div className="flex items-start gap-2">
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-red-800 dark:text-red-200">
                        Kunne ikke indlæse lønseddel
                      </p>
                      <p className="text-xs text-red-700 dark:text-red-300">
                        {uploadState.message}
                      </p>
                    </div>
                    <button
                      onClick={dismiss}
                      className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                </div>
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
                      Indlæser lønseddel...
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
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
                <div className="flex items-start gap-2">
                  <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">
                      Lønseddel indlæst
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-300">
                      {paycheck.payPeriod.from} til {paycheck.payPeriod.to}
                      {uploadState.status === "success" &&
                        ` — ${uploadState.parseResult.fieldsFound.length} felter fundet`}
                    </p>
                  </div>
                  <button
                    onClick={dismiss}
                    className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              </div>

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
                    Forventet skat (YTD)
                  </p>
                  <p className="text-lg font-bold">
                    {formatDKK(comparison.ytdTaxExpected)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Forskel</p>
                  <p
                    className={`text-lg font-bold ${
                      comparison.ytdTaxDifference > 0
                        ? "text-red-600 dark:text-red-400"
                        : comparison.ytdTaxDifference < 0
                          ? "text-green-600 dark:text-green-400"
                          : ""
                    }`}
                  >
                    {comparison.ytdTaxDifference >= 0 ? "+" : ""}
                    {formatDKK(comparison.ytdTaxDifference)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <p
                    className={`text-sm font-semibold ${
                      comparison.ytdTaxDifference > 1000
                        ? "text-red-600 dark:text-red-400"
                        : comparison.ytdTaxDifference < -1000
                          ? "text-green-600 dark:text-green-400"
                          : "text-muted-foreground"
                    }`}
                  >
                    {comparison.ytdTaxDifference > 1000
                      ? "Overbetaler skat"
                      : comparison.ytdTaxDifference < -1000
                        ? "Underbetaler skat"
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
                  <button
                    onClick={addAdjustment}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <PlusIcon className="size-3" />
                    Tilføj
                  </button>
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
                        className="flex items-end gap-2 rounded-md border bg-muted/30 p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Beskrivelse
                          </label>
                          <Input
                            type="text"
                            placeholder="F.eks. Bonus, lønstigning..."
                            value={adj.label}
                            onChange={(e) =>
                              updateAdjustment(adj.id, "label", e.target.value)
                            }
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="w-28 shrink-0">
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Beløb (kr.)
                          </label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={adj.amount || ""}
                            onChange={(e) =>
                              updateAdjustment(
                                adj.id,
                                "amount",
                                Math.round(parseFloat(e.target.value) || 0)
                              )
                            }
                            className="h-8 text-right text-sm"
                            min={0}
                          />
                        </div>
                        <div className="w-20 shrink-0">
                          <label className="mb-1 block text-xs text-muted-foreground">
                            Måned
                          </label>
                          <select
                            value={adj.month}
                            onChange={(e) =>
                              updateAdjustment(
                                adj.id,
                                "month",
                                parseInt(e.target.value, 10)
                              )
                            }
                            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                          >
                            {MONTH_OPTIONS.filter(
                              (m) => m.value > (paycheck?.month ?? 0)
                            ).map((m) => (
                              <option key={m.value} value={m.value}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          onClick={() => removeAdjustment(adj.id)}
                          className="mb-0.5 shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Fjern"
                        >
                          <Trash2Icon className="size-4" />
                        </button>
                      </div>
                    ))}
                    {adjustments.some((a) => a.amount > 0) && (
                      <p className="text-xs text-muted-foreground">
                        Samlet forventet ekstra indkomst:{" "}
                        <span className="font-medium text-foreground">
                          {formatDKK(
                            adjustments.reduce((s, a) => s + a.amount, 0)
                          )}
                        </span>{" "}
                        — inkluderet i fremskrivningen ovenfor.
                      </p>
                    )}
                  </div>
                )}

                {adjustments.length === 0 && (
                  <button
                    onClick={addAdjustment}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-3 text-xs text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted/50"
                  >
                    <PlusIcon className="size-3.5" />
                    Tilføj bonus, lønstigning eller anden ændring
                  </button>
                )}
              </div>

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
                          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                            {d.suggestion}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Tax consequence */}
                    {(() => {
                      const taxDiff =
                        comparison.projectedAnnualTax +
                        comparison.projectedAnnualAm -
                        (comparison.calculatedAnnualTax +
                          comparison.calculatedAnnualAm)
                      const isOwing = taxDiff < 0
                      return (
                        <div
                          className={`mt-3 rounded-md border p-3 ${
                            isOwing
                              ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                              : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                          }`}
                        >
                          <p className="text-sm font-medium">
                            {isOwing
                              ? "Forventet restskat ved årsopgørelsen"
                              : "Forventet tilbagebetaling ved årsopgørelsen"}
                          </p>
                          <p
                            className={`text-lg font-bold ${
                              isOwing
                                ? "text-red-600 dark:text-red-400"
                                : "text-green-600 dark:text-green-400"
                            }`}
                          >
                            ca. {formatDKK(Math.abs(taxDiff))}
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
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Fremskrevet indkomst
                    </p>
                    <p className="font-semibold">
                      {formatDKK(comparison.projectedAnnualIncome)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      vs. {formatDKK(comparison.calculatedAnnualIncome)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Fremskrevet skat
                    </p>
                    <p className="font-semibold">
                      {formatDKK(comparison.projectedAnnualTax)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      vs. {formatDKK(comparison.calculatedAnnualTax)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">
                      Fremskrevet AM
                    </p>
                    <p className="font-semibold">
                      {formatDKK(comparison.projectedAnnualAm)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      vs. {formatDKK(comparison.calculatedAnnualAm)}
                    </p>
                  </div>
                </div>
              </div>

              {/* OpenAI prompt */}
              <Separator />
              <div>
                <button
                  onClick={() => setShowPrompt(!showPrompt)}
                  className="flex w-full items-center justify-between text-sm font-medium"
                >
                  <span>AI-optimeringsforslag</span>
                  {showPrompt ? (
                    <ChevronUpIcon className="size-4" />
                  ) : (
                    <ChevronDownIcon className="size-4" />
                  )}
                </button>
                {showPrompt && prompt && (
                  <div className="mt-2 space-y-2">
                    <p className="text-muted-foreground text-xs">
                      Kopiér denne prompt og indsæt den i ChatGPT for at
                      få forslag til ændringer i din forskudsopgørelse.
                    </p>
                    <div className="relative">
                      <textarea
                        readOnly
                        value={prompt}
                        className="h-48 w-full resize-y rounded-md border bg-muted/50 p-3 font-mono text-xs"
                      />
                      <button
                        onClick={copyPrompt}
                        className="absolute right-2 top-2 rounded-md border bg-background p-1.5 text-muted-foreground hover:text-foreground"
                        title="Kopiér til udklipsholder"
                      >
                        {copied ? (
                          <CheckIcon className="size-4 text-green-600" />
                        ) : (
                          <CopyIcon className="size-4" />
                        )}
                      </button>
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
