import type { NextRequest } from "next/server";

import { isUuid, withOwner } from "@/lib/api/auth";
import { jsonError, jsonOk } from "@/lib/utils/http";
import { asBool, asString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

/** POST /api/tools/[id]/versions — tambah version baru untuk sebuah tool type. */
export async function POST(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const toolTypeId = route.params.id;
    if (!isUuid(toolTypeId)) return jsonError("ID tool tidak valid", "validation_error", 400);

    let body: { name?: unknown; is_active?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    const name = asString(body.name, 64);
    if (!name) return jsonError("Nama version wajib diisi (maks 64 karakter)", "validation_error", 400);

    const { data: tool } = await ctx.admin
      .from("tool_types")
      .select("id")
      .eq("id", toolTypeId)
      .maybeSingle();

    if (!tool) return jsonError("Tool type tidak ditemukan", "not_found", 404);

    const { data: duplicate } = await ctx.admin
      .from("tool_versions")
      .select("id")
      .eq("tool_type_id", toolTypeId)
      .eq("name", name)
      .maybeSingle();

    if (duplicate) {
      return jsonError(`Version "${name}" sudah ada di tool ini`, "conflict", 409);
    }

    const isActive = asBool(body.is_active);
    const { data, error } = await ctx.admin
      .from("tool_versions")
      .insert({
        tool_type_id: toolTypeId,
        name,
        is_active: isActive === null ? true : isActive,
      })
      .select("*")
      .single();

    if (error) return jsonError(error.message, "server_error", 500);
    return jsonOk({ version: data });
  });
}
