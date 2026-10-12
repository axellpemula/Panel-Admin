import type { SupabaseClient } from "@supabase/supabase-js";

import { recordActivity } from "@/lib/api/activity";
import { listKeys } from "@/lib/api/keys";
import { GenerateError, generateKeys } from "@/lib/api/generate";
import { listKeyDevices, resetKeyDevices } from "@/lib/api/device-reset";
import type { HwidResetLimits } from "@/lib/api/hwid-reset";
import { loadRuntime, loadTelegram } from "@/lib/api/settings";
import type { Database, KeyRow, ProfileRow } from "@/lib/types/database";
import { formatNumber } from "@/lib/utils/format";
import {
  answerTelegramCallback,
  escapeHtml,
  sendTelegramMessage,
  type TelegramInlineButton,
} from "@/lib/utils/telegram";

/**
 * Perintah bot Telegram reseller (#15) — v2 dengan inline keyboard & HTML.
 *
 * Alur: pengguna menautkan chat lewat kode dari Pengaturan (`/start <KODE>`),
 * setelah itu bot melayani:
 *
 * | Perintah / tombol                      | Fungsi                                  |
 * | -------------------------------------- | --------------------------------------- |
 * | `/menu`                                | menu tombol (juga muncul di /start)     |
 * | `/help`                                | daftar perintah                         |
 * | `/saldo`                               | sisa credit + ringkasan key             |
 * | `/preset`                              | daftar preset durasi (nomor + harga)    |
 * | `/keys [status]`                        | 5 key terbaru per halaman (tombol ‹ ›)  |
 * | `/key XLVP-XXXX-XXXX`                   | detail key + daftar device              |
 * | `/generate <preset> [qty] [device]`     | generate cepat (tool aktif pertama)     |
 * | wizard ⚡ Generate                       | pilih tool → version → preset → qty → device → konfirmasi |
 * | `/reset <KEY> [n\|all]`                 | reset HWID (kuota cooldown berlaku)     |
 * | `/unlink`                               | lepas tautan chat                       |
 *
 * Semua pesan memakai `parse_mode: HTML`; isi dari user (username, HWID, note)
 * di-escape lewat `escapeHtml` supaya tidak bisa merusak format. Key dibungkus
 * `<code>` agar bisa di-tap-copy di Telegram.
 *
 * Tombol memakai `callback_data` **stateless** — seluruh pilihan (tool, version,
 * preset, qty, device, halaman) disimpan di data callback, bukan di memori
 * server, jadi aman untuk runtime serverless. Nomor urut konsisten dengan
 * perintah teks dan selalu di-validasi ulang saat dieksekusi.
 *
 * Bot memakai library yang sama dengan panel (`generateKeys`, `resetKeyDevices`),
 * jadi harga, validasi, kuota, audit, dan notifikasinya konsisten.
 */

/** Batas perintah per chat per menit (anti loop/miskin). */
const CHAT_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

/** Jumlah key per halaman di daftar /keys & tombol pagination. */
const KEYS_PAGE_SIZE = 5;

/** Pilihan jumlah key & device di wizard generate. */
const QTY_CHOICES = [1, 3, 5, 10];
const DEVICE_CHOICES = [1, 2, 3];

const rateBuckets = new Map<string, number[]>();

function rateLimited(chatId: string): boolean {
  const now = Date.now();
  const recent = (rateBuckets.get(chatId) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  recent.push(now);
  rateBuckets.set(chatId, recent);
  // Bersihkan bucket lama supaya map tidak tumbuh tanpa batas.
  if (rateBuckets.size > 500) {
    [...rateBuckets.entries()].forEach(([key, times]) => {
      if (times.every((time) => now - time >= RATE_WINDOW_MS)) rateBuckets.delete(key);
    });
  }
  return recent.length > CHAT_RATE_LIMIT;
}

interface TelegramUpdate {
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number; username?: string; first_name?: string };
  };
  callback_query?: {
    id?: string | number;
    data?: string;
    from?: { id?: number; username?: string; first_name?: string };
    message?: { chat?: { id?: number | string } };
  };
}

const HELP_TEXT = [
  "Perintah yang tersedia:",
  "/menu — menu tombol",
  "<code>/saldo</code> — sisa credit &amp; ringkasan key",
  "<code>/preset</code> — daftar preset durasi",
  "<code>/keys [active|expired|banned]</code> — key terbaru",
  "<code>/key XLVP-XXXX-XXXX</code> — detail key + device",
  "<code>/generate &lt;preset&gt; [qty] [device]</code> — buat key cepat",
  "<code>/reset XLVP-XXXX-XXXX &lt;all|nomor device&gt;</code> — reset HWID",
  "<code>/unlink</code> — lepas tautan chat ini",
  "",
  "Atau pakai ⚡ Generate di /menu untuk memilih tool &amp; version.",
].join("\n");

/** Bungkus nilai (key/HWID) jadi blok kode yang bisa di-tap-copy. */
function code(value: string): string {
  return `<code>${escapeHtml(value)}</code>`;
}

function bold(value: string): string {
  return `<b>${escapeHtml(value)}</b>`;
}

