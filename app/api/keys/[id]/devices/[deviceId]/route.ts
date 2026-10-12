import type { NextRequest } from "next/server";

import { loadKeyWithAccess, withAuth } from "@/lib/api/auth";
import { resetKeyDevices } from "@/lib/api/device-reset";
import { notifyResellerInBackground } from "@/lib/api/notify-reseller";
import type { HwidResetLimits } from "@/lib/api/hwid-reset";
import { loadRuntime } from "@/lib/api/settings";
import { jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string; deviceId: string };
}

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

    // Kabari pemilik key kalau reset dilakukan Owner (bukan dirinya sendiri).
    if (key.created_by && key.created_by !== ctx.userId) {
      notifyResellerInBackground(ctx.admin, {
        userId: key.created_by,
        event: "hwid_reset",
        title: "HWID key direset",
        lines: [
          `1 device pada key ${key.key_value} direset oleh ${ctx.profile.username}.`,
          "Pemakai tinggal login ulang — device baru terdaftar otomatis.",
        ],
        detail: { key_id: key.id, key_value: key.key_value, hardware_id: result.hardware_id ?? null },
      });
    }

    return jsonOk({
      reset: true,
      removed: result.removed,
      hardware_id: result.hardware_id,
      cooldown: result.cooldown,
    });
  });
}
