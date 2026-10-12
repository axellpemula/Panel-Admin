import type { SupabaseClient } from "@supabase/supabase-js";

import { HWID_RESET, LIMITS, RATE_LIMIT } from "@/lib/constants";
import { licenseTokenTtlSeconds } from "@/lib/env";
import type { Database } from "@/lib/types/database";
import { parseJsonObjectOrEmpty } from "@/lib/utils/json";

/**
 * Konfigurasi runtime panel — diatur Owner dari **Pengaturan → Batas & Sistem**.
 *
 * Kenapa ada: sebelumnya semua limit (rate limit validasi, kuota reset HWID, jumlah
 * quantity, retensi log) dipaku di `lib/constants.ts`. Sekarang nilainya bisa
 * disesuaikan tanpa deploy, TAPI:
 *
 * - `lib/constants.ts` tetap menjadi **default** dan tetap dipakai client untuk
 *   hal yang tidak sensitif (format key, batas input dasar). Nilai runtime hanya
 *   membatasi/melonggarkan di sisi server.
 * - Semua nilai disanitasi (`sanitizeRuntime`) dan dijepit ke rentang aman
 *   (`min`/`max`), jadi nilai aneh di database tidak bisa membuat panel error 500
 *   atau membuka celah (mis. rate limit 0 = semua request ditolak, tetap dijepit).
 * - Override disimpan sebagai SATU dokumen JSON di `app_settings` (`key = 'runtime'`),
 *   sehingga menambah field baru cukup menambah default — data lama tetap valid.
 * - Cache 15 detik per proses supaya /api/validate tidak query settings tiap request;
 *   `saveRuntime` langsung membatalkan cache itu.
 */

export interface RuntimeSettings {
  validate: {
    /** Maksimal request /api/validate per IP per menit. */
    perIpPerMinute: number;
    /** Maksimal request /api/validate per key per menit. */
    perKeyPerMinute: number;
    /** Jumlah `invalid_key` dari satu IP sebelum kegagalan disamarkan. */
    bruteForceFailures: number;
    bruteForceWindowMinutes: number;
    /** Auto-ban: jumlah HWID berbeda dalam window sebelum key diblokir. */
    autoBanDistinctHwids: number;
    autoBanWindowMinutes: number;
    /** TTL token lisensi (detik). Default mengikuti LICENSE_TOKEN_TTL_SECONDS. */
    tokenTtlSeconds: number;
  };
  hwid: {
    /** Kuota reset HWID per key per window (khusus reseller). */
    resetLimit: number;
    resetWindowHours: number;
  };
  keys: {
    maxDeviceMin: number;
    maxDeviceMax: number;
    quantityOwnerMax: number;
    quantityResellerMax: number;
  };
  retention: {
    /** Retensi validation_attempts (hari) — dipakai cron cleanup. */
    attemptsDays: number;
    /** Retensi api_request_logs (hari). */
    apiLogsDays: number;
    /** Retensi notification_logs (hari). */
    notificationDays: number;
  };
  analytics: {
    /** IP dianggap mencurigakan kalau total gagal ≥ nilai ini. */
    suspectFailedMin: number;
    /** HWID dianggap berbagi kalau dipakai ≥ sekian key berbeda. */
    sharedHwidKeysMin: number;
    /** Key dianggap mencurigakan kalau dipakai dari ≥ sekian IP berbeda. */
    multiIpKeysMin: number;
  };
  api: {
    /** Matikan untuk menolak semua request /api/v1 tanpa menghapus token. */
    enabled: boolean;
    /** Maksimal request /api/v1 per token per menit. */
    rateLimitPerMinute: number;
  };
  notify: {
    enabled: boolean;
    /** Ambang gagal login per IP sebelum notifikasi (juga dipakai login-guard). */
    loginBurstFailures: number;
    /** Notifikasi kalau saldo reseller turun melewati ambang ini. */
    lowCreditThreshold: number;
    /** Window anti-spam notifikasi yang sama (menit). */
    dedupeMinutes: number;
    /** Kirim juga ke Telegram reseller yang bersangkutan. */
    notifyReseller: boolean;
    events: {
      autoBan: boolean;
      loginBurst: boolean;
      validationBurst: boolean;
      lowCredit: boolean;
      digest: boolean;
      security: boolean;
    };
  };
}

