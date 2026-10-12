import type { NextRequest } from "next/server";

import { apiKeySummary, withApiKey } from "@/lib/api/v1";
import { jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withApiKey(request, async (ctx) =>
    jsonOk({
      user: {
        id: ctx.profile.id,
        username: ctx.profile.username,
        email: ctx.profile.email,
        role: ctx.profile.role,
        credit: ctx.profile.credit,
        is_active: ctx.profile.is_active,
      },
      api_key: apiKeySummary(ctx),
      limits: {
        rate_limit_per_minute: ctx.runtime.api.rateLimitPerMinute,
        max_device_min: ctx.runtime.keys.maxDeviceMin,
        max_device_max: ctx.runtime.keys.maxDeviceMax,
        quantity_max: ctx.isOwner
          ? ctx.runtime.keys.quantityOwnerMax
          : ctx.runtime.keys.quantityResellerMax,
        hwid_reset_limit: ctx.runtime.hwid.resetLimit,
        hwid_reset_window_hours: ctx.runtime.hwid.resetWindowHours,
      },
      server_time: new Date().toISOString(),
    }),
  );
}
