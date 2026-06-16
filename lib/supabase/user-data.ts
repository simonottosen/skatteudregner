import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Per-user persisted blob. We store the whole tax input and the budget items as
 * JSONB so the schema stays tiny (one row per user) and mirrors the existing
 * localStorage model.
 */
export interface UserDataRow {
  tax_input: unknown | null
  budget_items: unknown | null
  planning: unknown | null
}

export async function fetchUserData(
  supabase: SupabaseClient,
  userId: string
): Promise<UserDataRow | null> {
  // Select all columns so a not-yet-migrated database (missing the `planning`
  // column) still returns tax_input/budget_items instead of failing the query.
  const { data, error } = await supabase
    .from("skatteberegner_user_data")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    console.error("Supabase fetchUserData failed:", error.message)
    return null
  }
  return (data as UserDataRow | null) ?? null
}

export async function saveUserData(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<Pick<UserDataRow, "tax_input" | "budget_items" | "planning">>
): Promise<void> {
  const { error } = await supabase.from("skatteberegner_user_data").upsert(
    {
      user_id: userId,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  )

  if (error) {
    console.error("Supabase saveUserData failed:", error.message)
  }
}
