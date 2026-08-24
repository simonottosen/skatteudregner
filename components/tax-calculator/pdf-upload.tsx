"use client"

import { useCallback, useRef, useState } from "react"
import { UploadIcon, FileTextIcon } from "lucide-react"
import { ContentSwitcher, Switch, InlineNotification } from "@carbon/react"
import type { ParseResult } from "@/lib/pdf/parse-forskudsopgoerelse"
import { payslipToTaxInput } from "@/lib/paycheck/to-tax-input"

/**
 * Which document is being uploaded. A payslip is parsed differently and can only
 * fill part of the form, so the user picks rather than us sniffing the file —
 * guessing wrong would silently produce a year's worth of wrong numbers.
 */
export type DocumentKind = "forskudsopgoerelse" | "loenseddel"

const KINDS: DocumentKind[] = ["forskudsopgoerelse", "loenseddel"]

const COPY: Record<
  DocumentKind,
  {
    tab: string
    prompt: string
    loading: string
    notPdf: string
    unreadable: string
    errorTitle: string
    successTitle: string
    aria: string
  }
> = {
  forskudsopgoerelse: {
    tab: "Forskudsopgørelse",
    prompt: "Upload din forskudsopgørelse (PDF) for at udfylde automatisk",
    loading: "Indlæser forskudsopgørelse...",
    notPdf:
      "Filen skal være en PDF. Vælg venligst din forskudsopgørelse som PDF.",
    unreadable: "Ingen felter kunne genkendes fra denne PDF.",
    errorTitle: "Kunne ikke indlæse forskudsopgørelse",
    successTitle: "Forskudsopgørelse indlæst",
    aria: "Upload forskudsopgørelse PDF",
  },
  loenseddel: {
    tab: "Lønseddel",
    prompt: "Upload en lønseddel (PDF) — vi fremskriver året for dig",
    loading: "Indlæser lønseddel...",
    notPdf: "Filen skal være en PDF. Vælg venligst din lønseddel som PDF.",
    unreadable: "Ingen felter kunne genkendes fra denne lønseddel.",
    errorTitle: "Kunne ikke indlæse lønseddel",
    successTitle: "Lønseddel indlæst",
    aria: "Upload lønseddel PDF",
  },
}

/**
 * Every state after `idle` carries its own `kind`: the switcher stays live while
 * a file is parsing, so the currently-selected tab may no longer be the document
 * the notification is about.
 */
type UploadState =
  | { status: "idle" }
  | { status: "parsing"; kind: DocumentKind }
  | { status: "success"; kind: DocumentKind; summary: string }
  | { status: "error"; kind: DocumentKind; message: string }

/** Normalised parser output, so both document kinds share one result path. */
type ParseOutcome =
  | { ok: true; data: ParseResult["data"]; summary: string }
  | { ok: false; message: string }

/** Parsers are imported lazily to keep pdfjs-dist out of the initial bundle. */
async function parsePayslip(file: File, unreadable: string): Promise<ParseOutcome> {
  const { parseLoenseddel } = await import("@/lib/pdf/parse-loenseddel")
  const parsed = await parseLoenseddel(file)
  if (!parsed.data) {
    return { ok: false, message: parsed.warnings[0] ?? unreadable }
  }

  const { data, filledLabels, warnings } = payslipToTaxInput(parsed.data)
  // The parser's own warnings matter here too — a partially recognised payslip
  // still imports, and the user should know which figures were shaky.
  const allWarnings = [...parsed.warnings, ...warnings]
  if (filledLabels.length === 0) {
    return { ok: false, message: allWarnings[0] ?? unreadable }
  }

  return {
    ok: true,
    data,
    summary: [`Udfyldt: ${filledLabels.join(", ")}.`, ...allWarnings].join(" "),
  }
}

async function parseForskudsopgoerelseUpload(
  file: File,
  unreadable: string
): Promise<ParseOutcome> {
  const { parseForskudsopgoerelse } = await import(
    "@/lib/pdf/parse-forskudsopgoerelse"
  )
  const result = await parseForskudsopgoerelse(file)
  if (result.fieldsFound.length === 0) {
    return { ok: false, message: result.warnings[0] ?? unreadable }
  }

  return {
    ok: true,
    data: result.data,
    summary: `${result.fieldsFound.length} felter udfyldt automatisk${
      result.warnings.length > 0 ? ` — ${result.warnings.join("; ")}` : ""
    }`,
  }
}

interface PdfUploadProps {
  onImport: (data: ParseResult["data"], kind: DocumentKind) => void
}

export function PdfUpload({ onImport }: PdfUploadProps) {
  const [kind, setKind] = useState<DocumentKind>("forskudsopgoerelse")
  const [state, setState] = useState<UploadState>({ status: "idle" })
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const copy = COPY[kind]

  const handleFile = useCallback(
    async (file: File) => {
      const text = COPY[kind]
      const fail = (message: string) =>
        setState({ status: "error", kind, message })

      if (file.type !== "application/pdf") {
        fail(text.notPdf)
        return
      }

      setState({ status: "parsing", kind })

      try {
        const outcome =
          kind === "loenseddel"
            ? await parsePayslip(file, text.unreadable)
            : await parseForskudsopgoerelseUpload(file, text.unreadable)

        if (!outcome.ok) {
          fail(outcome.message)
          return
        }

        setState({ status: "success", kind, summary: outcome.summary })
        onImport(outcome.data, kind)
      } catch {
        fail("Kunne ikke læse PDF-filen. Prøv venligst igen.")
      }
    },
    [kind, onImport]
  )

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
      // Reset so the same file can be re-uploaded
      e.target.value = ""
    },
    [handleFile]
  )

  const dismiss = useCallback(() => {
    setState({ status: "idle" })
  }, [])

  if (state.status === "success") {
    return (
      <InlineNotification
        className="mb-4 max-w-full"
        kind="success"
        lowContrast
        title={COPY[state.kind].successTitle}
        subtitle={state.summary}
        onCloseButtonClick={dismiss}
      />
    )
  }

  if (state.status === "error") {
    return (
      <InlineNotification
        className="mb-4 max-w-full"
        kind="error"
        lowContrast
        title={COPY[state.kind].errorTitle}
        subtitle={state.message}
        onCloseButtonClick={dismiss}
      />
    )
  }

  return (
    <div className="mb-4">
      <ContentSwitcher
        className="mb-2 max-w-xs"
        size="sm"
        selectedIndex={KINDS.indexOf(kind)}
        onChange={({ index }) => setKind(KINDS[index ?? 0])}
      >
        {KINDS.map((k) => (
          <Switch key={k} name={k} text={COPY[k].tab} />
        ))}
      </ContentSwitcher>
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
        } ${state.status === "parsing" ? "pointer-events-none opacity-60" : ""}`}
      >
        {state.status === "parsing" ? (
          <>
            <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            <p className="text-sm text-muted-foreground">
              {COPY[state.kind].loading}
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
                {isDragging ? "Slip filen her" : copy.prompt}
              </p>
            </div>
            <p className="text-xs text-muted-foreground/70">
              Din fil forbliver i din browser og uploades ikke til nogen server
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
        aria-label={copy.aria}
      />
    </div>
  )
}
