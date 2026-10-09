import { NextResponse, type NextRequest } from "next/server";

import { withOwner } from "@/lib/api/auth";
import { AUDIT_ACTIONS, BAN_REASONS } from "@/lib/constants";
import type { AuditAction, BanReason } from "@/lib/types/database";
import { AUDIT_ACTION_LABEL, BAN_REASON_LABEL, formatDateTime } from "@/lib/utils/format";
import { toCsv } from "@/lib/utils/csv";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

interface AuditLogItem {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_role: string | null;
  action: AuditAction;
  key_id: string | null;
  key_value: string;
  key_owner_id: string | null;
  key_owner_username: string | null;
  ban_reason: BanReason | null;
  note: string | null;
  detail: Record<string, unknown> | null;
}

/**
 * GET /api/audit
 * Audit log aksi Owner/Reseller/sistem terhadap key (ban, unban, hapus key,
 * reset HWID, auto-ban) — hanya untuk Owner (dipakai saat cek jejak/sengketa).
 *
 * Query params: from, to, action, actor (user_id), key (cari key_value),
 * page, per_page, format=csv
 */
export async function GET(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    const params = request.nextUrl.searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const action = params.get("action");
    const actorId = params.get("actor");
    // Wildcard LIKE (%, _) dibuang supaya pencarian selalu literal.
    const keySearch = (params.get("key") ?? "").replace(/[%_,()\\]/g, "").trim().slice(0, 64);
    const format = params.get("format");
    // Page di-clamp juga ke atas (nilai ekstrem → offset melewati batas integer).
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

    try {
      let query = ctx.admin
        .from("audit_logs")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      if (AUDIT_ACTIONS.includes(action as AuditAction)) {
        query = query.eq("action", action as AuditAction);
      }
      if (actorId === "system") {
        // Aksi oleh sistem (auto-ban) tidak punya actor_id.
        query = query.is("actor_id", null);
      } else if (actorId) {
        query = query.eq("actor_id", actorId);
      }
      if (keySearch.length > 0) {
        query = query.ilike("key_value", `%${keySearch.toUpperCase()}%`);
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
            "aktor",
            "role",
            "aksi",
            "key",
            "pemilik_key",
            "alasan_ban",
            "note",
            "detail",
          ],
          items.map((item) => [
            item.created_at,
            item.actor_username ?? "system",
            item.actor_role ?? "",
            AUDIT_ACTION_LABEL[item.action] ?? item.action,
            item.key_value,
            item.key_owner_username ?? "",
            item.ban_reason ? (BAN_REASON_LABEL[item.ban_reason] ?? item.ban_reason) : "",
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
        exported_at: formatDateTime(new Date()),
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

/**
 * Normalisasi satu baris audit_logs.
 * `detail` bisa berupa objek (Postgres JSONB) atau string JSON (SQLite TEXT).
 */
function normalizeLog(row: unknown): AuditLogItem {
  const record = row as Record<string, unknown>;

  let detail: Record<string, unknown> | null = null;
  const rawDetail = record.detail;
  if (rawDetail && typeof rawDetail === "object") {
    detail = rawDetail as Record<string, unknown>;
  } else if (typeof rawDetail === "string" && rawDetail.length > 0) {
    try {
      const parsed: unknown = JSON.parse(rawDetail);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        detail = parsed as Record<string, unknown>;
      }
    } catch {
      detail = null;
    }
  }

  const banReason = record.ban_reason;

  return {
    id: String(record.id),
    created_at: String(record.created_at),
    actor_id: record.actor_id ? String(record.actor_id) : null,
    actor_username: (record.actor_username as string | null) ?? null,
    actor_role: (record.actor_role as string | null) ?? null,
    action: record.action as AuditAction,
    key_id: record.key_id ? String(record.key_id) : null,
    key_value: String(record.key_value ?? ""),
    key_owner_id: record.key_owner_id ? String(record.key_owner_id) : null,
    key_owner_username: (record.key_owner_username as string | null) ?? null,
    ban_reason: BAN_REASONS.includes(banReason as BanReason)
      ? (banReason as BanReason)
      : null,
    note: (record.note as string | null) ?? null,
    detail,
  };
}
