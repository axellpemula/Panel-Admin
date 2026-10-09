import type { NextRequest } from "next/server";

import { loadKeyWithAccess, withAuth } from "@/lib/api/auth";
import { getProfileUsername, recordAuditLog } from "@/lib/api/audit";
import { getKeyDetail } from "@/lib/api/keys";
import { LIMITS, MANUAL_BAN_REASONS } from "@/lib/constants";
import type { BanReason } from "@/lib/types/database";
import { jsonError, jsonOk } from "@/lib/utils/http";
import { asOptionalString, asString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

interface BanBody {
  reason?: unknown;
  note?: unknown;
}

/**
 * PUT /api/keys/[id]/ban
 * Status jadi `banned` — key tidak bisa dipakai walau belum expired.
 *
 * Body (opsional): { reason: "manual" | "refund" | "other", note?: string }
 * - `reason` terstruktur untuk audit & sengketa; default "manual".
 * - `auto_hwid` khusus auto-ban sistem (/api/validate) dan tidak bisa dipilih manual.
 *
 * Setiap ban dicatat ke `audit_logs` (siapa, kapan, alasan, catatan).
 */
export async function PUT(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { key, allowed, error } = await loadKeyWithAccess(ctx, route.params.id);
    if (!allowed) return error as Response;

    let body: BanBody = {};
    try {
      body = (await request.json()) as BanBody;
    } catch {
      // Body kosong/tidak valid → tetap boleh ban dengan alasan default.
      body = {};
    }

    const rawReason = asString(body.reason, 16);
    if (rawReason === "auto_hwid") {
      return jsonError(
        "Alasan auto_hwid hanya untuk auto-ban sistem",
        "validation_error",
        400,
      );
    }
    type ManualBanReason = (typeof MANUAL_BAN_REASONS)[number];
    if (rawReason !== null && !MANUAL_BAN_REASONS.includes(rawReason as ManualBanReason)) {
      return jsonError(
        "Alasan ban tidak valid (manual, refund, atau other)",
        "validation_error",
        400,
      );
    }
    const reason: BanReason = (rawReason as ManualBanReason | null) ?? "manual";

    // Catatan opsional — hanya divalidasi kalau memang dikirim.
    let note: string | null = null;
    if (body.note !== undefined) {
      const parsedNote = asOptionalString(body.note, LIMITS.noteMax);
      if (parsedNote === undefined) return jsonError("Note tidak valid", "validation_error", 400);
      note = parsedNote;
    }

    const previousStatus = key.status;

    const { error: updateError } = await ctx.admin
      .from("keys")
      .update({
        status: "banned",
        ban_reason: reason,
        ban_note: note,
        banned_by: ctx.userId,
        banned_at: new Date().toISOString(),
      })
      .eq("id", key.id);

    if (updateError) return jsonError(updateError.message, "server_error", 500);

    // Jejak audit: siapa yang ban + alasan terstrukturnya.
    const keyOwnerUsername = await getProfileUsername(ctx.admin, key.created_by);
    await recordAuditLog(ctx.admin, {
      actorId: ctx.userId,
      actorUsername: ctx.profile.username,
      actorRole: ctx.role,
      action: "key_ban",
      keyId: key.id,
      keyValue: key.key_value,
      keyOwnerId: key.created_by,
      keyOwnerUsername,
      banReason: reason,
      note,
      detail: { previous_status: previousStatus },
    });

    const detail = await getKeyDetail(ctx.admin, key.id);
    return jsonOk({ key: detail });
  });
}
