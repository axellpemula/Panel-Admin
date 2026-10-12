import type { NextRequest } from "next/server";

import { recordActivity } from "@/lib/api/activity";
import { listOwnSessions, revokeOwnOtherSessions } from "@/lib/api/accounts";
import { withAuth } from "@/lib/api/auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    try {
      const result = await listOwnSessions(ctx);
      if (!result.ok) return jsonError(result.error, result.code, result.status);
      return jsonOk(result.data);
    } catch (error) {
      console.error("[auth/sessions] gagal membaca sesi:", error);
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

export async function DELETE(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    try {
      const result = await revokeOwnOtherSessions(ctx);
      if (!result.ok) return jsonError(result.error, result.code, result.status);

      await recordActivity(ctx.admin, {
        actorId: ctx.userId,
        actorUsername: ctx.profile.username,
        actorRole: ctx.profile.role,
        action: "sessions_revoke",
        targetType: "account",
        targetLabel: ctx.profile.username,
        detail: {
          revoked: result.data.revoked,
          limited: result.data.limited,
        },
      });

      return jsonOk({
        revoked: result.data.revoked,
        limited: result.data.limited,
        message:
          result.data.revoked >= 0
            ? `${result.data.revoked} sesi lain diputus`
            : "Semua sesi lain diputus",
      });
    } catch (error) {
      console.error("[auth/sessions] gagal memutus sesi:", error);
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
