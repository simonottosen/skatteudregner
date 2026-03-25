"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MapPinIcon,
  ExternalLinkIcon,
  Loader2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { formatDKK } from "@/lib/format"
import { getRates, getMunicipality } from "@/lib/tax"
import { calculateBefordringsFradrag } from "@/lib/tax/calculations/itemized-deductions"
import { calculateDrivingDistance } from "@/lib/geo/distance"
import type { TaxInput } from "@/lib/tax/types"

interface CommuteDeductionProps {
  input: TaxInput
  parsedEmployeeAddress?: string
  parsedEmployerAddress?: string
}

type DistanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; oneWayKm: number; durationMinutes: number }
  | { status: "error"; message: string }

export function CommuteDeduction({
  input,
  parsedEmployeeAddress,
  parsedEmployerAddress,
}: CommuteDeductionProps) {
  const [homeAddress, setHomeAddress] = useState(parsedEmployeeAddress ?? "")
  const [workAddress, setWorkAddress] = useState(parsedEmployerAddress ?? "")
  const [roundTripKm, setRoundTripKm] = useState<number>(
    input.commuteDistanceKm || 0
  )
  const [distanceState, setDistanceState] = useState<DistanceState>({
    status: "idle",
  })
  const [expanded, setExpanded] = useState(false)
  const autoCalcDone = useRef(false)

  const rates = getRates(input.year)
  const municipality = getMunicipality(input.municipality, input.year)

  const deduction = useMemo(() => {
    if (!municipality || roundTripKm <= 0) return null
    const fakeInput = { ...input, commuteDistanceKm: roundTripKm }
    return calculateBefordringsFradrag(fakeInput, rates, municipality, input.workIncome)
  }, [input, roundTripKm, rates, municipality])

  const currentDeduction = useMemo(() => {
    if (!municipality || input.commuteDistanceKm <= 0) return null
    return calculateBefordringsFradrag(input, rates, municipality, input.workIncome)
  }, [input, rates, municipality])

  const totalDeduction = deduction
    ? deduction.befordringsFradrag + deduction.forhoejetBefordringsFradrag
    : 0
  const currentTotal = currentDeduction
    ? currentDeduction.befordringsFradrag +
      currentDeduction.forhoejetBefordringsFradrag
    : 0

  const hasAddresses = homeAddress.length > 3 && workAddress.length > 3

  const googleMapsUrl = useMemo(() => {
    if (!hasAddresses) return null
    const origin = encodeURIComponent(homeAddress)
    const dest = encodeURIComponent(workAddress)
    return `https://www.google.com/maps/dir/${origin}/${dest}`
  }, [homeAddress, workAddress, hasAddresses])

  const calculateDistance = useCallback(async () => {
    if (!hasAddresses) return
    setDistanceState({ status: "loading" })
    try {
      const result = await calculateDrivingDistance(homeAddress, workAddress)
      setDistanceState({
        status: "success",
        oneWayKm: result.oneWayKm,
        durationMinutes: result.durationMinutes,
      })
      setRoundTripKm(result.roundTripKm)
    } catch (err) {
      setDistanceState({
        status: "error",
        message:
          err instanceof Error
            ? err.message
            : "Kunne ikke beregne afstanden",
      })
      // Expand details so user can fix addresses or enter km manually
      setExpanded(true)
    }
  }, [homeAddress, workAddress, hasAddresses])

  // Auto-calculate distance when addresses are available from payslip
  useEffect(() => {
    if (
      !autoCalcDone.current &&
      parsedEmployeeAddress &&
      parsedEmployerAddress &&
      hasAddresses
    ) {
      autoCalcDone.current = true
      calculateDistance()
    }
  }, [parsedEmployeeAddress, parsedEmployerAddress, hasAddresses, calculateDistance])

  const isNewDeduction = input.commuteDistanceKm === 0 && roundTripKm > 24
  const isChangedDeduction =
    input.commuteDistanceKm > 0 &&
    roundTripKm !== input.commuteDistanceKm &&
    roundTripKm > 24
  const isLoading = distanceState.status === "loading"
  const hasResult = roundTripKm > 0 && !isLoading
  const taxSavings = Math.round(totalDeduction * 0.37)

  // Compact loading state
  if (isLoading) {
    return (
      <div>
        <h3 className="mb-1 text-sm font-medium">Kørselsfradrag</h3>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          Beregner afstand mellem hjem og arbejde...
        </div>
      </div>
    )
  }

  // Compact result view (default after auto-calculation)
  if (hasResult && !expanded) {
    return (
      <div>
        <h3 className="mb-1 text-sm font-medium">Kørselsfradrag</h3>

        {roundTripKm > 24 && totalDeduction > 0 ? (
          <div className="rounded-md border bg-muted/50 p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span>
                {roundTripKm} km tur/retur
                {distanceState.status === "success" && (
                  <span className="text-muted-foreground text-xs ml-1">
                    ({distanceState.durationMinutes} min. hver vej)
                  </span>
                )}
              </span>
              <span className="font-semibold">
                {formatDKK(totalDeduction)} / år
              </span>
            </div>

            {/* Suggestion inline */}
            {isNewDeduction && (
              <p className="mt-1.5 text-xs text-green-700 dark:text-green-400">
                Tilføj {roundTripKm} km under &quot;Befordring&quot; på skat.dk
                — spar ca. {formatDKK(taxSavings)} i skat.
              </p>
            )}
            {isChangedDeduction && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                Opdatér fra {input.commuteDistanceKm} km til {roundTripKm} km
                på skat.dk (forskel: {formatDKK(totalDeduction - currentTotal)}).
              </p>
            )}
            {!isNewDeduction && !isChangedDeduction && roundTripKm === input.commuteDistanceKm && (
              <p className="mt-1.5 text-xs text-green-700 dark:text-green-400">
                Matcher din forskudsopgørelse.
              </p>
            )}

            <button
              onClick={() => setExpanded(true)}
              className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDownIcon className="size-3" />
              Vis detaljer
            </button>
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground">
              {roundTripKm} km tur/retur — under 24 km, intet fradrag.
            </p>
            <button
              onClick={() => setExpanded(true)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronDownIcon className="size-3" />
              Vis detaljer
            </button>
          </div>
        )}
      </div>
    )
  }

  // Expanded view with full details
  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="mb-1 text-sm font-medium">Kørselsfradrag</h3>
        {hasResult && (
          <button
            onClick={() => setExpanded(false)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronUpIcon className="size-3" />
            Skjul detaljer
          </button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Fradrag for transport mellem hjem og arbejde (over 24 km tur/retur).
      </p>

      {/* Address inputs */}
      <div className="space-y-2">
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPinIcon className="size-3" />
            Hjemmeadresse
          </label>
          <Input
            type="text"
            placeholder="F.eks. Flensborggade 40, 1669 København V"
            value={homeAddress}
            onChange={(e) => setHomeAddress(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPinIcon className="size-3" />
            Arbejdsadresse
          </label>
          <Input
            type="text"
            placeholder="F.eks. J.C Jacobsens Gade 12, 1799 København V"
            value={workAddress}
            onChange={(e) => setWorkAddress(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {hasAddresses && (
          <button
            onClick={calculateDistance}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Beregn afstand
          </button>
        )}
        {googleMapsUrl && (
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Google Maps
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>

      {/* Distance result / error */}
      {distanceState.status === "success" && (
        <p className="mt-2 text-xs text-green-700 dark:text-green-400">
          {distanceState.oneWayKm} km hver vej ({distanceState.durationMinutes}{" "}
          min.) — {distanceState.oneWayKm * 2} km tur/retur
        </p>
      )}
      {distanceState.status === "error" && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {distanceState.message}
        </p>
      )}

      {/* Manual km input */}
      <div className="mt-3">
        <label className="mb-1 block text-xs text-muted-foreground">
          Afstand tur/retur (km pr. dag)
        </label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            placeholder="0"
            value={roundTripKm || ""}
            onChange={(e) =>
              setRoundTripKm(Math.round(parseFloat(e.target.value) || 0))
            }
            className="h-8 w-28 text-right text-sm"
            min={0}
          />
          <span className="text-xs text-muted-foreground">km</span>
        </div>
      </div>

      {/* Deduction breakdown */}
      {roundTripKm > 24 && deduction && (
        <>
          <Separator className="my-3" />
          <div className="rounded-md border bg-muted/50 p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Beregnet kørselsfradrag</span>
              <span className="font-semibold">
                {formatDKK(totalDeduction)} / år
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {roundTripKm} km × {input.workDaysPerYear} dage ×{" "}
              {rates.commuteRate25to120} kr/km (25-120 km)
              {deduction.forhoejetBefordringsFradrag > 0 && (
                <span className="block">
                  + forhøjet fradrag:{" "}
                  {formatDKK(deduction.forhoejetBefordringsFradrag)}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Estimeret skattebesparelse: ca. {formatDKK(taxSavings)} / år
            </p>

            {isNewDeduction && (
              <div className="mt-2 rounded border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-950">
                <p className="text-xs text-green-700 dark:text-green-300">
                  Tilføj {roundTripKm} km under &quot;Befordring&quot; på
                  skat.dk.
                </p>
              </div>
            )}
            {isChangedDeduction && (
              <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Opdatér fra {input.commuteDistanceKm} km til {roundTripKm} km
                  på skat.dk (nu: {formatDKK(currentTotal)}).
                </p>
              </div>
            )}
            {!isNewDeduction && !isChangedDeduction && roundTripKm === input.commuteDistanceKm && (
              <p className="mt-2 text-xs text-green-700 dark:text-green-400">
                Matcher din forskudsopgørelse.
              </p>
            )}
          </div>
        </>
      )}

      {roundTripKm > 0 && roundTripKm <= 24 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Under 24 km tur/retur — intet fradrag.
        </p>
      )}
    </div>
  )
}
