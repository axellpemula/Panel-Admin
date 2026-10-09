import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { RATE_LIMIT } from "@/lib/constants";
import { cronSecret, dbMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cron/cleanup — dipanggil Vercel Cron (lihat vercel.json).
 * Dilindungi header `Authorization: Bearer CRON_SECRET`.
 *
 * Tugas:
 * 1. Hapus validation_attempts lebih dari 7 hari.
 * 2. Jalankan update_expired_keys() supaya status key selalu akurat.
 * 3. (Mode SQLite) Bersihkan auth_sessions yang sudah kedaluwarsa.
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

  // Bandingkan dengan timingSafeEqual supaya waktu respons tidak bocorkan
  // seberapa cocok secret yang ditebak.
  const expectedBuf = Buffer.from(expected);
  const tokenBuf = Buffer.from(token);
  const authorized =
    expectedBuf.length === tokenBuf.length && timingSafeEqual(expectedBuf, tokenBuf);

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const startedAt = Date.now();

  const cutoff = new Date(
    Date.now() - RATE_LIMIT.retentionDays * 86_400_000,
  ).toISOString();

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

  const expired = await admin.rpc("update_expired_keys");
  if (expired.error) {
    console.error("[cron] update_expired_keys gagal:", expired.error.message);
    return NextResponse.json(
      { ok: false, error: "Gagal menjalankan update_expired_keys()" },
      { status: 500 },
    );
  }

  // Mode SQLite: bersihkan sesi kedaluwarsa (tidak ada di Supabase).
  // Cast ke `any` karena fungsi ini hanya ada di adapter SQLite, bukan di Supabase.
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
    cutoff,
    expired_keys_updated: true,
    duration_ms: Date.now() - startedAt,
  });
}
