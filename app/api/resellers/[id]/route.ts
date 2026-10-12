import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { recordActivity } from "@/lib/api/activity";
import { isUuid, withOwner } from "@/lib/api/auth";
import { addCredit, spendCredit } from "@/lib/api/credit";
import { notifyLowCredit } from "@/lib/api/low-credit";
import { loadRuntime } from "@/lib/api/settings";
import { recentActivity, resellerStats, resellerSummary } from "@/lib/api/stats";
import type { ProfileRow } from "@/lib/types/database";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";
import {
  asBool,
  asEmail,
  asInt,
  asOptionalString,
  asPassword,
  asSignedInt,
  asString,
} from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

async function loadReseller(
  ctx: { admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient> },
  id: string,
): Promise<{ profile: ProfileRow | null; error?: NextResponse }> {
  const { data, error } = await ctx.admin
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle<ProfileRow>();

  if (error) return { profile: null, error: jsonError(errorMessage(error), "server_error", 500) };
  if (!data) return { profile: null, error: jsonError("Reseller tidak ditemukan", "not_found", 404) };
  if (data.role !== "reseller") {
    return { profile: data, error: jsonError("Akun ini bukan reseller", "validation_error", 400) };
  }
  return { profile: data };
}

export async function GET(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID reseller tidak valid", "validation_error", 400);

    const { profile, error } = await loadReseller(ctx, id);
    if (error) return error;
    if (!profile) return jsonError("Reseller tidak ditemukan", "not_found", 404);

    const historyRaw = Number(request.nextUrl.searchParams.get("history_limit") ?? 25);
    const historyLimit = Number.isFinite(historyRaw) ? Math.min(200, Math.max(1, historyRaw)) : 25;

    const [summary, activity, stats] = await Promise.all([
      resellerSummary(ctx.admin),
      recentActivity(ctx.admin, { userId: id, limit: historyLimit }),
      resellerStats(ctx.admin, id),
    ]);

    const row = summary.find((item) => item.id === id) ?? {
      id,
      username: profile!.username,
      email: profile!.email,
      credit: profile!.credit,
      is_active: profile!.is_active,
      key_count: 0,
    };

    return jsonOk({
      reseller: row,
      created_at: profile!.created_at,
      history: activity,
      totals: stats.totals,
      chart: stats.chart,
    });
  });
}