// ---------------------------------------------------------------------------
// Pengiriman
// ---------------------------------------------------------------------------

/** Catat kegagalan kirim balasan ke notification_logs biar bisa di-debug dari panel. */
async function logBotReplyFailure(
  admin: SupabaseClient<Database>,
  chat: string,
  error: string,
): Promise<void> {
  try {
    await admin.from("notification_logs").insert({
      event: "bot_reply",
      dedupe_key: null,
      target: `telegram:${chat}`,
      success: false,
      summary: `Gagal membalas: ${error}`.slice(0, 500),
      detail: null,
    });
  } catch {
    // Logging gagal — abaikan, jangan menggagalkan handler.
  }
}

interface ReplyOptions {
  keyboard?: TelegramInlineButton[][];
}

// ---------------------------------------------------------------------------
// Keyboard utama & tombol
// ---------------------------------------------------------------------------

function mainMenuKeyboard(): TelegramInlineButton[][] {
  return [
    [
      { text: "💰 Saldo", callback_data: "menu:saldo" },
      { text: "📋 Preset", callback_data: "menu:preset" },
    ],
    [
      { text: "🔑 Key saya", callback_data: "menu:keys" },
      { text: "⚡ Generate", callback_data: "wizard:start" },
    ],
    [{ text: "🔗 Lepas tautan chat", callback_data: "menu:unlink" }],
  ];
}

const MENU_HOME_ROW: TelegramInlineButton[] = [
  { text: "🏠 Menu", callback_data: "menu:home" },
];

function keysKeyboard(
  status: string | null,
  page: number,
  totalPages: number,
  keyValues: string[],
): TelegramInlineButton[][] {
  const rows: TelegramInlineButton[][] = keyValues.map((value) => [
    { text: value, callback_data: `key:${value}` },
  ]);

  const statusPart = status ?? "all";
  const nav: TelegramInlineButton[] = [];
  if (page > 1) {
    nav.push({ text: "‹", callback_data: `keys:${statusPart}:${page - 1}` });
  }
  nav.push({ text: `${page}/${Math.max(1, totalPages)}`, callback_data: `keys:${statusPart}:${page}` });
  if (page < totalPages) {
    nav.push({ text: "›", callback_data: `keys:${statusPart}:${page + 1}` });
  }
  rows.push(nav);
  rows.push([
    ...(status
      ? [{ text: "Semua status", callback_data: `keys:all:1` } satisfies TelegramInlineButton]
      : []),
    ...MENU_HOME_ROW,
  ]);
  return rows;
}

function keyDetailKeyboard(keyValue: string, deviceCount: number): TelegramInlineButton[][] {
  const rows: TelegramInlineButton[][] = [];
  if (deviceCount > 0) {
    const deviceButtons: TelegramInlineButton[] = [];
    for (let index = 1; index <= deviceCount && index <= 5; index += 1) {
      deviceButtons.push({
        text: `♻️ #${index}`,
        callback_data: `rstc:${keyValue}:${index}`,
      });
    }
    deviceButtons.push({ text: "♻️ Semua", callback_data: `rstc:${keyValue}:all` });
    rows.push(deviceButtons);
  }
  rows.push([{ text: "◀️ Daftar key", callback_data: "menu:keys" }]);
  return rows;
}

function resetConfirmKeyboard(keyValue: string, target: string): TelegramInlineButton[][] {
  return [
    [
      { text: "✅ Ya, reset", callback_data: `rstgo:${keyValue}:${target}` },
      { text: "❌ Batal", callback_data: `key:${keyValue}` },
    ],
  ];
}

// ---------------------------------------------------------------------------
// Handler utama
// ---------------------------------------------------------------------------

export async function handleTelegramUpdate(
  admin: SupabaseClient<Database>,
  update: TelegramUpdate,
): Promise<void> {
  if (update.callback_query) return handleCallbackQuery(admin, update.callback_query);
  return handleMessage(admin, update.message);
}

// ---------------------------------------------------------------------------
// Pesan teks (perintah)
// ---------------------------------------------------------------------------

