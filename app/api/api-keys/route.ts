import type { NextRequest } from "next/server";

import { recordActivity } from "@/lib/api/activity";
import { createApiKey, listApiKeys } from "@/lib/api/api-keys";
import { isUuid, withAuth } from "@/lib/api/auth";
import { loadRuntime } from "@/lib/api/settings";
import { errorMessage, jsonError, jsonOk, readJsonBody } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BODY_MAX = 4 * 1024;
const MAX_ACTIVE_KEYS = 5;

export async function GET(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    const requested = request.nextUrl.searchParams.get("user_id");

    let userId = ctx.userId;
    if (requested && requested !== ctx.userId) {
      if (!ctx.isOwner) {
        return jsonError("Hanya Owner yang bisa melihat API key akun lain", "forbidden", 403);
      }
      if (!isUuid(requested)) {
        return jsonError("user_id tidak valid", "validation_error", 400);
      }
      userId = requested;
    }

    try {
      const items = await listApiKeys(ctx.admin, { userId });
      return jsonOk({ items, max_active: MAX_ACTIVE_KEYS });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

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
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (name.length < 3) {
      return jsonError("Nama API key wajib diisi minimal 3 karakter", "validation_error", 400);
    }

    let targetUserId = ctx.userId;
    const requestedUser = typeof body.user_id === "string" ? body.user_id : "";
    if (requestedUser && requestedUser !== ctx.userId) {
      if (!ctx.isOwner) {
        return jsonError("Hanya Owner yang bisa membuat API key untuk akun lain", "forbidden", 403);
      }
      if (!isUuid(requestedUser)) {
        return jsonError("user_id tidak valid", "validation_error", 400);
      }
      const { data: target } = await ctx.admin
        .from("profiles")
        .select("id, role, username, is_active")
        .eq("id", requestedUser)
        .maybeSingle<{ id: string; role: string; username: string; is_active: boolean }>();
      if (!target) return jsonError("Akun tujuan tidak ditemukan", "not_found", 404);
      if (target.role !== "reseller") {
        return jsonError("API key hanya untuk akun reseller", "validation_error", 400);
      }
      targetUserId = target.id;
    }

    try {
      const runtime = await loadRuntime(ctx.admin);
      const existing = await listApiKeys(ctx.admin, { userId: targetUserId, activeOnly: true });
      if (existing.length >= MAX_ACTIVE_KEYS) {
        return jsonError(
          `Maksimal ${MAX_ACTIVE_KEYS} API key aktif per akun. Cabut salah satu dulu.`,
          "conflict",
          409,
        );
      }

      const created = await createApiKey(ctx.admin, {
        userId: targetUserId,
        name,
        createdBy: ctx.userId,
      });

      await recordActivity(ctx.admin, {
        actorId: ctx.userId,
        actorUsername: ctx.profile.username,
        actorRole: ctx.profile.role,
        action: "api_key_create",
        targetType: "api_key",
        targetId: created.apiKey.id,
        targetLabel: created.apiKey.name,
        detail: {
          user_id: targetUserId,
          token_prefix: created.apiKey.token_prefix,
          api_rate_limit_per_minute: runtime.api.rateLimitPerMinute,
        },
      });

      return jsonOk({
        api_key: created.apiKey,
        token: created.token,
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
