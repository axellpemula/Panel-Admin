import type { SupabaseClient } from "@supabase/supabase-js";

import { loadRuntime, loadTelegram, type RuntimeSettings } from "@/lib/api/settings";
import type { Database } from "@/lib/types/database";
import { sendTelegramMessage } from "@/lib/utils/telegram";

/**
 * Notifikasi keluar — Telegram (bot) dan/atau webhook HTTP.
 *
 * Desain:
 * - **Tidak pernah menggagalkan aksi utama.** Semua kegagalan di-warn + dicatat di
 *   `notification_logs`; pemanggil tidak menerima exception.
 * - **Anti-spam (dedupe):** satu notifikasi per `dedupeKey` per window
 *   (`notify.dedupeMinutes`). Datanya dari `notification_logs` yang sukses —
 *   jadi tidak butuh tabel/state tambahan.
 * - **Timeout pendek** dan `wait: false` di jalur panas (/api/validate, login):
 *   pengiriman dijalankan lewat `void` sehingga response user tidak menunggu Telegram.
 * - Penerima: chat Telegram milik semua Owner yang sudah menautkan akun, plus
 *   (opsional) chat reseller terkait kalau `notify.notifyReseller` aktif.
 */

export type NotifyEvent =
  | "key_auto_ban"
  | "login_burst"
  | "validation_burst"
  | "low_credit"
  | "digest"
  | "security"
  | "test";

export interface NotifyPayload {
  event: NotifyEvent;
  /** Judul singkat, mis. "Key di-auto-ban". */
  title: string;
  /** Baris isi pesan (sudah final, tanpa markdown). */
  lines: string[];
  /** Kunci anti-spam — notifikasi dengan kunci sama dalam window akan dilewati. */
  dedupeKey?: string;
  /** Reseller terkait (dikirim ke chat-nya kalau `notifyReseller` aktif). */
  notifyUserIds?: string[];
  /** Metadata tambahan untuk webhook & notification_logs. */
  detail?: Record<string, unknown>;
  /** true = tunggu sampai selesai; false/undefined = fire-and-forget. */
  wait?: boolean;
}

export interface NotifyOutcome {
  sent: boolean;
  skipped?: "disabled" | "event_disabled" | "deduped" | "no_target";
  targets: string[];
  errors?: string[];
}

/** Event → flag di `notify.events`. */
function eventEnabled(event: NotifyEvent, runtime: RuntimeSettings): boolean {
  const events = runtime.notify.events;
  switch (event) {
    case "key_auto_ban":
      return events.autoBan;
    case "login_burst":
      return events.loginBurst;
    case "validation_burst":
      return events.validationBurst;
    case "low_credit":
      return events.lowCredit;
    case "digest":
      return events.digest;
    case "security":
      return events.security;
    case "test":
      return true;
    default:
      return true;
  }
}

/** Susun teks pesan Telegram (tanpa markup — aman untuk isi dinamis). */
export function buildNotificationText(payload: NotifyPayload): string {
  const header = `XLOOP PANEL — ${payload.title}`;
  return [header, "", ...payload.lines].join("\n");
}