async function handleMessage(
  admin: SupabaseClient<Database>,
  message: TelegramUpdate["message"],
): Promise<void> {
  const chatId = message?.chat?.id;
  const text = (message?.text ?? "").trim();
  if (chatId === undefined || chatId === null || text.length === 0) return;

  const telegram = await loadTelegram(admin);
  if (!telegram.botToken) return;

  const chat = String(chatId);
  const send = async (body: string, options?: ReplyOptions) => {
    const result = await sendTelegramMessage(telegram.botToken as string, chat, body, {
      timeoutMs: 8_000,
      parseMode: "HTML",
      keyboard: options?.keyboard,
    });
    if (!result.ok) {
      console.warn("[telegram-bot] gagal membalas:", result.error);
      await logBotReplyFailure(admin, chat, result.error ?? "gagal");
    }
  };

  if (rateLimited(chat)) {
    await send("Terlalu banyak perintah. Coba lagi sebentar lagi.");
    return;
  }

  const [rawCommand, ...args] = text.split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@.*$/, "");

  // ---------- /start <kode> : penautan chat ----------
  if (command === "/start") {
    const candidate = (args[0] ?? "").toUpperCase();
    if (!candidate) {
      await send(
        [
          `Halo ${escapeHtml(message?.from?.first_name ?? "")}! 👋`.trimEnd(),
          "Bot ini milik XLOOP PANEL.",
          "",
          "Untuk menautkan akun: buka panel → Pengaturan → Telegram → Tautkan, lalu kirim",
          `${code("/start <KODE>")} ke chat ini.`,
          "",
          "Kalau chat sudah tertaut, pakai tombol di bawah 👇",
        ].join("\n"),
        { keyboard: mainMenuKeyboard() },
      );
      return;
    }

    const linked = await linkChat(admin, candidate, chat, message?.from?.username ?? null);

    if (!linked.ok) {
      await send(escapeHtml(linked.error));
      return;
    }

    await send(
      [
        `Berhasil! Chat ini tertaut ke akun ${bold(linked.profile.username)} (${escapeHtml(linked.profile.role)}).`,
        "",
        "Kamu akan menerima notifikasi penting di sini. Mulai dari menu ini 👇",
      ].join("\n"),
      { keyboard: mainMenuKeyboard() },
    );
    return;
  }

  // ---------- Semua perintah lain butuh tautan ----------
  const profile = await profileForChat(admin, chat);
  if (!profile) {
    await send(
      escapeHtml(
        "Chat ini belum tertaut ke akun panel. Buka panel → Pengaturan → Telegram → Tautkan akun, lalu kirim kode /start <KODE> ke bot ini.",
      ),
    );
    return;
  }

  try {
    switch (command) {
      case "/menu":
        await send("Silakan pilih 👇", { keyboard: mainMenuKeyboard() });
        return;

      case "/help":
      case "/bantuan":
        await send(HELP_TEXT);
        return;

      case "/unlink": {
        await admin.from("telegram_links").delete().eq("user_id", profile.id);
        await recordActivity(admin, {
          actorId: profile.id,
          actorUsername: profile.username,
          actorRole: profile.role,
          action: "telegram_unlink",
          targetType: "telegram",
          targetLabel: profile.username,
          detail: { chat_id: chat, source: "bot" },
        });
        await send(escapeHtml("Tautan chat ini sudah dilepas. Notifikasi tidak akan dikirim ke sini lagi."));
        return;
      }

      case "/saldo":
      case "/credit":
        await sendSaldo(admin, profile, send);
        return;

      case "/preset":
      case "/presets":
        await sendPresets(admin, send);
        return;

      case "/keys":
      case "/key": {
        const keyArg = args.find((arg) => /^xlvp-/i.test(arg));
        if (!keyArg) {
          const statusFilter = args[0]?.toLowerCase();
          const status = ["active", "expired", "banned"].includes(statusFilter)
            ? statusFilter
            : null;
          await sendKeysPage(admin, profile, send, status, 1);
          return;
        }
        await sendKeyDetail(admin, profile, send, keyArg);
        return;
      }

      case "/generate": {
        const presetNumber = Number.parseInt(args[0] ?? "", 10);
        if (!Number.isFinite(presetNumber) || presetNumber < 1) {
          await send(
            [
              escapeHtml("Format: /generate <nomor preset> [jumlah key] [jumlah device]"),
              escapeHtml("Lihat nomor preset dengan /preset, atau pakai ⚡ Generate di /menu untuk memilih tool."),
            ].join("\n"),
          );
          return;
        }
        const quantity = args[1] ? Number.parseInt(args[1], 10) : 1;
        const maxDevice = args[2] ? Number.parseInt(args[2], 10) : 1;
        // Perintah teks memakai tool aktif pertama — untuk memilih tool, pakai wizard /menu.
        await executeGenerate(admin, profile, send, 1, 1, presetNumber, quantity, maxDevice);
        return;
      }

      case "/reset": {
        const [keyArg, targetArg] = [args[0], args[1]];
        if (!keyArg) {
          await send(
            escapeHtml("Format: /reset XLVP-XXXX-XXXX <all|nomor device>\nAtau tap key di /keys lalu pilih tombol reset."),
          );
          return;
        }
        await executeReset(admin, profile, send, keyArg, targetArg && targetArg.toLowerCase() !== "all" ? targetArg : "all", true);
        return;
      }

      default:
        await send(
          [escapeHtml(`Perintah ${rawCommand} tidak dikenal.`), "", HELP_TEXT].join("\n"),
          { keyboard: mainMenuKeyboard() },
        );
    }
  } catch (error) {
    if (error instanceof GenerateError) {
      await send(`❌ ${escapeHtml(error.message)}`);
      return;
    }
    console.error("[telegram-bot] perintah gagal:", (error as Error)?.message ?? error);
    await send(escapeHtml("Terjadi kesalahan saat memproses perintah. Coba lagi sebentar lagi."));
  }
}

// ---------------------------------------------------------------------------
// Callback query (tombol inline)
// ---------------------------------------------------------------------------

