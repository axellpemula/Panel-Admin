import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database, KeyRow, ProfileRow, UserRole } from "@/lib/types/database";
import { jsonError } from "@/lib/utils/http";

/**
 * Konteks auth untuk semua API route panel.
 * `user` = client dengan cookie sesi (RLS aktif).
 * `admin` = client service role (bypass RLS) — dipakai untuk operasi tulis.
 */
export interface AuthContext {
  userId: string;
  email: string | null;
  profile: ProfileRow;
  role: UserRole;
  isOwner: boolean;
  /** Client dengan cookie user (RLS). */
  supabase: SupabaseClient<Database>;
  /** Client service role. Hanya dipakai setelah cek session + role + kepemilikan. */
  admin: SupabaseClient<Database>;
}

type Handler<T> = (ctx: AuthContext) => Promise<T>;

/**
 * Jalankan handler setelah memverifikasi session Supabase.
 * Semua Route Handler yang butuh login wajib lewat sini.
 */
export async function withAuth(
  request: NextRequest,
  handler: Handler<Response>,
): Promise<Response> {
  const supabase = createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonError("Sesi tidak ditemukan. Silakan login lagi.", "unauthorized", 401);
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    return jsonError("Gagal membaca profil user", "server_error", 500);
  }

  if (!profile) {
    return jsonError("Profil tidak ditemukan. Hubungi Owner.", "forbidden", 403);
  }

  if (profile.is_active === false) {
    return jsonError("Akun kamu dinonaktifkan", "forbidden", 403);
  }

  const ctx: AuthContext = {
    userId: user.id,
    email: user.email ?? profile.email ?? null,
    profile,
    role: profile.role,
    isOwner: profile.role === "owner",
    supabase,
    admin,
  };

  try {
    return await handler(ctx);
  } catch (error) {
    console.error("[api] unhandled error:", error);
    return jsonError("Terjadi kesalahan di server", "server_error", 500);
  }
}

/** Sama seperti withAuth, tapi hanya untuk role owner. */
export async function withOwner(
  request: NextRequest,
  handler: Handler<Response>,
): Promise<Response> {
  return withAuth(request, async (ctx) => {
    if (!ctx.isOwner) {
      return jsonError("Menu ini hanya untuk Owner", "forbidden", 403);
    }
    return handler(ctx);
  });
}

export interface KeyAccessResult {
  key: KeyRow;
  allowed: boolean;
  error?: Response;
}

/**
 * Cek kepemilikan key: Owner bebas, Reseller hanya key miliknya.
 * Dipakai sebelum edit / ban / hapus / reset HWID.
 */
export async function loadKeyWithAccess(
  ctx: AuthContext,
  keyId: string,
): Promise<KeyAccessResult> {
  if (!isUuid(keyId)) {
    return { key: null as unknown as KeyRow, allowed: false, error: jsonError("ID key tidak valid", "validation_error", 400) };
  }

  const { data, error } = await ctx.admin.from("keys").select("*").eq("id", keyId).maybeSingle<KeyRow>();

  if (error) {
    return {
      key: null as unknown as KeyRow,
      allowed: false,
      error: jsonError("Gagal membaca data key", "server_error", 500),
    };
  }

  if (!data) {
    return {
      key: null as unknown as KeyRow,
      allowed: false,
      error: jsonError("Key tidak ditemukan", "not_found", 404),
    };
  }

  if (!ctx.isOwner && data.created_by !== ctx.userId) {
    return {
      key: data,
      allowed: false,
      error: jsonError("Key ini bukan milik kamu", "forbidden", 403),
    };
  }

  return { key: data, allowed: true };
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}