/** Sudah ada notifikasi sukses dengan kunci sama dalam window? */
async function isDeduped(
  admin: SupabaseClient<Database>,
  dedupeKey: string,
  dedupeMinutes: number,
): Promise<boolean> {
  if (dedupeMinutes <= 0) return false;
  const since = new Date(Date.now() - dedupeMinutes * 60_000).toISOString();

  const { data, error } = await admin
    .from("notification_logs")
    .select("id")
    .eq("dedupe_key", dedupeKey)
    .eq("success", true)
    .gte("created_at", since)
    .limit(1);

  if (error) {
    // Kalau pemeriksaan gagal, jangan blokir notifikasi (lebih baik spam tipis
    // daripada kejadian penting tidak terkirim).
    console.warn("[notify] cek dedupe gagal:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

async function logNotification(
  admin: SupabaseClient<Database>,
  entry: {
    event: string;
    dedupeKey: string | null;
    target: string;
    success: boolean;
    summary: string;
    detail?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    const { error } = await admin.from("notification_logs").insert({
      event: entry.event,
      dedupe_key: entry.dedupeKey,
      target: entry.target,
      success: entry.success,
      summary: entry.summary.slice(0, 500),
      detail: entry.detail ?? null,
    });
    if (error) console.warn("[notify] notification_logs insert gagal:", error.message);
  } catch (error) {
    console.warn("[notify] notification_logs insert gagal:", (error as Error)?.message ?? error);
  }
}

/** Chat ID yang harus menerima notifikasi ini. */
async function resolveTargets(
  admin: SupabaseClient<Database>,
  payload: NotifyPayload,
  runtime: RuntimeSettings,
): Promise<{ owners: string[]; resellers: string[] }> {
  const owners: string[] = [];
  const resellers: string[] = [];

  const ownerProfiles = await admin.from("profiles").select("id").eq("role", "owner");
  const ownerIds = ((ownerProfiles.data ?? []) as { id: string }[]).map((row) => row.id);

  const wanted = [...ownerIds];
  if (runtime.notify.notifyReseller && payload.notifyUserIds && payload.notifyUserIds.length > 0) {
    payload.notifyUserIds.forEach((id) => {
      if (id && !wanted.includes(id)) wanted.push(id);
    });
  }
  if (wanted.length === 0) return { owners, resellers };

  const links = await admin.from("telegram_links").select("user_id, chat_id").in("user_id", wanted);
  ((links.data ?? []) as { user_id: string; chat_id: string }[]).forEach((row) => {
    if (ownerIds.includes(row.user_id)) owners.push(row.chat_id);
    else resellers.push(row.chat_id);
  });

  return { owners, resellers };
}

/**
 * Kirim notifikasi ke Telegram (dan webhook kalau diisi). Aman dipanggil
 * fire-and-forget: `void sendNotification(...)`.
 */
export async function sendNotification(
  admin: SupabaseClient<Database>,
  payload: NotifyPayload,
): Promise<NotifyOutcome> {
  try {
    const runtime = await loadRuntime(admin);
    if (!runtime.notify.enabled) return { sent: false, skipped: "disabled", targets: [] };
    if (!eventEnabled(payload.event, runtime)) {
      return { sent: false, skipped: "event_disabled", targets: [] };
    }

    if (payload.dedupeKey && (await isDeduped(admin, payload.dedupeKey, runtime.notify.dedupeMinutes))) {
      return { sent: false, skipped: "deduped", targets: [] };
    }

    const telegram = await loadTelegram(admin);
    const text = buildNotificationText(payload);
    const targetChats: { chat: string; kind: "owner" | "reseller" }[] = [];
    // Webhook (opsional) dibaca di sini supaya bisa jadi satu-satunya tujuan notifikasi.
    const webhookUrl = process.env.XLOOP_NOTIFY_WEBHOOK_URL?.trim();

    if (telegram.botToken && telegram.notificationsEnabled) {
      const { owners, resellers } = await resolveTargets(admin, payload, runtime);
      owners.forEach((chat) => targetChats.push({ chat, kind: "owner" }));
      resellers.forEach((chat) => targetChats.push({ chat, kind: "reseller" }));
    }

    const targets: string[] = [];
    const errors: string[] = [];

    if (targetChats.length === 0 && !telegram.botToken && !webhookUrl) {
      await logNotification(admin, {
        event: payload.event,
        dedupeKey: payload.dedupeKey ?? null,
        target: "none",
        success: false,
        summary: "Tidak ada tujuan notifikasi (bot Telegram & webhook belum dikonfigurasi)",
        detail: payload.detail ?? null,
      });
      return { sent: false, skipped: "no_target", targets: [] };
    }

    // 1. Telegram — dikirim paralel; timeout 3,5 detik supaya tidak menahan request.
    const telegramResults = await Promise.all(
      targetChats.map(async (target) => {
        const result = await sendTelegramMessage(telegram.botToken as string, target.chat, text, {
          timeoutMs: 3_500,
        });
        targets.push(`telegram:${target.kind}`);
        if (!result.ok) errors.push(`telegram ${target.chat}: ${result.error ?? "gagal"}`);
        await logNotification(admin, {
          event: payload.event,
          dedupeKey: payload.dedupeKey ?? null,
          target: `telegram:${target.kind}`,
          success: result.ok,
          summary: result.ok ? `${payload.title} → chat ${target.chat}` : `Gagal: ${result.error}`,
          detail: payload.detail ?? null,
        });
        return result.ok;
      }),
    );

    // 2. Webhook (opsional) — dipakai kalau Owner ingin meneruskan ke sistem lain.
    let webhookOk = false;
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: payload.event,
            title: payload.title,
            message: text,
            lines: payload.lines,
            detail: payload.detail ?? null,
            sent_at: new Date().toISOString(),
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(3_500),
        });
        webhookOk = response.ok;
        targets.push("webhook");
        if (!response.ok) errors.push(`webhook: HTTP ${response.status}`);
      } catch (error) {
        errors.push(`webhook: ${(error as Error)?.message ?? "gagal"}`);
      }
      await logNotification(admin, {
        event: payload.event,
        dedupeKey: payload.dedupeKey ?? null,
        target: "webhook",
        success: webhookOk,
        summary: webhookOk ? payload.title : `Gagal: ${errors[errors.length - 1] ?? "-"}`,
        detail: payload.detail ?? null,
      });
    }

    const sent = telegramResults.some(Boolean) || webhookOk;
    if (!sent && telegram.botToken && targetChats.length === 0) {
      await logNotification(admin, {
        event: payload.event,
        dedupeKey: payload.dedupeKey ?? null,
        target: "none",
        success: false,
        summary: "Bot Telegram terhubung, tapi belum ada akun Owner yang menautkan chat",
        detail: payload.detail ?? null,
      });
    }

    return { sent, targets, errors: errors.length > 0 ? errors : undefined };
  } catch (error) {
    console.warn("[notify] gagal mengirim notifikasi:", (error as Error)?.message ?? error);
    return { sent: false, targets: [] };
  }
}

/** Kirim notifikasi tanpa menunggu (jalur panas). */
export function notifyInBackground(
  admin: SupabaseClient<Database>,
  payload: NotifyPayload,
): void {
  void sendNotification(admin, payload);
}

/** Kirim pesan langsung ke satu user (dipakai bot Telegram untuk membalas perintah). */
export async function sendTelegramToUser(
  admin: SupabaseClient<Database>,
  userId: string,
  text: string,
): Promise<boolean> {
  try {
    const telegram = await loadTelegram(admin);
    if (!telegram.botToken) return false;

    const { data } = await admin
      .from("telegram_links")
      .select("chat_id")
      .eq("user_id", userId)
      .maybeSingle<{ chat_id: string }>();
    if (!data?.chat_id) return false;

    const result = await sendTelegramMessage(telegram.botToken, data.chat_id, text, {
      timeoutMs: 5_000,
    });
    return result.ok;
  } catch (error) {
    console.warn("[notify] gagal mengirim pesan Telegram:", (error as Error)?.message ?? error);
    return false;
  }
}
