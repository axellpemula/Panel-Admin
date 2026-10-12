import type { NextRequest } from "next/server";

import { listKeyDevices } from "@/lib/api/device-reset";
import { getHwidResetQuota, type HwidResetLimits } from "@/lib/api/hwid-reset";
import { getKeyDetail } from "@/lib/api/keys";
import { withApiKey } from "@/lib/api/v1";
import { isUuid } from "@/lib/api/auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, route: RouteParams) {
  return withApiKey(request, async (ctx) => {
    const raw = decodeURIComponent(route.params.id);
    const asKeyValue = raw.toUpperCase();
    const rawIsUuid = isUuid(raw);
    if (!rawIsUuid && !/^XLVP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(asKeyValue)) {
      return jsonError("ID/key tidak valid", "validation_error", 400);
    }

    try {
      let keyId = raw;
      if (!rawIsUuid) {
        const { data: row, error } = await ctx.admin
          .from("keys")
          .select("id, created_by")
          .eq("key_value", asKeyValue)
          .maybeSingle<{ id: string; created_by: string | null }>();
        if (error) return jsonError(error.message, "server_error", 500);
        if (!row) return jsonError("Key tidak ditemukan", "not_found", 404);
        keyId = row.id;
      }

      const detail = await getKeyDetail(ctx.admin, keyId);
      if (!detail) return jsonError("Key tidak ditemukan", "not_found", 404);
      if (!ctx.isOwner && detail.created_by !== ctx.profile.id) {
        return jsonError("Key ini bukan milik kamu", "forbidden", 403);
      }

      const devices = await listKeyDevices(ctx.admin, keyId);
      const limits: HwidResetLimits = {
        limit: ctx.runtime.hwid.resetLimit,
        windowHours: ctx.runtime.hwid.resetWindowHours,
      };
      const cooldown = ctx.isOwner
        ? null
        : await getHwidResetQuota(ctx.admin, keyId, new Date(), limits);

      return jsonOk({
        key: detail,
        devices,
        cooldown,
        reset_endpoint: `POST /api/v1/keys/${detail.key_value}/hwid-reset`,
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
