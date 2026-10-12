import type { NextRequest } from "next/server";

import { loadKeyWithAccess, withAuth } from "@/lib/api/auth";
import { listKeyDevices, resetKeyDevices } from "@/lib/api/device-reset";
import { notifyResellerInBackground } from "@/lib/api/notify-reseller";
import { getHwidResetQuota, type HwidResetLimits } from "@/lib/api/hwid-reset";
import { loadRuntime } from "@/lib/api/settings";
import { jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { key, allowed, error } = await loadKeyWithAccess(ctx, route.params.id);
    if (!allowed) return error as Response;

    const runtime = await loadRuntime(ctx.admin);
    const limits: HwidResetLimits = {
      limit: runtime.hwid.resetLimit,
      windowHours: runtime.hwid.resetWindowHours,
    };

    let devices: Awaited<ReturnType<typeof listKeyDevices>>;
    try {
      devices = await listKeyDevices(ctx.admin, key.id);
    } catch (error) {
      return jsonError((error as Error).message, "server_error", 500);
    }

    const cooldown = ctx.isOwner
      ? { used: 0, limit: 0, remaining: -1, window_start: null, next_reset_at: null, retry_after_seconds: null }
      : await getHwidResetQuota(ctx.admin, key.id, new Date(), limits);

    return jsonOk({
      devices,
      used: devices.length,
      max_device: key.max_device,
      cooldown,
    });
  });
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
      { limits },
    );

    if (!result.ok) return jsonError(result.error, result.code, result.status, result.details);

    // Kabari pemilik key kalau reset dilakukan Owner (bukan dirinya sendiri).
    if (key.created_by && key.created_by !== ctx.userId) {
      notifyResellerInBackground(ctx.admin, {
        userId: key.created_by,
        event: "hwid_reset",
        title: "HWID key direset",
        lines: [
          `Semua device pada key ${key.key_value} direset oleh ${ctx.profile.username} (${result.removed} device dihapus).`,
          "Pemakai tinggal login ulang — device baru terdaftar otomatis.",
        ],
        detail: { key_id: key.id, key_value: key.key_value, removed: result.removed },
      });
    }

    return jsonOk({
      reset: true,
      removed: result.removed,
      max_device: result.max_device,
      cooldown: result.cooldown,
    });
  });
}
