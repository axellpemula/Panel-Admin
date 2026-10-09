import type { NextRequest } from "next/server";

import { resellerSummary, type TopReseller } from "@/lib/api/stats";
import { addCredit } from "@/lib/api/credit";
import { withOwner } from "@/lib/api/auth";
import type { ProfileRow } from "@/lib/types/database";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";
import { asEmail, asInt, asOptionalString, asPassword, asString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

/**
 * GET /api/resellers (Owner only)
 * Daftar reseller + sisa credit + total key yang dibuat.
 */
export async function GET(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    try {
      const resellers = await resellerSummary(ctx.admin);
      const sorted = [...resellers].sort((a, b) => a.username.localeCompare(b.username));
      return jsonOk({ resellers: sorted });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

/**
 * POST /api/resellers (Owner only)
 * Buat akun reseller: Supabase Auth + baris `profiles`.
 * Kalau `credit` > 0, langsung dicatat sebagai credit_logs bertipe topup.
 */
export async function POST(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    let body: {
      username?: unknown;
      email?: unknown;
      password?: unknown;
      credit?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    const username = asString(body.username, 32);
    const email = asEmail(body.email);
    const password = asPassword(body.password);
    const credit = asInt(body.credit ?? 0, 0, 1_000_000);

    if (!username || !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      return jsonError(
        "Username 3–32 karakter, hanya huruf, angka, titik, garis bawah, atau strip",
        "validation_error",
        400,
      );
    }
    if (!email) return jsonError("Email tidak valid", "validation_error", 400);
    if (!password) return jsonError("Password minimal 8 karakter", "validation_error", 400);
    if (credit === null) return jsonError("Credit awal tidak valid", "validation_error", 400);

    // Cek duplikat username di profiles.
    const { data: existingUsername } = await ctx.admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (existingUsername) return jsonError("Username sudah dipakai", "conflict", 409);

    // Buat user Supabase Auth.
    const { data: created, error: authError } = await ctx.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, role: "reseller" },
    });

    if (authError || !created.user) {
      const message = authError?.message ?? "Gagal membuat akun";
      const isDuplicate = /already|exists|registered/i.test(message);
      return jsonError(
        isDuplicate ? "Email sudah terdaftar" : message,
        isDuplicate ? "conflict" : "server_error",
        isDuplicate ? 409 : 500,
      );
    }

    const newUserId = created.user.id;

    // Simpan profil.
    const { data: profile, error: profileError } = await ctx.admin
      .from("profiles")
      .insert({
        id: newUserId,
        username,
        email,
        role: "reseller",
        credit: 0,
        is_active: true,
      })
      .select("*")
      .single<ProfileRow>();

    if (profileError || !profile) {
      // Rollback: hapus user auth supaya tidak jadi akun tanpa profil.
      await ctx.admin.auth.admin.deleteUser(newUserId);
      const message = profileError?.code === "23505" ? "Username sudah dipakai" : "Gagal menyimpan profil reseller";
      return jsonError(message, profileError?.code === "23505" ? "conflict" : "server_error", 409);
    }

    let balance = 0;

    if (credit > 0) {
      try {
        balance = await addCredit(ctx.admin, newUserId, credit);
      } catch (error) {
        // Rollback: hapus profil + akun auth supaya tidak tertinggal akun
        // tanpa saldo yang dijanjikan (owner akan lihat errornya).
        await ctx.admin.from("profiles").delete().eq("id", newUserId);
        await ctx.admin.auth.admin.deleteUser(newUserId);
        return jsonError(errorMessage(error), "server_error", 500);
      }

      const { error: logError } = await ctx.admin.from("credit_logs").insert({
        user_id: newUserId,
        action: "topup",
        amount: credit,
        balance_after: balance,
        note: "Credit awal saat pembuatan akun",
        created_by: ctx.userId,
      });
      if (logError) console.warn("[resellers] credit_logs insert gagal:", logError.message);
    }

    return jsonOk({
      reseller: {
        id: newUserId,
        username,
        email,
        credit: balance,
        key_count: 0,
        is_active: true,
      } satisfies TopReseller,
    });
  });
}
