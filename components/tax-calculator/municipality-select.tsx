"use client"

import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { getMunicipalityList } from "@/lib/tax/municipalities"
import type { TaxYear } from "@/lib/tax/types"

interface MunicipalitySelectProps {
  value: string
  onChange: (value: string) => void
  year: TaxYear
}

export function MunicipalitySelect({
  value,
  onChange,
  year,
}: MunicipalitySelectProps) {
  const [open, setOpen] = useState(false)
  const municipalities = getMunicipalityList(year)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value || "Vælg kommune..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Søg kommune..." />
          <CommandList>
            <CommandEmpty>Ingen kommune fundet.</CommandEmpty>
            <CommandGroup>
              {municipalities
                .sort((a, b) => a.name.localeCompare(b.name, "da"))
                .map((m) => (
                  <CommandItem
                    key={m.code}
                    value={m.name}
                    onSelect={() => {
                      onChange(m.name)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === m.name ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {m.name}
                    <span className="text-muted-foreground ml-auto text-xs">
                      {m.taxRate}%
                    </span>
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
