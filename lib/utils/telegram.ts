/**
 * Klien Telegram Bot API (server-only, tanpa dependency tambahan).
 *
 * Semua panggilan memakai `fetch` + timeout pendek (`AbortSignal.timeout`) karena
 * dipanggil dari jalur panas (/api/validate, /api/auth/login): kalau Telegram lambat
 * atau mati, panel TIDAK boleh ikut lambat. Kegagalan selalu dikembalikan sebagai
 * `{ ok: false }`, bukan exception.
 */

const DEFAULT_TIMEOUT_MS = 5_000;
const API_BASE = "https://api.telegram.org";

export interface TelegramResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
  status?: number;
}

/** Batas panjang pesan Telegram (4096) — dipotong dengan penanda. */
const MESSAGE_MAX = 4096;

export async function telegramApi<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TelegramResult<T>> {
  if (!token) return { ok: false, error: "Bot token belum diisi" };

  try {
    const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await response.text();
    let parsed: { ok?: boolean; result?: T; description?: string } | null = null;
    try {
      parsed = text ? (JSON.parse(text) as { ok?: boolean; result?: T; description?: string }) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok || parsed?.ok !== true) {
      return {
        ok: false,
        status: response.status,
        error: parsed?.description ?? `HTTP ${response.status}`,
      };
    }

    return { ok: true, result: parsed.result, status: response.status };
  } catch (error) {
    const message = (error as Error)?.name === "TimeoutError" ? "timeout" : (error as Error)?.message;
    return { ok: false, error: message ?? "gagal memanggil Telegram" };
  }
}

/** Info bot (dipakai untuk verifikasi token & mengambil username). */
export async function getTelegramBot(
  token: string,
): Promise<{ ok: boolean; username?: string; id?: number; error?: string }> {
  const result = await telegramApi<{ id: number; username?: string; first_name?: string }>(
    token,
    "getMe",
  );
  if (!result.ok || !result.result) return { ok: false, error: result.error };
  return { ok: true, username: result.result.username, id: result.result.id };
}

/** Kirim pesan teks. `parseMode: "HTML"` untuk format (isi user wajib di-escape). */
export async function sendTelegramMessage(
  token: string,
  chatId: string | number,
  text: string,
  options?: {
    timeoutMs?: number;
    disablePreview?: boolean;
    parseMode?: "HTML";
    /** Baris tombol inline — tiap item { text, callback_data }. */
    keyboard?: TelegramInlineButton[][];
  },
): Promise<TelegramResult<{ message_id: number }>> {
  const body = text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 20)}\n…(dipotong)` : text;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: body,
    disable_web_page_preview: options?.disablePreview ?? true,
  };
  if (options?.parseMode) payload.parse_mode = options.parseMode;
  if (options?.keyboard && options.keyboard.length > 0) {
    payload.reply_markup = { inline_keyboard: options.keyboard };
  }
  return telegramApi<{ message_id: number }>(token, "sendMessage", payload, options?.timeoutMs);
}

/** Satu tombol inline (callback). */
export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

/** Tutup spinner + (opsional) tampilkan toast kecil di atas tombol. */
export async function answerTelegramCallback(
  token: string,
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await telegramApi(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

/** Escape isi bertipe user (username, HWID, note) untuk pesan parse_mode HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Pasang webhook (secret_token dikirim Telegram di header X-Telegram-Bot-Api-Secret-Token). */
export async function setTelegramWebhook(
  token: string,
  url: string,
  secretToken: string,
): Promise<TelegramResult<boolean>> {
  return telegramApi<boolean>(token, "setWebhook", {
    url,
    secret_token: secretToken,
    // "callback_query" untuk tombol inline bot (/menu, wizard generate, pagination).
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export async function deleteTelegramWebhook(token: string): Promise<TelegramResult<boolean>> {
  return telegramApi<boolean>(token, "deleteWebhook", { drop_pending_updates: false });
}

export async function getTelegramWebhookInfo(
  token: string,
): Promise<TelegramResult<{ url?: string; last_error_message?: string; pending_update_count?: number }>> {
  return telegramApi(token, "getWebhookInfo");
}

/** Secret acak untuk webhook (dibandingkan konstanta-waktu di route webhook). */
export function generateWebhookSecret(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = new Uint8Array(40);
  crypto.getRandomValues(bytes);
  let out = "";
  bytes.forEach((byte) => {
    out += alphabet[byte % alphabet.length];
  });
  return out;
}