async function handleCallbackQuery(
  admin: SupabaseClient<Database>,
  query: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const chatId = query.message?.chat?.id;
  const data = (query.data ?? "").trim();
  if (chatId === undefined || chatId === null || data.length === 0) return;

  const telegram = await loadTelegram(admin);
  if (!telegram.botToken) return;

  const chat = String(chatId);
  const callbackId = query.id !== undefined ? String(query.id) : null;

  // Tutup spinner segera; toast error menyusul kalau perlu.
  const answer = async (text?: string) => {
    if (callbackId) await answerTelegramCallback(telegram.botToken as string, callbackId, text);
  };

  const send = async (body: string, options?: ReplyOptions) => {
    const result = await sendTelegramMessage(telegram.botToken as string, chat, body, {
      timeoutMs: 8_000,
      parseMode: "HTML",
      keyboard: options?.keyboard,
    });
    if (!result.ok) {
      console.warn("[telegram-bot] gagal membalas callback:", result.error);
      await logBotReplyFailure(admin, chat, result.error ?? "gagal");
    }
  };

  if (rateLimited(chat)) {
    await answer("Terlalu banyak perintah, tunggu sebentar.");
    return;
  }

  const profile = await profileForChat(admin, chat);
  if (!profile) {
    await answer("Chat belum tertaut ke akun panel.");
    return;
  }

  const [head, ...rest] = data.split(":");

  try {
    switch (head) {
      case "menu": {
        const target = rest[0] ?? "home";
        if (target === "saldo") await sendSaldo(admin, profile, send);
        else if (target === "preset") await sendPresets(admin, send);
        else if (target === "keys") await sendKeysPage(admin, profile, send, null, 1);
        else if (target === "unlink") {
          await admin.from("telegram_links").delete().eq("user_id", profile.id);
          await recordActivity(admin, {
            actorId: profile.id,
            actorUsername: profile.username,
            actorRole: profile.role,
            action: "telegram_unlink",
            targetType: "telegram",
            targetLabel: profile.username,
            detail: { chat_id: chat, source: "bot_menu" },
          });
          await send(escapeHtml("Tautan chat ini sudah dilepas. Sampai jumpa! 👋"));
        } else await send("Silakan pilih 👇", { keyboard: mainMenuKeyboard() });
        await answer();
        return;
      }

      case "keys": {
        const status = rest[0] && rest[0] !== "all" ? rest[0] : null;
        const page = Number.parseInt(rest[1] ?? "1", 10) || 1;
        await sendKeysPage(admin, profile, send, status, page);
        await answer();
        return;
      }

      case "key": {
        await sendKeyDetail(admin, profile, send, rest.join(":"));
        await answer();
        return;
      }

      case "rstc": {
        // Konfirmasi reset: rest = [KEY, target]
        const keyValue = rest[0] ?? "";
        const target = rest[1] ?? "all";
        await send(
          [
            `♻️ Reset HWID ${code(keyValue)}?`,
            target === "all" ? "Semua device akan dihapus — pemakai harus login/HWID baru." : `Device #${escapeHtml(target)} akan dihapus.`,
            "",
            escapeHtml("Aksi tercatat di audit log & kuota cooldown reset tetap berlaku."),
          ].join("\n"),
          { keyboard: resetConfirmKeyboard(keyValue, target) },
        );
        await answer();
        return;
      }

      case "rstgo": {
        const keyValue = rest[0] ?? "";
        const target = rest[1] ?? "all";
        await executeReset(admin, profile, send, keyValue, target, false);
        await answer();
        return;
      }

      // ---------- Wizard generate ----------
      case "wizard": {
        if (rest[0] === "start") await renderWizardTools(admin, send);
        else if (rest[0] === "cancel") await send("Wizard generate dibatalkan.", { keyboard: mainMenuKeyboard() });
        await answer();
        return;
      }

      case "gentool": {
        await renderWizardVersions(admin, send, Number.parseInt(rest[0] ?? "1", 10) || 1);
        await answer();
        return;
      }

      case "genver": {
        await renderWizardPresets(admin, send, Number.parseInt(rest[0] ?? "1", 10) || 1, Number.parseInt(rest[1] ?? "1", 10) || 1);
        await answer();
        return;
      }

      case "genpre": {
        await renderWizardQty(
          admin,
          send,
          Number.parseInt(rest[0] ?? "1", 10) || 1,
          Number.parseInt(rest[1] ?? "1", 10) || 1,
          Number.parseInt(rest[2] ?? "1", 10) || 1,
        );
        await answer();
        return;
      }

      case "genqty": {
        const [t, v, p, q] = rest.map((value) => Number.parseInt(value, 10) || 1);
        await renderWizardDevices(admin, send, t, v, p, q);
        await answer();
        return;
      }

      case "gendev": {
        const [t, v, p, q, d] = rest.map((value) => Number.parseInt(value, 10) || 1);
        await renderWizardConfirm(admin, profile, send, t, v, p, q, d);
        await answer();
        return;
      }

      case "gen": {
        if (rest[0] === "go") {
          const [t, v, p, q, d] = rest.slice(1).map((value) => Number.parseInt(value, 10) || 1);
          await answer("Memproses…");
          await executeGenerate(admin, profile, send, t, v, p, q, d);
        } else {
          await send("Wizard generate dibatalkan.", { keyboard: mainMenuKeyboard() });
          await answer();
        }
        return;
      }

      default:
        await answer("Tombol tidak dikenal.");
    }
  } catch (error) {
    if (error instanceof GenerateError) {
      await send(`❌ ${escapeHtml(error.message)}`);
      await answer();
      return;
    }
    console.error("[telegram-bot] callback gagal:", (error as Error)?.message ?? error);
    await send(escapeHtml("Terjadi kesalahan saat memproses tombol. Coba lagi."));
    await answer();
  }
}

