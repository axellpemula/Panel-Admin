import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, LoginLogRow } from "@/lib/types/database";

/**
 * Riwayat login — dicatat untuk percobaan sukses maupun gagal.
 * Dipakai: /api/auth/login (tulis), /api/auth/logins (baca), halaman Pengaturan
 * & detail reseller (tampil).
 *
 * Kegagalan menulis log TIDAK boleh menggagalkan login (hanya di-warn), sama
 * seperti credit_logs & audit_logs.
 */

export type LoginFailureReason =
  | "invalid_credentials"
  | "inactive"
  | "no_profile"
  | "rate_limited"
  | "email_not_confirmed"
  | "server_error";

export interface LoginLogEntry {
  userId: string | null;
  email: string | null;
  success: boolean;
  reason?: LoginFailureReason | null;
  ip: string;
  userAgent: string | null;
}

/** Potong user-agent supaya tidak ada baris raksasa dari client aneh. */
const USER_AGENT_MAX = 512;

export async function recordLoginLog(
  admin: SupabaseClient<Database>,
  entry: LoginLogEntry,
): Promise<void> {
  try {
    const { error } = await admin.from("login_logs").insert({
      user_id: entry.userId,
      email: entry.email,
      success: entry.success,
      reason: entry.success ? null : (entry.reason ?? null),
      ip: entry.ip,
      user_agent: entry.userAgent ? entry.userAgent.slice(0, USER_AGENT_MAX) : null,
    });
    if (error) console.warn("[login-log] insert gagal:", error.message);
  } catch (error) {
    console.warn("[login-log] insert gagal:", (error as Error)?.message ?? error);
  }
}

export interface LoginLogItem {
  id: string;
  created_at: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
}

/** Riwayat login satu akun, terbaru dulu. */
export async function listLoginLogs(
  admin: SupabaseClient<Database>,
  userId: string,
  limit = 20,
): Promise<LoginLogItem[]> {
  const { data, error } = await admin
    .from("login_logs")
    .select("id, created_at, success, reason, ip, user_agent")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));

  if (error) throw new Error(error.message);

  return ((data ?? []) as Pick<LoginLogRow, "id" | "created_at" | "success" | "reason" | "ip" | "user_agent">[]).map(
    (row) => ({
      id: row.id,
      created_at: row.created_at,
      success: Boolean(row.success),
      reason: row.reason ?? null,
      ip: row.ip ?? null,
      user_agent: row.user_agent ?? null,
    }),
  );
}

/** Label alasan gagal login (UI & CSV). */
export const LOGIN_REASON_LABEL: Record<string, string> = {
  invalid_credentials: "Email/password salah",
  inactive: "Akun nonaktif",
  no_profile: "Profil tidak ditemukan",
  rate_limited: "Terlalu banyak percobaan",
  email_not_confirmed: "Email belum dikonfirmasi",
  server_error: "Kesalahan server",
};
