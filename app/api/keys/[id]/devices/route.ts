import type { NextRequest } from "next/server";

import { loadKeyWithAccess, withAuth } from "@/lib/api/auth";
import { listKeyDevices, resetKeyDevices } from "@/lib/api/device-reset";
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

    return jsonOk({
      reset: true,
      removed: result.removed,
      max_device: result.max_device,
      cooldown: result.cooldown,
    });
  });
}