// ---------------------------------------------------------------------------
// Render: saldo / preset / keys / detail key
// ---------------------------------------------------------------------------

type SendFn = (body: string, options?: ReplyOptions) => Promise<void>;

async function sendSaldo(admin: SupabaseClient<Database>, profile: ProfileRow, send: SendFn) {
  const perPage = 1;
  const [active, expired, banned] = await Promise.all([
    listKeys(admin, { userId: profile.id, status: "active", perPage }),
    listKeys(admin, { userId: profile.id, status: "expired", perPage }),
    listKeys(admin, { userId: profile.id, status: "banned", perPage }),
  ]);

  const isOwner = profile.role === "owner";
  await send(
    [
      `💰 ${bold("Saldo")}`,
      `Akun: ${bold(profile.username)} (${isOwner ? "Owner" : "Reseller"})`,
      `Sisa credit: ${bold(formatNumber(profile.credit))}`,
      "",
      `🔑 Aktif: ${formatNumber(active.total)} · ⌛ Expired: ${formatNumber(expired.total)} · ⛔ Banned: ${formatNumber(banned.total)}`,
      "",
      escapeHtml(isOwner ? "Owner tidak dipotong credit saat generate." : "Harga 1 unit = 1 key × 1 device."),
    ].join("\n"),
    { keyboard: [MENU_HOME_ROW] },
  );
}

async function sendPresets(admin: SupabaseClient<Database>, send: SendFn) {
  const { data, error } = await admin
    .from("duration_presets")
    .select("id, name, days, credit_cost, is_active")
    .eq("is_active", true)
    .order("days", { ascending: true });

  if (error) throw new Error(error.message);
  const presets = (data ?? []) as {
    name: string;
    days: number | null;
    credit_cost: number;
  }[];

  if (presets.length === 0) {
    await send("Belum ada preset durasi aktif.", { keyboard: [MENU_HOME_ROW] });
    return;
  }

  const lines = presets.map((preset, index) => {
    const duration =
      preset.days === null || preset.days === 0 ? "lifetime" : `${preset.days} hari`;
    return `${index + 1}. ${escapeHtml(preset.name)} (${duration}) — ${formatNumber(preset.credit_cost)} credit/device`;
  });

  await send(
    [
      "📋 Preset durasi aktif:",
      "",
      ...lines,
      "",
      escapeHtml("Pakai nomornya: /generate 1 2 1 — atau tap ⚡ Generate di /menu."),
    ].join("\n"),
    { keyboard: [MENU_HOME_ROW] },
  );
}

async function sendKeysPage(
  admin: SupabaseClient<Database>,
  profile: ProfileRow,
  send: SendFn,
  status: string | null,
  page: number,
) {
  const result = await listKeys(admin, {
    userId: profile.id,
    status: status ?? undefined,
    page,
    perPage: KEYS_PAGE_SIZE,
  });

  if (result.items.length === 0) {
    await send(
      status
        ? escapeHtml(`Belum ada key dengan status ${status}.`)
        : "Belum ada key. Buat lewat ⚡ Generate!",
      { keyboard: [MENU_HOME_ROW] },
    );
    return;
  }

  const lines = result.items.map(
    (item) =>
      `${code(item.key_value)} · ${escapeHtml(item.tool_name)}${item.version_name ? ` ${escapeHtml(item.version_name)}` : ""} · ${escapeHtml(item.status)} · ${item.devices_used}/${item.max_device} device`,
  );
  const statusLabel = status ? ` (${status})` : "";

  await send(
    [`🔑 Key${escapeHtml(statusLabel)} — halaman ${result.page}/${result.totalPages}:`, "", ...lines].join("\n"),
    { keyboard: keysKeyboard(status, result.page, result.totalPages, result.items.map((item) => item.key_value)) },
  );
}

async function sendKeyDetail(
  admin: SupabaseClient<Database>,
  profile: ProfileRow,
  send: SendFn,
  keyArg: string,
) {
  const search = await listKeys(admin, { userId: profile.id, search: keyArg, perPage: 5 });
  const found = search.items.find(
    (item) => item.key_value.toUpperCase() === keyArg.toUpperCase(),
  );
  if (!found) {
    await send(`${escapeHtml(keyArg.toUpperCase())} tidak ditemukan di akun ini.`, {
      keyboard: [MENU_HOME_ROW],
    });
    return;
  }

  const devices = await listKeyDevices(admin, found.id);

  await send(
    [
      `🔑 ${code(found.key_value)}`,
      `Status: ${escapeHtml(found.status)}`,
      `Tool: ${escapeHtml(found.tool_name)}${found.version_name ? ` ${escapeHtml(found.version_name)}` : ""}`,
      `Device: ${devices.length}/${found.max_device}`,
      found.expired_at ? `Expired: ${found.expired_at.slice(0, 10)}` : "Expired: lifetime",
      found.status === "banned" ? "⛔ Key sedang diblokir (banned)." : "",
      "",
      devices.length > 0
        ? [
            "Device terdaftar:",
            ...devices.map(
              (device, index) => `${index + 1}. ${escapeHtml(device.hardware_id)}`,
            ),
          ].join("\n")
        : "Belum ada device terdaftar.",
    ]
      .filter(Boolean)
      .join("\n"),
    { keyboard: keyDetailKeyboard(found.key_value, devices.length) },
  );
}

