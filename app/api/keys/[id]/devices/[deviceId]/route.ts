import type { NextRequest } from "next/server";

import { loadKeyWithAccess, withAuth } from "@/lib/api/auth";
import { resetKeyDevices } from "@/lib/api/device-reset";
import type { HwidResetLimits } from "@/lib/api/hwid-reset";
import { loadRuntime } from "@/lib/api/settings";
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
 * **Cooldown** — reseller dibatasi `hwid.resetLimit` reset (termasuk reset semua)
 * dalam `hwid.resetWindowHours` jam per key (bisa diatur Owner di Pengaturan).
 * Owner dibebaskan. Logikanya ada di lib/api/device-reset.ts supaya sama dengan
 * jalur API publik & bot Telegram.
 */
export async function DELETE(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { key, allowed, error } = await loadKeyWithAccess(ctx, route.params.id);
    if (!allowed) return error as Response;

    const runtime = await loadRuntime(ctx.admin);
    const limits: HwidResetLimits = {
      limit: runtime.hwid.resetLimit,
      windowHours: runtime.hwid.resetWindowHours,
    };

    const result = await resetKeyDevices(
      {
        admin: ctx.admin,
        userId: ctx.userId,
        username: ctx.profile.username,
        role: ctx.role,
        isOwner: ctx.isOwner,
      },
      key,
      { hardwareId: decodeURIComponent(route.params.deviceId), limits },
    );

    if (!result.ok) return jsonError(result.error, result.code, result.status, result.details);

    return jsonOk({
      reset: true,
      removed: result.removed,
      hardware_id: result.hardware_id,
      cooldown: result.cooldown,
    });
  });
}
