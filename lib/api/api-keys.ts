import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ProfileRow, ResellerApiKeyRow } from "@/lib/types/database";
import { clientIp } from "@/lib/utils/http";

/**
 * API key reseller — akses mesin ke `/api/v1` (lihat docs/RESELLER_API.md).
 *
 * Format token:  `xlp_<prefix 12 hex>_<secret 32 hex>`
 * - `prefix` disimpan di database untuk identifikasi cepat + ditampilkan di UI,
 * - `secret` TIDAK PERNAH disimpan: yang disimpan hanya SHA-256 dari token penuh,
 * - verifikasi memakai perbandingan konstan-waktu (anti timing attack),
 * - token penuh hanya muncul SEKALI, saat dibuat.
 */

export interface ApiKeyItem {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  requests_count: number;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
  /** Diisi kalau diminta (daftar untuk Owner). */
  username?: string | null;
}

export interface CreatedApiKey {
  apiKey: ApiKeyItem;
  /** Token lengkap — hanya dikembalikan sekali. */
  token: string;
}

const TOKEN_PREFIX_PATTERN = /^xlp_[0-9a-f]{12}$/;

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Prefix yang dipakai untuk mencari baris key (`xlp_<12 hex>`). */
export function tokenPrefix(token: string): string | null {
  const parts = token.split("_");
  if (parts.length !== 3) return null;
  const prefix = `xlp_${parts[1]}`;
  return TOKEN_PREFIX_PATTERN.test(prefix) ? prefix : null;
}

