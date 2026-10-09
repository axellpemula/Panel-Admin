import type { NextRequest } from "next/server";

import { loadKeyWithAccess, withAuth } from "@/lib/api/auth";
import { getProfileUsername, recordAuditLog } from "@/lib/api/audit";
import { getKeyDetail } from "@/lib/api/keys";
import { jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

/**
 * PUT /api/keys/[id]/unban
 * Status kembali `active` kalau belum lewat expired, atau `expired` kalau sudah lewat.
 *
 * Pembatasan: unban untuk key yang kena **auto-ban** (`ban_reason = 'auto_hwid'`)
 * hanya bisa oleh Owner — reseller tidak bisa membuka sendiri ban otomatis sistem.
 *
 * Setiap unban dicatat ke `audit_logs` (siapa, kapan, alasan ban sebelumnya).
 */
export async function PUT(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { key, allowed, error } = await loadKeyWithAccess(ctx, route.params.id);
    if (!allowed) return error as Response;

    if (key.ban_reason === "auto_hwid" && !ctx.isOwner) {
      return jsonError(
        "Key ini kena auto-ban (terlalu banyak HWID berbeda). Unban auto-ban hanya bisa oleh Owner — hubungi Owner.",
        "forbidden",
        403,
      );
    }

    const isExpired = key.expired_at !== null && new Date(key.expired_at).getTime() <= Date.now();
    const nextStatus = isExpired ? "expired" : "active";

    const previousStatus = key.status;
    const previousBanReason = key.ban_reason;
    const previousBanNote = key.ban_note;

    const { error: updateError } = await ctx.admin
      .from("keys")
      .update({
        status: nextStatus,
        // Metadata ban dikosongkan — tapi jejaknya tetap ada di audit_logs.
        ban_reason: null,
        ban_note: null,
        banned_by: null,
        banned_at: null,
      })
      .eq("id", key.id);

    if (updateError) return jsonError(updateError.message, "server_error", 500);

    // Jejak audit: siapa yang unban + alasan ban sebelumnya (penting saat sengketa).
    const keyOwnerUsername = await getProfileUsername(ctx.admin, key.created_by);
    await recordAuditLog(ctx.admin, {
      actorId: ctx.userId,
      actorUsername: ctx.profile.username,
      actorRole: ctx.role,
      action: "key_unban",
      keyId: key.id,
      keyValue: key.key_value,
      keyOwnerId: key.created_by,
      keyOwnerUsername,
      banReason: previousBanReason,
      note: previousBanNote,
      detail: {
        previous_status: previousStatus,
        previous_ban_reason: previousBanReason,
        new_status: nextStatus,
      },
    });

    const detail = await getKeyDetail(ctx.admin, key.id);
    return jsonOk({ key: detail });
  });
}
