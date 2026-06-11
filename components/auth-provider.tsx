"use client"

import * as React from "react"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"

interface AuthResult {
  error?: string
  /** signUp only: true when email confirmation is required before a session exists. */
  needsConfirmation?: boolean
}

interface AuthContextValue {
  supabase: SupabaseClient | null
  configured: boolean
  user: User | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

const NOT_CONFIGURED: AuthResult = {
  error: "Login er ikke konfigureret. Tilføj Supabase-nøgler i .env.local.",
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = React.useMemo(() => getSupabaseBrowserClient(), [])
  const [user, setUser] = React.useState<User | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setUser(data.session?.user ?? null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [supabase])

  const signIn = React.useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!supabase) return NOT_CONFIGURED
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      return { error: error?.message }
    },
    [supabase]
  )

  const signUp = React.useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      if (!supabase) return NOT_CONFIGURED
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) return { error: error.message }
      return { needsConfirmation: !data.session }
    },
    [supabase]
  )

  const signOut = React.useCallback(async () => {
    await supabase?.auth.signOut()
  }, [supabase])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      supabase,
      configured: supabase !== null,
      user,
      loading,
      signIn,
      signUp,
      signOut,
    }),
    [supabase, user, loading, signIn, signUp, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