// ---------------------------------------------------------------------------
// Reset HWID (dipakai perintah teks & tombol)
// ---------------------------------------------------------------------------

async function executeReset(
  admin: SupabaseClient<Database>,
  profile: ProfileRow,
  send: SendFn,
  keyArg: string,
  target: string,
  fromText: boolean,
) {
  if (!/^xlvp-/i.test(keyArg)) {
    await send(escapeHtml("Format key tidak dikenal. Contoh: /reset XLVP-XXXX-XXXX all"));
    return;
  }

  const search = await listKeys(admin, { userId: profile.id, search: keyArg, perPage: 5 });
  const found = search.items.find(
    (item) => item.key_value.toUpperCase() === keyArg.toUpperCase(),
  );
  if (!found) {
    await send(`Key ${code(keyArg.toUpperCase())} tidak ditemukan di akun ini.`);
    return;
  }

  const runtime = await loadRuntime(admin);
  const limits: HwidResetLimits = {
    limit: runtime.hwid.resetLimit,
    windowHours: runtime.hwid.resetWindowHours,
  };

  let hardwareId: string | null = null;
  const devices = await listKeyDevices(admin, found.id);

  if (target.toLowerCase() !== "all") {
    const index = Number.parseInt(target, 10);
    if (!Number.isFinite(index) || index < 1 || index > devices.length) {
      await send(
        [
          escapeHtml(`Nomor device tidak valid. Key ini punya ${devices.length} device:`),
          ...devices.map((device, position) => `${position + 1}. ${escapeHtml(device.hardware_id)}`),
        ].join("\n"),
      );
      return;
    }
    hardwareId = devices[index - 1].hardware_id;
  }

  if (fromText) {
    // Dari perintah teks langsung eksekusi (sudah eksplisit menulis perintah).
  }

  const { data: keyRow, error: keyError } = await admin
    .from("keys")
    .select("*")
    .eq("id", found.id)
    .maybeSingle<KeyRow>();
  if (keyError || !keyRow) {
    await send(escapeHtml("Gagal membaca data key. Coba lagi."));
    return;
  }

  const result = await resetKeyDevices(
    {
      admin,
      userId: profile.id,
      username: profile.username,
      role: profile.role,
      isOwner: profile.role === "owner",
    },
    keyRow,
    { hardwareId, limits },
  );

  if (!result.ok) {
    await send(`❌ Gagal reset: ${escapeHtml(result.error)}`);
    return;
  }

  await send(
    [
      `✅ Reset berhasil (${result.removed} device dihapus)`,
      "",
      `Key: ${code(found.key_value)}`,
      result.cooldown && typeof result.cooldown.remaining === "number"
        ? `Kuota reset tersisa: ${Math.max(0, result.cooldown.remaining)}× per ${limits.windowHours} jam`
        : "Owner bebas kuota reset.",
    ].join("\n"),
    { keyboard: [MENU_HOME_ROW] },
  );
}

// ---------------------------------------------------------------------------
// Wizard generate: tool → version → preset → qty → device → konfirmasi
// ---------------------------------------------------------------------------

async function loadActiveTools(admin: SupabaseClient<Database>) {
  const { data, error } = await admin
    .from("tool_types")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string }[];
}

async function loadActiveVersions(admin: SupabaseClient<Database>, toolId: string) {
  const { data, error } = await admin
    .from("tool_versions")
    .select("id, name, is_active")
    .eq("tool_type_id", toolId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string }[];
}

async function loadActivePresets(admin: SupabaseClient<Database>) {
  const { data, error } = await admin
    .from("duration_presets")
    .select("id, name, days, credit_cost, is_active")
    .eq("is_active", true)
    .order("days", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; name: string; days: number | null; credit_cost: number }[];
}

async function renderWizardTools(admin: SupabaseClient<Database>, send: SendFn) {
  const tools = await loadActiveTools(admin);
  if (tools.length === 0) {
    await send("Belum ada tool aktif. Hubungi Owner.", { keyboard: [MENU_HOME_ROW] });
    return;
  }

  const rows = tools.map((tool, index) => [
    { text: `🧰 ${tool.name}`, callback_data: `gentool:${index + 1}` },
  ]);
  rows.push([{ text: "❌ Batal", callback_data: "wizard:cancel" }]);
  await send("⚡ Pilih tool untuk key baru:", { keyboard: rows });
}

