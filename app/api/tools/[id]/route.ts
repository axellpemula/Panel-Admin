import type { NextRequest } from "next/server";

import { isUuid, withOwner } from "@/lib/api/auth";
import { jsonError, jsonOk } from "@/lib/utils/http";
import type { ToolTypeRow } from "@/lib/types/database";
import { asBool, asSlug, asString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

export async function PUT(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID tool tidak valid", "validation_error", 400);

    let body: { name?: unknown; slug?: unknown; is_active?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    const updates: Partial<ToolTypeRow> = {};

    if (body.name !== undefined) {
      const name = asString(body.name, 100);
      if (!name) return jsonError("Nama tool tidak valid", "validation_error", 400);
      updates.name = name;
    }

    if (body.slug !== undefined) {
      const slug = asSlug(body.slug);
      if (!slug) return jsonError("Slug tidak valid", "validation_error", 400);
      const { data: existing } = await ctx.admin
        .from("tool_types")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (existing && existing.id !== id) {
        return jsonError(`Slug "${slug}" sudah dipakai tool lain`, "conflict", 409);
      }
      updates.slug = slug;
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
      .from("tool_types")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return jsonError(error.message, "server_error", 500);
    return jsonOk({ tool: data });
  });
}

export async function DELETE(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID tool tidak valid", "validation_error", 400);

    const { count, error: countError } = await ctx.admin
      .from("keys")
      .select("id", { count: "exact", head: true })
      .eq("tool_type_id", id);

    if (countError) return jsonError(countError.message, "server_error", 500);

    if ((count ?? 0) > 0) {
      return jsonError(
        `Tool ini masih punya ${count} key. Hapus key-nya terlebih dulu.`,
        "conflict",
        409,
      );
    }

    const { error } = await ctx.admin.from("tool_types").delete().eq("id", id);
    if (error) return jsonError(error.message, "server_error", 500);

    return jsonOk({ deleted: true });
  });
}
