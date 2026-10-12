import type { NextRequest } from "next/server";

import { withApiKey } from "@/lib/api/v1";
import { jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/presets
 * Daftar preset durasi aktif — dipakai untuk menghitung biaya sebelum generate.
 * `days = null` berarti lifetime.
 */
export async function GET(request: NextRequest) {
  return withApiKey(request, async (ctx) => {
    const { data, error } = await ctx.admin
      .from("duration_presets")
      .select("id, name, days, credit_cost, is_active, created_at")
      .eq("is_active", true)
      .order("days", { ascending: true });

    if (error) return jsonError(error.message, "server_error", 500);

    return jsonOk({
      presets: (data ?? []).map((preset) => ({
        id: preset.id,
        name: preset.name,
        days: preset.days,
        label: preset.days === null || preset.days === 0 ? "Lifetime" : `${preset.days} hari`,
        credit_cost: preset.credit_cost,
      })),
      // Harga 1 unit = 1 key × 1 device.
      credit_rule: "1 unit harga = 1 key × 1 device",
    });
  });
}
