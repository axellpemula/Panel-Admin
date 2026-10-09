import type { NextRequest } from "next/server";

import { withAuth, withOwner } from "@/lib/api/auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";
import { asBool, asInt, asString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

/**
 * GET /api/durations
 * Owner: semua preset (termasuk nonaktif). Reseller: hanya preset aktif.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    try {
      let query = ctx.admin
        .from("duration_presets")
        .select("*")
        .order("days", { ascending: true });

      if (!ctx.isOwner) query = query.eq("is_active", true);

      const { data, error } = await query;
      if (error) return jsonError(errorMessage(error), "server_error", 500);

      return jsonOk({ presets: data ?? [], isOwner: ctx.isOwner });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

/** POST /api/durations — tambah preset durasi (Owner only). */
export async function POST(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    let body: { name?: unknown; days?: unknown; credit_cost?: unknown; is_active?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    const name = asString(body.name, 64);
    const days = asInt(body.days, 1, 3650);
    const creditCost = asInt(body.credit_cost ?? 0, 0, 1_000_000);
    const isActive = asBool(body.is_active);

    if (!name) return jsonError("Nama durasi wajib diisi", "validation_error", 400);
    if (days === null) return jsonError("Jumlah hari harus antara 1 dan 3650", "validation_error", 400);
    if (creditCost === null) return jsonError("Harga credit tidak valid", "validation_error", 400);

    const { data, error } = await ctx.admin
      .from("duration_presets")
      .insert({
        name,
        days,
        credit_cost: creditCost,
        is_active: isActive === null ? true : isActive,
      })
      .select("*")
      .single();

    if (error) return jsonError(error.message, "server_error", 500);
    return jsonOk({ preset: data });
  });
}
