import type { NextRequest } from "next/server";

import { withAuth } from "@/lib/api/auth";
import { GenerateError, generateKeys } from "@/lib/api/generate";
import { loadRuntime } from "@/lib/api/settings";
import { LIMITS } from "@/lib/constants";
import { jsonError, jsonOk } from "@/lib/utils/http";
import { asInt, asOptionalString, asString } from "@/lib/utils/validate";

export const dynamic = "force-dynamic";

interface GenerateBody {
  tool_type_id?: unknown;
  tool_version_id?: unknown;
  duration_mode?: unknown;
  duration_preset_id?: unknown;
  custom_days?: unknown;
  max_device?: unknown;
  quantity?: unknown;
  note?: unknown;
}

/**
 * POST /api/keys/generate
 * Owner: preset atau custom duration. Reseller: preset saja + potong credit.
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    let body: GenerateBody;
    try {
      body = (await request.json()) as GenerateBody;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    // Batas quantity & max device mengikuti konfigurasi runtime (Pengaturan).
    const runtime = await loadRuntime(ctx.admin);

    const toolTypeId = asString(body.tool_type_id, 64);
    const toolVersionId = asString(body.tool_version_id, 64);
    const maxDevice = asInt(
      body.max_device ?? LIMITS.defaultMaxDevice,
      runtime.keys.maxDeviceMin,
      runtime.keys.maxDeviceMax,
    );
    const quantityMax = ctx.isOwner
      ? runtime.keys.quantityOwnerMax
      : runtime.keys.quantityResellerMax;
    const quantity = asInt(body.quantity ?? 1, 1, quantityMax);
    const note = asOptionalString(body.note, LIMITS.noteMax);

    if (!toolTypeId) return jsonError("Tool type wajib dipilih", "validation_error", 400);
    if (!toolVersionId) return jsonError("Version wajib dipilih", "validation_error", 400);
    if (maxDevice === null) {
      return jsonError(
        `Max device harus antara ${runtime.keys.maxDeviceMin} dan ${runtime.keys.maxDeviceMax}`,
        "validation_error",
        400,
      );
    }
    if (quantity === null) {
      return jsonError(`Quantity harus antara 1 dan ${quantityMax}`, "validation_error", 400);
    }

    // Reseller tidak boleh mengirim duration_mode custom.
    const requestedMode = body.duration_mode === "custom" ? "custom" : "preset";
    const durationMode = ctx.isOwner ? requestedMode : "preset";

    const durationPresetId = asString(body.duration_preset_id, 64);
    const customDays = body.custom_days === undefined ? null : asInt(body.custom_days, 0, 3650);

    if (durationMode === "preset" && !durationPresetId) {
      return jsonError("Preset durasi wajib dipilih", "validation_error", 400);
    }
    if (durationMode === "custom" && customDays === null) {
      return jsonError("Jumlah hari harus antara 0 (Lifetime) dan 3650", "validation_error", 400);
    }

    try {
      const result = await generateKeys(ctx, {
        toolTypeId,
        toolVersionId,
        durationMode,
        durationPresetId: durationMode === "preset" ? durationPresetId : null,
        customDays: durationMode === "custom" ? customDays : null,
        maxDevice,
        quantity,
        note: note ?? null,
      });

      return jsonOk(result);
    } catch (error) {
      if (error instanceof GenerateError) {
        const status =
          error.code === "not_found"
            ? 404
            : error.code === "insufficient_credit"
              ? 402
              : error.code === "conflict"
                ? 409
                : error.code === "server_error"
                  ? 500
                  : 400;
        return jsonError(error.message, error.code, status, error.details);
      }
      console.error("[keys/generate] error:", error);
      return jsonError("Gagal generate key", "server_error", 500);
    }
  });
}
