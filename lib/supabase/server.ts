import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { createSqliteClient } from "@/lib/db/sqlite/adapter";
import { isSqliteMode, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import type { Database } from "@/lib/types/database";

/**
 * Client sesi untuk Server Component / Route Handler.
 *
 * - Mode Supabase: client anon + cookie sesi (`sb-*`), RLS berlaku.
 * - Mode SQLite: adapter lokal yang membaca cookie sesi `xloop_session`
 *   dan memvalidasinya ke tabel `auth_sessions`; operasi tulis tetap
 *   hanya lewat API route (semua route memakai client admin).
 *
 * `getAll`/`setAll` memakai API cookie Next.js 14 (sync).
 */
export function createClient(): SupabaseClient<Database> {
  if (isSqliteMode()) {
    return createSqliteClient() as unknown as SupabaseClient<Database>;
  }

  const cookieStore = cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Dipanggil dari Server Component yang tidak bisa set cookie.
          // Refresh sesi ditangani oleh middleware.ts.
        }
      },
    },
  });
}
