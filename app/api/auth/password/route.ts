import type { NextRequest } from "next/server";

import { recordActivity } from "@/lib/api/activity";
import { withAuth } from "@/lib/api/auth";
import { changeOwnPassword } from "@/lib/api/accounts";
import { errorMessage, jsonError, jsonOk, readJsonBody } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BODY_MAX = 4 * 1024;

/**
 * POST /api/auth/password — ganti password akun sendiri.
 *
 * Body: `{ current_password, new_password, logout_others? }`
 * - `current_password` wajib & harus cocok (anti session-hijack).
 * - `new_password` minimal 8 karakter, maksimal 72 (batas aman scrypt).
 * - `logout_others` (default true) memutus semua sesi lain setelah password
 *   berubah, tapi sesi yang sedang dipakai tetap hidup.
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    const parsed = await readJsonBody(request, BODY_MAX);
    if (!parsed.ok) {
      return jsonError(
        parsed.tooLarge ? "Body request terlalu besar" : "Body request bukan JSON yang valid",
        "validation_error",
        parsed.tooLarge ? 413 : 400,
      );
    }

    const body = (parsed.value ?? {}) as Record<string, unknown>;
    const currentPassword = typeof body.current_password === "string" ? body.current_password : "";
    const newPassword = typeof body.new_password === "string" ? body.new_password : "";
    const logoutOthers = body.logout_others === undefined ? true : body.logout_others === true;

    if (!currentPassword || !newPassword) {
      return jsonError("Password lama dan password baru wajib diisi", "validation_error", 400);
    }
    if (newPassword.length < 8) {
      return jsonError("Password baru minimal 8 karakter", "validation_error", 400);
    }
    if (newPassword.length > 72) {
      // scrypt hanya memakai 72 byte pertama; lebih dari itu tidak menambah keamanan.
      return jsonError("Password baru maksimal 72 karakter", "validation_error", 400);
    }

    try {
      const result = await changeOwnPassword(ctx, {
        currentPassword,
        newPassword,
        logoutOthers,
      });

      if (!result.ok) {
        // Percobaan gagal (password lama salah) juga dicatat — indikasi session hijack.
        if (result.code === "unauthorized") {
          await recordActivity(ctx.admin, {
            actorId: ctx.userId,
            actorUsername: ctx.profile.username,
            actorRole: ctx.profile.role,
            action: "security",
            targetType: "account",
            targetLabel: ctx.profile.username,
            detail: { reason: "Password lama salah saat ganti password" },
          });
        }
        return jsonError(result.error, result.code, result.status);
      }

      await recordActivity(ctx.admin, {
        actorId: ctx.userId,
        actorUsername: ctx.profile.username,
        actorRole: ctx.profile.role,
        action: "password_change",
        targetType: "account",
        targetLabel: ctx.profile.username,
        detail: { logout_others: logoutOthers, other_sessions_revoked: result.data.revoked },
      });

      return jsonOk({
        updated: true,
        other_sessions_revoked: result.data.revoked,
      });
    } catch (error) {
      console.error("[auth/password] gagal:", error);
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
