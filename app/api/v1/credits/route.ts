import type { NextRequest } from "next/server";

import { withApiKey } from "@/lib/api/v1";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withApiKey(request, async (ctx) => {
    const params = request.nextUrl.searchParams;
    const page = Math.min(1_000_000, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));
    const perPage = Math.min(100, Math.max(5, Number.parseInt(params.get("per_page") ?? "20", 10) || 20));
    const from = (page - 1) * perPage;

    try {
      let query = ctx.admin
        .from("credit_logs")
        .select("*", { count: "exact" })
        .eq("user_id", ctx.profile.id)
        .order("created_at", { ascending: false });

      const action = (params.get("action") ?? "").trim().toLowerCase();
      if (action) {
        if (!["topup", "generate", "extend", "refund", "adjustment"].includes(action)) {
          return jsonError(
            "Parameter `action` harus salah satu: topup, generate, extend, refund, adjustment",
            "validation_error",
            400,
            { allowed: ["topup", "generate", "extend", "refund", "adjustment"] },
          );
        }
        query = query.eq("action", action);
      }

      const fromParam = params.get("from");
      if (fromParam) {
        const date = new Date(`${fromParam}T00:00:00+07:00`);
        if (!Number.isNaN(date.getTime())) query = query.gte("created_at", date.toISOString());
      }
      const toParam = params.get("to");
      if (toParam) {
        const date = new Date(`${toParam}T23:59:59.999+07:00`);
        if (!Number.isNaN(date.getTime())) query = query.lte("created_at", date.toISOString());
      }

      const { data, error, count } = await query.range(from, from + perPage - 1);
      if (error) return jsonError(error.message, "server_error", 500);

      const total = count ?? 0;
      return jsonOk({
        balance: ctx.profile.credit,
        items: (data ?? []).map((row) => ({
          id: row.id,
          created_at: row.created_at,
          action: row.action,
          amount: row.amount,
          balance_after: row.balance_after,
          note: row.note,
        })),
        total,
        page,
        per_page: perPage,
        total_pages: Math.max(1, Math.ceil(total / perPage)),
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