export async function PUT(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID reseller tidak valid", "validation_error", 400);

    const { profile, error } = await loadReseller(ctx, id);
    if (error) return error;
    if (!profile) return jsonError("Reseller tidak ditemukan", "not_found", 404);

    let body: {
      action?: unknown;
      amount?: unknown;
      note?: unknown;
      reason?: unknown;
      is_active?: unknown;
      password?: unknown;
      username?: unknown;
      email?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    const action = asString(body.action, 32);
    if (!action) return jsonError("Action wajib diisi", "validation_error", 400);

    if (action === "topup") {
      const amount = asInt(body.amount, 1, 1_000_000);
      if (amount === null) return jsonError("Jumlah credit tidak valid", "validation_error", 400);

      const note = asOptionalString(body.note, 500) ?? `Topup oleh ${ctx.profile.username}`;

      let balance: number;
      try {
        balance = await addCredit(ctx.admin, id, amount);
      } catch (err) {
        return jsonError(errorMessage(err), "server_error", 500);
      }

      const { error: logError } = await ctx.admin.from("credit_logs").insert({
        user_id: id,
        action: "topup",
        amount,
        balance_after: balance,
        note,
        created_by: ctx.userId,
      });

      if (logError) console.warn("[resellers] credit_logs gagal:", logError.message);

      await recordActivity(ctx.admin, {
        actorId: ctx.userId,
        actorUsername: ctx.profile.username,
        actorRole: ctx.profile.role,
        action: "credit_topup",
        targetType: "reseller",
        targetId: id,
        targetLabel: profile.username,
        detail: { amount, balance_after: balance, note },
      });

      notifyLowCredit(ctx.admin, {
        userId: id,
        username: profile.username,
        balanceBefore: profile.credit,
        balanceAfter: balance,
        reason: `topup oleh ${ctx.profile.username}`,
        runtime: await loadRuntime(ctx.admin),
      });

      return jsonOk({ reseller: { ...(profile as ProfileRow), credit: balance }, balance });
    }

    if (action === "adjust_credit") {
      const amount = asSignedInt(body.amount, 1_000_000);
      if (amount === null || amount === 0) {
        return jsonError("Jumlah penyesuaian tidak valid (angka, tidak boleh 0)", "validation_error", 400);
      }

      const reason = (asOptionalString(body.reason, 200) ?? "").trim();
      if (reason.length < 3) {
        return jsonError("Alasan penyesuaian wajib diisi (minimal 3 karakter)", "validation_error", 400);
      }
      const extraNote = asOptionalString(body.note, 300);

      const before = Number(profile.credit) || 0;

      if (amount < 0 && before + amount < 0) {
        return jsonError(
          `Saldo reseller tidak cukup: saldo sekarang ${before}, pengurangan ${Math.abs(amount)}.`,
          "conflict",
          409,
        );
      }

      let balance: number;
      try {
        balance =
          amount > 0
            ? await addCredit(ctx.admin, id, amount)
            : await spendCredit(ctx.admin, id, Math.abs(amount));
      } catch (err) {
        return jsonError(errorMessage(err), "server_error", 500);
      }

      if (balance < 0) {
        return jsonError("Gagal menyesuaikan credit (saldo tidak cukup / gagal simpan)", "conflict", 409);
      }

      const note = extraNote
        ? `${reason} — ${extraNote} (oleh ${ctx.profile.username})`
        : `${reason} (oleh ${ctx.profile.username})`;

      const { error: logError } = await ctx.admin.from("credit_logs").insert({
        user_id: id,
        action: "adjustment",
        amount,
        balance_after: balance,
        note,
        created_by: ctx.userId,
      });
      if (logError) console.warn("[resellers] credit_logs (adjustment) gagal:", logError.message);

      await recordActivity(ctx.admin, {
        actorId: ctx.userId,
        actorUsername: ctx.profile.username,
        actorRole: ctx.profile.role,
        action: "credit_adjust",
        targetType: "reseller",
        targetId: id,
        targetLabel: profile.username,
        detail: {
          amount,
          balance_before: before,
          balance_after: balance,
          reason,
          note: extraNote,
        },
      });

      if (amount < 0) {
        notifyLowCredit(ctx.admin, {
          userId: id,
          username: profile.username,
          balanceBefore: before,
          balanceAfter: balance,
          reason: `penyesuaian oleh ${ctx.profile.username}: ${reason}`,
          runtime: await loadRuntime(ctx.admin),
        });
      }

      return jsonOk({
        reseller: { ...(profile as ProfileRow), credit: balance },
        balance,
        adjusted: amount,
        reason,
      });
    }

    if (action === "set_active") {
      const isActive = asBool(body.is_active);
      if (isActive === null) return jsonError("Status aktif tidak valid", "validation_error", 400);

      const { error: updateError } = await ctx.admin
        .from("profiles")
        .update({ is_active: isActive })
        .eq("id", id);

      if (updateError) return jsonError(updateError.message, "server_error", 500);

      if (!isActive) {
        try {
          await ctx.admin.auth.admin.signOut(id);
        } catch {
        }
      }

      return jsonOk({ is_active: isActive });
    }

    if (action === "reset_password") {
      const password = asPassword(body.password);
      if (!password) return jsonError("Password minimal 8 karakter", "validation_error", 400);

      const { error: passwordError } = await ctx.admin.auth.admin.updateUserById(id, { password });
      if (passwordError) return jsonError(passwordError.message, "server_error", 500);

      return jsonOk({ updated: true });
    }

    if (action === "update") {
      const updates: Partial<ProfileRow> = {};
      const authUpdates: Record<string, unknown> = {};

      if (body.username !== undefined) {
        const username = asString(body.username, 32);
        if (!username || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
          return jsonError("Username tidak valid", "validation_error", 400);
        }
        const { data: duplicate } = await ctx.admin
          .from("profiles")
          .select("id")
          .eq("username", username)
          .maybeSingle();
        if (duplicate && duplicate.id !== id) {
          return jsonError("Username sudah dipakai", "conflict", 409);
        }
        updates.username = username;
      }

      if (body.email !== undefined) {
        const email = asEmail(body.email);
        if (!email) return jsonError("Email tidak valid", "validation_error", 400);
        updates.email = email;
        authUpdates.email = email;
        authUpdates.email_confirm = true;
      }

      if (Object.keys(updates).length === 0) {
        return jsonError("Tidak ada perubahan yang dikirim", "validation_error", 400);
      }

      if (Object.keys(authUpdates).length > 0) {
        const { error: authError } = await ctx.admin.auth.admin.updateUserById(id, authUpdates);
        if (authError) {
          const isDuplicate = /already|exists|registered/i.test(authError.message);
          return jsonError(
            isDuplicate ? "Email sudah terdaftar" : authError.message,
            isDuplicate ? "conflict" : "server_error",
            isDuplicate ? 409 : 500,
          );
        }
      }

      const { error: updateError } = await ctx.admin.from("profiles").update(updates).eq("id", id);
      if (updateError) return jsonError(updateError.message, "server_error", 500);

      return jsonOk({ updated: true });
    }

    return jsonError("Action tidak dikenal", "validation_error", 400);
  });
}

export async function DELETE(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID reseller tidak valid", "validation_error", 400);

    const { profile, error } = await loadReseller(ctx, id);
    if (error) return error;

    let body: { confirm_username?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }

    const confirm = asString(body.confirm_username, 32);
    if (confirm !== profile!.username) {
      return jsonError(
        `Ketik username "${profile!.username}" untuk konfirmasi penghapusan`,
        "validation_error",
        400,
      );
    }

    const { data: keys } = await ctx.admin.from("keys").select("id").eq("created_by", id);
    const keyIds = (keys ?? []).map((row) => row.id as string);

    if (keyIds.length > 0) {
      await ctx.admin.from("device_logs").delete().in("key_id", keyIds);
      const { error: keyError } = await ctx.admin.from("keys").delete().eq("created_by", id);
      if (keyError) return jsonError(keyError.message, "server_error", 500);
    }

    const { error: logError } = await ctx.admin.from("credit_logs").delete().eq("user_id", id);
    if (logError) return jsonError(logError.message, "server_error", 500);

    const { error: profileError } = await ctx.admin.from("profiles").delete().eq("id", id);
    if (profileError) return jsonError(profileError.message, "server_error", 500);

    const { error: authError } = await ctx.admin.auth.admin.deleteUser(id);
    if (authError) {
      console.warn("[resellers] auth deleteUser:", authError.message);
    }

    return jsonOk({ deleted: true, removed_keys: keyIds.length });
  });
}