async function renderWizardVersions(admin: SupabaseClient<Database>, send: SendFn, toolNumber: number) {
  const tools = await loadActiveTools(admin);
  const tool = tools[toolNumber - 1];
  if (!tool) {
    await send("Daftar tool berubah. Ulangi wizard dari /menu ya.");
    return;
  }

  const versions = await loadActiveVersions(admin, tool.id);
  if (versions.length === 0) {
    await send(`Tool ${escapeHtml(tool.name)} belum punya version aktif. Hubungi Owner.`);
    return;
  }

  const rows = versions.map((version, index) => [
    { text: `📦 ${version.name}`, callback_data: `genver:${toolNumber}:${index + 1}` },
  ]);
  rows.push([
    { text: "◀️ Ganti tool", callback_data: "wizard:start" },
    { text: "❌ Batal", callback_data: "wizard:cancel" },
  ]);
  await send(`📦 Pilih version untuk ${bold(tool.name)}:`, { keyboard: rows });
}

async function renderWizardPresets(
  admin: SupabaseClient<Database>,
  send: SendFn,
  toolNumber: number,
  versionNumber: number,
) {
  const tools = await loadActiveTools(admin);
  const tool = tools[toolNumber - 1];
  if (!tool) {
    await send("Daftar tool berubah. Ulangi wizard dari /menu ya.");
    return;
  }
  const versions = await loadActiveVersions(admin, tool.id);
  const version = versions[versionNumber - 1];
  if (!version) {
    await send("Daftar version berubah. Ulangi wizard dari /menu ya.");
    return;
  }

  const presets = await loadActivePresets(admin);
  if (presets.length === 0) {
    await send("Belum ada preset durasi aktif. Hubungi Owner.");
    return;
  }

  const rows = presets.map((preset, index) => {
    const duration = preset.days === null || preset.days === 0 ? "lifetime" : `${preset.days} hr`;
    return [
      {
        text: `⏱ ${preset.name} · ${duration} · ${formatNumber(preset.credit_cost)}cr`,
        callback_data: `genpre:${toolNumber}:${versionNumber}:${index + 1}`,
      },
    ];
  });
  rows.push([
    { text: "◀️ Ganti version", callback_data: `gentool:${toolNumber}` },
    { text: "❌ Batal", callback_data: "wizard:cancel" },
  ]);
  await send("⏱ Pilih durasi (preset):", { keyboard: rows });
}

async function renderWizardQty(
  admin: SupabaseClient<Database>,
  send: SendFn,
  toolNumber: number,
  versionNumber: number,
  presetNumber: number,
) {
  const rows = QTY_CHOICES.map((qty) => [
    { text: `${qty} key`, callback_data: `genqty:${toolNumber}:${versionNumber}:${presetNumber}:${qty}` },
  ]);
  rows.push([
    { text: "◀️ Ganti preset", callback_data: `genver:${toolNumber}:${versionNumber}` },
    { text: "❌ Batal", callback_data: "wizard:cancel" },
  ]);
  await send("🔢 Berapa jumlah key?", { keyboard: rows });
}

async function renderWizardDevices(
  admin: SupabaseClient<Database>,
  send: SendFn,
  toolNumber: number,
  versionNumber: number,
  presetNumber: number,
  qty: number,
) {
  const rows = DEVICE_CHOICES.map((device) => [
    { text: `${device} device/key`, callback_data: `gendev:${toolNumber}:${versionNumber}:${presetNumber}:${qty}:${device}` },
  ]);
  rows.push([
    { text: "◀️ Ganti jumlah", callback_data: `genpre:${toolNumber}:${versionNumber}:${presetNumber}` },
    { text: "❌ Batal", callback_data: "wizard:cancel" },
  ]);
  await send("📱 Berapa device per key?", { keyboard: rows });
}

async function renderWizardConfirm(
  admin: SupabaseClient<Database>,
  profile: ProfileRow,
  send: SendFn,
  toolNumber: number,
  versionNumber: number,
  presetNumber: number,
  qty: number,
  device: number,
) {
  const preview = await resolveWizardPicks(admin, toolNumber, versionNumber, presetNumber);
  if (!preview) {
    await send("Pilihan tidak valid lagi (daftar mungkin berubah). Ulangi wizard dari /menu ya.");
    return;
  }

  const totalCost = preview.preset.credit_cost * qty * device;
  await send(
    [
      "🧾 Konfirmasi generate:",
      `Tool: ${bold(preview.tool.name)} ${escapeHtml(preview.version.name)}`,
      `Durasi: ${escapeHtml(presetLabel(preview.preset))}`,
      `Jumlah: ${qty} key × ${device} device`,
      `Biaya: ${bold(`${formatNumber(totalCost)} credit`)}${profile.role === "owner" ? " (Owner bebas biaya)" : ""}`,
      "",
      escapeHtml("Lanjutkan?"),
    ].join("\n"),
    {
      keyboard: [
        [
          { text: `✅ Buat ${qty} key`, callback_data: `gen:go:${toolNumber}:${versionNumber}:${presetNumber}:${qty}:${device}` },
          { text: "❌ Batal", callback_data: "wizard:cancel" },
        ],
      ],
    },
  );
}

function presetLabel(preset: { name: string; days: number | null }): string {
  return preset.days === null || preset.days === 0
    ? `${preset.name} (lifetime)`
    : `${preset.name} (${preset.days} hari)`;
}

