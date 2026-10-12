import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";
import { HWID_RESET } from "@/lib/constants";

/**
 * Hitung sisa kuota reset HWID untuk sebuah key dalam window cooldown.
 *
 * Sumber data: audit_logs (aksi `hwid_reset` dan `hwid_reset_all`).
 * Pilihan desain:
 *   - Pakai audit_logs yang sudah ada supaya tidak perlu tabel/kolom baru dan
 *     histori reset-nya otomatis tersinkron dengan jejak audit (tidak ada dua
 *     sumber kebenaran).
 *   - Reset Semua (hapus semua slot sekaligus) dihitung 1 kuota — secara operasi
 *     itu jauh lebih "berat" daripada reset 1 HWID, jadi tidak adil kalau dihitung
 *     per HWID.
 *   - **Reset yang dilakukan Owner TIDAK dihitung ke kuota** — Owner bisa reset
 *     kapan pun untuk keperluan support (mis. bantu reseller saat darurat) tanpa
 *     "memakan" jatah cooldown reseller. Yang dihitung hanya reset oleh reseller
 *     (actor_role = 'reseller') dan sistem (auto-ban tidak memicu reset).
 *   - Owner tidak terkena limit (dicek di caller, tidak di sini), supaya
 *     Owner tetap bisa bantu support reseller saat darurat.
 *   - Nilai limit/window bisa diubah Owner dari Pengaturan (lihat
 *     `lib/api/settings.ts`); kalau tidak diberikan, dipakai default
 *     `HWID_RESET` di lib/constants.ts.
 */
export interface ResetQuota {
  /** Jumlah reset yang sudah dilakukan dalam window sekarang. */
  used: number;
  /** Batas maksimal reset per window. */
  limit: number;
  /** Sisa kuota (limit − used; tidak pernah di bawah 0). */
  remaining: number;
  /** ISO timestamp reset tertua yang masih terhitung di window. */
  window_start: string;
  /** ISO timestamp kapan reset terlama di window akan "lewat" (kuota +1). */
  next_reset_at: string | null;
  /** Detik sampai kuota bertambah 1 (null kalau kuota masih penuh). */
  retry_after_seconds: number | null;
  /** Panjang window cooldown (jam) — dipakai UI supaya teksnya ikut konfigurasi. */
  window_hours: number;
}

/** Batas cooldown yang berlaku (dari Pengaturan, default `HWID_RESET`). */
export interface HwidResetLimits {
  limit: number;
  windowHours: number;
}

export const DEFAULT_HWID_RESET_LIMITS: HwidResetLimits = {
  limit: HWID_RESET.limit,
  windowHours: HWID_RESET.windowHours,
};

export async function getHwidResetQuota(
  admin: SupabaseClient<Database>,
  keyId: string,
  now: Date = new Date(),
  limits: HwidResetLimits = DEFAULT_HWID_RESET_LIMITS,
): Promise<ResetQuota> {
  const windowMs = limits.windowHours * 60 * 60 * 1000;
  const windowStart = new Date(now.getTime() - windowMs).toISOString();

  // Hitung hanya reset yang dilakukan oleh reseller (actor_role = 'reseller').
  // Reset oleh Owner (actor_role = 'owner') dan sistem (actor_role = 'system')
  // tidak menghabiskan kuota reseller — lihat docstring di atas.
  const { data, error } = await admin
    .from("audit_logs")
    .select("created_at")
    .eq("key_id", keyId)
    .in("action", ["hwid_reset", "hwid_reset_all"])
    .eq("actor_role", "reseller")
    .gte("created_at", windowStart)
    .order("created_at", { ascending: true });

  if (error) {
    // Gagal baca audit log — jangan blok aksi; laporkan seolah kuota penuh
    // (fail-safe yang membebaskan, bukan mengunci).
    console.warn("[hwid-reset] gagal membaca audit_logs:", error.message);
    return {
      used: 0,
      limit: limits.limit,
      remaining: limits.limit,
      window_start: windowStart,
      next_reset_at: null,
      retry_after_seconds: null,
      window_hours: limits.windowHours,
    };
  }

  const timestamps = (data ?? [])
    .map((row) => (row as { created_at: string }).created_at)
    .filter(Boolean)
    .sort();

  const used = timestamps.length;
  const remaining = Math.max(0, limits.limit - used);

  // Kapan reset tertua akan keluar dari window? Kalau kuota sudah habis, user
  // harus menunggu sampai itu saatnya (paling cepat satu kuota kembali).
  let nextResetAt: string | null = null;
  let retryAfterSeconds: number | null = null;
  if (used >= limits.limit && timestamps.length > 0) {
    const oldest = new Date(timestamps[0]);
    nextResetAt = new Date(oldest.getTime() + windowMs).toISOString();
    retryAfterSeconds = Math.max(0, Math.ceil((new Date(nextResetAt).getTime() - now.getTime()) / 1000));
  }

  return {
    used,
    limit: limits.limit,
    remaining,
    window_start: windowStart,
    next_reset_at: nextResetAt,
    retry_after_seconds: retryAfterSeconds,
    window_hours: limits.windowHours,
  };
}

/**
 * Format pesan error cooldown untuk user.
 */
export function formatCooldownMessage(quota: ResetQuota): string {
  const hours = quota.window_hours ?? HWID_RESET.windowHours;
  if (!quota.next_reset_at || quota.retry_after_seconds === null) {
    return `Kuota reset HWID untuk key ini sudah habis (maks ${quota.limit}x per ${hours} jam)`;
  }

  const secs = quota.retry_after_seconds;
  let wait: string;
  if (secs < 60) wait = `${secs} detik`;
  else if (secs < 3600) wait = `${Math.ceil(secs / 60)} menit`;
  else wait = `${Math.ceil(secs / 3600)} jam`;

  return `Kuota reset HWID habis — coba lagi dalam ${wait} (maks ${quota.limit}x per ${hours} jam per key)`;
}
