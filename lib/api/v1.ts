import type { NextRequest } from "next/server";

import {
  apiRequestCount,
  authenticateApiRequest,
  recordApiRequest,
  requestIp,
  type ApiKeyContext,
} from "@/lib/api/api-keys";
import { loadRuntime, type RuntimeSettings } from "@/lib/api/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types/database";
import { errorMessage, jsonError } from "@/lib/utils/http";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Pembungkus semua endpoint `/api/v1` (API publik reseller).
 *
 * Urutan yang dijalankan untuk setiap request:
 *   1. verifikasi API key (format → hash konstan-waktu → akun aktif),
 *   2. cek `api.enabled` (Owner bisa mematikan API dari Pengaturan),
 *   3. rate limit per key (`api.rateLimitPerMinute`, dihitung dari `api_request_logs`),
 *   4. jalankan handler dengan konteks `{ key, profile, admin, runtime }`,
 *   5. catat request + perbarui `last_used_at` & `requests_count`.
 *
 * Handler mengembalikan `Response` biasa (biasanya `jsonOk`/`jsonError`), jadi
 * bentuk respons API publik konsisten dengan panel: `{ ok, data }` / `{ ok, error, code }`.
 */

export interface ApiV1Context {
  admin: SupabaseClient<Database>;
  key: ApiKeyContext["key"];
  profile: ApiKeyContext["profile"];
  runtime: RuntimeSettings;
  /** Helper: `ctx.isOwner` untuk jalur khusus Owner. */
  isOwner: boolean;
}

export type ApiV1Handler = (ctx: ApiV1Context, request: NextRequest) => Promise<Response>;

export async function withApiKey(request: NextRequest, handler: ApiV1Handler): Promise<Response> {
  const admin = createAdminClient();

  const auth = await authenticateApiRequest(request, admin);
  if (!auth.ok) return jsonError(auth.error, auth.code, auth.status);

  const runtime = await loadRuntime(admin);
  if (!runtime.api.enabled) {
    return jsonError(
      "API publik sedang dimatikan oleh Owner",
      "api_disabled",
      403,
    );
  }

  const used = await apiRequestCount(admin, auth.context.key.id, 60);
  if (used >= runtime.api.rateLimitPerMinute) {
    return jsonError(
      `Rate limit tercapai (${runtime.api.rateLimitPerMinute} request/menit per API key). Coba lagi sebentar lagi.`,
      "rate_limited",
      429,
    );
  }

  const ctx: ApiV1Context = {
    admin,
    key: auth.context.key,
    profile: auth.context.profile,
    runtime,
    isOwner: auth.context.profile.role === "owner",
  };

  let response: Response;
  try {
    response = await handler(ctx, request);
  } catch (error) {
    console.error("[api/v1] handler error:", error);
    response = jsonError(errorMessage(error), "server_error", 500);
  }

  // Catat setelah response siap — kegagalan logging tidak mengubah hasil request.
  await recordApiRequest(admin, {
    apiKeyId: ctx.key.id,
    userId: ctx.profile.id,
    method: request.method,
    path: new URL(request.url).pathname,
    status: response.status,
    ip: requestIp(request),
    requestsCount: ctx.key.requests_count,
  });

  return response;
}

/** Info pemakai API key (dipakai `/api/v1/me`). */
export function apiKeySummary(ctx: ApiV1Context) {
  return {
    name: ctx.key.name,
    token_prefix: `${ctx.key.token_prefix}…`,
    created_at: ctx.key.created_at,
    last_used_at: ctx.key.last_used_at,
    requests_count: ctx.key.requests_count,
  };
}
