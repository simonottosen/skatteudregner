"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { formatDKK, formatPercent } from "@/lib/format"
import type { TaxResult } from "@/lib/tax/types"

interface TaxResultsProps {
  result: TaxResult
}

function ResultLine({
  label,
  value,
  bold,
  negative,
}: {
  label: string
  value: number
  bold?: boolean
  negative?: boolean
}) {
  const formatted = formatDKK(Math.abs(value))
  const display = negative || value < 0 ? `-${formatted}` : formatted
  return (
    <div
      className={`flex justify-between text-sm ${bold ? "font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className={value < 0 ? "text-green-600 dark:text-green-400" : ""}>
        {display}
      </span>
    </div>
  )
}

export function TaxResults({ result }: TaxResultsProps) {
  const grossIncome = result.amBasis + result.insuranceBasis + result.nonAmIncome

  return (
    <div className="space-y-4">
      <div className="lg:sticky lg:top-4 lg:z-10">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Resultat</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-muted-foreground text-xs">Bruttoindkomst</p>
              <p className="text-xl font-bold">{formatDKK(grossIncome)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Nettoindkomst</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400">
                {formatDKK(result.netIncome)}
              </p>
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-muted-foreground text-xs">Samlet skat</p>
              <p className="text-lg font-semibold">{formatDKK(result.totalTax)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Effektiv skat</p>
              <p className="text-lg font-semibold">
                {formatPercent(result.effectiveTaxRate)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Marginalskat</p>
              <p className="text-lg font-semibold">
                {formatPercent(result.marginalTaxRate)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>

      <Accordion type="multiple" defaultValue={["income-tax"]} className="w-full">
        <AccordionItem value="income-basis">
          <AccordionTrigger className="text-sm">
            Indkomstgrundlag
          </AccordionTrigger>
          <AccordionContent className="space-y-1">
            <ResultLine label="AM-bidragspligtig indkomst" value={result.totalAmBasis} />
            <ResultLine label="Indkomst uden AM-bidrag" value={result.nonAmIncome} />
            <ResultLine label="AM-bidrag" value={result.amBidrag} negative />
            {result.pensionLivrenteDeduction > 0 && (
              <ResultLine
                label="Livrente fradrag"
                value={result.pensionLivrenteDeduction}
                negative
              />
            )}
            <Separator className="my-1" />
            <ResultLine
              label="Personlig indkomst"
              value={result.personalIncome}
              bold
            />
            {result.totalCapitalIncome !== 0 && (
              <ResultLine
                label="Kapitalindkomst"
                value={result.totalCapitalIncome}
              />
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="deductions">
          <AccordionTrigger className="text-sm">
            Fradrag
          </AccordionTrigger>
          <AccordionContent className="space-y-1">
            {result.beskaeftigelsesFradrag > 0 && (
              <ResultLine
                label="Beskæftigelsesfradrag"
                value={result.beskaeftigelsesFradrag}
                negative
              />
            )}
            {result.ekstraBeskaeftigelseForsorgere > 0 && (
              <ResultLine
                label="Ekstra beskæftigelsesfradrag (forsørgere)"
                value={result.ekstraBeskaeftigelseForsorgere}
                negative
              />
            )}
            {result.jobFradrag > 0 && (
              <ResultLine label="Jobfradrag" value={result.jobFradrag} negative />
            )}
            {result.ekstraPensionsFradrag > 0 && (
              <ResultLine
                label="Ekstra pensionsfradrag"
                value={result.ekstraPensionsFradrag}
                negative
              />
            )}
            {result.befordringsFradrag !== 0 && (
              <ResultLine
                label="Befordringsfradrag"
                value={Math.abs(result.befordringsFradrag)}
                negative
              />
            )}
            {result.unionFeesDeduction > 0 && (
              <ResultLine
                label="Fagligt kontingent"
                value={result.unionFeesDeduction}
                negative
              />
            )}
            {result.aKasseDeduction > 0 && (
              <ResultLine label="A-kasse" value={result.aKasseDeduction} negative />
            )}
            {result.charitableDonationsDeduction > 0 && (
              <ResultLine
                label="Velgørenhed"
                value={result.charitableDonationsDeduction}
                negative
              />
            )}
            {result.serviceDeductionAmount > 0 && (
              <ResultLine
                label="Servicefradrag"
                value={result.serviceDeductionAmount}
                negative
              />
            )}
            {result.capitalIncomeDeduction !== 0 && (
              <ResultLine
                label="Rentefradrag"
                value={Math.abs(result.capitalIncomeDeduction)}
                negative
              />
            )}
            <Separator className="my-1" />
            <ResultLine
              label="Skattepligtig indkomst"
              value={result.taxableIncome}
              bold
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="income-tax">
          <AccordionTrigger className="text-sm">
            Indkomstskat
          </AccordionTrigger>
          <AccordionContent className="space-y-1">
            <ResultLine label="AM-bidrag" value={result.amBidragTotal} />
            <ResultLine label="Bundskat" value={result.bundSkat} />
            {result.mellemSkat > 0 && (
              <ResultLine label="Mellemskat" value={result.mellemSkat} />
            )}
            {result.mellemSkatCapital > 0 && (
              <ResultLine
                label="Mellemskat (kapital)"
                value={result.mellemSkatCapital}
              />
            )}
            {result.topSkat > 0 && (
              <ResultLine label="Topskat" value={result.topSkat} />
            )}
            {result.topTopSkat > 0 && (
              <ResultLine label="Top-topskat" value={result.topTopSkat} />
            )}
            <ResultLine
              label="Personfradrag (stat)"
              value={result.personFradragStatCredit}
              negative
            />
            <ResultLine label="Kommuneskat" value={result.kommuneSkat} />
            {result.kirkeSkat > 0 && (
              <ResultLine label="Kirkeskat" value={result.kirkeSkat} />
            )}
            <ResultLine
              label="Personfradrag (kommune)"
              value={result.personFradragKommuneCredit}
              negative
            />
            <Separator className="my-1" />
            <ResultLine
              label="Samlet indkomstskat"
              value={result.totalIncomeTax}
              bold
            />
          </AccordionContent>
        </AccordionItem>

        {result.totalStockTax > 0 && (
          <AccordionItem value="stock-tax">
            <AccordionTrigger className="text-sm">
              Aktieskat
            </AccordionTrigger>
            <AccordionContent className="space-y-1">
              <ResultLine label="Aktieindkomst" value={result.stockIncome} />
              <ResultLine label="Skat (27%)" value={result.stockTaxLow} />
              {result.stockTaxHigh > 0 && (
                <ResultLine label="Skat (42%)" value={result.stockTaxHigh} />
              )}
              {result.foreignDividendCredit > 0 && (
                <ResultLine
                  label="Udenlandsk udbytteskat"
                  value={result.foreignDividendCredit}
                  negative
                />
              )}
              <Separator className="my-1" />
              <ResultLine
                label="Samlet aktieskat"
                value={result.totalStockTax}
                bold
              />
            </AccordionContent>
          </AccordionItem>
        )}

        {result.totalPropertyTax > 0 && (
          <AccordionItem value="property-tax">
            <AccordionTrigger className="text-sm">
              Boligskat
            </AccordionTrigger>
            <AccordionContent className="space-y-1">
              {result.ejendomsvaerdiSkatPrimary > 0 && (
                <ResultLine
                  label="Ejendomsværdiskat (helårsbolig)"
                  value={result.ejendomsvaerdiSkatPrimary}
                />
              )}
              {result.ejendomsvaerdiSkatSummer > 0 && (
                <ResultLine
                  label="Ejendomsværdiskat (sommerhus)"
                  value={result.ejendomsvaerdiSkatSummer}
                />
              )}
              {result.grundskyldPrimary > 0 && (
                <ResultLine
                  label="Grundskyld (helårsbolig)"
                  value={result.grundskyldPrimary}
                />
              )}
              {result.grundskyldSummer > 0 && (
                <ResultLine
                  label="Grundskyld (sommerhus)"
                  value={result.grundskyldSummer}
                />
              )}
              {result.personalTaxDiscount > 0 && (
                <ResultLine
                  label="Personlig skatterabat"
                  value={result.personalTaxDiscount}
                  negative
                />
              )}
              <Separator className="my-1" />
              <ResultLine
                label="Samlet boligskat"
                value={result.totalPropertyTax}
                bold
              />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  )
}
