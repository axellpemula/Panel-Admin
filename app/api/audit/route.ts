import { NextResponse, type NextRequest } from "next/server";

import { ACTIVITY_ACTIONS, ACTIVITY_ACTION_LABEL, type ActivityAction } from "@/lib/activity-labels";
import { withOwner } from "@/lib/api/auth";
import {
  listMergedLogs,
  listMergedLogsForExport,
  MERGED_LOG_SCAN_LIMIT,
} from "@/lib/api/audit";
import { AUDIT_ACTIONS } from "@/lib/constants";
import type { AuditAction, BanReason } from "@/lib/types/database";
import { AUDIT_ACTION_LABEL, BAN_REASON_LABEL, formatDateTime } from "@/lib/utils/format";
import { toCsv } from "@/lib/utils/csv";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

/**
 * Audit log terpadu (hanya Owner): merge `audit_logs` (aksi pada key — ban,
 * unban, hapus, reset HWID, auto-ban) + `activity_logs` (aktivitas akun &
 * sistem — ganti password, putus sesi, API key, pengaturan, credit, Telegram)
 * menjadi satu daftar kronologis.
 *
 * Query: `from, to, action, actor` (user_id atau `system`), `key` (cari
 * `key_value`, hanya menyaring baris aksi key), `page, per_page, format=csv`.
 */
export async function GET(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    const params = request.nextUrl.searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const action = params.get("action");
    const actorId = params.get("actor");
    const keySearch = (params.get("key") ?? "").replace(/[%_,()\\]/g, "").trim().slice(0, 64);
    const format = params.get("format");
    const pageRaw = Number.parseInt(params.get("page") ?? "1", 10);
    const page = Math.min(
      1_000_000,
      Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1),
    );
    const perPageRaw = Number.parseInt(params.get("per_page") ?? "50", 10);
    const perPage = Math.min(
      500,
      Math.max(5, Number.isFinite(perPageRaw) ? perPageRaw : 50),
    );

    // Nilai `action` yang tidak dikenal diabaikan (bukan error) — sama seperti
    // perilaku lama, supaya filter dari UI selalu aman.
    const knownAction =
      action && (AUDIT_ACTIONS.includes(action as AuditAction) || action in ACTIVITY_ACTION_LABEL)
        ? action
        : undefined;

    const toDateBoundary = (value: string): string | null => {
      const date = new Date(value.includes("T") ? value : `${value}T23:59:59.999+07:00`);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? toDateBoundary(to) : null;

    try {
      const listOptions = {
        from: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate.toISOString() : undefined,
        to: toDate ?? undefined,
        action: knownAction,
        actor: actorId ?? undefined,
        key: keySearch.length > 0 ? keySearch : undefined,
      };

      if (format === "csv") {
        const items = await listMergedLogsForExport(ctx.admin, listOptions);
        const csv = toCsv(
          [
            "tanggal",
            "sumber",
            "aktor",
            "role",
            "aksi",
            "key_target",
            "pemilik_key",
            "alasan_ban",
            "catatan",
            "detail",
          ],
          items.map((item) => [
            item.created_at,
            item.source === "key" ? "aksi key" : "akun & sistem",
            item.actor_username ?? "system",
            item.actor_role ?? "",
            AUDIT_ACTION_LABEL[item.action] ?? ACTIVITY_ACTION_LABEL[item.action] ?? item.action,
            item.key_value ?? item.target_label ?? "",
            item.key_owner_username ?? "",
            item.ban_reason ? (BAN_REASON_LABEL[item.ban_reason as BanReason] ?? item.ban_reason) : "",
            item.note ?? "",
            item.detail ? JSON.stringify(item.detail) : "",
          ]),
        );

        const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }

      const result = await listMergedLogs(ctx.admin, {
        ...listOptions,
        page,
        perPage,
      });

      return jsonOk({
        ...result,
        scanned_per_source: MERGED_LOG_SCAN_LIMIT,
        exported_at: formatDateTime(new Date()),
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
