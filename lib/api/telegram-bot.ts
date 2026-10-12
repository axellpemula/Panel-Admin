import type { SupabaseClient } from "@supabase/supabase-js";

import { recordActivity } from "@/lib/api/activity";
import { listKeys } from "@/lib/api/keys";
import { GenerateError, generateKeys } from "@/lib/api/generate";
import { listKeyDevices, resetKeyDevices } from "@/lib/api/device-reset";
import type { HwidResetLimits } from "@/lib/api/hwid-reset";
import { loadRuntime, loadTelegram } from "@/lib/api/settings";
import type { Database, KeyRow, ProfileRow } from "@/lib/types/database";
import { formatNumber } from "@/lib/utils/format";
import { sendTelegramMessage } from "@/lib/utils/telegram";

/**
 * Perintah bot Telegram reseller (#15).
 *
 * Alur: pengguna menautkan chat lewat kode dari Pengaturan (`/start <KODE>`),
 * setelah itu bot melayani:
 *
 * | Perintah                              | Fungsi                                  |
 * | ------------------------------------- | --------------------------------------- |
 * | `/help`                               | daftar perintah                         |
 * | `/saldo`                              | sisa credit + ringkasan key             |
 * | `/preset`                             | daftar preset durasi (nomor + harga)     |
 * | `/keys [status]`                       | 5 key terbaru (status: active/expired/banned) |
 * | `/key XLVP-XXXX-XXXX`                  | detail key + daftar device              |
 * | `/generate <preset> [qty] [device]`    | generate key (harga = preset × qty × device) |
 * | `/reset <KEY> [n\|all]`                | reset HWID (kuota cooldown reseller berlaku) |
 * | `/unlink`                              | lepas tautan chat                       |
 *
 * Bot memakai library yang sama dengan panel (`generateKeys`, `resetKeyDevices`),
 * jadi harga, validasi, kuota, audit, dan notifikasinya konsisten.
 */

/** Batas perintah per chat per menit (anti loop/miskin). */
const CHAT_RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

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
}

const HELP_TEXT = [
  "Perintah yang tersedia:",
  "/saldo — sisa credit & ringkasan key",
  "/preset — daftar preset durasi",
  "/keys [active|expired|banned] — 5 key terbaru",
  "/key XLVP-XXXX-XXXX — detail key + device",
  "/generate <preset> [qty] [device] — buat key baru",
  "/reset XLVP-XXXX-XXXX <all|nomor device> — reset HWID",
  "/unlink — lepas tautan chat ini",
  "",
  "Contoh: /generate 2 3 2",
].join("\n");

/** Tambahkan kutipan key di dalam teks supaya mudah di-copy. */
function code(value: string): string {
  return `\`${value}\``;
}

