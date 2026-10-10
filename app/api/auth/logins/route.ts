import type { NextRequest } from "next/server";

import { isUuid, withAuth } from "@/lib/api/auth";
import { listLoginLogs } from "@/lib/api/login-log";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/logins?user_id=&limit=
 * Riwayat login (sukses & gagal) akun sendiri. Owner boleh melihat akun lain
 * lewat `user_id` (dipakai halaman detail reseller).
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    const params = request.nextUrl.searchParams;
    const requested = params.get("user_id");
    const limitRaw = Number(params.get("limit") ?? 20);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

    let userId = ctx.userId;
    if (requested && requested !== ctx.userId) {
      if (!ctx.isOwner) return jsonError("Hanya Owner yang bisa melihat riwayat akun lain", "forbidden", 403);
      if (!isUuid(requested)) return jsonError("user_id tidak valid", "validation_error", 400);
      userId = requested;
    }

    try {
      const items = await listLoginLogs(ctx.admin, userId, limit);
      return jsonOk({ items });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
