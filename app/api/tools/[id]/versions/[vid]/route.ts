import type { NextRequest } from "next/server";

import { isUuid, withOwner } from "@/lib/api/auth";
import { jsonError, jsonOk } from "@/lib/utils/http";
import type { ToolVersionRow } from "@/lib/types/database";
import { asBool, asString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string; vid: string };
}

/** PUT /api/tools/[id]/versions/[vid] — ubah nama / status aktif version. */
export async function PUT(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id, vid } = route.params;
    if (!isUuid(id) || !isUuid(vid)) {
      return jsonError("ID tidak valid", "validation_error", 400);
    }

    let body: { name?: unknown; is_active?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    const { data: version } = await ctx.admin
      .from("tool_versions")
      .select("id, tool_type_id")
      .eq("id", vid)
      .maybeSingle();

    if (!version) return jsonError("Version tidak ditemukan", "not_found", 404);
    if (version.tool_type_id !== id) {
      return jsonError("Version bukan milik tool ini", "validation_error", 400);
    }

    const updates: Partial<ToolVersionRow> = {};

    if (body.name !== undefined) {
      const name = asString(body.name, 64);
      if (!name) return jsonError("Nama version tidak valid", "validation_error", 400);

      const { data: duplicate } = await ctx.admin
        .from("tool_versions")
        .select("id")
        .eq("tool_type_id", id)
        .eq("name", name)
        .maybeSingle();

      if (duplicate && duplicate.id !== vid) {
        return jsonError(`Version "${name}" sudah ada di tool ini`, "conflict", 409);
      }
      updates.name = name;
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
      .from("tool_versions")
      .update(updates)
      .eq("id", vid)
      .select("*")
      .single();

    if (error) return jsonError(error.message, "server_error", 500);
    return jsonOk({ version: data });
  });
}

/** DELETE /api/tools/[id]/versions/[vid] — hapus version (ditolak kalau masih ada key). */
export async function DELETE(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id, vid } = route.params;
    if (!isUuid(id) || !isUuid(vid)) {
      return jsonError("ID tidak valid", "validation_error", 400);
    }

    const { data: version } = await ctx.admin
      .from("tool_versions")
      .select("id, tool_type_id")
      .eq("id", vid)
      .maybeSingle();

    if (!version) return jsonError("Version tidak ditemukan", "not_found", 404);
    if (version.tool_type_id !== id) {
      return jsonError("Version bukan milik tool ini", "validation_error", 400);
    }

    const { count, error: countError } = await ctx.admin
      .from("keys")
      .select("id", { count: "exact", head: true })
      .eq("tool_version_id", vid);

    if (countError) return jsonError(countError.message, "server_error", 500);

    if ((count ?? 0) > 0) {
      return jsonError(
        `Version ini masih dipakai ${count} key. Hapus key-nya dulu di Key List.`,
        "conflict",
        409,
      );
    }

    const { error } = await ctx.admin.from("tool_versions").delete().eq("id", vid);
    if (error) return jsonError(error.message, "server_error", 500);

    return jsonOk({ deleted: true });
  });
}