/** Nilai default — selalu berasal dari konstanta/env supaya perilaku lama terjaga. */
export function defaultRuntime(): RuntimeSettings {
  return {
    validate: {
      perIpPerMinute: RATE_LIMIT.perIpPerMinute,
      perKeyPerMinute: RATE_LIMIT.perKeyPerMinute,
      bruteForceFailures: RATE_LIMIT.bruteForceFailures,
      bruteForceWindowMinutes: RATE_LIMIT.bruteForceWindowMinutes,
      autoBanDistinctHwids: RATE_LIMIT.autoBanDistinctHwids,
      autoBanWindowMinutes: RATE_LIMIT.autoBanWindowMinutes,
      tokenTtlSeconds: licenseTokenTtlSeconds(),
    },
    hwid: {
      resetLimit: HWID_RESET.limit,
      resetWindowHours: HWID_RESET.windowHours,
    },
    keys: {
      maxDeviceMin: LIMITS.maxDeviceMin,
      maxDeviceMax: LIMITS.maxDeviceMax,
      quantityOwnerMax: LIMITS.quantityOwnerMax,
      quantityResellerMax: LIMITS.quantityResellerMax,
    },
    retention: {
      attemptsDays: RATE_LIMIT.retentionDays,
      apiLogsDays: 30,
      notificationDays: 30,
    },
    analytics: {
      suspectFailedMin: 10,
      sharedHwidKeysMin: 2,
      multiIpKeysMin: 3,
    },
    api: {
      enabled: true,
      rateLimitPerMinute: 60,
    },
    notify: {
      enabled: false,
      loginBurstFailures: 5,
      lowCreditThreshold: 5,
      dedupeMinutes: 30,
      notifyReseller: true,
      events: {
        autoBan: true,
        loginBurst: true,
        validationBurst: true,
        lowCredit: true,
        digest: true,
        security: true,
      },
    },
  };
}

/** Rentang aman per field — nilai di luar ini dijepit (bukan ditolak) supaya panel tetap jalan. */
export const SETTINGS_BOUNDS = {
  perIpPerMinute: [5, 1000],
  perKeyPerMinute: [3, 1000],
  bruteForceFailures: [2, 100],
  bruteForceWindowMinutes: [1, 1440],
  autoBanDistinctHwids: [2, 100],
  autoBanWindowMinutes: [5, 1440],
  tokenTtlSeconds: [60, 86_400],
  resetLimit: [1, 100],
  resetWindowHours: [1, 720],
  maxDeviceMin: [1, 10],
  maxDeviceMax: [1, 100],
  quantityOwnerMax: [1, 1000],
  quantityResellerMax: [1, 1000],
  attemptsDays: [1, 365],
  apiLogsDays: [1, 365],
  notificationDays: [1, 365],
  suspectFailedMin: [1, 10_000],
  sharedHwidKeysMin: [2, 100],
  multiIpKeysMin: [2, 1000],
  rateLimitPerMinute: [5, 6000],
  loginBurstFailures: [2, 100],
  lowCreditThreshold: [0, 1_000_000],
  dedupeMinutes: [0, 1440],
} as const;

const BOUNDS = SETTINGS_BOUNDS;

function clampNumber(value: unknown, bounds: readonly [number, number], fallback: number): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  return Math.min(bounds[1], Math.max(bounds[0], rounded));
}

