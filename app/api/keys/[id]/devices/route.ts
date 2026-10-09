import type { NextRequest } from "next/server";

import { loadKeyWithAccess, withAuth } from "@/lib/api/auth";
import { getProfileUsername, recordAuditLog } from "@/lib/api/audit";
import { formatCooldownMessage, getHwidResetQuota } from "@/lib/api/hwid-reset";
import { jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/keys/[id]/devices
 * Daftar HWID yang terdaftar di key ini, urut dari yang paling awal dipakai.
 * Juga mengembalikan informasi cooldown reset HWID (kuota tersisa) supaya UI
 * bisa menampilkan peringatan & men-disable tombol sebelum user menekannya.
 */
export async function GET(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { key, allowed, error } = await loadKeyWithAccess(ctx, route.params.id);
    if (!allowed) return error as Response;

    const { data, error: listError } = await ctx.admin
      .from("device_logs")
      .select("id, hardware_id, first_seen, last_seen")
      .eq("key_id", key.id)
      .order("first_seen", { ascending: true });

    if (listError) return jsonError(listError.message, "server_error", 500);

    const devices = (data ?? []).map((device) => ({
      id: device.id as string,
      hardware_id: device.hardware_id as string,
      first_seen: device.first_seen as string,
      last_seen: device.last_seen as string,
    }));

    // Kuota cooldown — untuk Owner selalu dilaporkan unlimited (remaining = limit).
    const cooldown = ctx.isOwner
      ? { used: 0, limit: 0, remaining: -1, window_start: null, next_reset_at: null, retry_after_seconds: null }
      : await getHwidResetQuota(ctx.admin, key.id);

    return jsonOk({
      devices,
      used: devices.length,
      max_device: key.max_device,
      cooldown,
    });
  });
}

/**
 * DELETE /api/keys/[id]/devices
 * Reset SEMUA slot device pada key ini. Tercatat di audit log.
 *
 * **Cooldown** — untuk reseller, "Reset Semua" dihitung 1 kuota yang sama
 * dengan reset 1 HWID (bukan per HWID), karena aksi ini 1 kali operasi dan
 * harus dihitung tegas supaya tidak jadi celah bypass.
 */
export async function DELETE(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { key, allowed, error } = await loadKeyWithAccess(ctx, route.params.id);
    if (!allowed) return error as Response;

    // --- Cek kuota cooldown (hanya untuk reseller). ---
    if (!ctx.isOwner) {
      const quota = await getHwidResetQuota(ctx.admin, key.id);
      if (quota.remaining <= 0) {
        return jsonError(formatCooldownMessage(quota), "hwid_reset_cooldown", 429, {
          ...quota,
        });
      }
    }

    const { data, error: deleteError } = await ctx.admin
      .from("device_logs")
      .delete()
      .eq("key_id", key.id)
      .select("id");

    if (deleteError) return jsonError(deleteError.message, "server_error", 500);

    const removed = (data ?? []).length;

    // Jejak audit: siapa yang reset semua HWID pada key ini.
    const keyOwnerUsername = await getProfileUsername(ctx.admin, key.created_by);
    await recordAuditLog(ctx.admin, {
      actorId: ctx.userId,
      actorUsername: ctx.profile.username,
      actorRole: ctx.role,
      action: "hwid_reset_all",
      keyId: key.id,
      keyValue: key.key_value,
      keyOwnerId: key.created_by,
      keyOwnerUsername,
      detail: { removed, max_device: key.max_device },
    });

    // Kembalikan quota terbaru (untuk UI).
    const cooldown = ctx.isOwner ? null : await getHwidResetQuota(ctx.admin, key.id);

    return jsonOk({ reset: true, removed, max_device: key.max_device, cooldown });
  });
}
