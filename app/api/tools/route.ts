import type { NextRequest } from "next/server";

import { withAuth, withOwner } from "@/lib/api/auth";
import { LIMITS } from "@/lib/constants";
import { licensePublicKey } from "@/lib/env";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";
import { asOptionalString, asSlug, asString } from "@/lib/utils/validate";
import { slugify } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export interface ToolVersionItem {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  total_keys: number;
  active_keys: number;
}

export interface ToolTypeItem {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  has_secret: boolean;
  versions: ToolVersionItem[];
  total_keys: number;
  active_keys: number;
  version_count: number;
}

/**
 * GET /api/tools
 * Owner: daftar lengkap tool type + version + jumlah key.
 * Reseller: hanya tool & version AKTIF (untuk form generate).
 * Payload rahasia TIDAK pernah dikirim — hanya flag `has_secret`.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    try {
      const [toolsResult, versionsResult, secretsResult, countsResult] = await Promise.all([
        ctx.admin
          .from("tool_types")
          .select("*")
          .order("created_at", { ascending: true }),
        ctx.admin
          .from("tool_versions")
          .select("*")
          .order("created_at", { ascending: true }),
        ctx.admin.from("tool_secrets").select("tool_type_id, secret_payload"),
        ctx.admin.rpc("key_counts_by_version"),
      ]);

      if (toolsResult.error) return jsonError(toolsResult.error.message, "server_error", 500);
      if (versionsResult.error) return jsonError(versionsResult.error.message, "server_error", 500);

      const counts = new Map<string, { total: number; active: number }>();
      (countsResult.data ?? []).forEach((row) => {
        const record = row as { tool_version_id: string; total_keys: number; active_keys: number };
        counts.set(record.tool_version_id, {
          total: Number(record.total_keys) || 0,
          active: Number(record.active_keys) || 0,
        });
      });

      const secretIds = new Set<string>();
      (secretsResult.data ?? []).forEach((row) => {
        const record = row as { tool_type_id: string; secret_payload: string | null };
        if (record.secret_payload && record.secret_payload.length > 0) {
          secretIds.add(record.tool_type_id);
        }
      });

      const items: ToolTypeItem[] = (toolsResult.data ?? []).map((tool) => {
        const versions = (versionsResult.data ?? [])
          .filter((version) => version.tool_type_id === tool.id)
          .map((version) => {
            const count = counts.get(version.id) ?? { total: 0, active: 0 };
            return {
              id: version.id as string,
              name: version.name as string,
              is_active: Boolean(version.is_active),
              created_at: version.created_at as string,
              updated_at: version.updated_at as string,
              total_keys: count.total,
              active_keys: count.active,
            };
          });

        return {
          id: tool.id as string,
          name: tool.name as string,
          slug: tool.slug as string,
          is_active: Boolean(tool.is_active),
          created_at: tool.created_at as string,
          updated_at: tool.updated_at as string,
          has_secret: secretIds.has(tool.id as string),
          versions,
          version_count: versions.length,
          total_keys: versions.reduce((sum, version) => sum + version.total_keys, 0),
          active_keys: versions.reduce((sum, version) => sum + version.active_keys, 0),
        };
      });

      const visible = ctx.isOwner
        ? items
        : items
            .filter((tool) => tool.is_active)
            .map((tool) => ({
              ...tool,
              versions: tool.versions.filter((version) => version.is_active),
            }));

      return jsonOk({
        tools: visible,
        public_key: licensePublicKey() ?? null,
        isOwner: ctx.isOwner,
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

/**
 * POST /api/tools — tambah tool type (Owner only).
 * Slug auto-generate dari nama, tapi bisa diisi manual.
 */
export async function POST(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    let body: { name?: unknown; slug?: unknown; is_active?: unknown; secret_payload?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Format request tidak valid", "validation_error", 400);
    }

    const name = asString(body.name, 100);
    if (!name) return jsonError("Nama tool wajib diisi (maks 100 karakter)", "validation_error", 400);

    const slug = asSlug(body.slug) ?? asSlug(slugify(name));
    if (!slug) return jsonError("Slug tidak valid", "validation_error", 400);

    const { data: existing } = await ctx.admin
      .from("tool_types")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existing) return jsonError(`Slug "${slug}" sudah dipakai tool lain`, "conflict", 409);

    const { data, error } = await ctx.admin
      .from("tool_types")
      .insert({
        name,
        slug,
        is_active: body.is_active === false ? false : true,
        created_by: ctx.userId,
      })
      .select("*")
      .single();

    if (error) return jsonError(error.message, "server_error", 500);

    // Payload rahasia opsional — hanya disimpan, tidak pernah dikembalikan.
    const secret = asOptionalString(body.secret_payload, LIMITS.secretPayloadMax);
    if (secret) {
      const { error: secretError } = await ctx.admin
        .from("tool_secrets")
        .upsert({ tool_type_id: data.id, secret_payload: secret }, { onConflict: "tool_type_id" });
      if (secretError) console.warn("[tools] simpan secret gagal:", secretError.message);
    }

    return jsonOk({
      tool: {
        id: data.id,
        name: data.name,
        slug: data.slug,
        is_active: data.is_active,
        created_at: data.created_at,
        updated_at: data.updated_at,
        has_secret: Boolean(secret),
        versions: [],
        version_count: 0,
        total_keys: 0,
        active_keys: 0,
      },
    });
  });
}
