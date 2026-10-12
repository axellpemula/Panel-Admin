import type { SupabaseClient } from "@supabase/supabase-js";

import { getProfileUsername, recordAuditLog } from "@/lib/api/audit";
import { isUuid } from "@/lib/api/auth";
import { formatCooldownMessage, getHwidResetQuota, type HwidResetLimits, type ResetQuota } from "@/lib/api/hwid-reset";
import type { Database, KeyRow, UserRole } from "@/lib/types/database";
import type { ApiErrorCode } from "@/lib/utils/http";

/**
 * Logika reset HWID/device yang dipakai bersama oleh tiga jalur:
 *   1. panel (DELETE /api/keys/[id]/devices dan /api/keys/[id]/devices/[deviceId]),
 *   2. API publik reseller (POST /api/v1/keys/[id]/hwid-reset),
 *   3. perintah bot Telegram (`/reset KEY all|n`).
 *
 * Aturannya sama di semua jalur — ini penting: kalau kuota cooldown hanya dicek di
 * panel, reseller bisa mem-bypass-nya lewat API key atau bot.
 *
 * - Owner bebas kuota, tapi tetap dicatat di audit log.
 * - Reseller dibatasi `hwid.resetLimit` per `hwid.resetWindowHours` jam per key
 *   (`hwid_reset_cooldown` + 429 seperti di panel).
 * - Reset semua device dihitung SATU kuota (1 operasi), bukan per HWID.
 */

export type DeviceResetOutcome =
  | {
      ok: true;
      removed: number;
      hardware_id: string | null;
      max_device: number;
      cooldown: ResetQuota | null;
    }
  | {
      ok: false;
      error: string;
      code: ApiErrorCode;
      status: number;
      details?: Record<string, unknown>;
    };

export interface DeviceResetActor {
  admin: SupabaseClient<Database>;
  userId: string;
  username: string;
  role: UserRole;
  isOwner: boolean;
}

/**
 * Reset device pada satu key.
 * `hardwareId` kosong/null → hapus SEMUA device (reset semua).
 */
export async function resetKeyDevices(
  actor: DeviceResetActor,
  key: KeyRow,
  options: { hardwareId?: string | null; limits: HwidResetLimits },
): Promise<DeviceResetOutcome> {
  const { limits } = options;

  // --- Kuota cooldown (hanya untuk reseller). ---
  if (!actor.isOwner) {
    const quota = await getHwidResetQuota(actor.admin, key.id, new Date(), limits);
    if (quota.remaining <= 0) {
      return {
        ok: false,
        error: formatCooldownMessage(quota),
        code: "hwid_reset_cooldown",
        status: 429,
        details: { ...quota },
      };
    }
  }

  const target = (options.hardwareId ?? "").trim();
  let removed = 0;
  let removedHwid: string | null = null;

  if (target.length === 0) {
    // Reset semua.
    const { data, error } = await actor.admin
      .from("device_logs")
      .delete()
      .eq("key_id", key.id)
      .select("id");

    if (error) return { ok: false, error: error.message, code: "server_error", status: 500 };
    removed = (data ?? []).length;
  } else {
    const query = actor.admin.from("device_logs").delete().eq("key_id", key.id);
    const { data, error } = isUuid(target)
      ? await query.eq("id", target).select("id, hardware_id")
      : await query.eq("hardware_id", target).select("id, hardware_id");

    if (error) return { ok: false, error: error.message, code: "server_error", status: 500 };
    if (!data || data.length === 0) {
      return {
        ok: false,
        error: "Device tidak ditemukan di key ini",
        code: "not_found",
        status: 404,
      };
    }

    removed = data.length;
    removedHwid = (data[0].hardware_id as string) ?? null;
  }

  // --- Jejak audit (sama seperti panel). ---
  const keyOwnerUsername = await getProfileUsername(actor.admin, key.created_by);
  await recordAuditLog(actor.admin, {
    actorId: actor.userId,
    actorUsername: actor.username,
    actorRole: actor.role,
    action: target.length === 0 ? "hwid_reset_all" : "hwid_reset",
    keyId: key.id,
    keyValue: key.key_value,
    keyOwnerId: key.created_by,
    keyOwnerUsername,
    detail:
      target.length === 0
        ? { removed, max_device: key.max_device }
        : { removed, hardware_id: removedHwid, max_device: key.max_device },
  });

  const cooldown = actor.isOwner
    ? null
    : await getHwidResetQuota(actor.admin, key.id, new Date(), limits);

  return { ok: true, removed, hardware_id: removedHwid, max_device: key.max_device, cooldown };
}

/** Daftar device (HWID) pada satu key, urut dari yang pertama terdaftar. */
export async function listKeyDevices(
  admin: SupabaseClient<Database>,
  keyId: string,
): Promise<{ id: string; hardware_id: string; first_seen: string; last_seen: string }[]> {
  const { data, error } = await admin
    .from("device_logs")
    .select("id, hardware_id, first_seen, last_seen")
    .eq("key_id", keyId)
    .order("first_seen", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((device) => ({
    id: device.id as string,
    hardware_id: device.hardware_id as string,
    first_seen: device.first_seen as string,
    last_seen: device.last_seen as string,
  }));
}
