import type { NextRequest } from "next/server";

import { recordActivity } from "@/lib/api/activity";
import { revokeApiKey } from "@/lib/api/api-keys";
import { isUuid, withAuth } from "@/lib/api/auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: { id: string };
}

export async function DELETE(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID API key tidak valid", "validation_error", 400);

    try {
      const { data: existing } = await ctx.admin
        .from("reseller_api_keys")
        .select("id, user_id, name, token_prefix, is_active")
        .eq("id", id)
        .maybeSingle<{
          id: string;
          user_id: string;
          name: string;
          token_prefix: string;
          is_active: boolean;
        }>();

      if (!existing) return jsonError("API key tidak ditemukan", "not_found", 404);

      if (!ctx.isOwner && existing.user_id !== ctx.userId) {
        return jsonError("API key ini bukan milik kamu", "forbidden", 403);
      }
      if (!existing.is_active) {
        return jsonOk({ revoked: false, note: "API key ini sudah dicabut sebelumnya" });
      }

      const revoked = await revokeApiKey(ctx.admin, id);
      if (!revoked) return jsonError("Gagal mencabut API key", "server_error", 500);

      await recordActivity(ctx.admin, {
        actorId: ctx.userId,
        actorUsername: ctx.profile.username,
        actorRole: ctx.profile.role,
        action: "api_key_revoke",
        targetType: "api_key",
        targetId: id,
        targetLabel: existing.name,
        detail: { user_id: existing.user_id, token_prefix: existing.token_prefix },
      });

      return jsonOk({ revoked: true, api_key: revoked });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
