"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  TextInput,
  PasswordInput,
  Button,
  InlineNotification,
} from "@carbon/react"
import { useAuth } from "@/components/auth-provider"

export default function LoginPage() {
  const router = useRouter()
  const { configured, signIn, signUp } = useAuth()
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      if (mode === "login") {
        const { error } = await signIn(email, password)
        if (error) {
          setError(error)
          return
        }
        router.push("/")
      } else {
        const { error, needsConfirmation } = await signUp(email, password)
        if (error) {
          setError(error)
          return
        }
        if (needsConfirmation) {
          setInfo(
            "Konto oprettet. Tjek din e-mail for et bekræftelseslink, og log derefter ind."
          )
          setMode("login")
        } else {
          router.push("/")
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      style={{
        maxWidth: "420px",
        margin: "0 auto",
        padding: "3rem 1.5rem 4rem",
      }}
    >
      <header className="mb-6 border-l-4 border-[var(--cds-border-interactive)] pl-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "login" ? "Log ind" : "Opret konto"}
        </h1>
        <p className="text-muted-foreground text-sm">
          Gem din skat og dit budget, og hent det på alle dine enheder.
        </p>
      </header>

      {!configured && (
        <InlineNotification
          className="mb-4 max-w-full"
          kind="warning"
          lowContrast
          hideCloseButton
          title="Login er ikke konfigureret"
          subtitle="Sæt NEXT_PUBLIC_SUPABASE_URL og NEXT_PUBLIC_SUPABASE_ANON_KEY som miljøvariabler (.env.local lokalt, eller i Docker/host-miljøet)."
        />
      )}

      {error && (
        <InlineNotification
          className="mb-4 max-w-full"
          kind="error"
          lowContrast
          title="Der opstod en fejl"
          subtitle={error}
          onCloseButtonClick={() => setError(null)}
        />
      )}

      {info && (
        <InlineNotification
          className="mb-4 max-w-full"
          kind="success"
          lowContrast
          title="Næsten færdig"
          subtitle={info}
          onCloseButtonClick={() => setInfo(null)}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <TextInput
          id="login-email"
          type="email"
          labelText="E-mail"
          placeholder="dig@eksempel.dk"
          value={email}
          required
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordInput
          id="login-password"
          labelText="Adgangskode"
          placeholder="Mindst 6 tegn"
          value={password}
          required
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={busy || !configured} className="w-full">
          {mode === "login" ? "Log ind" : "Opret konto"}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-sm">
        {mode === "login" ? "Har du ikke en konto?" : "Har du allerede en konto?"}{" "}
        <button
          type="button"
          className="text-link font-medium underline"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login")
            setError(null)
            setInfo(null)
          }}
        >
          {mode === "login" ? "Opret en konto" : "Log ind"}
        </button>
      </p>
    </main>
  )
}
