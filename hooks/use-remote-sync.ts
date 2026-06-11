"use client"

import { useEffect, useRef } from "react"
import { useAuth } from "@/components/auth-provider"
import {
  fetchUserData,
  saveUserData,
  type UserDataRow,
} from "@/lib/supabase/user-data"

type SyncKey = keyof Pick<UserDataRow, "tax_input" | "budget_items">

const DEBOUNCE_MS = 600

/**
 * Keeps a single JSONB column of the user's row in sync with Supabase while
 * signed in:
 *  - on sign-in, loads the saved value (or seeds the row from local state),
 *  - debounces saves as the value changes,
 *  - and FLUSHES any pending save immediately when the tab is hidden or the
 *    component unmounts, so an edit made right before navigating away or
 *    closing the tab is never lost.
 *
 * When signed out it does nothing — callers keep their localStorage fallback.
 */
export function useRemoteSync<T>(
  key: SyncKey,
  value: T,
  applyRemote: (remote: T) => void
) {
  const { supabase, user } = useAuth()
  const valueRef = useRef(value)
  const syncedUserId = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushRef = useRef<() => void>(() => {})

  useEffect(() => {
    valueRef.current = value
  }, [value])

  // Keep an up-to-date "save immediately" closure for the lifecycle listeners.
  useEffect(() => {
    flushRef.current = () => {
      if (!supabase || !user || syncedUserId.current !== user.id) return
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      saveUserData(supabase, user.id, {
        [key]: valueRef.current,
      } as Partial<Pick<UserDataRow, "tax_input" | "budget_items">>)
    }
  }, [supabase, user, key])

  // On sign-in: pull the saved value, or seed the row with current local state.
  useEffect(() => {
    if (!supabase || !user) {
      syncedUserId.current = null
      return
    }
    if (syncedUserId.current === user.id) return
    let active = true
    ;(async () => {
      const row = await fetchUserData(supabase, user.id)
      if (!active) return
      const remote = row?.[key]
      if (remote != null) {
        applyRemote(remote as T)
      } else {
        await saveUserData(supabase, user.id, {
          [key]: valueRef.current,
        } as Partial<Pick<UserDataRow, "tax_input" | "budget_items">>)
      }
      syncedUserId.current = user.id
    })()
    return () => {
      active = false
    }
  }, [supabase, user, key, applyRemote])

  // Debounced save on every change.
  useEffect(() => {
    if (!supabase || !user || syncedUserId.current !== user.id) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      saveUserData(supabase, user.id, {
        [key]: value,
      } as Partial<Pick<UserDataRow, "tax_input" | "budget_items">>)
    }, DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, supabase, user, key])

  // Flush pending save when the tab is hidden or the component unmounts.
  useEffect(() => {
    const flush = () => flushRef.current()
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", flush)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", flush)
      flush()
    }
  }, [])
}