export async function handleTelegramUpdate(
  admin: SupabaseClient<Database>,
  update: TelegramUpdate,
): Promise<void> {
  const message = update.message;
  const chatId = message?.chat?.id;
  const text = (message?.text ?? "").trim();
  if (chatId === undefined || chatId === null || text.length === 0) return;

  const telegram = await loadTelegram(admin);
  if (!telegram.botToken) return;

  const chat = String(chatId);
  const reply = async (body: string) => {
    const result = await sendTelegramMessage(telegram.botToken as string, chat, body, {
      timeoutMs: 8_000,
    });
    if (!result.ok) console.warn("[telegram-bot] gagal membalas:", result.error);
  };

  if (rateLimited(chat)) {
    await reply("Terlalu banyak perintah. Coba lagi sebentar lagi.");
    return;
  }

  const [rawCommand, ...args] = text.split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@.*$/, "");

  // ---------- /start <kode> : penautan chat ----------
  if (command === "/start") {
    const candidate = (args[0] ?? "").toUpperCase();
    if (!candidate) {
      await reply(
        [
          "Halo! Bot ini milik XLOOP PANEL.",
          "",
          "Untuk menautkan akun: buka panel → Pengaturan → Telegram → Tautkan, lalu kirim",
          `/start <KODE> ke chat ini.`,
          "",
          HELP_TEXT,
        ].join("\n"),
      );
      return;
    }

    const linked = await linkChat(admin, candidate, chat, message?.from?.username ?? null);

    if (!linked.ok) {
      await reply(linked.error);
      return;
    }

    await reply(
      [
        `Berhasil! Chat ini tertaut ke akun ${linked.profile.username} (${linked.profile.role}).`,
        "",
        "Kamu akan menerima notifikasi penting di sini. Ketik /help untuk daftar perintah.",
      ].join("\n"),
    );
    return;
  }

  // ---------- Semua perintah lain butuh tautan ----------
  const profile = await profileForChat(admin, chat);
  if (!profile) {
    await reply(
      "Chat ini belum tertaut ke akun panel. Buka panel → Pengaturan → Telegram → Tautkan akun, lalu kirim kode `/start <KODE>` ke bot ini.",
    );
    return;
  }

  try {
    switch (command) {
      case "/help":
      case "/bantuan":
        await reply(HELP_TEXT);
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
        await reply("Tautan chat ini sudah dilepas. Notifikasi tidak akan dikirim ke sini lagi.");
        return;
      }

      case "/saldo":
      case "/credit": {
        const perPage = 1;
        const [active, expired, banned] = await Promise.all([
          listKeys(admin, { userId: profile.id, status: "active", perPage }),
          listKeys(admin, { userId: profile.id, status: "expired", perPage }),
          listKeys(admin, { userId: profile.id, status: "banned", perPage }),
        ]);

        const isOwner = profile.role === "owner";
        await reply(
          [
            `Akun: ${profile.username} (${isOwner ? "Owner" : "Reseller"})`,
            `Sisa credit: ${formatNumber(profile.credit)}`,
            "",
            `Key aktif: ${formatNumber(active.total)}`,
            `Expired: ${formatNumber(expired.total)}`,
            `Banned: ${formatNumber(banned.total)}`,
            "",
            isOwner ? "Owner tidak dipotong credit saat generate." : "Harga 1 unit = 1 key × 1 device.",
          ].join("\n"),
        );
        return;
      }

      case "/preset":
      case "/presets": {
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
          await reply("Belum ada preset durasi aktif.");
          return;
        }

        const lines = presets.map((preset, index) => {
          const duration =
            preset.days === null || preset.days === 0 ? "lifetime" : `${preset.days} hari`;
          return `${index + 1}. ${preset.name} (${duration}) — ${formatNumber(preset.credit_cost)} credit/device`;
        });

        await reply(["Preset durasi aktif:", "", ...lines, "", "Pakai nomornya: /generate 1 2 1"].join("\n"));
        return;
      }

      case "/keys":
      case "/key": {
        const keyArg = args.find((arg) => /^xlvp-/i.test(arg));
        if (!keyArg) {
          const statusFilter = args[0]?.toLowerCase();
          const status = ["active", "expired", "banned"].includes(statusFilter)
            ? statusFilter
            : undefined;
          const result = await listKeys(admin, { userId: profile.id, status, perPage: 5 });
          if (result.items.length === 0) {
            await reply("Belum ada key pada filter itu.");
            return;
          }
          await reply(
            [
              `5 key terbaru${status ? ` (${status})` : ""}:`,
              "",
              ...result.items.map(
                (item) =>
                  `${item.key_value} · ${item.tool_name}${item.version_name ? ` ${item.version_name}` : ""} · ${item.status} · ${item.devices_used}/${item.max_device} device`,
              ),
              "",
              "Detail satu key: /key XLVP-XXXX-XXXX",
            ].join("\n"),
          );
          return;
        }

        const search = await listKeys(admin, { userId: profile.id, search: keyArg, perPage: 5 });
        const found = search.items.find(
          (item) => item.key_value.toUpperCase() === keyArg.toUpperCase(),
        );
        if (!found) {
          await reply(`Key ${keyArg.toUpperCase()} tidak ditemukan di akun ini.`);
          return;
        }

        const devices = await listKeyDevices(admin, found.id);

        await reply(
          [
            `Key: ${found.key_value}`,
            `Status: ${found.status}`,
            `Tool: ${found.tool_name}${found.version_name ? ` ${found.version_name}` : ""}`,
            `Device: ${devices.length}/${found.max_device}`,
            found.expired_at ? `Expired: ${found.expired_at.slice(0, 10)}` : "Expired: lifetime",
            found.status === "banned" ? "Key sedang diblokir (banned)." : "",
            "",
            devices.length > 0
              ? [
                  "Device terdaftar:",
                  ...devices.map(
                    (device, index) => `${index + 1}. ${device.hardware_id}`,
                  ),
                  "",
                  "Reset: /reset " + found.key_value + " all",
                ].join("\n")
              : "Belum ada device terdaftar.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        return;
      }

      case "/generate": {
        const presetNumber = Number.parseInt(args[0] ?? "", 10);
        const quantity = args[1] ? Number.parseInt(args[1], 10) : 1;
        const maxDevice = args[2] ? Number.parseInt(args[2], 10) : 1;

        if (!Number.isFinite(presetNumber) || presetNumber < 1) {
          await reply("Format: /generate <nomor preset> [jumlah key] [jumlah device]\nLihat nomor preset dengan /preset.");
          return;
        }

        const { data: presetRows, error } = await admin
          .from("duration_presets")
          .select("id, name, days, credit_cost, is_active")
          .eq("is_active", true)
          .order("days", { ascending: true });
        if (error) throw new Error(error.message);

        const presets = (presetRows ?? []) as {
          id: string;
          name: string;
          days: number | null;
          credit_cost: number;
        }[];
        const preset = presets[presetNumber - 1];
        if (!preset) {
          await reply(`Preset nomor ${presetNumber} tidak ada. Kirim /preset untuk daftarnya.`);
          return;
        }

        const { data: toolRows, error: toolError } = await admin
          .from("tool_types")
          .select("id, name, is_active")
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1);
        if (toolError) throw new Error(toolError.message);

        const tool = ((toolRows ?? []) as { id: string; name: string }[])[0];
        if (!tool) {
          await reply("Belum ada tool aktif. Hubungi Owner.");
          return;
        }

        const { data: versionRows, error: versionError } = await admin
          .from("tool_versions")
          .select("id, name, is_active")
          .eq("tool_type_id", tool.id)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1);
        if (versionError) throw new Error(versionError.message);

        const version = ((versionRows ?? []) as { id: string; name: string }[])[0];
        if (!version) {
          await reply(`Tool ${tool.name} belum punya version aktif. Hubungi Owner.`);
          return;
        }

        const result = await generateKeys(
          { admin, userId: profile.id, profile, isOwner: profile.role === "owner" },
          {
            toolTypeId: tool.id,
            toolVersionId: version.id,
            durationMode: "preset",
            durationPresetId: preset.id,
            maxDevice: Number.isFinite(maxDevice) && maxDevice > 0 ? maxDevice : 1,
            quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
            note: "Digenerate lewat bot Telegram",
          },
        );

        await reply(
          [
            `${result.keys.length} key dibuat ✓`,
            "",
            ...result.keys.map((item) => code(item.key_value)),
            "",
            `${result.summary.tool_name} ${result.summary.version_name} · ${result.summary.duration_label}`,
            `${result.keys.length} × ${result.summary.max_device} device`,
            `Biaya: ${formatNumber(result.summary.credit_cost)} credit`,
            `Sisa credit: ${formatNumber(result.summary.credit_balance_after)}`,
          ].join("\n"),
        );
        return;
      }

      case "/reset": {
        const [keyArg, targetArg] = [args[0], args[1]];
        if (!keyArg) {
          await reply("Format: /reset XLVP-XXXX-XXXX <all|nomor device>");
          return;
        }

        const search = await listKeys(admin, { userId: profile.id, search: keyArg, perPage: 5 });
        const found = search.items.find(
          (item) => item.key_value.toUpperCase() === keyArg.toUpperCase(),
        );
        if (!found) {
          await reply(`Key ${keyArg.toUpperCase()} tidak ditemukan di akun ini.`);
          return;
        }

        const runtime = await loadRuntime(admin);
        const limits: HwidResetLimits = {
          limit: runtime.hwid.resetLimit,
          windowHours: runtime.hwid.resetWindowHours,
        };

        let hardwareId: string | null = null;
        const devices = await listKeyDevices(admin, found.id);

        if (targetArg && targetArg.toLowerCase() !== "all") {
          const index = Number.parseInt(targetArg, 10);
          if (!Number.isFinite(index) || index < 1 || index > devices.length) {
            await reply(
              [
                `Nomor device tidak valid. Key ini punya ${devices.length} device:`,
                ...devices.map((device, position) => `${position + 1}. ${device.hardware_id}`),
                "",
                "Gunakan /reset " + found.key_value + " all untuk reset semua.",
              ].join("\n"),
            );
            return;
          }
          hardwareId = devices[index - 1].hardware_id;
        }

        const { data: keyRow, error: keyError } = await admin
          .from("keys")
          .select("*")
          .eq("id", found.id)
          .maybeSingle<KeyRow>();
        if (keyError || !keyRow) {
          await reply("Gagal membaca data key. Coba lagi.");
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
          await reply(`Gagal reset: ${result.error}`);
          return;
        }

        await reply(
          [
            `Reset berhasil ✓ (${result.removed} device dihapus)`,
            "",
            `Key: ${found.key_value}`,
            result.cooldown && typeof result.cooldown.remaining === "number"
              ? `Kuota reset tersisa: ${Math.max(0, result.cooldown.remaining)}× per ${limits.windowHours} jam`
              : "Owner bebas kuota reset.",
          ].join("\n"),
        );
        return;
      }

      default:
        await reply(HELP_TEXT);
    }
  } catch (error) {
    if (error instanceof GenerateError) {
      await reply(`Gagal: ${error.message}`);
      return;
    }
    console.error("[telegram-bot] perintah gagal:", (error as Error)?.message ?? error);
    await reply("Terjadi kesalahan saat memproses perintah. Coba lagi sebentar lagi.");
  }
}

/** Tautkan chat dengan kode sekali pakai. */
async function linkChat(
  admin: SupabaseClient<Database>,
  code: string,
  chat: string,
  username: string | null,
): Promise<{ ok: true; profile: ProfileRow } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("telegram_link_codes")
    .select("code, user_id, expires_at, used_at")
    .eq("code", code)
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
    .eq("code", code);

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