function boolOr(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Gabungkan override (dari DB / request) dengan default, sekaligus menjepit nilai.
 * `partial` boleh hanya berisi sebagian field — sisanya memakai `base`.
 */
export function sanitizeRuntime(partial: unknown, base: RuntimeSettings): RuntimeSettings {
  const raw = record(partial);
  const validate = record(raw.validate);
  const hwid = record(raw.hwid);
  const keys = record(raw.keys);
  const retention = record(raw.retention);
  const analytics = record(raw.analytics);
  const api = record(raw.api);
  const notify = record(raw.notify);

  const maxDeviceMin = clampNumber(keys.maxDeviceMin, BOUNDS.maxDeviceMin, base.keys.maxDeviceMin);
  const maxDeviceMax = Math.max(
    maxDeviceMin,
    clampNumber(keys.maxDeviceMax, BOUNDS.maxDeviceMax, base.keys.maxDeviceMax),
  );

  return {
    validate: {
      perIpPerMinute: clampNumber(
        validate.perIpPerMinute,
        BOUNDS.perIpPerMinute,
        base.validate.perIpPerMinute,
      ),
      perKeyPerMinute: clampNumber(
        validate.perKeyPerMinute,
        BOUNDS.perKeyPerMinute,
        base.validate.perKeyPerMinute,
      ),
      bruteForceFailures: clampNumber(
        validate.bruteForceFailures,
        BOUNDS.bruteForceFailures,
        base.validate.bruteForceFailures,
      ),
      bruteForceWindowMinutes: clampNumber(
        validate.bruteForceWindowMinutes,
        BOUNDS.bruteForceWindowMinutes,
        base.validate.bruteForceWindowMinutes,
      ),
      autoBanDistinctHwids: clampNumber(
        validate.autoBanDistinctHwids,
        BOUNDS.autoBanDistinctHwids,
        base.validate.autoBanDistinctHwids,
      ),
      autoBanWindowMinutes: clampNumber(
        validate.autoBanWindowMinutes,
        BOUNDS.autoBanWindowMinutes,
        base.validate.autoBanWindowMinutes,
      ),
      tokenTtlSeconds: clampNumber(
        validate.tokenTtlSeconds,
        BOUNDS.tokenTtlSeconds,
        base.validate.tokenTtlSeconds,
      ),
    },
    hwid: {
      resetLimit: clampNumber(hwid.resetLimit, BOUNDS.resetLimit, base.hwid.resetLimit),
      resetWindowHours: clampNumber(
        hwid.resetWindowHours,
        BOUNDS.resetWindowHours,
        base.hwid.resetWindowHours,
      ),
    },
    keys: {
      maxDeviceMin,
      maxDeviceMax,
      quantityOwnerMax: clampNumber(
        keys.quantityOwnerMax,
        BOUNDS.quantityOwnerMax,
        base.keys.quantityOwnerMax,
      ),
      quantityResellerMax: clampNumber(
        keys.quantityResellerMax,
        BOUNDS.quantityResellerMax,
        base.keys.quantityResellerMax,
      ),
    },
    retention: {
      attemptsDays: clampNumber(retention.attemptsDays, BOUNDS.attemptsDays, base.retention.attemptsDays),
      apiLogsDays: clampNumber(retention.apiLogsDays, BOUNDS.apiLogsDays, base.retention.apiLogsDays),
      notificationDays: clampNumber(
        retention.notificationDays,
        BOUNDS.notificationDays,
        base.retention.notificationDays,
      ),
    },
    analytics: {
      suspectFailedMin: clampNumber(
        analytics.suspectFailedMin,
        BOUNDS.suspectFailedMin,
        base.analytics.suspectFailedMin,
      ),
      sharedHwidKeysMin: clampNumber(
        analytics.sharedHwidKeysMin,
        BOUNDS.sharedHwidKeysMin,
        base.analytics.sharedHwidKeysMin,
      ),
      multiIpKeysMin: clampNumber(
        analytics.multiIpKeysMin,
        BOUNDS.multiIpKeysMin,
        base.analytics.multiIpKeysMin,
      ),
    },
    api: {
      enabled: boolOr(api.enabled, base.api.enabled),
      rateLimitPerMinute: clampNumber(
        api.rateLimitPerMinute,
        BOUNDS.rateLimitPerMinute,
        base.api.rateLimitPerMinute,
      ),
    },
    notify: {
      enabled: boolOr(notify.enabled, base.notify.enabled),
      loginBurstFailures: clampNumber(
        notify.loginBurstFailures,
        BOUNDS.loginBurstFailures,
        base.notify.loginBurstFailures,
      ),
      lowCreditThreshold: clampNumber(
        notify.lowCreditThreshold,
        BOUNDS.lowCreditThreshold,
        base.notify.lowCreditThreshold,
      ),
      dedupeMinutes: clampNumber(notify.dedupeMinutes, BOUNDS.dedupeMinutes, base.notify.dedupeMinutes),
      notifyReseller: boolOr(notify.notifyReseller, base.notify.notifyReseller),
      events: {
        autoBan: boolOr(record(notify.events).autoBan, base.notify.events.autoBan),
        loginBurst: boolOr(record(notify.events).loginBurst, base.notify.events.loginBurst),
        validationBurst: boolOr(
          record(notify.events).validationBurst,
          base.notify.events.validationBurst,
        ),
        lowCredit: boolOr(record(notify.events).lowCredit, base.notify.events.lowCredit),
        digest: boolOr(record(notify.events).digest, base.notify.events.digest),
        security: boolOr(record(notify.events).security, base.notify.events.security),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Cache (per proses)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 15_000;
let cached: { value: RuntimeSettings; expiresAt: number } | null = null;

/** Batalkan cache — dipanggil setelah Pengaturan disimpan. */
export function invalidateSettingsCache(): void {
  cached = null;
}

/**
 * Ambil konfigurasi runtime yang berlaku (default + override dari DB).
 * `bypassCache` dipakai halaman Pengaturan supaya angka yang tampil selalu
 * yang terbaru (bukan sisa cache 15 detik).
 */
export async function loadRuntime(
  admin: SupabaseClient<Database>,
  options: { bypassCache?: boolean } = {},
): Promise<RuntimeSettings> {
  const now = Date.now();
  if (!options.bypassCache && cached && cached.expiresAt > now) return cached.value;

  const base = defaultRuntime();
  let value = base;

  try {
    const { data, error } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "runtime")
      .maybeSingle<{ value: unknown }>();
    if (error) throw new Error(error.message);
    // Postgres (JSONB) → objek; SQLite (TEXT) → string JSON. Helper ini
    // menormalkan keduanya supaya konfigurasi yang disimpan benar-benar terbaca.
    value = sanitizeRuntime(parseJsonObjectOrEmpty(data?.value), base);
  } catch (error) {
    // Settings tidak boleh membuat panel mati — pakai default & lanjut.
    console.warn("[settings] gagal membaca app_settings:", (error as Error)?.message ?? error);
  }

  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/**
 * Simpan override runtime. `patch` boleh sebagian; nilai digabung dengan yang
 * berlaku sekarang (bukan hanya default), lalu dijepit dan disanitasi.
 */
export async function saveRuntime(
  admin: SupabaseClient<Database>,
  patch: unknown,
  updatedBy: string,
): Promise<RuntimeSettings> {
  const base = defaultRuntime();
  const current = await loadRuntime(admin);
  const merged = sanitizeRuntime(mergeRuntimePatch(current, base, patch), base);

  const { error } = await admin.from("app_settings").upsert(
    {
      key: "runtime",
      value: merged as unknown,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  if (error) throw new Error("Gagal menyimpan pengaturan: " + error.message);

  cached = { value: merged, expiresAt: Date.now() + CACHE_TTL_MS };
  return merged;
}

/**
 * Gabungkan patch bersarang: nilai yang tidak dikirim tetap memakai nilai
 * runtime sekarang (default kalau belum pernah diubah).
 */
function mergeRuntimePatch(
  current: RuntimeSettings,
  base: RuntimeSettings,
  patch: unknown,
): Record<string, unknown> {
  const raw = record(patch);
  const out: Record<string, unknown> = { ...current };

  (Object.keys(current) as (keyof RuntimeSettings)[]).forEach((section) => {
    const patchSection = raw[section];
    if (patchSection === undefined) return;
    const existing = current[section];
    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
      // `events` juga objek bersarang: merge dua tingkat cukup untuk struktur ini.
      const merged: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
      const incoming = record(patchSection);
      Object.entries(incoming).forEach(([key, value]) => {
        const previous = merged[key];
        if (previous && typeof previous === "object" && !Array.isArray(previous)) {
          merged[key] = { ...(previous as Record<string, unknown>), ...record(value) };
        } else {
          merged[key] = value;
        }
      });
      out[section] = merged;
    } else {
      out[section] = patchSection;
    }
  });

  // Field yang tidak dikenal dibuang oleh sanitizeRuntime (hanya membaca key yang dikenal).
  void base;
  return out;
}

// ---------------------------------------------------------------------------
// Telegram (rahasia — token tidak pernah dikirim ke browser)
// ---------------------------------------------------------------------------

export interface TelegramConfig {
  botToken: string | null;
  botUsername: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  /** Kirim notifikasi (auto-ban, saldo tipis, digest) juga ke Telegram. */
  notificationsEnabled: boolean;
}

export const EMPTY_TELEGRAM: TelegramConfig = {
  botToken: null,
  botUsername: null,
  webhookUrl: null,
  webhookSecret: null,
  notificationsEnabled: true,
};

/** Status Telegram yang aman dikirim ke client (tanpa token/secret). */
export interface TelegramStatus {
  connected: boolean;
  bot_username: string | null;
  webhook_url: string | null;
  notifications_enabled: boolean;
}

export async function loadTelegram(admin: SupabaseClient<Database>): Promise<TelegramConfig> {
  try {
    const { data, error } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "telegram")
      .maybeSingle<{ value: unknown }>();
    if (error) throw new Error(error.message);

    const raw = parseJsonObjectOrEmpty<Record<string, unknown>>(data?.value);
    return {
      botToken: typeof raw.bot_token === "string" && raw.bot_token ? raw.bot_token : null,
      botUsername: typeof raw.bot_username === "string" && raw.bot_username ? raw.bot_username : null,
      webhookUrl: typeof raw.webhook_url === "string" && raw.webhook_url ? raw.webhook_url : null,
      webhookSecret:
        typeof raw.webhook_secret === "string" && raw.webhook_secret ? raw.webhook_secret : null,
      notificationsEnabled: boolOr(raw.notifications_enabled, true),
    };
  } catch (error) {
    console.warn("[settings] gagal membaca konfigurasi telegram:", (error as Error)?.message ?? error);
    return { ...EMPTY_TELEGRAM };
  }
}

export async function saveTelegram(
  admin: SupabaseClient<Database>,
  patch: Partial<TelegramConfig>,
  updatedBy: string,
): Promise<TelegramConfig> {
  const current = await loadTelegram(admin);
  const next: TelegramConfig = { ...current, ...patch };

  const { error } = await admin.from("app_settings").upsert(
    {
      key: "telegram",
      value: {
        bot_token: next.botToken,
        bot_username: next.botUsername,
        webhook_url: next.webhookUrl,
        webhook_secret: next.webhookSecret,
        notifications_enabled: next.notificationsEnabled,
      } as unknown,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  if (error) throw new Error("Gagal menyimpan konfigurasi Telegram: " + error.message);
  return next;
}

export function telegramStatus(config: TelegramConfig): TelegramStatus {
  return {
    connected: Boolean(config.botToken),
    bot_username: config.botUsername,
    webhook_url: config.webhookUrl,
    notifications_enabled: config.notificationsEnabled,
  };
}

// ---------------------------------------------------------------------------
// Payload untuk client
// ---------------------------------------------------------------------------

/** Batas/limit yang boleh diketahui client (untuk validasi form & tampilan). */
export interface PublicSettings {
  limits: {
    maxDeviceMin: number;
    maxDeviceMax: number;
    quantityOwnerMax: number;
    quantityResellerMax: number;
    noteMax: number;
    secretPayloadMax: number;
  };
  hwid: { resetLimit: number; resetWindowHours: number };
  retention: { attemptsDays: number; apiLogsDays: number; notificationDays: number };
  analytics: { suspectFailedMin: number };
  api: { enabled: boolean; rateLimitPerMinute: number };
  notify: { enabled: boolean };
}

export function publicSettings(runtime: RuntimeSettings): PublicSettings {
  return {
    limits: {
      maxDeviceMin: runtime.keys.maxDeviceMin,
      maxDeviceMax: runtime.keys.maxDeviceMax,
      quantityOwnerMax: runtime.keys.quantityOwnerMax,
      quantityResellerMax: runtime.keys.quantityResellerMax,
      noteMax: LIMITS.noteMax,
      secretPayloadMax: LIMITS.secretPayloadMax,
    },
    hwid: { resetLimit: runtime.hwid.resetLimit, resetWindowHours: runtime.hwid.resetWindowHours },
    retention: {
      attemptsDays: runtime.retention.attemptsDays,
      apiLogsDays: runtime.retention.apiLogsDays,
      notificationDays: runtime.retention.notificationDays,
    },
    analytics: { suspectFailedMin: runtime.analytics.suspectFailedMin },
    api: { enabled: runtime.api.enabled, rateLimitPerMinute: runtime.api.rateLimitPerMinute },
    notify: { enabled: runtime.notify.enabled },
  };
}