/** Bandingkan dua hash hex dengan waktu konstan. */
function hashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const prefix = `xlp_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(32).toString("hex");
  const token = `${prefix}_${secret}`;
  return { token, prefix, hash: hashApiToken(token) };
}

function normalize(row: Record<string, unknown>): ApiKeyItem {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name ?? ""),
    token_prefix: String(row.token_prefix ?? ""),
    is_active: row.is_active !== false && row.is_active !== 0,
    last_used_at: (row.last_used_at as string | null) ?? null,
    requests_count: Number(row.requests_count ?? 0),
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at),
    revoked_at: (row.revoked_at as string | null) ?? null,
  };
}

/** Buat API key baru. Token penuh dikembalikan sekali di sini. */
export async function createApiKey(
  admin: SupabaseClient<Database>,
  input: { userId: string; name: string; createdBy: string },
): Promise<CreatedApiKey> {
  const { token, prefix, hash } = generateApiToken();

  const { data, error } = await admin
    .from("reseller_api_keys")
    .insert({
      user_id: input.userId,
      name: input.name,
      token_prefix: prefix,
      token_hash: hash,
      is_active: true,
      requests_count: 0,
      created_by: input.createdBy,
    })
    .select("*")
    .maybeSingle<Record<string, unknown>>();

  if (error || !data) throw new Error(error?.message ?? "Gagal membuat API key");

  return { apiKey: normalize(data), token };
}

/** Daftar API key milik satu user (termasuk yang sudah dicabut, untuk riwayat). */
export async function listApiKeys(
  admin: SupabaseClient<Database>,
  options: { userId?: string; activeOnly?: boolean; limit?: number },
): Promise<ApiKeyItem[]> {
  let query = admin
    .from("reseller_api_keys")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, options.limit ?? 50)));

  if (options.userId) query = query.eq("user_id", options.userId);
  if (options.activeOnly) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const items = ((data ?? []) as unknown as Record<string, unknown>[]).map(normalize);

  // Lengkapi username (Owner perlu tahu milik siapa setiap key).
  const userIds = [...new Set(items.map((item) => item.user_id))];
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, username")
      .in("id", userIds);
    const names = new Map(
      ((profiles ?? []) as { id: string; username: string }[]).map((row) => [row.id, row.username]),
    );
    items.forEach((item) => {
      item.username = names.get(item.user_id) ?? null;
    });
  }

  return items;
}

/** Cabut satu API key (soft revoke: `is_active = false` + `revoked_at`). */
export async function revokeApiKey(
  admin: SupabaseClient<Database>,
  id: string,
): Promise<ApiKeyItem | null> {
  const { data, error } = await admin
    .from("reseller_api_keys")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle<Record<string, unknown>>();

  if (error) throw new Error(error.message);
  return data ? normalize(data) : null;
}

/** Ambil token mentah dari header (tanpa verifikasi apa pun). */
export function readApiToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("x-api-key") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
}

export interface ApiKeyContext {
  key: ApiKeyItem;
  profile: ProfileRow;
}

export type ApiKeyAuthResult =
  | { ok: true; context: ApiKeyContext }
  | { ok: false; status: number; error: string; code: "unauthorized" | "forbidden" | "server_error" };

/**
 * Verifikasi header `Authorization: Bearer xlp_...` (atau `X-API-Key`).
 * Tidak menyentuh rate limit — itu tugas pembungkus `withApiKey`.
 */
export async function authenticateApiRequest(
  request: NextRequest,
  admin: SupabaseClient<Database>,
): Promise<ApiKeyAuthResult> {
  const token = readApiToken(request);

  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      error:
        "API key tidak ditemukan. Kirim header `Authorization: Bearer <token>` — buat API key di panel (Pengaturan → API Key).",
    };
  }

  const prefix = tokenPrefix(token);
  if (!prefix) {
    return { ok: false, status: 401, code: "unauthorized", error: "Format API key tidak valid" };
  }

  const { data, error } = await admin
    .from("reseller_api_keys")
    .select("*")
    .eq("token_prefix", prefix)
    .maybeSingle<Record<string, unknown>>();

  if (error) {
    return { ok: false, status: 500, code: "server_error", error: "Gagal memeriksa API key" };
  }

  // Selalu hitung hash & bandingkan (walau baris tidak ada) supaya waktu respons
  // untuk prefix tak dikenal tidak jauh berbeda dengan prefix yang ada.
  const expected = data ? String((data as Record<string, unknown>).token_hash ?? "") : "0".repeat(64);
  const matches = hashEquals(hashApiToken(token), expected);

  if (!data || !matches) {
    return { ok: false, status: 401, code: "unauthorized", error: "API key tidak valid" };
  }

  const key = normalize(data);
  if (!key.is_active) {
    return { ok: false, status: 401, code: "unauthorized", error: "API key sudah dicabut" };
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .eq("id", key.user_id)
    .maybeSingle<ProfileRow>();

  if (profileError) {
    return { ok: false, status: 500, code: "server_error", error: "Gagal membaca profil pemilik API key" };
  }
  if (!profile) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      error: "Akun pemilik API key tidak ditemukan",
    };
  }
  if (profile.is_active === false) {
    return { ok: false, status: 403, code: "forbidden", error: "Akun pemilik API key dinonaktifkan" };
  }

  return { ok: true, context: { key, profile } };
}

/** Jumlah request API key ini dalam rentang detik terakhir. */
export async function apiRequestCount(
  admin: SupabaseClient<Database>,
  apiKeyId: string,
  windowSeconds = 60,
): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await admin
    .from("api_request_logs")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId)
    .gte("created_at", since);

  if (error) {
    console.warn("[api/v1] gagal menghitung pemakaian:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** Catat satu request + perbarui statistik pemakaian key. */
export async function recordApiRequest(
  admin: SupabaseClient<Database>,
  input: {
    apiKeyId: string;
    userId: string;
    method: string;
    path: string;
    status: number;
    ip: string;
    requestsCount: number;
  },
): Promise<void> {
  try {
    const { error } = await admin.from("api_request_logs").insert({
      api_key_id: input.apiKeyId,
      user_id: input.userId,
      method: input.method,
      path: input.path.slice(0, 255),
      status: input.status,
      ip: input.ip.slice(0, 128),
    });
    if (error) console.warn("[api/v1] log request gagal:", error.message);

    await admin
      .from("reseller_api_keys")
      .update({
        last_used_at: new Date().toISOString(),
        requests_count: input.requestsCount + 1,
      })
      .eq("id", input.apiKeyId);
  } catch (error) {
    console.warn("[api/v1] gagal mencatat pemakaian:", (error as Error)?.message ?? error);
  }
}

/** IP pemanggil (untuk log). */
export function requestIp(request: NextRequest): string {
  return clientIp(request);
}

export type { ResellerApiKeyRow };
