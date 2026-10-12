import type { NextRequest } from "next/server";

import { withApiKey } from "@/lib/api/v1";
import { jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withApiKey(request, async (ctx) => {
    const { data: tools, error } = await ctx.admin
      .from("tool_types")
      .select("id, name, slug, is_active, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (error) return jsonError(error.message, "server_error", 500);

    const toolIds = (tools ?? []).map((tool) => tool.id as string);
    const versions =
      toolIds.length > 0
        ? await ctx.admin
            .from("tool_versions")
            .select("id, tool_type_id, name, is_active, created_at")
            .in("tool_type_id", toolIds)
            .eq("is_active", true)
            .order("created_at", { ascending: false })
        : { data: [], error: null };

    if (versions.error) return jsonError(versions.error.message, "server_error", 500);

    return jsonOk({
      tools: (tools ?? []).map((tool) => ({
        id: tool.id,
        name: tool.name,
        slug: tool.slug,
        versions: ((versions.data ?? []) as { id: string; tool_type_id: string; name: string }[])
          .filter((version) => version.tool_type_id === tool.id)
          .map((version) => ({ id: version.id, name: version.name })),
      })),
    });
  });
}
