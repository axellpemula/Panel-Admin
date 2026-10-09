import type { NextRequest } from "next/server";

import { loadKeyWithAccess, withAuth } from "@/lib/api/auth";
import { isUuid } from "@/lib/api/auth";
import { getProfileUsername, recordAuditLog } from "@/lib/api/audit";
import { formatCooldownMessage, getHwidResetQuota } from "@/lib/api/hwid-reset";
import { jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string; deviceId: string };
}

/**
 * DELETE /api/keys/[id]/devices/[deviceId]
 * Reset 1 slot device (hapus HWID dari key) → slot-nya bisa dipakai device lain.
 * `deviceId` boleh berupa UUID baris device_logs atau HWID-nya langsung.
 * Tercatat di audit log (HWID yang direset ikut disimpan di detail).
 *
 * **Cooldown** — reseller dibatasi maksimal HWID_RESET.limit reset (termasuk
 * reset semua) dalam HWID_RESET.windowHours jam per key. Owner dibebaskan.
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

    const { deviceId } = route.params;
    const decoded = decodeURIComponent(deviceId);

    const query = ctx.admin.from("device_logs").delete().eq("key_id", key.id);
    const { data, error: deleteError } = isUuid(decoded)
      ? await query.eq("id", decoded).select("id, hardware_id")
      : await query.eq("hardware_id", decoded).select("id, hardware_id");

    if (deleteError) return jsonError(deleteError.message, "server_error", 500);
    if (!data || data.length === 0) {
      return jsonError("Device tidak ditemukan di key ini", "not_found", 404);
    }

    const removedHwid = data[0].hardware_id as string;

    // Jejak audit: siapa yang reset HWID (dan HWID mana yang direset).
    const keyOwnerUsername = await getProfileUsername(ctx.admin, key.created_by);
    await recordAuditLog(ctx.admin, {
      actorId: ctx.userId,
      actorUsername: ctx.profile.username,
      actorRole: ctx.role,
      action: "hwid_reset",
      keyId: key.id,
      keyValue: key.key_value,
      keyOwnerId: key.created_by,
      keyOwnerUsername,
      detail: { removed: data.length, hardware_id: removedHwid, max_device: key.max_device },
    });

    // Kembalikan quota terbaru (untuk UI) — hanya relevan untuk reseller.
    const quota = ctx.isOwner ? null : await getHwidResetQuota(ctx.admin, key.id);

    return jsonOk({
      reset: true,
      removed: data.length,
      hardware_id: removedHwid,
      cooldown: quota,
    });
  });
}
