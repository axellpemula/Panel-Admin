import type { NextRequest } from "next/server";

import { withAuth } from "@/lib/api/auth";
import { listKeys, refreshExpiredKeys, type SortColumn } from "@/lib/api/keys";
import { LIMITS } from "@/lib/constants";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys
 * Owner → semua key. Reseller → hanya key miliknya.
 *
 * Query params: q, status, tool_type_id, version_id, created_by (owner only),
 * sort, order, page, per_page
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    const params = request.nextUrl.searchParams;

    try {
      // Pastikan key yang sudah lewat tanggal expired langsung berstatus expired.
      await refreshExpiredKeys(ctx.admin);

      const page = Number.parseInt(params.get("page") ?? "1", 10);
      const perPage = Number.parseInt(params.get("per_page") ?? "20", 10);

      const sortParam = params.get("sort");
      const allowedSort: SortColumn[] = ["created_at", "expired_at", "status", "key_value"];
      const sort = allowedSort.includes(sortParam as SortColumn)
        ? (sortParam as SortColumn)
        : "created_at";

      const createdBy = params.get("created_by");

      const result = await listKeys(ctx.admin, {
        // Reseller hanya melihat key miliknya sendiri.
        userId: ctx.isOwner ? undefined : ctx.userId,
        createdBy: ctx.isOwner && createdBy ? createdBy : undefined,
        // Batas 64 karakter (sama dengan sanitizeSearch) — key_value cuma 14 karakter,
        // jadi ini cukup dan menghindari query LIKE dengan payload sangat panjang.
        search: (params.get("q") ?? "").slice(0, 64),
        status: params.get("status") ?? undefined,
        toolTypeId: params.get("tool_type_id") ?? undefined,
        versionId: params.get("version_id") ?? undefined,
        sort,
        order: params.get("order") === "asc" ? "asc" : "desc",
        page: Number.isFinite(page) ? page : 1,
        perPage: Number.isFinite(perPage) ? perPage : 20,
      });

      return jsonOk({ ...result, isOwner: ctx.isOwner });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
