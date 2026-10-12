import type { NextRequest } from "next/server";

import { loadKeyWithAccess, withAuth } from "@/lib/api/auth";
import { getProfileUsername, recordAuditLog } from "@/lib/api/audit";
import { addCredit, recordCreditLog, spendCredit } from "@/lib/api/credit";
import { fetchDeviceCounts, getKeyDetail, refreshExpiredKeys } from "@/lib/api/keys";
import { notifyLowCredit } from "@/lib/api/low-credit";
import { loadRuntime } from "@/lib/api/settings";
import { LIMITS } from "@/lib/constants";
import type { DurationPresetRow, KeyRow } from "@/lib/types/database";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";
import { creditCostBreakdown, extendCreditCost } from "@/lib/utils/pricing";
import { isKeyRefundableOnDelete, refundAmount } from "@/lib/utils/refund";
import { asDateOnlyToIso, asInt, asIsoDate, asOptionalString, asString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { key, allowed, error } = await loadKeyWithAccess(ctx, route.params.id);
    if (!allowed) return error as Response;

    try {
      const detail = await getKeyDetail(ctx.admin, key.id);
      return jsonOk({ key: detail });
    } catch (err) {
      return jsonError(errorMessage(err), "server_error", 500);
    }
  });
}

interface EditBody {
  mode?: unknown;
  duration_preset_id?: unknown;
  add_days?: unknown;
  expired_at?: unknown;
  note?: unknown;
  max_device?: unknown;
}

