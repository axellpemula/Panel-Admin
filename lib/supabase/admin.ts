import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

import { createSqliteClient } from "@/lib/db/sqlite/adapter";
import { isSqliteMode, supabaseServiceRoleKey, supabaseUrl } from "@/lib/env";
import type { Database } from "@/lib/types/database";

let adminClient: SupabaseClient<Database> | null = null;
let adminMode: "supabase" | "sqlite" | null = null;

/**
 * Client database dengan hak penuh (di Supabase: SERVICE ROLE KEY; di mode
 * SQLite: adapter lokal yang setara service role).
 *
 * Aturan pemakaian:
 * - Hanya dipakai di server (Route Handler / Route Segment).
 * - Jangan pernah di-import dari Client Component.
 * - Di Supabase: jangan pernah kirim service role key ke browser / log.
 * - Selalu cek session + role (+ kepemilikan data) sebelum dipakai — di mode
 *   SQLite tidak ada RLS, jadi pemeriksaan di kode API route adalah satu-satunya pengaman.
 */
export function createAdminClient(): SupabaseClient<Database> {
  const mode = isSqliteMode() ? "sqlite" : "supabase";

  if (adminClient && adminMode === mode) return adminClient;
  adminMode = mode;

  if (mode === "sqlite") {
    adminClient = createSqliteClient() as unknown as SupabaseClient<Database>;
    return adminClient;
  }

  adminClient = createSupabaseClient<Database>(supabaseUrl(), supabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return adminClient;
}
