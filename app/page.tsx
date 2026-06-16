"use client"

import Link from "next/link"
import { Tile, Tag } from "@carbon/react"
import {
  Calculator,
  Wallet,
  ChartColumn,
  ChartLine,
  ArrowRight,
  Login,
  UserAvatar,
  CheckmarkFilled,
} from "@carbon/icons-react"
import { useAuth } from "@/components/auth-provider"
import { useTax } from "@/components/tax-provider"
import { formatDKK } from "@/lib/format"

const tileClass =
  "block h-full no-underline transition-colors hover:bg-[var(--cds-layer-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cds-focus)]"

function StepTile({
  href,
  step,
  icon,
  title,
  desc,
  optional,
}: {
  href: string
  step: number
  icon: React.ReactNode
  title: string
  desc: string
  optional?: boolean
}) {
  return (
    <Link href={href} className={tileClass}>
      <Tile className="h-full">
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="bg-[var(--cds-layer-accent-01)] text-foreground inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold">
              {step}
            </span>
            {optional && <Tag type="cool-gray" size="sm">Kan springes over</Tag>}
          </div>
          <span className="text-[var(--cds-icon-primary)]">{icon}</span>
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-muted-foreground mt-1 text-sm">{desc}</p>
          </div>
          <span className="text-link mt-auto inline-flex items-center gap-1 pt-2 text-sm font-medium">
            Åbn <ArrowRight size={16} />
          </span>
        </div>
      </Tile>
    </Link>
  )
}

export default function LandingPage() {
  const { configured, user } = useAuth()
  const { monthlyNetIncome } = useTax()

  return (
    <main
      style={{
        maxWidth: "1000px",
        margin: "0 auto",
        padding: "3rem 1.5rem 4rem",
      }}
    >
      <header className="mb-8 border-l-4 border-[var(--cds-border-interactive)] pl-4">
        <h1 className="text-3xl font-semibold tracking-tight">
          Din økonomi, samlet ét sted
        </h1>
        <p className="text-muted-foreground mt-1 text-base">
          Beregn din danske skat, planlæg dit budget, og få ét samlet overblik
          med indsigt.
        </p>
      </header>

      {/* Login / register box */}
      {configured && user ? (
        <Tile className="mb-8 border-t-4 border-[var(--cds-support-success)]">
          <div className="flex items-center gap-3">
            <CheckmarkFilled size={24} className="text-success shrink-0" />
            <div>
              <p className="font-medium">Logget ind som {user.email}</p>
              <p className="text-muted-foreground text-sm">
                Dine tal gemmes automatisk og kan hentes på alle dine enheder.
              </p>
            </div>
          </div>
        </Tile>
      ) : (
        <Link href="/login" className={`${tileClass} mb-8`}>
          <Tile className="border-t-4 border-[var(--cds-border-interactive)]">
            <div className="flex items-center gap-4">
              <Login size={28} className="text-[var(--cds-icon-primary)] shrink-0" />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold">
                  Log ind eller opret en konto
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Gem dine tal og hent dem på alle dine enheder. Det, du allerede
                  har indtastet, overføres automatisk til din konto.
                </p>
              </div>
              <span className="text-link inline-flex items-center gap-1 text-sm font-medium">
                <UserAvatar size={16} /> <ArrowRight size={16} />
              </span>
            </div>
          </Tile>
        </Link>
      )}

      {/* Flow */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Sådan virker det
        </h2>
        {monthlyNetIncome > 0 && (
          <span className="text-muted-foreground text-xs">
            Nettoløn: {formatDKK(monthlyNetIncome)}/md.
          </span>
        )}
      </div>

      <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StepTile
          href="/skat"
          step={1}
          icon={<Calculator size={32} />}
          title="Skatteberegner"
          desc="Beregn AM-bidrag, bund-, top- og kommuneskat og din nettoløn."
          optional
        />
        <StepTile
          href="/budget"
          step={2}
          icon={<Wallet size={32} />}
          title="Budget"
          desc="Planlæg dine månedlige udgifter mod din nettoløn."
        />
        <StepTile
          href="/resultat"
          step={3}
          icon={<ChartColumn size={32} />}
          title="Resultat"
          desc="Se grafer og indsigt på tværs af skat og budget."
        />
        <StepTile
          href="/planlaegning"
          step={4}
          icon={<ChartLine size={32} />}
          title="Planlægning"
          desc="Simulér din formue mange år frem med afkast, bolig og livsbegivenheder."
        />
      </div>

      <p className="text-muted-foreground mt-4 text-sm">
        Du kan springe <strong>skat</strong> over og starte direkte med
        budgettet — indtast blot din nettoløn manuelt.
      </p>
    </main>
  )
}