export async function PUT(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { key, allowed, error } = await loadKeyWithAccess(ctx, route.params.id);
    if (!allowed) return error as Response;

    let body: EditBody;
    try {
      body = (await request.json()) as EditBody;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    const mode = typeof body.mode === "string" ? body.mode : "none";
    const updates: Partial<KeyRow> = {};
    const runtime = await loadRuntime(ctx.admin);

    if (body.note !== undefined) {
      const note = asOptionalString(body.note, LIMITS.noteMax);
      if (note === undefined) return jsonError("Note tidak valid", "validation_error", 400);
      updates.note = note;
    }

    if (body.max_device !== undefined) {
      const maxDevice = asInt(
        body.max_device,
        runtime.keys.maxDeviceMin,
        runtime.keys.maxDeviceMax,
      );
      if (maxDevice === null) {
        return jsonError(
          `Max device harus antara ${runtime.keys.maxDeviceMin} dan ${runtime.keys.maxDeviceMax}`,
          "validation_error",
          400,
        );
      }
      const counts = await fetchDeviceCounts(ctx.admin, [key.id]);
      const used = counts.get(key.id) ?? 0;
      if (maxDevice < used) {
        return jsonError(
          `Max device tidak boleh lebih kecil dari device terdaftar (${used})`,
          "validation_error",
          400,
        );
      }
      updates.max_device = maxDevice;
    }

    const requestedPresetId = asString(body.duration_preset_id, 64);
    const deviceIncreased = updates.max_device !== undefined && updates.max_device > key.max_device;

    if (!ctx.isOwner && (mode === "extend" || mode === "set" || mode === "lifetime")) {
      return jsonError(
        "Reseller hanya bisa memperpanjang pakai preset durasi yang sudah ada",
        "forbidden",
        403,
      );
    }
    if (!ctx.isOwner && deviceIncreased && mode !== "preset") {
      return jsonError(
        "Pilih preset durasi untuk menambah max device — device baru ikut dihitung biaya",
        "validation_error",
        400,
      );
    }

    let newExpiredAt: string | null | undefined;
    let usedPreset: DurationPresetRow | null = null;

    if (mode === "preset") {
      if (!requestedPresetId) {
        return jsonError("Preset durasi wajib dipilih", "validation_error", 400);
      }

      const { data: preset, error: presetError } = await ctx.admin
        .from("duration_presets")
        .select("*")
        .eq("id", requestedPresetId)
        .maybeSingle<DurationPresetRow>();

      if (presetError) return jsonError(errorMessage(presetError), "server_error", 500);
      if (!preset) return jsonError("Preset durasi tidak ditemukan", "not_found", 404);
      if (!preset.is_active) {
        return jsonError("Preset durasi sedang nonaktif", "validation_error", 400);
      }

      usedPreset = preset;

      const baseMs = key.expired_at ? new Date(key.expired_at).getTime() : Date.now();
      const base = Number.isFinite(baseMs) ? Math.max(baseMs, Date.now()) : Date.now();
      newExpiredAt = new Date(base + preset.days * 86_400_000).toISOString();
      updates.duration_days = (key.duration_days ?? 0) + preset.days;
    } else if (mode === "extend") {
      const addDays = asInt(body.add_days, 1, 3650);
      if (addDays === null) {
        return jsonError("Jumlah hari harus antara 1 dan 3650", "validation_error", 400);
      }
      const baseMs = key.expired_at ? new Date(key.expired_at).getTime() : Date.now();
      const base = Number.isFinite(baseMs) ? Math.max(baseMs, Date.now()) : Date.now();
      newExpiredAt = new Date(base + addDays * 86_400_000).toISOString();
      updates.duration_days = (key.duration_days ?? 0) + addDays;
    } else if (mode === "set") {
      const rawExpired = typeof body.expired_at === "string" ? body.expired_at.trim() : "";
      const parsed = /^\d{4}-\d{2}-\d{2}$/.test(rawExpired)
        ? asDateOnlyToIso(rawExpired)
        : asIsoDate(body.expired_at);
      if (!parsed) {
        return jsonError("Tanggal expired baru tidak valid", "validation_error", 400);
      }
      newExpiredAt = parsed;
      const createdMs = new Date(key.created_at).getTime();
      const days = Math.max(0, Math.ceil((new Date(parsed).getTime() - createdMs) / 86_400_000));
      updates.duration_days = days;
    } else if (mode === "lifetime") {
      newExpiredAt = null;
      updates.duration_days = null;
    }

    if (newExpiredAt !== undefined) {
      updates.expired_at = newExpiredAt;
      if (key.status !== "banned") {
        const isFuture = newExpiredAt === null || new Date(newExpiredAt).getTime() > Date.now();
        updates.status = isFuture ? "active" : "expired";
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("Tidak ada perubahan yang dikirim", "validation_error", 400);
    }

    const effectiveMaxDevice = updates.max_device ?? key.max_device;
    const unitPrice = usedPreset?.credit_cost ?? 0;
    const cost = !ctx.isOwner ? extendCreditCost(unitPrice, effectiveMaxDevice) : 0;
    const breakdown = creditCostBreakdown(unitPrice, 1, effectiveMaxDevice, "key");
    const balanceBefore = ctx.profile.credit ?? 0;

    if (cost > 0 && balanceBefore < cost) {
      return jsonError(
        `Credit tidak cukup (sisa ${balanceBefore}, butuh ${cost}) — ${breakdown}`,
        "insufficient_credit",
        402,
        {
          credit_needed: cost,
          credit_balance: balanceBefore,
          unit_price: unitPrice,
          max_device: effectiveMaxDevice,
        },
      );
    }

    const { error: updateError } = await ctx.admin.from("keys").update(updates).eq("id", key.id);
    if (updateError) return jsonError(updateError.message, "server_error", 500);

    let balanceAfter = balanceBefore;
    if (cost > 0) {
      balanceAfter = await spendCredit(ctx.admin, ctx.userId, cost);
      if (balanceAfter < 0) {
        const revert: Partial<KeyRow> = {};
        for (const field of Object.keys(updates) as (keyof KeyRow)[]) {
          revert[field] = key[field] as never;
        }
        await ctx.admin.from("keys").update(revert).eq("id", key.id);

        return jsonError(
          `Credit tidak cukup (sisa ${balanceBefore}, butuh ${cost}) — ${breakdown}`,
          "insufficient_credit",
          402,
          {
            credit_needed: cost,
            credit_balance: balanceBefore,
            unit_price: unitPrice,
            max_device: effectiveMaxDevice,
          },
        );
      }

      await ctx.admin
        .from("keys")
        .update({ credit_cost: (Number(key.credit_cost) || 0) + cost })
        .eq("id", key.id);

      await recordCreditLog(ctx.admin, {
        userId: ctx.userId,
        action: "extend",
        amount: -cost,
        balanceAfter,
        note: `Perpanjang ${usedPreset?.name ?? "preset"} / ${key.key_value} / ${effectiveMaxDevice} device`,
        createdBy: ctx.userId,
      });

      notifyLowCredit(ctx.admin, {
        userId: ctx.userId,
        username: ctx.profile.username,
        balanceBefore,
        balanceAfter,
        reason: `perpanjang ${key.key_value} (${usedPreset?.name ?? "preset"})`,
        runtime,
      });
    }

    await refreshExpiredKeys(ctx.admin);
    const detail = await getKeyDetail(ctx.admin, key.id);
    return jsonOk({
      key: detail,
      credit: {
        cost,
        unit_price: unitPrice,
        max_device: effectiveMaxDevice,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
      },
    });
  });
}

