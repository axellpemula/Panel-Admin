import { NextResponse, type NextRequest } from "next/server";

import { withOwner, type AuthContext } from "@/lib/api/auth";
import { loadRuntime } from "@/lib/api/settings";
import { VALIDATION_REASONS } from "@/lib/constants";
import { toCsv } from "@/lib/utils/csv";
import { VALIDATION_REASON_LABEL, formatDateTime } from "@/lib/utils/format";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const HOURLY_TREND_MAX_MS = 48 * HOUR_MS;
const MAX_TREND_BUCKETS = 400;
const AGGREGATE_FETCH_LIMIT = 50_000;
const CSV_EXPORT_LIMIT = 5_000;
const TOP_LIMIT = 10;

const MONTHS_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

interface AttemptFilterValues {
  fromIso: string;
  toIso: string;
  result: "" | "success" | "failed";
  reason: string;
  ip: string;
  key: string;
}

export async function GET(request: NextRequest) {
  return withOwner(request, async (ctx) => {
    const params = request.nextUrl.searchParams;
    const format = params.get("format");
    const page = Math.min(1_000_000, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));
    const perPageRaw = Number.parseInt(params.get("per_page") ?? "25", 10) || 25;
    const perPage = Math.min(200, Math.max(5, perPageRaw));

    try {
      const runtime = await loadRuntime(ctx.admin);

      const now = new Date();
      const nowMs = now.getTime();
      const retentionStartMs = nowMs - runtime.retention.attemptsDays * DAY_MS;

      let fromMs: number;
      const fromParam = params.get("from");
      if (fromParam) {
        const parsed = parseJakartaDayStart(fromParam);
        if (!parsed) {
          return jsonError("Format `from` tidak valid (YYYY-MM-DD)", "validation_error", 400);
        }
        fromMs = parsed.getTime();
      } else {
        fromMs = parseJakartaDayStart(toJakartaDateKey(now))?.getTime() ?? nowMs - DAY_MS;
      }

      let toMs: number;
      const toParam = params.get("to");
      if (toParam) {
        const start = parseJakartaDayStart(toParam);
        if (!start) {
          return jsonError("Format `to` tidak valid (YYYY-MM-DD)", "validation_error", 400);
        }
        toMs = start.getTime() + DAY_MS - 1; // akhir hari WIB
      } else {
        toMs = nowMs;
      }

      fromMs = Math.max(fromMs, retentionStartMs - HOUR_MS);
      toMs = Math.min(toMs, nowMs);
      if (fromMs > toMs) {
        return jsonError("Rentang tanggal tidak valid", "validation_error", 400);
      }

      const resultParam = params.get("result");
      const result: AttemptFilterValues["result"] =
        resultParam === "success" || resultParam === "failed" ? resultParam : "";
      const reasonParam = (params.get("reason") ?? "").trim();
      const reason = (VALIDATION_REASONS as readonly string[]).includes(reasonParam)
        ? reasonParam
        : "";
      const ip = sanitizeLikeFilter(params.get("ip"));
      const key = sanitizeLikeFilter(params.get("key"));

      const filterValues: AttemptFilterValues = {
        fromIso: new Date(fromMs).toISOString(),
        toIso: new Date(toMs).toISOString(),
        result,
        reason,
        ip,
        key,
      };

      if (format === "csv") {
        const { data, error } = await buildAttemptQuery(ctx.admin, filterValues).range(
          0,
          CSV_EXPORT_LIMIT - 1,
        );
        if (error) return jsonError(errorMessage(error), "server_error", 500);

        const csv = toCsv(
          ["tanggal", "ip", "key", "hardware_id", "hasil", "alasan"],
          (data ?? []).map((row) => [
            String(row.created_at),
            row.ip,
            row.key_value ?? "",
            row.hardware_id ?? "",
            row.success ? "Sukses" : "Gagal",
            row.reason ? (VALIDATION_REASON_LABEL[row.reason] ?? row.reason) : "",
          ]),
        );

        const filename = `validation-attempts-${new Date().toISOString().slice(0, 10)}.csv`;
        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
          },
        });
      }

      const { data: aggregateRows, error: aggregateError } = await buildAttemptQuery(
        ctx.admin,
        filterValues,
      ).range(0, AGGREGATE_FETCH_LIMIT - 1);
      if (aggregateError) return jsonError(errorMessage(aggregateError), "server_error", 500);

      const start = (page - 1) * perPage;
      const { data, error, count } = await buildAttemptQuery(ctx.admin, filterValues).range(
        start,
        start + perPage - 1,
      );
      if (error) return jsonError(errorMessage(error), "server_error", 500);

      const rows = aggregateRows ?? [];
      const summary = summarize(rows);
      const hourly = toMs - fromMs <= HOURLY_TREND_MAX_MS;
      const trend = buildTrend(rows, fromMs, toMs, hourly);
      const suspiciousIps = topSuspiciousIps(
        rows,
        runtime.analytics.suspectFailedMin,
        runtime.validate.bruteForceFailures,
      );
      const failingKeys = topFailingKeys(rows);
      const sharedHwids = sharedHardwareIds(rows, runtime.analytics.sharedHwidKeysMin);
      const multiIpKeys = multiIpKeyUsage(rows, runtime.analytics.multiIpKeysMin);

      const items = (data ?? []).map(normalizeAttempt);
      const total = count ?? items.length;

      return jsonOk({
        range: {
          from: filterValues.fromIso,
          to: filterValues.toIso,
          hourly,
        },
        summary,
        trend,
        suspicious_ips: suspiciousIps,
        top_failing_keys: failingKeys,
        shared_hwids: sharedHwids,
        multi_ip_keys: multiIpKeys,
        thresholds: {
          suspect_failed_min: runtime.analytics.suspectFailedMin,
          brute_force_failures: runtime.validate.bruteForceFailures,
          shared_hwid_keys_min: runtime.analytics.sharedHwidKeysMin,
          multi_ip_keys_min: runtime.analytics.multiIpKeysMin,
          retention_days: runtime.retention.attemptsDays,
        },
        items,
        total,
        page,
        per_page: perPage,
        total_pages: Math.max(1, Math.ceil(total / perPage)),
        exported_at: formatDateTime(new Date()),
      });
    } catch (error) {
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}

