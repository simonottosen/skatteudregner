"use client"

import { useCallback, useRef, useState } from "react"
import { UploadIcon, FileTextIcon, CheckCircleIcon, AlertCircleIcon, XIcon } from "lucide-react"
import type { ParseResult } from "@/lib/pdf/parse-forskudsopgoerelse"

type UploadState =
  | { status: "idle" }
  | { status: "parsing" }
  | { status: "success"; result: ParseResult }
  | { status: "error"; message: string }

interface PdfUploadProps {
  onImport: (data: ParseResult["data"]) => void
}

export function PdfUpload({ onImport }: PdfUploadProps) {
  const [state, setState] = useState<UploadState>({ status: "idle" })
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf") {
        setState({
          status: "error",
          message: "Filen skal være en PDF. Vælg venligst din forskudsopgørelse som PDF.",
        })
        return
      }

      setState({ status: "parsing" })

      try {
        // Dynamic import to avoid loading pdfjs-dist until needed
        const { parseForskudsopgoerelse } = await import(
          "@/lib/pdf/parse-forskudsopgoerelse"
        )
        const result = await parseForskudsopgoerelse(file)

        if (result.fieldsFound.length === 0) {
          setState({
            status: "error",
            message:
              result.warnings[0] ||
              "Ingen felter kunne genkendes fra denne PDF.",
          })
          return
        }

        setState({ status: "success", result })
        onImport(result.data)
      } catch {
        setState({
          status: "error",
          message: "Kunne ikke læse PDF-filen. Prøv venligst igen.",
        })
      }
    },
    [onImport]
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
      <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
        <div className="flex items-start gap-2">
          <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              Forskudsopgørelse indlæst
            </p>
            <p className="text-xs text-green-700 dark:text-green-300">
              {state.result.fieldsFound.length} felter udfyldt automatisk
            </p>
            {state.result.warnings.length > 0 && (
              <ul className="mt-1 text-xs text-green-600 dark:text-green-400">
                {state.result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
          <button
            onClick={dismiss}
            className="text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-200"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
        <div className="flex items-start gap-2">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              Kunne ikke indlæse forskudsopgørelse
            </p>
            <p className="text-xs text-red-700 dark:text-red-300">
              {state.message}
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
    )
  }

  return (
    <div className="mb-4">
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
              Indlæser forskudsopgørelse...
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
                  : "Upload din forskudsopgørelse (PDF) for at udfylde automatisk"}
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
        aria-label="Upload forskudsopgørelse PDF"
      />
    </div>
  )
}