export async function DELETE(request: NextRequest, route: RouteParams) {
  return withAuth(request, async (ctx) => {
    const { key, allowed, error } = await loadKeyWithAccess(ctx, route.params.id);
    if (!allowed) return error as Response;

    const refundable = isKeyRefundableOnDelete(key, {
      userId: ctx.userId,
      isOwner: ctx.isOwner,
    });
    const refundAmountValue = refundable ? refundAmount(key) : 0;
    const keyOwnerUsername = await getProfileUsername(ctx.admin, key.created_by);

    const { data: removedDevices, error: deviceError } = await ctx.admin
      .from("device_logs")
      .delete()
      .eq("key_id", key.id)
      .select("id");
    if (deviceError) return jsonError(deviceError.message, "server_error", 500);

    const { error: deleteError } = await ctx.admin.from("keys").delete().eq("id", key.id);
    if (deleteError) return jsonError(deleteError.message, "server_error", 500);

    let refundResult: {
      amount: number;
      user_id: string;
      username: string | null;
      balance_after: number | null;
      error?: string;
    } | null = null;

    if (refundAmountValue > 0) {
      try {
        const balanceAfter = await addCredit(ctx.admin, key.created_by, refundAmountValue);

        await recordCreditLog(ctx.admin, {
          userId: key.created_by,
          action: "refund",
          amount: refundAmountValue,
          balanceAfter,
          note: `Pengembalian credit: ${key.key_value} dihapus Owner (status aktif, belum expired)`,
          createdBy: ctx.userId,
        });

        refundResult = {
          amount: refundAmountValue,
          user_id: key.created_by,
          username: keyOwnerUsername,
          balance_after: balanceAfter,
        };
      } catch (refundError) {
        console.error("[keys/delete] pengembalian credit gagal:", refundError);
        refundResult = {
          amount: refundAmountValue,
          user_id: key.created_by,
          username: keyOwnerUsername,
          balance_after: null,
          error: errorMessage(refundError),
        };
      }
    }

    await recordAuditLog(ctx.admin, {
      actorId: ctx.userId,
      actorUsername: ctx.profile.username,
      actorRole: ctx.role,
      action: "key_delete",
      keyId: null,
      keyValue: key.key_value,
      keyOwnerId: key.created_by,
      keyOwnerUsername,
      banReason: key.ban_reason,
      note: key.ban_note,
      detail: {
        status: key.status,
        expired_at: key.expired_at,
        duration_days: key.duration_days,
        max_device: key.max_device,
        tool_type_id: key.tool_type_id,
        tool_version_id: key.tool_version_id,
        devices_removed: (removedDevices ?? []).length,
        refund: refundResult,
      },
    });

    return jsonOk({ deleted: true, key_value: key.key_value, refund: refundResult });
  });
}
