import type { NextRequest } from "next/server";

import { LIMITS, KEY_REGEX, NONCE_REGEX, RATE_LIMIT, type ValidationReason } from "@/lib/constants";
import { notifyInBackground } from "@/lib/api/notify";
import { loadRuntime, type RuntimeSettings } from "@/lib/api/settings";
import { licensePrivateKey } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { base64Encode, loadSigningKey, signJsonPayload } from "@/lib/utils/crypto";
import {
  clientIp,
  jsonError,
  readJsonBody,
  validateBadRequest,
  validateFailure,
  validateRateLimited,
} from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ValidateBody {
  key?: unknown;
  tool_slug?: unknown;
  tool_version?: unknown;
  hardware_id?: unknown;
  nonce?: unknown;
}

interface ValidatedInput {
  key: string;
  toolSlug: string;
  toolVersion: string;
  hardwareId: string;
  nonce: string;
}

interface SignedResponse {
  payload: string;
  signature: string;
}

function isPlainFiniteString(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  const raw = await readJsonBody(request, LIMITS.bodyBytes);
  if (!raw.ok) {
    await logAttempt(null, ip, null, null, false, "invalid_request");
    return validateBadRequest();
  }

  const body = raw.value as ValidateBody;
  if (!body || typeof body !== "object") {
    await logAttempt(null, ip, null, null, false, "invalid_request");
    return validateBadRequest();
  }

  const parsed = parseInput(body);
  if (!parsed) {
    await logAttempt(null, ip, null, null, false, "invalid_request");
    return validateBadRequest();
  }

  const { key, toolSlug, toolVersion, hardwareId, nonce } = parsed;

  let admin: SupabaseClient<Database>;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("[validate] supabase admin tidak siap:", (error as Error).message);
    return validateFailure("server_error", 500);
  }

  const runtime = await loadRuntime(admin);

  const rateLimit = await checkRateLimits(
    admin,
    ip,
    key,
    runtime.validate.perIpPerMinute,
    runtime.validate.perKeyPerMinute,
  );
  if (rateLimit) {
    await logAttempt(admin, ip, key, hardwareId, false, "rate_limited");
    return validateRateLimited();
  }

  const bruteForce = await isBruteForceIp(admin, ip, runtime);
  const maskFailures = bruteForce.active;

  if (bruteForce.justCrossed) {
    notifyInBackground(admin, {
      event: "validation_burst",
      title: "Percobaan brute-force key terdeteksi",
      lines: [
        `IP ${ip} sudah ${bruteForce.count}x gagal dengan key tidak dikenal dalam ${runtime.validate.bruteForceWindowMinutes} menit terakhir.`,
        "Semua kegagalan berikutnya dari IP ini disamarkan sebagai `invalid_key` anti-bruteforce.",
        `Untuk memblokir permanen, atur firewall/proxy di depan panel.`,
      ],
      dedupeKey: `validation_burst:${ip}`,
      detail: { ip, failures: bruteForce.count, window_minutes: runtime.validate.bruteForceWindowMinutes },
    });
  }

  const fail = async (reason: ValidationReason, status = 200) => {
    await logAttempt(admin, ip, key, hardwareId, false, reason);
    if (maskFailures && reason !== "rate_limited" && reason !== "invalid_request") {
      return validateFailure("invalid_key", status);
    }
    return validateFailure(reason, status);
  };

  const { data: keyRow, error: keyError } = await admin
    .from("keys")
    .select("id, key_value, status, expired_at, max_device, tool_type_id, tool_version_id, created_by")
    .eq("key_value", key)
    .maybeSingle();

  if (keyError) {
    console.error("[validate] query key gagal:", keyError.message);
    return fail("server_error", 500);
  }
  if (!keyRow) return fail("invalid_key");

  if (keyRow.status === "banned") return fail("key_banned");
  if (keyRow.status !== "active") {
    // Status 'expired' (atau nilai tak dikenal) diperlakukan sebagai expired.
    return fail("key_expired");
  }

  const { data: tool, error: toolError } = await admin
    .from("tool_types")
    .select("id, slug, is_active")
    .eq("id", keyRow.tool_type_id)
    .maybeSingle();

  if (toolError) {
    console.error("[validate] query tool gagal:", toolError.message);
    return fail("server_error", 500);
  }
  if (!tool || tool.slug !== toolSlug || tool.is_active !== true) return fail("wrong_tool");

  const { data: version, error: versionError } = await admin
    .from("tool_versions")
    .select("id, name, is_active")
    .eq("id", keyRow.tool_version_id)
    .maybeSingle();

  if (versionError) {
    console.error("[validate] query version gagal:", versionError.message);
    return fail("server_error", 500);
  }
  if (!version || version.name !== toolVersion || version.is_active !== true) {
    return fail("wrong_version");
  }

  if (keyRow.expired_at) {
    const expiredAt = new Date(keyRow.expired_at).getTime();
    if (Number.isFinite(expiredAt) && expiredAt <= Date.now()) {
      void admin.from("keys").update({ status: "expired" }).eq("id", keyRow.id);
      return fail("key_expired");
    }
  }

  const { data: deviceResult, error: deviceError } = await admin.rpc("register_device", {
    p_key_id: keyRow.id,
    p_hwid: hardwareId,
  });

  if (deviceError || !deviceResult) {
    console.error("[validate] register_device gagal:", deviceError?.message ?? "no data");
    return fail("server_error", 500);
  }

  const deviceRow = Array.isArray(deviceResult)
    ? (deviceResult[0] as { result: string; current_devices: number } | undefined)
    : undefined;

  if (!deviceRow) return fail("server_error", 500);

  if (deviceRow.result !== "ok") {
    await logAttempt(admin, ip, key, hardwareId, false, "device_limit_exceeded");
    try {
      const banResult = await admin.rpc("check_auto_ban", {
        p_key_id: keyRow.id,
        p_hwid: hardwareId,
        p_ip: ip,
        p_distinct_limit: runtime.validate.autoBanDistinctHwids,
        p_window_minutes: runtime.validate.autoBanWindowMinutes,
        p_note: RATE_LIMIT.autoBanNote,
      });

      const banRow = Array.isArray(banResult.data)
        ? (banResult.data[0] as { result?: string; distinct_hwids?: number } | undefined)
        : undefined;

      if (banRow?.result === "banned") {
        notifyInBackground(admin, {
          event: "key_auto_ban",
          title: "Key di-auto-ban (terlalu banyak device)",
          lines: [
            `Key ${keyRow.key_value} diblokir otomatis: ${banRow.distinct_hwids ?? runtime.validate.autoBanDistinctHwids} HWID berbeda mencoba memakainya dalam ${runtime.validate.autoBanWindowMinutes} menit.`,
            `HWID pemicu: ${hardwareId}`,
            `IP: ${ip}`,
            "Unban hanya bisa dilakukan Owner, reseller tidak bisa membukanya.",
          ],
          dedupeKey: `auto_ban:${keyRow.id}`,
          notifyUserIds: [keyRow.created_by],
          detail: {
            key_id: keyRow.id,
            key_value: keyRow.key_value,
            ip,
            hardware_id: hardwareId,
            distinct_hwids: banRow.distinct_hwids ?? null,
          },
        });
      }
    } catch (rpcError) {
      console.warn("[validate] check_auto_ban gagal:", (rpcError as Error).message);
    }
    if (maskFailures) return validateFailure("invalid_key");
    return validateFailure("device_limit_exceeded");
  }

  const currentDevices = Number(deviceRow.current_devices) || 1;

  const nowIso = new Date().toISOString();
  const { error: touchError } = await admin
    .from("keys")
    .update({ last_used: nowIso })
    .eq("id", keyRow.id);

  if (touchError) {
    console.warn("[validate] update last_used gagal:", touchError.message);
  }

  const { data: secretRow, error: secretError } = await admin
    .from("tool_secrets")
    .select("secret_payload")
    .eq("tool_type_id", tool.id)
    .maybeSingle();

  if (secretError) {
    console.warn("[validate] query tool_secrets gagal:", secretError.message);
  }

  const secretPayload =
    secretRow && typeof secretRow.secret_payload === "string" && secretRow.secret_payload.length > 0
      ? secretRow.secret_payload
      : null;

  let signed: SignedResponse;
  try {
    const ttlSeconds = runtime.validate.tokenTtlSeconds;
    const serverTime = new Date();
    const tokenExpiresAt = new Date(serverTime.getTime() + ttlSeconds * 1000);

    const payload = {
      valid: true,
      tool: tool.slug,
      version: version.name,
      expired_at: keyRow.expired_at ?? null,
      max_device: Number(keyRow.max_device) || 1,
      current_devices: currentDevices,
      hardware_id: hardwareId,
      nonce,
      server_time: serverTime.toISOString(),
      token_expires_at: tokenExpiresAt.toISOString(),
      secret_payload: secretPayload,
    };

    const payloadJson = JSON.stringify(payload);
    const privateKey = loadSigningKey(licensePrivateKey(), "private");
    const signature = signJsonPayload(payloadJson, privateKey);

    signed = {
      payload: base64Encode(Buffer.from(payloadJson, "utf8")),
      signature: base64Encode(signature),
    };
  } catch (error) {
    console.error("[validate] gagal menandatangani payload:", (error as Error).message);
    return fail("server_error", 500);
  }

  await logAttempt(admin, ip, key, hardwareId, true, null);

  return Response.json(signed, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}

