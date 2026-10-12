import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { dbMode, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import type { AuthContext } from "@/lib/api/auth";
import * as localAuth from "@/lib/db/sqlite/auth";
import type { ApiErrorCode } from "@/lib/utils/http";

/**
 * Keamanan akun: ganti password sendiri + kelola sesi aktif.
 *
 * Dua mode database punya kemampuan berbeda, jadi perbedaannya diseragamkan di
 * sini supaya API route & UI tidak perlu bercabang:
 *
 * | Fitur                | SQLite                                  | Supabase                                  |
 * | -------------------- | --------------------------------------- | ----------------------------------------- |
 * | Verifikasi password  | `verifyAccountPassword` (scrypt)        | sign-in ke GoTrue dengan client sementara |
 * | Ganti password       | `updateAccount` (sesi lain diputus)     | `auth.admin.updateUserById`               |
 * | Daftar sesi          | tabel `auth_sessions` (IP + user-agent) | hanya sesi yang sedang dipakai (GoTrue)   |
 * | Putus sesi lain      | `revokeOtherSessions`                   | `auth.admin.signOut(jwt, 'others')`       |
 */

export type AccountResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: ApiErrorCode; status: number };

export interface SessionInfo {
  id: string;
  created_at: string | null;
  expires_at: string | null;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
}

export interface SessionList {
  items: SessionInfo[];
  /** True kalau mode ini tidak bisa menampilkan daftar sesi lengkap (Supabase). */
  limited: boolean;
  mode: "sqlite" | "supabase";
}

/**
 * Verifikasi password lama.
 * Supabase: login pakai client sementara (`persistSession: false`) supaya cookie
 * sesi panel tidak ikut berubah hanya untuk mengecek password.
 */
async function verifyCurrentPassword(
  ctx: AuthContext,
  password: string,
): Promise<boolean> {
  if (dbMode() === "sqlite") {
    return localAuth.verifyAccountPassword(ctx.userId, password);
  }

  const email = ctx.email ?? ctx.profile.email;
  if (!email) return false;

  const ephemeral = createSupabaseClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await ephemeral.auth.signInWithPassword({ email, password });
  if (error || !data.user) return false;
  return data.user.id === ctx.userId;
}

/** Sesi yang sedang dipakai request ini (untuk dipakai sebagai pengecualian revoke). */
async function currentSessionInfo(ctx: AuthContext): Promise<SessionInfo | null> {
  if (dbMode() !== "sqlite") {
    const {
      data: { session },
    } = await ctx.supabase.auth.getSession();
    if (!session) return null;
    return {
      id: session.access_token.slice(-12),
      created_at: null,
      expires_at: session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : null,
      ip: null,
      user_agent: null,
      current: true,
    };
  }
  return null;
}

/** Daftar sesi aktif akun sendiri. */
export async function listOwnSessions(ctx: AuthContext): Promise<AccountResult<SessionList>> {
  if (dbMode() === "sqlite") {
    const items = await localAuth.listSessions(ctx.userId);
    return { ok: true, data: { items, limited: false, mode: "sqlite" } };
  }

  const current = await currentSessionInfo(ctx);
  return {
    ok: true,
    data: {
      items: current ? [current] : [],
      limited: true,
      mode: "supabase",
    },
  };
}

/** Putus semua sesi akun sendiri KECUALI yang sedang dipakai. */
export async function revokeOwnOtherSessions(
  ctx: AuthContext,
): Promise<AccountResult<{ revoked: number; limited: boolean }>> {
  if (dbMode() === "sqlite") {
    const revoked = await localAuth.revokeOtherSessions(ctx.userId);
    return { ok: true, data: { revoked, limited: false } };
  }

  const {
    data: { session },
  } = await ctx.supabase.auth.getSession();

  if (!session?.access_token) {
    return {
      ok: false,
      error: "Sesi tidak ditemukan. Silakan login lagi.",
      code: "unauthorized",
      status: 401,
    };
  }

  try {
    // Scope 'others' = semua sesi lain milik user ini (termasuk refresh token-nya).
    await ctx.admin.auth.admin.signOut(session.access_token, "others");
    return { ok: true, data: { revoked: -1, limited: true } };
  } catch (error) {
    const message = (error as Error)?.message ?? "Gagal memutus sesi lain";
    return { ok: false, error: message, code: "server_error", status: 500 };
  }
}

/**
 * Ganti password akun sendiri.
 * Setelah berhasil, semua sesi lain diputus — sesi yang dipakai sekarang tetap
 * hidup supaya user tidak ikut ter-logout.
 */
export async function changeOwnPassword(
  ctx: AuthContext,
  input: { currentPassword: string; newPassword: string; logoutOthers: boolean },
): Promise<AccountResult<{ revoked: number }>> {
  const currentOk = await verifyCurrentPassword(ctx, input.currentPassword);
  if (!currentOk) {
    return {
      ok: false,
      error: "Password lama tidak cocok",
      code: "unauthorized",
      status: 401,
    };
  }

  if (input.currentPassword === input.newPassword) {
    return {
      ok: false,
      error: "Password baru harus berbeda dari password lama",
      code: "validation_error",
      status: 400,
    };
  }

  // -1 = "semua sesi lain diputus" (jumlah pastinya tidak dihitung).
  let revoked = 0;

  if (dbMode() === "sqlite") {
    const keepToken = input.logoutOthers ? localAuth.currentSessionToken() : null;
    // Ganti password + putus sesi lain dalam satu operasi (mode SQLite).
    const result = await localAuth.updateAccount(
      ctx.userId,
      { password: input.newPassword },
      { keepSessionToken: keepToken },
    );
    if (result.error) {
      return {
        ok: false,
        error: result.error.message,
        code: "server_error",
        status: result.error.status ?? 500,
      };
    }
    if (keepToken) revoked = -1;
  } else {
    const { error } = await ctx.admin.auth.admin.updateUserById(ctx.userId, {
      password: input.newPassword,
    });
    if (error) {
      return { ok: false, error: error.message, code: "server_error", status: 500 };
    }

    if (input.logoutOthers) {
      const result = await revokeOwnOtherSessions(ctx);
      if (!result.ok) {
        // Password sudah berubah; kegagalan memutus sesi lain tidak fatal.
        console.warn("[accounts] gagal memutus sesi lain:", result.error);
        return { ok: true, data: { revoked } };
      }
      revoked = result.data.revoked;
    }
  }

  return { ok: true, data: { revoked } };
}
