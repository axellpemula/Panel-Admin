import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { sendNotification } from "@/lib/api/notify";
import { loadRuntime, loadTelegram } from "@/lib/api/settings";
import { cronSecret, dbMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Zona waktu WIB dipakai untuk penamaan hari & label laporan. */
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

/**
 * GET /api/cron/digest — ringkasan harian ke Telegram/webhook (#2).
 *
 * Dijadwalkan sekali sehari (lihat vercel.json). Isinya aktivitas 24 jam terakhir:
 * key baru, key expired, auto-ban, validasi sukses/gagal, topup & penyesuaian credit,
 * plus jumlah reseller yang saldonya tipis.
 *
 * Anti-duplikat: `dedupeKey = digest:<tanggal WIB>`, jadi walau cron dipanggil dua
 * kali pada hari yang sama, Owner hanya menerima satu ringkasan.
 */
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
    },
  });
}
