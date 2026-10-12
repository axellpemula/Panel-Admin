import type { NextRequest } from "next/server";

import { recordActivity } from "@/lib/api/activity";
import { withOwner } from "@/lib/api/auth";
import { sendNotification } from "@/lib/api/notify";
import { loadTelegram, saveTelegram, telegramStatus } from "@/lib/api/settings";
import {
  deleteTelegramWebhook,
  generateWebhookSecret,
  getTelegramBot,
  getTelegramWebhookInfo,
  setTelegramWebhook,
} from "@/lib/utils/telegram";
import { errorMessage, jsonError, jsonOk, readJsonBody } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BODY_MAX = 4 * 1024;

/**
 * Kelola bot Telegram panel (khusus Owner).
 *
 * GET  — status bot + info webhook (token TIDAK pernah dikirim ke browser).
 * POST — `{ action }`:
 *   - `connect`        : `{ bot_token, public_url? }` verifikasi token (getMe) lalu pasang webhook,
 *   - `set_webhook`    : `{ public_url? }` pasang ulang webhook (secret diganti),
 *   - `remove_webhook` : hapus webhook (pakai long polling manual kalau perlu),
 *   - `disconnect`     : hapus webhook + lupakan token,
 *   - `test`           : kirim pesan uji ke chat Owner yang sudah menautkan akun,
 *   - `notifications`  : `{ enabled }` matikan/nyalakan pengiriman notifikasi ke Telegram.
 *
 * URL webhook diambil dari `public_url` (kalau diisi) atau origin request.
 */

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** Hanya izinkan http(s) — mencegah nilai aneh disimpan ke konfigurasi. */
function isValidBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    const telegram = await loadTelegram(ctx.admin);

    let webhookInfo: { url?: string; last_error_message?: string; pending_update_count?: number } | null =
      null;
    if (telegram.botToken) {
      const info = await getTelegramWebhookInfo(telegram.botToken);
      webhookInfo = info.ok ? info.result ?? null : null;
    }

    return jsonOk({
      telegram: telegramStatus(telegram),
      webhook_actual: webhookInfo?.url ?? null,
      webhook_error: webhookInfo?.last_error_message ?? null,
      pending_updates: webhookInfo?.pending_update_count ?? 0,
    });
  });
}

