import type { NextRequest } from "next/server";

import { GenerateError, generateKeys } from "@/lib/api/generate";
import { listKeys, type SortColumn } from "@/lib/api/keys";
import { withApiKey } from "@/lib/api/v1";
import { errorMessage, jsonError, jsonOk, readJsonBody } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BODY_MAX = 8 * 1024;

/**
 * GET  /api/v1/keys — daftar key milik pemilik API key (filter + pagination).
 * POST /api/v1/keys — generate key baru (memakai lib/api/generate.ts yang sama
 *                     dengan panel, jadi harga & validasinya identik).
 *
 * Query GET : status, q, tool_type_id, version_id, page, per_page, sort, order
 * Body POST : { tool_type_id, tool_version_id, duration_preset_id, quantity?,
 *               max_device?, note?, custom_days? }
 *
 * Catatan: reseller hanya boleh memakai preset durasi (`duration_preset_id`).
 * Owner boleh memakai `custom_days` (termasuk 0 = lifetime).
 */
export async function GET(request: NextRequest) {
  return withApiKey(request, async (ctx) => {
    const params = request.nextUrl.searchParams;

    // Filter yang tidak dikenal jangan diam-diam diabaikan: bot/skrip harus tahu
    // bahwa nilainya salah (kalau tidak, `status=expird` malah mengembalikan semua key).
    const status = (params.get("status") ?? "").trim().toLowerCase();
    if (status && !["active", "expired", "banned"].includes(status)) {
      return jsonError(
        "Parameter `status` harus salah satu: active, expired, banned",
        "validation_error",
        400,
        { allowed: ["active", "expired", "banned"] },
      );
    }

    try {
      const result = await listKeys(ctx.admin, {
        userId: ctx.profile.id,
        status: status || undefined,
        search: params.get("q") ?? undefined,
        toolTypeId: params.get("tool_type_id") ?? undefined,
        versionId: params.get("version_id") ?? undefined,
        sort: (params.get("sort") as SortColumn | null) ?? "created_at",
        order: params.get("order") === "asc" ? "asc" : "desc",
        page: Number.parseInt(params.get("page") ?? "1", 10) || 1,
        perPage: Number.parseInt(params.get("per_page") ?? "20", 10) || 20,
      });

      return jsonOk({
        items: result.items,
        total: result.total,
        page: result.page,
        per_page: result.perPage,
        total_pages: result.totalPages,
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

export async function POST(request: NextRequest) {
  return withApiKey(request, async (ctx) => {
    const parsed = await readJsonBody(request, BODY_MAX);
    if (!parsed.ok) {
      return jsonError(
        parsed.tooLarge ? "Body request terlalu besar" : "Body request bukan JSON yang valid",
        "validation_error",
        parsed.tooLarge ? 413 : 400,
      );
    }

    const body = (parsed.value ?? {}) as Record<string, unknown>;
    const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const asInt = (value: unknown) => {
      const parsedNumber = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
      return Number.isFinite(parsedNumber) ? Math.trunc(parsedNumber) : null;
    };

    const toolTypeId = asString(body.tool_type_id);
    const toolVersionId = asString(body.tool_version_id);
    const presetId = asString(body.duration_preset_id);
    const customDaysRaw = body.custom_days === undefined || body.custom_days === null
      ? null
      : asInt(body.custom_days);

    if (!toolTypeId || !toolVersionId) {
      return jsonError("tool_type_id dan tool_version_id wajib diisi", "validation_error", 400);
    }

    const useCustom = !presetId && customDaysRaw !== null;
    if (!presetId && !useCustom) {
      return jsonError(
        "Sertakan duration_preset_id (lihat GET /api/v1/presets) — atau custom_days untuk Owner",
        "validation_error",
        400,
      );
    }

    try {
      const result = await generateKeys(
        { admin: ctx.admin, userId: ctx.profile.id, profile: ctx.profile, isOwner: ctx.isOwner },
        {
          toolTypeId,
          toolVersionId,
          durationMode: useCustom ? "custom" : "preset",
          durationPresetId: presetId || null,
          customDays: useCustom ? customDaysRaw : null,
          maxDevice: asInt(body.max_device) ?? 1,
          quantity: asInt(body.quantity) ?? 1,
          note: asString(body.note) || "Dibuat lewat API",
        },
      );

      return jsonOk({
        keys: result.keys,
        summary: result.summary,
      });
    } catch (error) {
      if (error instanceof GenerateError) {
        return jsonError(
          error.message,
          error.code,
          statusForCode(error.code),
          error.details ?? undefined,
        );
      }
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

/** Kode error GenerateError → HTTP status yang masuk akal untuk API publik. */
function statusForCode(code: GenerateError["code"]): number {
  switch (code) {
    case "not_found":
      return 404;
    case "insufficient_credit":
    case "conflict":
      return 409;
    case "validation_error":
      return 400;
    default:
      return 500;
  }
}
