import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyInBackground } from "@/lib/api/notify";
import { loadRuntime } from "@/lib/api/settings";
import type { Database } from "@/lib/types/database";

/**
 * Deteksi & notifikasi login gagal berulang pada satu akun.
 *
 * Dipanggil setiap kali login gagal (lihat app/api/auth/login/route.ts).
 * Kalau jumlah kegagalan dalam window terakhir **tepat** menyentuh ambang
 * `notify.loginBurstFailures`, notifikasi dikirim sekali — jadi percobaan
 * berikutnya tidak membanjiri Owner. Ambang & dedupe diatur dari Pengaturan.
 */

/** Window penghitungan kegagalan login (menit). */
const WINDOW_MINUTES = 15;

export function notifyLoginFailure(
  admin: SupabaseClient<Database>,
  input: {
    userId: string | null;
    email: string;
    ip: string;
    userAgent: string | null;
    reason: string;
  },
): void {
  // Fire-and-forget: jangan menahan response login.
  void (async () => {
    try {
      const runtime = await loadRuntime(admin);
      if (!runtime.notify.enabled || !runtime.notify.events.loginBurst) return;

      const threshold = runtime.notify.loginBurstFailures;
      if (threshold <= 0) return;

      const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

      let query = admin
        .from("login_logs")
        .select("id", { count: "exact", head: true })
        .eq("success", false)
        .gte("created_at", since);

      // Akun dikenali dari email (kegagalan sering terjadi sebelum user ditemukan).
      query = input.userId ? query.eq("user_id", input.userId) : query.eq("email", input.email);

      const { count, error } = await query;
      if (error) {
        console.warn("[notify] gagal menghitung login gagal:", error.message);
        return;
      }

      const total = count ?? 0;
      if (total !== threshold) return;

      notifyInBackground(admin, {
        event: "login_burst",
        title: "Percobaan login gagal berulang",
        lines: [
          `Akun ${input.email} gagal login ${total}x dalam ${WINDOW_MINUTES} menit terakhir.`,
          `IP terakhir: ${input.ip}`,
          input.userAgent ? `Perangkat: ${input.userAgent.slice(0, 120)}` : "",
          "Kalau ini bukan kamu, segera ganti password akun tersebut dan putus semua sesinya.",
        ].filter(Boolean),
        dedupeKey: `login_burst:${input.userId ?? input.email}`,
        notifyUserIds: input.userId ? [input.userId] : [],
        detail: {
          email: input.email,
          user_id: input.userId,
          failures: total,
          window_minutes: WINDOW_MINUTES,
          last_reason: input.reason,
          ip: input.ip,
        },
      });
    } catch (error) {
      console.warn("[notify] cek login burst gagal:", (error as Error)?.message ?? error);
    }
  })();
}