async function resolveWizardPicks(
  admin: SupabaseClient<Database>,
  toolNumber: number,
  versionNumber: number,
  presetNumber: number,
): Promise<{
  tool: { id: string; name: string };
  version: { id: string; name: string };
  preset: { id: string; name: string; days: number | null; credit_cost: number };
} | null> {
  const tools = await loadActiveTools(admin);
  const tool = tools[toolNumber - 1];
  if (!tool) return null;

  const versions = await loadActiveVersions(admin, tool.id);
  const version = versions[versionNumber - 1];
  if (!version) return null;

  const presets = await loadActivePresets(admin);
  const preset = presets[presetNumber - 1];
  if (!preset) return null;

  return { tool, version, preset };
}

async function executeGenerate(
  admin: SupabaseClient<Database>,
  profile: ProfileRow,
  send: SendFn,
  toolNumber: number,
  versionNumber: number,
  presetNumber: number,
  quantity: number,
  maxDevice: number,
) {
  const picks = await resolveWizardPicks(admin, toolNumber, versionNumber, presetNumber);
  if (!picks) {
    await send(
      escapeHtml("Pilihan tidak valid (daftar tool/preset mungkin berubah). Ulangi dari /menu → ⚡ Generate."),
      { keyboard: mainMenuKeyboard() },
    );
    return;
  }

  const result = await generateKeys(
    { admin, userId: profile.id, profile, isOwner: profile.role === "owner" },
    {
      toolTypeId: picks.tool.id,
      toolVersionId: picks.version.id,
      durationMode: "preset",
      durationPresetId: picks.preset.id,
      maxDevice: maxDevice > 0 ? maxDevice : 1,
      quantity: quantity > 0 ? quantity : 1,
      note: "Digenerate lewat bot Telegram",
    },
  );

  await send(
    [
      `✅ ${bold(`${result.keys.length} key dibuat`)}`,
      "",
      ...result.keys.map((item) => code(item.key_value)),
      "",
      `${escapeHtml(result.summary.tool_name)} ${escapeHtml(result.summary.version_name)} · ${escapeHtml(result.summary.duration_label)}`,
      `${result.keys.length} × ${result.summary.max_device} device`,
      `Biaya: ${formatNumber(result.summary.credit_cost)} credit`,
      `Sisa credit: ${bold(formatNumber(result.summary.credit_balance_after))}`,
    ].join("\n"),
    { keyboard: [MENU_HOME_ROW] },
  );
}

// ---------------------------------------------------------------------------
// Penautan chat
// ---------------------------------------------------------------------------

/** Tautkan chat dengan kode sekali pakai. */
async function linkChat(
  admin: SupabaseClient<Database>,
  codeValue: string,
  chat: string,
  username: string | null,
): Promise<{ ok: true; profile: ProfileRow } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("telegram_link_codes")
    .select("code, user_id, expires_at, used_at")
    .eq("code", codeValue)
    .maybeSingle<{ code: string; user_id: string; expires_at: string; used_at: string | null }>();

  if (error) return { ok: false, error: "Gagal memeriksa kode. Coba lagi." };
  if (!data) return { ok: false, error: "Kode tidak dikenal. Buat kode baru dari panel → Pengaturan." };
  if (data.used_at) return { ok: false, error: "Kode ini sudah dipakai. Buat kode baru dari panel." };
  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "Kode sudah kedaluwarsa. Buat kode baru dari panel." };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", data.user_id)
    .maybeSingle<ProfileRow>();
  if (!profile) return { ok: false, error: "Akun tidak ditemukan." };
  if (profile.is_active === false) return { ok: false, error: "Akun kamu dinonaktifkan." };

  // Satu chat hanya boleh tertaut ke satu akun.
  await admin.from("telegram_links").delete().eq("chat_id", chat);
  await admin.from("telegram_links").delete().eq("user_id", profile.id);

  const { error: insertError } = await admin.from("telegram_links").insert({
    user_id: profile.id,
    chat_id: chat,
    username,
    // Diisi eksplisit: Postgres punya DEFAULT NOW(), SQLite tidak.
    linked_at: new Date().toISOString(),
  });
  if (insertError) return { ok: false, error: "Gagal menyimpan tautan. Coba lagi." };

  await admin
    .from("telegram_link_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code", codeValue);

  await recordActivity(admin, {
    actorId: profile.id,
    actorUsername: profile.username,
    actorRole: profile.role,
    action: "telegram_link",
    targetType: "telegram",
    targetLabel: username ? `@${username}` : chat,
    detail: { chat_id: chat },
  });

  return { ok: true, profile };
}

/** Profil pemilik chat (kalau sudah tertaut). */
async function profileForChat(
  admin: SupabaseClient<Database>,
  chat: string,
): Promise<ProfileRow | null> {
  const { data: link } = await admin
    .from("telegram_links")
    .select("user_id")
    .eq("chat_id", chat)
    .maybeSingle<{ user_id: string }>();
  if (!link) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", link.user_id)
    .maybeSingle<ProfileRow>();

  if (!profile || profile.is_active === false) return null;
  return profile;
}
