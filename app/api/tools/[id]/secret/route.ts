import type { NextRequest } from "next/server";

import { isUuid, withOwner } from "@/lib/api/auth";
import { LIMITS } from "@/lib/constants";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";
import { asOptionalString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID tool tidak valid", "validation_error", 400);

    const { data, error } = await ctx.admin
      .from("tool_secrets")
      .select("tool_type_id, secret_payload, updated_at")
      .eq("tool_type_id", id)
      .maybeSingle();

    if (error) return jsonError(errorMessage(error), "server_error", 500);

    return jsonOk({
      has_secret: Boolean(data?.secret_payload && data.secret_payload.length > 0),
      updated_at: data?.updated_at ?? null,
    });
  });
}

export async function PUT(request: NextRequest, route: RouteParams) {
  return withOwner(request, async (ctx) => {
    const { id } = route.params;
    if (!isUuid(id)) return jsonError("ID tool tidak valid", "validation_error", 400);

    let body: { secret_payload?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    if (
      body.secret_payload !== undefined &&
      body.secret_payload !== null &&
      typeof body.secret_payload !== "string"
    ) {
      return jsonError("Payload rahasia harus berupa teks", "validation_error", 400);
    }

    const secret = asOptionalString(body.secret_payload ?? null, LIMITS.secretPayloadMax);

    const { data: tool } = await ctx.admin
      .from("tool_types")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (!tool) return jsonError("Tool type tidak ditemukan", "not_found", 404);

    if (secret === null || secret === undefined) {
      const { error } = await ctx.admin.from("tool_secrets").delete().eq("tool_type_id", id);
      if (error) return jsonError(error.message, "server_error", 500);
      return jsonOk({ has_secret: false });
    }

    const { error } = await ctx.admin
      .from("tool_secrets")
      .upsert({ tool_type_id: id, secret_payload: secret }, { onConflict: "tool_type_id" });

    if (error) return jsonError(error.message, "server_error", 500);

    return jsonOk({ has_secret: true });
  });
}
