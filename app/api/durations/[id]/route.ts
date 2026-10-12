import type { NextRequest } from "next/server";

import { isUuid, withOwner } from "@/lib/api/auth";
import { jsonError, jsonOk } from "@/lib/utils/http";
import type { DurationPresetRow } from "@/lib/types/database";
import { asBool, asInt, asString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

export async function PUT(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID preset tidak valid", "validation_error", 400);

    let body: { name?: unknown; days?: unknown; credit_cost?: unknown; is_active?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    const updates: Partial<DurationPresetRow> = {};

    if (body.name !== undefined) {
      const name = asString(body.name, 64);
      if (!name) return jsonError("Nama durasi tidak valid", "validation_error", 400);
      updates.name = name;
    }

    if (body.days !== undefined) {
      const days = asInt(body.days, 1, 3650);
      if (days === null) return jsonError("Jumlah hari harus antara 1 dan 3650", "validation_error", 400);
      updates.days = days;
    }

    if (body.credit_cost !== undefined) {
      const creditCost = asInt(body.credit_cost, 0, 1_000_000);
      if (creditCost === null) return jsonError("Harga credit tidak valid", "validation_error", 400);
      updates.credit_cost = creditCost;
    }

    if (body.is_active !== undefined) {
      const isActive = asBool(body.is_active);
      if (isActive === null) return jsonError("Status aktif tidak valid", "validation_error", 400);
      updates.is_active = isActive;
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("Tidak ada perubahan yang dikirim", "validation_error", 400);
    }

    const { data, error } = await ctx.admin
      .from("duration_presets")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return jsonError(error.message, "server_error", 500);
    return jsonOk({ preset: data });
  });
}

export async function DELETE(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID preset tidak valid", "validation_error", 400);

    const { error } = await ctx.admin.from("duration_presets").delete().eq("id", id);
    if (error) return jsonError(error.message, "server_error", 500);

    return jsonOk({ deleted: true });
  });
}
