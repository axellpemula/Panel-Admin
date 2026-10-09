import { NextResponse, type NextRequest } from "next/server";

import { withAuth } from "@/lib/api/auth";
import type { CreditAction } from "@/lib/types/database";
import { CREDIT_ACTION_LABEL, formatDateTime } from "@/lib/utils/format";
import { toCsv } from "@/lib/utils/csv";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

const CREDIT_ACTIONS: CreditAction[] = ["topup", "generate", "extend", "refund"];

interface CreditLogItem {
  id: string;
  created_at: string;
  user_id: string;
  username: string | null;
  email: string | null;
  action: CreditAction;
  amount: number;
  balance_after: number;
  note: string | null;
  created_by_username: string | null;
}

/**
 * GET /api/credits
 * Owner: semua log (bisa filter by reseller). Reseller: hanya milik sendiri.
 * Query params: from, to, action, user_id (owner), page, per_page, format=csv
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    const params = request.nextUrl.searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const action = params.get("action");
    const userIdParam = params.get("user_id");
    const format = params.get("format");
    // Page di-clamp juga ke atas (nilai ekstrem → offset melewati batas integer).
    const page = Math.min(1_000_000, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));
    const perPageRaw = Number.parseInt(params.get("per_page") ?? "50", 10) || 50;
    const perPage = Math.min(500, Math.max(5, perPageRaw));

    try {
      let query = ctx.admin
        .from("credit_logs")
        .select(
          "id, created_at, user_id, action, amount, balance_after, note, profiles!credit_logs_user_id_fkey(username, email), creator:profiles!credit_logs_created_by_fkey(username)",
          { count: "exact" },
        )
        .order("created_at", { ascending: false });

      // Reseller hanya melihat log miliknya.
      if (!ctx.isOwner) {
        query = query.eq("user_id", ctx.userId);
      } else if (userIdParam) {
        query = query.eq("user_id", userIdParam);
      }

      if (CREDIT_ACTIONS.includes(action as CreditAction)) {
        query = query.eq("action", action as CreditAction);
      }
      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) query = query.gte("created_at", fromDate.toISOString());
      }
      if (to) {
        const toDate = new Date(to.includes("T") ? to : `${to}T23:59:59.999+07:00`);
        if (!Number.isNaN(toDate.getTime())) query = query.lte("created_at", toDate.toISOString());
      }

      // Export CSV: ambil sampai 5000 baris terakhir.
      if (format === "csv") {
        const { data, error } = await query.range(0, 4999);
        if (error) return jsonError(errorMessage(error), "server_error", 500);

        const items = (data ?? []).map(normalizeLog);
        const csv = toCsv(
          [
            "tanggal",
            "reseller",
            "email",
            "aksi",
            "jumlah",
            "saldo_setelah",
            "note",
            "dibuat_oleh",
          ],
          items.map((item) => [
            item.created_at,
            item.username ?? "",
            item.email ?? "",
            CREDIT_ACTION_LABEL[item.action] ?? item.action,
            item.amount,
            item.balance_after,
            item.note ?? "",
            item.created_by_username ?? "",
          ]),
        );

        const filename = `credit-log-${new Date().toISOString().slice(0, 10)}.csv`;
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }

      const start = (page - 1) * perPage;
      const { data, error, count } = await query.range(start, start + perPage - 1);
      if (error) return jsonError(errorMessage(error), "server_error", 500);

      const items = (data ?? []).map(normalizeLog);
      const total = count ?? items.length;

      return jsonOk({
        items,
        total,
        page,
        per_page: perPage,
        total_pages: Math.max(1, Math.ceil(total / perPage)),
        isOwner: ctx.isOwner,
        exported_at: formatDateTime(new Date()),
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

function normalizeLog(row: unknown): CreditLogItem {
  const record = row as Record<string, unknown> & {
    profiles?: { username?: string; email?: string } | null;
    creator?: { username?: string } | null;
  };

  return {
    id: String(record.id),
    created_at: String(record.created_at),
    user_id: String(record.user_id),
    username: record.profiles?.username ?? null,
    email: record.profiles?.email ?? null,
    action: record.action as CreditAction,
    amount: Number(record.amount) || 0,
    balance_after: Number(record.balance_after) || 0,
    note: (record.note as string | null) ?? null,
    created_by_username: record.creator?.username ?? null,
  };
}
