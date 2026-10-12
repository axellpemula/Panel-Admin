import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { loadRuntime, publicSettings } from "@/lib/api/settings";
import { cronSecret, dbMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const expected = cronSecret();

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET belum diset di environment" },
      { status: 500 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const expectedBuf = Buffer.from(expected);
  const tokenBuf = Buffer.from(token);
  const authorized =
    expectedBuf.length === tokenBuf.length && timingSafeEqual(expectedBuf, tokenBuf);

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();
  const runtime = await loadRuntime(admin);
  const cutoffFor = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const cutoff = cutoffFor(runtime.retention.attemptsDays);

  const deleted = await admin
    .from("validation_attempts")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);

  if (deleted.error) {
    console.error("[cron] hapus validation_attempts gagal:", deleted.error.message);
    return NextResponse.json(
      { ok: false, error: "Gagal membersihkan validation_attempts" },
      { status: 500 },
    );
  }

  const apiLogCutoff = cutoffFor(runtime.retention.apiLogsDays);
  const deletedApiLogs = await admin
    .from("api_request_logs")
    .delete({ count: "exact" })
    .lt("created_at", apiLogCutoff);
  if (deletedApiLogs.error) {
    console.warn("[cron] hapus api_request_logs gagal:", deletedApiLogs.error.message);
  }

  const notifyCutoff = cutoffFor(runtime.retention.notificationDays);
  const deletedNotifications = await admin
    .from("notification_logs")
    .delete({ count: "exact" })
    .lt("created_at", notifyCutoff);
  if (deletedNotifications.error) {
    console.warn("[cron] hapus notification_logs gagal:", deletedNotifications.error.message);
  }

  const linkCodeCutoff = new Date(Date.now() - 86_400_000).toISOString();
  const deletedUsedCodes = await admin
    .from("telegram_link_codes")
    .delete({ count: "exact" })
    .not("used_at", "is", null)
    .lt("created_at", linkCodeCutoff);
  if (deletedUsedCodes.error) {
    console.warn("[cron] hapus telegram_link_codes (terpakai) gagal:", deletedUsedCodes.error.message);
  }

  const deletedExpiredCodes = await admin
    .from("telegram_link_codes")
    .delete({ count: "exact" })
    .is("used_at", null)
    .lt("expires_at", linkCodeCutoff);
  if (deletedExpiredCodes.error) {
    console.warn("[cron] hapus telegram_link_codes (kedaluwarsa) gagal:", deletedExpiredCodes.error.message);
  }

  const expired = await admin.rpc("update_expired_keys");
  if (expired.error) {
    console.error("[cron] update_expired_keys gagal:", expired.error.message);
    return NextResponse.json(
      { ok: false, error: "Gagal menjalankan update_expired_keys()" },
      { status: 500 },
    );
  }

  let deletedSessions = 0;
  if (dbMode() === "sqlite") {
    try {
      const sessions = await (admin.rpc as unknown as (name: string) => Promise<{ data: unknown; error: { message: string } | null }>)("cleanup_auth_sessions");
      if (sessions.error) {
        console.error("[cron] cleanup_auth_sessions gagal:", sessions.error.message);
      } else {
        const row = Array.isArray(sessions.data)
          ? (sessions.data[0] as { deleted: number } | undefined)
          : undefined;
        deletedSessions = Number(row?.deleted ?? 0);
      }
    } catch (err) {
      console.error("[cron] cleanup_auth_sessions exception:", (err as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    mode: dbMode(),
    deleted_attempts: deleted.count ?? 0,
    deleted_sessions: deletedSessions,
    deleted_api_logs: deletedApiLogs.count ?? 0,
    deleted_notifications: deletedNotifications.count ?? 0,
    deleted_link_codes: (deletedUsedCodes.count ?? 0) + (deletedExpiredCodes.count ?? 0),
    cutoff,
    retention: publicSettings(runtime).retention,
    expired_keys_updated: true,
    duration_ms: Date.now() - startedAt,
  });
}
