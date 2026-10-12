import type { NextRequest } from "next/server";

import { isUuid } from "@/lib/api/auth";
import { resetKeyDevices } from "@/lib/api/device-reset";
import type { HwidResetLimits } from "@/lib/api/hwid-reset";
import { withApiKey } from "@/lib/api/v1";
import type { Database, KeyRow } from "@/lib/types/database";
import { errorMessage, jsonError, jsonOk, readJsonBody } from "@/lib/utils/http";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BODY_MAX = 2 * 1024;

interface RouteParams {
  params: { id: string };
}

/** Cari baris `keys` dari UUID atau key_value. */
async function findKey(
  admin: SupabaseClient<Database>,
  raw: string,
): Promise<KeyRow | null> {
  const query = admin.from("keys").select("*");
  const isUuidValue = isUuid(raw);
  const asKeyValue: string = raw.toUpperCase();
  const { data, error } = isUuidValue
    ? await query.eq("id", raw).maybeSingle<KeyRow>()
    : await query.eq("key_value", asKeyValue).maybeSingle<KeyRow>();

  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * POST /api/v1/keys/[id]/hwid-reset
 * Reset HWID/device sebuah key — satu device (`{ "hardware_id": "..." }`) atau
 * semua device (`{ "all": true }`).
 *
 * Kuota cooldown reseller berlaku SAMA seperti di panel (`hwid.resetLimit` per
 * `hwid.resetWindowHours`); Owner bebas kuota. Setiap reset tercatat di audit log.
 */
export async function POST(request: NextRequest, route: RouteParams) {
  return withApiKey(request, async (ctx) => {
    const raw = decodeURIComponent(route.params.id);

    const parsed = await readJsonBody(request, BODY_MAX);
    // Body boleh kosong → dianggap reset semua (paling sering dipakai bot/skrip).
    const body = parsed.ok ? ((parsed.value ?? {}) as Record<string, unknown>) : {};
    const all = body.all === true || body.all === "true";
    const hardwareId = typeof body.hardware_id === "string" ? body.hardware_id.trim() : "";

    if (!all && !hardwareId) {
      return jsonError(
        "Sertakan `{\"all\": true}` untuk reset semua device atau `{\"hardware_id\": \"...\"}` untuk satu device",
        "validation_error",
        400,
      );
    }

    // Panjang HWID sama dengan yang diterima /api/validate (16–128, tanpa spasi) —
    // supaya nilai yang mustahil cocok dijawab 400, bukan 404 yang membingungkan.
    if (!all && (hardwareId.length < 16 || hardwareId.length > 128 || /\s/.test(hardwareId))) {
      return jsonError(
        "`hardware_id` harus 16–128 karakter tanpa spasi (sama seperti yang dikirim tool)",
        "validation_error",
        400,
      );
    }

    try {
      const key = await findKey(ctx.admin, raw);
      if (!key) return jsonError("Key tidak ditemukan", "not_found", 404);
      if (!ctx.isOwner && key.created_by !== ctx.profile.id) {
        return jsonError("Key ini bukan milik kamu", "forbidden", 403);
      }

      const limits: HwidResetLimits = {
        limit: ctx.runtime.hwid.resetLimit,
        windowHours: ctx.runtime.hwid.resetWindowHours,
      };

      const result = await resetKeyDevices(
        {
          admin: ctx.admin,
          userId: ctx.profile.id,
          username: ctx.profile.username,
          role: ctx.profile.role,
          isOwner: ctx.isOwner,
        },
        key,
        { hardwareId: all ? null : hardwareId, limits },
      );

      if (!result.ok) {
        return jsonError(result.error, result.code, result.status, result.details);
      }

      return jsonOk({
        reset: true,
        removed: result.removed,
        hardware_id: result.hardware_id,
        scope: all ? "all" : "single",
        max_device: result.max_device,
        cooldown: result.cooldown,
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
