/**
 * Konstanta bersama untuk panel & endpoint validasi.
 */

/** Format key: XLVP-XXXX-XXXX (huruf besar + angka). */
export const KEY_REGEX = /^XLVP-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Nonce dari client: 16–64 karakter [A-Za-z0-9_-]. */
export const NONCE_REGEX = /^[A-Za-z0-9_-]{16,64}$/;

/** Alpabet key — tanpa huruf/angka yang mudah tertukar dibaca (0/O, 1/I). */
export const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Batas panjang field /api/validate. */
export const LIMITS = {
  bodyBytes: 2048,
  hardwareIdMin: 16,
  hardwareIdMax: 128,
  toolSlugMax: 64,
  toolVersionMax: 64,
  noteMax: 500,
  defaultMaxDevice: 1,
  maxDeviceMin: 1,
  maxDeviceMax: 10,
  quantityOwnerMax: 100,
  quantityResellerMax: 50,
  secretPayloadMax: 16_384,
} as const;

/** Rate limit /api/validate. */
export const RATE_LIMIT = {
  perIpPerMinute: 30,
  perKeyPerMinute: 15,
  bruteForceFailures: 5,
  bruteForceWindowMinutes: 10,
  autoBanDistinctHwids: 5,
  autoBanWindowMinutes: 60,
  autoBanNote: "Auto-ban: terlalu banyak device berbeda",
  retentionDays: 7,
} as const;

/**
 * Cooldown reset HWID — mengurangi kebiasaan berbagi key lewat reset berulang.
 * Reseller maksimal boleh reset HWID (termasuk Reset Semua) sebanyak
 * HWID_RESET_LIMIT dalam window HWID_RESET_WINDOW_HOURS jam per key.
 * Owner TIDAK terkena limit (bisa reset kapan pun untuk keperluan support).
 */
export const HWID_RESET = {
  limit: 3,
  windowHours: 24,
} as const;

/** Semua alasan gagal yang mungkin dikembalikan /api/validate. */
export const VALIDATION_REASONS = [
  "invalid_request",
  "invalid_key",
  "key_expired",
  "key_banned",
  "wrong_tool",
  "wrong_version",
  "device_limit_exceeded",
  "rate_limited",
  "server_error",
] as const;

export type ValidationReason = (typeof VALIDATION_REASONS)[number];

/** Nama tabel Supabase. */
export const TABLES = {
  profiles: "profiles",
  toolTypes: "tool_types",
  toolVersions: "tool_versions",
  durationPresets: "duration_presets",
  keys: "keys",
  deviceLogs: "device_logs",
  creditLogs: "credit_logs",
  toolSecrets: "tool_secrets",
  validationAttempts: "validation_attempts",
  auditLogs: "audit_logs",
} as const;

/** Semua aksi yang dicatat di audit log. */
export const AUDIT_ACTIONS = [
  "key_ban",
  "key_unban",
  "key_delete",
  "hwid_reset",
  "hwid_reset_all",
  "key_auto_ban",
] as const;

/** Alasan ban terstruktur. `auto_hwid` hanya dipakai auto-ban sistem. */
export const BAN_REASONS = ["manual", "auto_hwid", "refund", "other"] as const;

/** Alasan ban yang boleh dipilih manual lewat panel (auto_hwid khusus sistem). */
export const MANUAL_BAN_REASONS = ["manual", "refund", "other"] as const;

/** Cookie sesi Supabase (dipakai middleware & login). */
export const AUTH_ROUTES = {
  login: "/login",
  dashboard: "/dashboard",
} as const;

/**
 * Nama cookie sesi mode SQLite. Dipakai tiga tempat:
 * - `lib/db/sqlite/auth.ts` (menulis & membaca),
 * - middleware Edge (`lib/supabase/middleware.ts`) yang hanya boleh cek keberadaannya,
 * - uji otomatis (login lewat API lalu pakai cookie ini).
 */
export const SESSION_COOKIE_NAME = "xloop_session";

/** ID elemen sidebar — dipakai tombol toggle (aria-controls) di sidebar & topbar. */
export const SIDEBAR_ID = "app-sidebar";

/**
 * Cookie status sidebar. Nilai awal dibaca di server (`app/(dashboard)/layout.tsx`)
 * supaya HTML pertama sudah benar, lalu ditulis ulang dari client setiap toggle.
 */
export const SIDEBAR_COOKIE = {
  name: "xloop_sidebar",
  hidden: "hidden",
  open: "open",
  maxAgeSeconds: 60 * 60 * 24 * 365,
} as const;
