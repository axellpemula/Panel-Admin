import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { sendNotification } from "@/lib/api/notify";
import { notifyResellerEvent } from "@/lib/api/notify-reseller";
import { loadRuntime, loadTelegram } from "@/lib/api/settings";
import { cronSecret, dbMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

function jakartaDateKey(date: Date): string {
  return new Date(date.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}

function formatWib(date: Date): string {
  const shifted = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  const day = shifted.toISOString().slice(0, 10);
  const time = shifted.toISOString().slice(11, 16);
  return `${day} ${time} WIB`;
}

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
  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);
  const authorized =
    expectedBuffer.length === tokenBuffer.length && timingSafeEqual(expectedBuffer, tokenBuffer);

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const runtime = await loadRuntime(admin, { bypassCache: true });
  const telegram = await loadTelegram(admin);
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const countOf = (count: number | null | undefined) => count ?? 0;

  const [
    newKeysResult,
    expiredKeysResult,
    autoBansResult,
    attemptsTotalResult,
    attemptsFailedResult,
    topupsResult,
    adjustmentsResult,
    lowCreditResult,
  ] = await Promise.all([
    admin.from("keys").select("id", { count: "exact", head: true }).gte("created_at", since),
    admin
      .from("keys")
      .select("id", { count: "exact", head: true })
      .gte("expired_at", since)
      .lt("expired_at", now.toISOString()),
    admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "key_auto_ban")
      .gte("created_at", since),
    admin
      .from("validation_attempts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
    admin
      .from("validation_attempts")
      .select("id", { count: "exact", head: true })
      .eq("success", false)
      .gte("created_at", since),
    admin
      .from("credit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "topup")
      .gte("created_at", since),
    admin
      .from("credit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "adjustment")
      .gte("created_at", since),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "reseller")
      .lt("credit", runtime.notify.lowCreditThreshold),
  ]);

  const newKeys = countOf(newKeysResult.count);
  const expiredKeys = countOf(expiredKeysResult.count);
  const autoBans = countOf(autoBansResult.count);
  const attemptsTotal = countOf(attemptsTotalResult.count);
  const attemptsFailed = countOf(attemptsFailedResult.count);
  const topups = countOf(topupsResult.count);
  const adjustments = countOf(adjustmentsResult.count);
  const lowCreditResellers = countOf(lowCreditResult.count);

  const skipped =
    !runtime.notify.enabled ||
    !runtime.notify.events.digest ||
    (!telegram.botToken && !process.env.XLOOP_NOTIFY_WEBHOOK_URL);

  if (skipped) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: !runtime.notify.enabled
        ? "notifikasi nonaktif"
        : !runtime.notify.events.digest
          ? "event digest nonaktif"
          : "bot Telegram & webhook belum dikonfigurasi",
      stats: { new_keys: newKeys, expired_keys: expiredKeys, auto_bans: autoBans },
    });
  }

  const outcome = await sendNotification(admin, {
    event: "digest",
    title: `Ringkasan harian ${jakartaDateKey(now)}`,
    lines: [
      `Periode: ${formatWib(new Date(since))} — ${formatWib(now)}`,
      "",
      `Key baru: ${newKeys}`,
      `Key expired: ${expiredKeys}`,
      `Key di-auto-ban: ${autoBans}`,
      "",
      `Validasi: ${attemptsTotal} percobaan, ${attemptsFailed} gagal`,
      `Topup credit: ${topups} transaksi`,
      `Penyesuaian credit: ${adjustments} transaksi`,
      `Reseller saldo tipis (< ${runtime.notify.lowCreditThreshold}): ${lowCreditResellers}`,
      "",
      "Detail: buka panel → Dashboard / Validation Attempts / Audit Log.",
    ],
    dedupeKey: `digest:${jakartaDateKey(now)}`,
    detail: {
      new_keys: newKeys,
      expired_keys: expiredKeys,
      auto_bans: autoBans,
      attempts_total: attemptsTotal,
      attempts_failed: attemptsFailed,
      topups,
      adjustments,
      low_credit_resellers: lowCreditResellers,
    },
  });

  // Pengingat personal: key milik reseller yang expiring <= 3 hari lagi.
  // Sekali per reseller per hari (dedupe harian), hanya kalau notifikasi reseller aktif.
  let expiringNotified = 0;
  const EXPIRING_DAYS = 3;
  const expiringFrom = now.toISOString();
  const expiringTo = new Date(now.getTime() + EXPIRING_DAYS * 86_400_000).toISOString();
  try {
    const expiringResult = await admin
      .from("keys")
      .select("key_value, expired_at, created_by")
      .eq("status", "active")
      .gte("expired_at", expiringFrom)
      .lte("expired_at", expiringTo);
    const expiringKeys = (expiringResult.data ?? []) as {
      key_value: string;
      expired_at: string | null;
      created_by: string | null;
    }[];

    if (expiringKeys.length > 0) {
      const { data: links } = await admin.from("telegram_links").select("user_id, chat_id");
      const linkedUserIds = new Set(
        ((links ?? []) as { user_id: string; chat_id: string }[]).map((row) => row.user_id),
      );

      const byOwner = new Map<string, { key_value: string; expired_at: string | null }[]>();
      expiringKeys.forEach((row) => {
        if (!row.created_by || !linkedUserIds.has(row.created_by)) return;
        const list = byOwner.get(row.created_by) ?? [];
        list.push({ key_value: row.key_value, expired_at: row.expired_at });
        byOwner.set(row.created_by, list);
      });

      const dateKey = jakartaDateKey(now);
      for (const [userId, list] of byOwner) {
        await notifyResellerEvent(admin, {
          userId,
          event: "expiring_digest",
          title: "Pengingat key expiring",
          lines: [
            `${list.length} key kamu akan expired dalam <= ${EXPIRING_DAYS} hari:`,
            "",
            ...list
              .slice(0, 10)
              .map((row) => `• ${row.key_value} — ${row.expired_at ? row.expired_at.slice(0, 10) : "?"}`),
            list.length > 10 ? `…dan ${list.length - 10} lainnya.` : "",
            "",
            "Perpanjang dari panel → Key List, atau minta Owner.",
          ].filter(Boolean),
          dedupeKey: `expiring_digest:${userId}:${dateKey}`,
          detail: { count: list.length, keys: list.slice(0, 10).map((row) => row.key_value) },
        });
        expiringNotified += 1;
      }
    }
  } catch (error) {
    console.warn("[cron] pengingat expiring gagal:", (error as Error)?.message ?? error);
  }

  return NextResponse.json({
    ok: true,
    mode: dbMode(),
    sent: outcome.sent,
    skipped: outcome.skipped ?? null,
    targets: outcome.targets,
    errors: outcome.errors ?? null,
    stats: {
      new_keys: newKeys,
      expired_keys: expiredKeys,
      auto_bans: autoBans,
      attempts_total: attemptsTotal,
      attempts_failed: attemptsFailed,
      topups,
      adjustments,
      low_credit_resellers: lowCreditResellers,
      expiring_resellers_notified: expiringNotified,
    },
  });
}
