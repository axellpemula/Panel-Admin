import type { NextRequest } from "next/server";

import { recordActivity } from "@/lib/api/activity";
import { withOwner } from "@/lib/api/auth";
import {
  SETTINGS_BOUNDS,
  defaultRuntime,
  loadRuntime,
  publicSettings,
  saveRuntime,
} from "@/lib/api/settings";
import { errorMessage, jsonError, jsonOk, readJsonBody } from "@/lib/utils/http";

const SETTINGS_BODY_MAX = 16 * 1024;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    const runtimeConfig = await loadRuntime(ctx.admin, { bypassCache: true });

    return jsonOk({
      runtime: runtimeConfig,
      public: publicSettings(runtimeConfig),
      defaults: defaultRuntime(),
      bounds: SETTINGS_BOUNDS,
    });
  });
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return undefined;
}

const SECTIONS: Array<{ key: string; fields: string[]; booleans: string[] }> = [
  {
    key: "validate",
    booleans: [],
    fields: [
      "perIpPerMinute",
      "perKeyPerMinute",
      "bruteForceFailures",
      "bruteForceWindowMinutes",
      "autoBanDistinctHwids",
      "autoBanWindowMinutes",
      "tokenTtlSeconds",
    ],
  },
  { key: "hwid", booleans: [], fields: ["resetLimit", "resetWindowHours"] },
  {
    key: "keys",
    booleans: [],
    fields: ["maxDeviceMin", "maxDeviceMax", "quantityOwnerMax", "quantityResellerMax"],
  },
  { key: "retention", booleans: [], fields: ["attemptsDays", "apiLogsDays", "notificationDays"] },
  {
    key: "analytics",
    booleans: [],
    fields: ["suspectFailedMin", "sharedHwidKeysMin", "multiIpKeysMin"],
  },
  { key: "api", booleans: ["enabled"], fields: ["rateLimitPerMinute"] },
  {
    key: "notify",
    booleans: ["enabled", "notifyReseller"],
    fields: ["loginBurstFailures", "lowCreditThreshold", "dedupeMinutes"],
  },
];

function buildRuntimePatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const section of SECTIONS) {
    const raw = body[section.key];
    if (!raw || typeof raw !== "object") continue;
    const source = raw as Record<string, unknown>;
    const target: Record<string, unknown> = {};

    for (const field of section.fields) {
      const value = source[field];
      if (value === undefined || value === null || value === "") continue;
      const parsed = typeof value === "number" ? value : Number(String(value).trim());
      if (Number.isFinite(parsed)) target[field] = parsed;
    }

    for (const field of section.booleans) {
      const value = asBoolean(source[field]);
      if (value !== undefined) target[field] = value;
    }

    if (source.events && typeof source.events === "object") {
      const events: Record<string, boolean> = {};
      for (const [eventKey, eventValue] of Object.entries(source.events as Record<string, unknown>)) {
        const value = asBoolean(eventValue);
        if (value !== undefined) events[eventKey] = value;
      }
      if (Object.keys(events).length > 0) target.events = events;
    }

    if (Object.keys(target).length > 0) patch[section.key] = target;
  }

  return patch;
}

function diffRuntime(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  patch: Record<string, unknown>,
): string[] {
  const changed: string[] = [];

  for (const [section, values] of Object.entries(patch)) {
    const previous = (before[section] as Record<string, unknown>) ?? {};
    for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
      if (field === "events") {
        const previousEvents = (previous.events as Record<string, unknown>) ?? {};
        for (const [eventKey, eventValue] of Object.entries(value as Record<string, unknown>)) {
          if (previousEvents[eventKey] !== eventValue) changed.push(`notify.events.${eventKey}`);
        }
        continue;
      }
      if (previous[field] !== value) changed.push(`${section}.${field}`);
    }
    void after;
  }

  return changed;
}

export async function PUT(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    const parsed = await readJsonBody(request, SETTINGS_BODY_MAX);
    if (!parsed.ok) {
      return jsonError(
        parsed.tooLarge ? "Body request terlalu besar" : "Body request bukan JSON yang valid",
        "validation_error",
        parsed.tooLarge ? 413 : 400,
      );
    }

    const body = parsed.value as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("Body request harus JSON objek", "validation_error", 400);
    }

    try {
      const runtimePatch = buildRuntimePatch(body);

      // Snapshot sebelum perubahan (cache dilewati supaya akurat).
      const before = await loadRuntime(ctx.admin, { bypassCache: true });

      const after =
        Object.keys(runtimePatch).length > 0
          ? await saveRuntime(ctx.admin, runtimePatch, ctx.userId)
          : before;

      const changes = diffRuntime(
        before as unknown as Record<string, unknown>,
        after as unknown as Record<string, unknown>,
        runtimePatch,
      );

      if (changes.length > 0) {
        await recordActivity(ctx.admin, {
          actorId: ctx.userId,
          actorUsername: ctx.profile.username,
          actorRole: ctx.profile.role,
          action: "settings_update",
          targetType: "settings",
          targetLabel: "Batas & Sistem",
          detail: { changes },
        });
      }

      return jsonOk({
        runtime: after,
        public: publicSettings(after),
        changed: changes,
      });
    } catch (error) {
      console.error("[settings] gagal menyimpan:", error);
      return jsonError(errorMessage(error) || "Gagal menyimpan pengaturan", "server_error", 500);
    }
  });
}
