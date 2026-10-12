import { randomInt } from "node:crypto";

import type { NextRequest } from "next/server";

import { recordActivity } from "@/lib/api/activity";
import { withAuth } from "@/lib/api/auth";
import { loadTelegram } from "@/lib/api/settings";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Masa berlaku kode tautan (menit). */
const CODE_TTL_MINUTES = 10;
/** Huruf tanpa karakter ambigu (0/O, 1/I/L) supaya mudah diketik ulang. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(length = 6): string {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Tautkan akun panel dengan chat Telegram (per akun, untuk notifikasi pribadi
 * dan perintah bot).
 *
 * GET    — status tautan + username bot (untuk menyusun deep link).
 * POST   — buat kode sekali pakai; kirim `/start <KODE>` ke bot dari chat kamu.
 * DELETE — lepas tautan chat.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    try {
      const telegram = await loadTelegram(ctx.admin);
      const { data } = await ctx.admin
        .from("telegram_links")
        .select("chat_id, username, linked_at")
        .eq("user_id", ctx.userId)
        .maybeSingle<{ chat_id: string; username: string | null; linked_at: string }>();

      return jsonOk({
        bot_username: telegram.botUsername,
        bot_ready: Boolean(telegram.botToken),
        linked: data
          ? {
              chat_id: data.chat_id,
              username: data.username,
              linked_at: data.linked_at,
            }
          : null,
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

export async function POST(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    try {
      const telegram = await loadTelegram(ctx.admin);
      if (!telegram.botToken) {
        return jsonError(
          "Bot Telegram panel belum dihubungkan oleh Owner",
          "validation_error",
          400,
        );
      }

      const code = generateCode();
      const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

      const { error } = await ctx.admin.from("telegram_link_codes").insert({
        code,
        user_id: ctx.userId,
        expires_at: expiresAt,
      });
      if (error) throw new Error(error.message);

      // Bersihkan kode kedaluwarsa milik user ini (tabel kecil, aman dilakukan).
      await ctx.admin
        .from("telegram_link_codes")
        .delete()
        .eq("user_id", ctx.userId)
        .lt("expires_at", new Date().toISOString());

      return jsonOk({
        code,
        expires_at: expiresAt,
        bot_username: telegram.botUsername,
        deep_link: telegram.botUsername
          ? `https://t.me/${telegram.botUsername}?start=${code}`
          : null,
        instruction: telegram.botUsername
          ? `Buka @${telegram.botUsername} lalu kirim: /start ${code}`
          : `Kirim perintah ini ke bot: /start ${code}`,
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

export async function DELETE(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    try {
      const { data } = await ctx.admin
        .from("telegram_links")
        .select("chat_id")
        .eq("user_id", ctx.userId)
        .maybeSingle<{ chat_id: string }>();

      const { error } = await ctx.admin.from("telegram_links").delete().eq("user_id", ctx.userId);
      if (error) throw new Error(error.message);

      if (data?.chat_id) {
        await recordActivity(ctx.admin, {
          actorId: ctx.userId,
          actorUsername: ctx.profile.username,
          actorRole: ctx.profile.role,
          action: "telegram_unlink",
          targetType: "telegram",
          targetLabel: ctx.profile.username,
          detail: { chat_id: data.chat_id },
        });
      }

      return jsonOk({ unlinked: true });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