export async function POST(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    const parsed = await readJsonBody(request, BODY_MAX);
    if (!parsed.ok) {
      return jsonError(
        parsed.tooLarge ? "Body request terlalu besar" : "Body request bukan JSON yang valid",
        "validation_error",
        parsed.tooLarge ? 413 : 400,
      );
    }

    const body = (parsed.value ?? {}) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const origin = new URL(request.url).origin;

    const requestedBase =
      typeof body.public_url === "string" && body.public_url.trim().length > 0
        ? normalizeBaseUrl(body.public_url)
        : origin;

    if (!isValidBaseUrl(requestedBase)) {
      return jsonError("public_url harus URL http(s) yang valid", "validation_error", 400);
    }

    const webhookUrl = `${requestedBase}/api/telegram/webhook`;

    try {
      switch (action) {
        case "connect": {
          const token = typeof body.bot_token === "string" ? body.bot_token.trim() : "";
          if (!token) return jsonError("Bot token wajib diisi", "validation_error", 400);

          const bot = await getTelegramBot(token);
          if (!bot.ok) {
            // Bedakan masalah jaringan (server tidak bisa keluar) dari token salah —
            // pesan yang keliru bikin Owner bingung saat setup.
            const reason = bot.error ?? "tidak valid";
            const networkIssue =
              /fetch failed|timeout|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|network/i.test(reason);
            return jsonError(
              networkIssue
                ? `Gagal menghubungi api.telegram.org (${reason}). Periksa koneksi internet server panel, lalu coba lagi.`
                : `Token ditolak Telegram: ${reason}`,
              "validation_error",
              400,
            );
          }

          const secret = generateWebhookSecret();
          const webhook = await setTelegramWebhook(token, webhookUrl, secret);

          const saved = await saveTelegram(
            ctx.admin,
            {
              botToken: token,
              botUsername: bot.username ?? null,
              webhookUrl: webhook.ok ? webhookUrl : null,
              webhookSecret: webhook.ok ? secret : null,
            },
            ctx.userId,
          );

          await recordActivity(ctx.admin, {
            actorId: ctx.userId,
            actorUsername: ctx.profile.username,
            actorRole: ctx.profile.role,
            action: "telegram_connect",
            targetType: "telegram",
            targetLabel: bot.username ? `@${bot.username}` : "bot Telegram",
            detail: { webhook_ok: webhook.ok, webhook_error: webhook.error ?? null, webhook_url: webhookUrl },
          });

          return jsonOk({
            telegram: telegramStatus(saved),
            webhook: { ok: webhook.ok, url: webhook.ok ? webhookUrl : null, error: webhook.error ?? null },
            note: webhook.ok
              ? "Bot aktif dan webhook terpasang. Tautkan chat Owner dari kartu Telegram di Pengaturan."
              : "Token tersimpan, tapi webhook gagal dipasang. Cek kembali public_url panel.",
          });
        }

        case "set_webhook":
        case "rotate_webhook": {
          const telegram = await loadTelegram(ctx.admin);
          if (!telegram.botToken) {
            return jsonError("Bot Telegram belum dihubungkan", "validation_error", 400);
          }

          const secret = generateWebhookSecret();
          const webhook = await setTelegramWebhook(telegram.botToken, webhookUrl, secret);
          if (!webhook.ok) {
            return jsonError(
              `Gagal memasang webhook: ${webhook.error ?? "tidak diketahui"}`,
              "server_error",
              502,
            );
          }

          const saved = await saveTelegram(
            ctx.admin,
            { webhookUrl, webhookSecret: secret },
            ctx.userId,
          );

          await recordActivity(ctx.admin, {
            actorId: ctx.userId,
            actorUsername: ctx.profile.username,
            actorRole: ctx.profile.role,
            action: "telegram_webhook",
            targetType: "telegram",
            targetLabel: telegram.botUsername ? `@${telegram.botUsername}` : "bot Telegram",
            detail: { webhook_url: webhookUrl, rotated: true },
          });

          return jsonOk({ telegram: telegramStatus(saved), webhook: { ok: true, url: webhookUrl } });
        }

        case "remove_webhook": {
          const telegram = await loadTelegram(ctx.admin);
          if (!telegram.botToken) {
            return jsonError("Bot Telegram belum dihubungkan", "validation_error", 400);
          }

          const removed = await deleteTelegramWebhook(telegram.botToken);
          const saved = await saveTelegram(
            ctx.admin,
            { webhookUrl: null, webhookSecret: null },
            ctx.userId,
          );

          await recordActivity(ctx.admin, {
            actorId: ctx.userId,
            actorUsername: ctx.profile.username,
            actorRole: ctx.profile.role,
            action: "telegram_webhook",
            targetType: "telegram",
            targetLabel: "bot Telegram",
            detail: { webhook_url: null, removed: removed.ok },
          });

          return jsonOk({
            telegram: telegramStatus(saved),
            webhook: { ok: removed.ok, url: null, error: removed.error ?? null },
          });
        }

        case "disconnect": {
          const telegram = await loadTelegram(ctx.admin);
          if (telegram.botToken) await deleteTelegramWebhook(telegram.botToken);

          const saved = await saveTelegram(
            ctx.admin,
            { botToken: null, botUsername: null, webhookUrl: null, webhookSecret: null },
            ctx.userId,
          );

          await recordActivity(ctx.admin, {
            actorId: ctx.userId,
            actorUsername: ctx.profile.username,
            actorRole: ctx.profile.role,
            action: "telegram_disconnect",
            targetType: "telegram",
            targetLabel: telegram.botUsername ? `@${telegram.botUsername}` : "bot Telegram",
          });

          return jsonOk({ telegram: telegramStatus(saved) });
        }

        case "notifications": {
          const enabled = typeof body.enabled === "boolean" ? body.enabled : null;
          if (enabled === null) {
            return jsonError("`enabled` wajib boolean", "validation_error", 400);
          }

          const saved = await saveTelegram(ctx.admin, { notificationsEnabled: enabled }, ctx.userId);

          return jsonOk({ telegram: telegramStatus(saved) });
        }

        case "test": {
          const telegram = await loadTelegram(ctx.admin);
          if (!telegram.botToken) {
            return jsonError("Bot Telegram belum dihubungkan", "validation_error", 400);
          }

          const outcome = await sendNotification(ctx.admin, {
            event: "test",
            title: "Pesan uji bot Telegram",
            lines: [
              "Kalau kamu membaca pesan ini, notifikasi panel sudah tersambung dengan benar.",
              `Waktu server: ${new Date().toISOString()}`,
              "Perintah bot: /help",
            ],
          });

          return jsonOk({
            outcome,
            note: outcome.sent
              ? "Pesan uji terkirim ke chat yang tertaut."
              : "Pesan uji tidak terkirim. Pastikan notifikasi aktif dan chat Owner sudah ditautkan (kartu Telegram).",
          });
        }

        default:
          return jsonError("Action tidak dikenal", "validation_error", 400);
      }
    } catch (error) {
      console.error("[settings/telegram] gagal:", error);
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