export async function GET() {
  return jsonError("Method tidak didukung. Gunakan POST.", "validation_error", 405);
}

function parseInput(body: ValidateBody): ValidatedInput | null {
  if (!isPlainFiniteString(body.key, 14, 14)) return null;
  const key = body.key.toUpperCase();
  if (!KEY_REGEX.test(key)) return null;

  if (!isPlainFiniteString(body.tool_slug, 1, LIMITS.toolSlugMax)) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(body.tool_slug)) return null;

  if (!isPlainFiniteString(body.tool_version, 1, LIMITS.toolVersionMax)) return null;
  if (!/^[A-Za-z0-9._\-+ ]+$/.test(body.tool_version)) return null;

  if (!isPlainFiniteString(body.hardware_id, LIMITS.hardwareIdMin, LIMITS.hardwareIdMax)) {
    return null;
  }
  if (/\s/.test(body.hardware_id)) return null;

  if (!isPlainFiniteString(body.nonce, 16, 64)) return null;
  if (!NONCE_REGEX.test(body.nonce)) return null;

  return {
    key,
    toolSlug: body.tool_slug,
    toolVersion: body.tool_version,
    hardwareId: body.hardware_id,
    nonce: body.nonce,
  };
}

async function checkRateLimits(
  admin: SupabaseClient<Database>,
  ip: string,
  key: string,
  perIpPerMinute: number,
  perKeyPerMinute: number,
): Promise<boolean> {
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();

  const [ipCount, keyCount] = await Promise.all([
    admin
      .from("validation_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", oneMinuteAgo)
      .or("reason.is.null,reason.neq.rate_limited"),
    admin
      .from("validation_attempts")
      .select("id", { count: "exact", head: true })
      .eq("key_value", key)
      .gte("created_at", oneMinuteAgo)
      .or("reason.is.null,reason.neq.rate_limited"),
  ]);

  if ((ipCount.count ?? 0) >= perIpPerMinute) return true;
  if ((keyCount.count ?? 0) >= perKeyPerMinute) return true;
  return false;
}

async function isBruteForceIp(
  admin: SupabaseClient<Database>,
  ip: string,
  runtime: RuntimeSettings,
): Promise<{ active: boolean; count: number; justCrossed: boolean }> {
  const windowStart = new Date(
    Date.now() - runtime.validate.bruteForceWindowMinutes * 60_000,
  ).toISOString();

  const { count, error } = await admin
    .from("validation_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("reason", "invalid_key")
    .gte("created_at", windowStart);

  if (error) {
    console.warn("[validate] cek bruteforce gagal:", error.message);
    return { active: false, count: 0, justCrossed: false };
  }

  const total = count ?? 0;
  return {
    active: total >= runtime.validate.bruteForceFailures,
    count: total,
    justCrossed: total === runtime.validate.bruteForceFailures,
  };
}

async function logAttempt(
  admin: SupabaseClient<Database> | null,
  ip: string,
  keyValue: string | null,
  hardwareId: string | null,
  success: boolean,
  reason: string | null,
): Promise<void> {
  if (!admin) return;

  const { error } = await admin.from("validation_attempts").insert({
    ip,
    key_value: keyValue,
    hardware_id: hardwareId,
    success,
    reason,
  });

  if (error) {
    console.warn("[validate] log attempt gagal:", error.message);
  }
}