function buildAttemptQuery(admin: AuthContext["admin"], filters: AttemptFilterValues) {
  let query = admin
    .from("validation_attempts")
    .select("*", { count: "exact" })
    .gte("created_at", filters.fromIso)
    .lte("created_at", filters.toIso)
    .order("created_at", { ascending: false });

  if (filters.result === "success") query = query.eq("success", true);
  if (filters.result === "failed") query = query.eq("success", false);
  if (filters.reason) query = query.eq("reason", filters.reason);
  if (filters.ip) query = query.ilike("ip", `%${filters.ip}%`);
  if (filters.key) query = query.ilike("key_value", `%${filters.key}%`);

  return query;
}

function sanitizeLikeFilter(value: string | null): string {
  return (value ?? "").replace(/[%_]/g, "").trim().slice(0, 64);
}

function parseJakartaDayStart(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toJakartaDateKey(date: Date): string {
  return new Date(date.getTime() + JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}

type AttemptRow = {
  ip: string;
  key_value: string | null;
  hardware_id?: string | null;
  success: boolean;
  reason: string | null;
  created_at: string;
};

function summarize(rows: AttemptRow[]) {
  let succeeded = 0;
  const ips = new Set<string>();
  const keys = new Set<string>();
  rows.forEach((row) => {
    if (row.success) succeeded += 1;
    if (row.ip) ips.add(row.ip);
    if (row.key_value) keys.add(row.key_value);
  });

  const total = rows.length;
  const failed = total - succeeded;

  return {
    total,
    succeeded,
    failed,
    failure_rate: total > 0 ? Math.round((failed / total) * 1000) / 10 : 0,
    distinct_ips: ips.size,
    distinct_keys: keys.size,
    capped: rows.length >= AGGREGATE_FETCH_LIMIT,
  };
}

function buildTrend(rows: AttemptRow[], fromMs: number, toMs: number, hourly: boolean) {
  const unitMs = hourly ? HOUR_MS : DAY_MS;

  const bucketOf = (iso: string): number => {
    const time = new Date(iso).getTime();
    if (Number.isNaN(time)) return Number.NaN;
    const shifted = time + JAKARTA_OFFSET_MS;
    return Math.floor(shifted / unitMs) * unitMs - JAKARTA_OFFSET_MS;
  };

  const trend: { bucket: string; label: string; total: number; succeeded: number; failed: number }[] =
    [];
  const index = new Map<string, (typeof trend)[number]>();

  const firstBucket = bucketOf(new Date(fromMs).toISOString());
  const lastBucket = bucketOf(new Date(toMs).toISOString());
  for (let bucket = firstBucket; bucket <= lastBucket && trend.length < MAX_TREND_BUCKETS; bucket += unitMs) {
    const point = {
      bucket: new Date(bucket).toISOString(),
      label: jakartaBucketLabel(bucket, hourly),
      total: 0,
      succeeded: 0,
      failed: 0,
    };
    trend.push(point);
    index.set(point.bucket, point);
  }

  rows.forEach((row) => {
    const bucket = bucketOf(row.created_at);
    if (Number.isNaN(bucket)) return;
    const point = index.get(new Date(bucket).toISOString());
    if (!point) return;
    point.total += 1;
    if (row.success) point.succeeded += 1;
    else point.failed += 1;
  });

  return trend;
}

function jakartaBucketLabel(bucketMs: number, hourly: boolean): string {
  const date = new Date(bucketMs + JAKARTA_OFFSET_MS);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS_ID[date.getUTCMonth()] ?? "";
  if (!hourly) return `${day} ${month}`;
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${day} ${month} ${hour}:00`;
}

function topSuspiciousIps(rows: AttemptRow[], suspectMin: number, bruteForceMin: number) {
  const map = new Map<
    string,
    {
      total: number;
      failed: number;
      invalidKey: number;
      keys: Set<string>;
      firstSeen: string;
      lastSeen: string;
    }
  >();

  rows.forEach((row) => {
    if (!row.ip) return;
    let agg = map.get(row.ip);
    if (!agg) {
      agg = {
        total: 0,
        failed: 0,
        invalidKey: 0,
        keys: new Set<string>(),
        firstSeen: row.created_at,
        lastSeen: row.created_at,
      };
      map.set(row.ip, agg);
    }
    agg.total += 1;
    if (!row.success) agg.failed += 1;
    if (row.reason === "invalid_key") agg.invalidKey += 1;
    if (row.key_value) agg.keys.add(row.key_value);
    if (row.created_at < agg.firstSeen) agg.firstSeen = row.created_at;
    if (row.created_at > agg.lastSeen) agg.lastSeen = row.created_at;
  });

  return [...map.entries()]
    .map(([ip, agg]) => ({
      ip,
      total: agg.total,
      failed: agg.failed,
      invalid_key: agg.invalidKey,
      distinct_keys: agg.keys.size,
      first_seen: agg.firstSeen,
      last_seen: agg.lastSeen,
      suspect: agg.failed >= suspectMin || agg.invalidKey >= bruteForceMin,
    }))
    .sort((a, b) => b.failed - a.failed || b.invalid_key - a.invalid_key || b.total - a.total)
    .slice(0, TOP_LIMIT);
}

function topFailingKeys(rows: AttemptRow[]) {
  const map = new Map<
    string,
    {
      total: number;
      succeeded: number;
      failed: number;
      ips: Set<string>;
      reasons: Map<string, number>;
      lastSeen: string;
    }
  >();

  rows.forEach((row) => {
    if (!row.key_value) return;
    let agg = map.get(row.key_value);
    if (!agg) {
      agg = {
        total: 0,
        succeeded: 0,
        failed: 0,
        ips: new Set<string>(),
        reasons: new Map<string, number>(),
        lastSeen: row.created_at,
      };
      map.set(row.key_value, agg);
    }
    agg.total += 1;
    if (row.success) {
      agg.succeeded += 1;
    } else {
      agg.failed += 1;
      const reason = row.reason ?? "tanpa alasan";
      agg.reasons.set(reason, (agg.reasons.get(reason) ?? 0) + 1);
    }
    if (row.ip) agg.ips.add(row.ip);
    if (row.created_at > agg.lastSeen) agg.lastSeen = row.created_at;
  });

  return [...map.entries()]
    .map(([keyValue, agg]) => ({
      key_value: keyValue,
      total: agg.total,
      succeeded: agg.succeeded,
      failed: agg.failed,
      distinct_ips: agg.ips.size,
      reasons: Object.fromEntries([...agg.reasons.entries()].sort((a, b) => b[1] - a[1])),
      last_seen: agg.lastSeen,
    }))
    .filter((item) => item.failed > 0)
    .sort((a, b) => b.failed - a.failed || b.total - a.total)
    .slice(0, TOP_LIMIT);
}

function sharedHardwareIds(rows: AttemptRow[], minKeys: number) {
  const map = new Map<
    string,
    {
      keys: Set<string>;
      ips: Set<string>;
      total: number;
      succeeded: number;
      failed: number;
      firstSeen: string;
      lastSeen: string;
    }
  >();

  rows.forEach((row) => {
    const hardwareId = (row.hardware_id ?? "").trim();
    if (!hardwareId) return;

    let agg = map.get(hardwareId);
    if (!agg) {
      agg = {
        keys: new Set<string>(),
        ips: new Set<string>(),
        total: 0,
        succeeded: 0,
        failed: 0,
        firstSeen: row.created_at,
        lastSeen: row.created_at,
      };
      map.set(hardwareId, agg);
    }

    agg.total += 1;
    if (row.success) agg.succeeded += 1;
    else agg.failed += 1;
    if (row.key_value) agg.keys.add(row.key_value);
    if (row.ip) agg.ips.add(row.ip);
    if (row.created_at < agg.firstSeen) agg.firstSeen = row.created_at;
    if (row.created_at > agg.lastSeen) agg.lastSeen = row.created_at;
  });

  return [...map.entries()]
    .filter(([, agg]) => agg.keys.size >= 2)
    .map(([hardwareId, agg]) => ({
      hardware_id: hardwareId,
      distinct_keys: agg.keys.size,
      distinct_ips: agg.ips.size,
      total: agg.total,
      succeeded: agg.succeeded,
      failed: agg.failed,
      // Contoh key-nya supaya Owner bisa langsung memeriksa.
      keys: [...agg.keys].slice(0, 5),
      first_seen: agg.firstSeen,
      last_seen: agg.lastSeen,
      suspect: agg.keys.size >= minKeys,
    }))
    .sort((a, b) => b.distinct_keys - a.distinct_keys || b.total - a.total)
    .slice(0, TOP_LIMIT);
}

function multiIpKeyUsage(rows: AttemptRow[], minIps: number) {
  const map = new Map<
    string,
    {
      ips: Set<string>;
      total: number;
      succeeded: number;
      failed: number;
      reasons: Map<string, number>;
      lastSeen: string;
    }
  >();

  rows.forEach((row) => {
    const keyValue = (row.key_value ?? "").trim();
    if (!keyValue) return;

    let agg = map.get(keyValue);
    if (!agg) {
      agg = {
        ips: new Set<string>(),
        total: 0,
        succeeded: 0,
        failed: 0,
        reasons: new Map<string, number>(),
        lastSeen: row.created_at,
      };
      map.set(keyValue, agg);
    }

    agg.total += 1;
    if (row.success) agg.succeeded += 1;
    else {
      agg.failed += 1;
      const reason = row.reason ?? "tanpa alasan";
      agg.reasons.set(reason, (agg.reasons.get(reason) ?? 0) + 1);
    }
    if (row.ip) agg.ips.add(row.ip);
    if (row.created_at > agg.lastSeen) agg.lastSeen = row.created_at;
  });

  return [...map.entries()]
    .filter(([, agg]) => agg.ips.size >= 2)
    .map(([keyValue, agg]) => ({
      key_value: keyValue,
      distinct_ips: agg.ips.size,
      total: agg.total,
      succeeded: agg.succeeded,
      failed: agg.failed,
      ips: [...agg.ips].slice(0, 5),
      top_reason: [...agg.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      last_seen: agg.lastSeen,
      suspect: agg.ips.size >= minIps,
    }))
    .sort((a, b) => b.distinct_ips - a.distinct_ips || b.total - a.total)
    .slice(0, TOP_LIMIT);
}

function normalizeAttempt(row: unknown) {
  const record = row as Record<string, unknown>;
  return {
    id: String(record.id),
    ip: String(record.ip ?? ""),
    key_value: (record.key_value as string | null) ?? null,
    hardware_id: (record.hardware_id as string | null) ?? null,
    success: record.success === true || record.success === 1,
    reason: (record.reason as string | null) ?? null,
    created_at: String(record.created_at),
  };
}
