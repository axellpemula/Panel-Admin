import type { SupabaseClient } from "@supabase/supabase-js";

import { loadRuntime, loadTelegram } from "@/lib/api/settings";
import type { Database } from "@/lib/types/database";
import { sendTelegramMessage } from "@/lib/utils/telegram";

/**
 * Notifikasi personal ke SATU reseller lewat chat Telegram yang tertaut.
 *
 * Berbeda dari `sendNotification` (yang ditujukan ke Owner + opsional reseller
 * terkait), helper ini murni pesan personal untuk pemilik key / pemilik saldo —
 * dipakai saat key-nya diblokir/di-unban/dihapus, atau saldonya ditopup.
 *
 * Prinsip sama dengan notifikasi Owner:
 * - **Tidak pernah menggagalkan aksi utama** — semua kegagalan di-warn + dicatat
 *   ke `notification_logs` (event `reseller_*`) supaya bisa diperiksa dari panel.
 * - **Anti-spam** opsional lewat `dedupeKey` (dipakai digest harian; event aksi
 *   user seperti ban/unban sengaja tanpa dedupe karena memang sekali kejadian).
 * - Pesan dikirim **tanpa markup** (plain text) — sama seperti notifikasi Owner —
 *   supaya isi dinamis tidak bisa merusak format.
 *
 * Saklar: `notify.enabled` + `notify.notifyReseller` (Pengaturan → Batas & Sistem).
 */
export async function notifyResellerEvent(
  admin: SupabaseClient<Database>,
  input: {
    userId: string;
    /** Nama event untuk `notification_logs`, mis. `key_banned`. */
    event: string;
    title: string;
    /** Baris isi pesan (plain text, tanpa markup). */
    lines: string[];
    dedupeKey?: string | null;
    detail?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    const runtime = await loadRuntime(admin);
    if (!runtime.notify.enabled || !runtime.notify.notifyReseller) return;

    if (input.dedupeKey) {
      const since = new Date(Date.now() - runtime.notify.dedupeMinutes * 60_000).toISOString();
      const { data: dupes } = await admin
        .from("notification_logs")
        .select("id")
        .eq("dedupe_key", input.dedupeKey)
        .eq("success", true)
        .gte("created_at", since)
        .limit(1);
      if ((dupes ?? []).length > 0) return;
    }

    const telegram = await loadTelegram(admin);
    if (!telegram.botToken || !telegram.notificationsEnabled) return;

    const { data: link } = await admin
      .from("telegram_links")
      .select("chat_id")
      .eq("user_id", input.userId)
      .maybeSingle<{ chat_id: string }>();
    if (!link?.chat_id) return;

    const text = [`XLOOP PANEL — ${input.title}`, "", ...input.lines].join("\n");
    const result = await sendTelegramMessage(telegram.botToken, link.chat_id, text, {
      timeoutMs: 5_000,
    });

    try {
      await admin.from("notification_logs").insert({
        event: `reseller_${input.event}`,
        dedupe_key: input.dedupeKey ?? null,
        target: `telegram:${link.chat_id}`,
        success: result.ok,
        summary: result.ok
          ? `${input.title} → chat ${link.chat_id}`
          : `Gagal: ${result.error ?? "gagal"}`,
        detail: input.detail ?? null,
      });
    } catch {
      // Logging gagal — abaikan.
    }

    if (!result.ok) {
      console.warn("[notify-reseller] gagal kirim:", result.error ?? "gagal");
    }
  } catch (error) {
    console.warn("[notify-reseller] gagal:", (error as Error)?.message ?? error);
  }
}

/** Kirim tanpa menunggu — aman untuk jalur request utama. */
export function notifyResellerInBackground(
  admin: SupabaseClient<Database>,
  input: Parameters<typeof notifyResellerEvent>[1],
): void {
  void notifyResellerEvent(admin, input);
}
