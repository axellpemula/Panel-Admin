/**
 * Helper format & tanggal — dipakai di UI (client & server).
 */

/** Nilai yang dipakai saat key tidak punya tanggal expired. */
export const LIFETIME_LABEL = "Lifetime";

/** Format tanggal ringkas: 12 Jun 2026, 09:30 (WIB/Asia/Jakarta). */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

/** Format tanggal saja: 12 Jun 2026. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

/** Tanggal expired: "-" kalau null, "Lifetime" ditangani pemanggil. */
export function formatExpiredAt(value: string | null | undefined): string {
  if (!value) return LIFETIME_LABEL;
  return formatDateTime(value);
}

/** Angka dengan pemisah ribuan gaya Indonesia. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("id-ID").format(value);
}

/** Pemakaian slot device: "1/2". */
export function formatDeviceUsage(used: number, max: number): string {
  return `${used}/${max}`;
}

/** Sisa waktu dalam bahasa manusia: "3 hari lagi", "2 jam lagi", "3 hari lalu" (sudah lewat). */
export function formatRelativeToNow(value: string | null | undefined): string {
  if (!value) return LIFETIME_LABEL;
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) return "-";
  const diffMs = target - Date.now();
  const overdue = diffMs < 0;
  const absMinutes = Math.round(Math.abs(diffMs) / 60_000);
  const days = Math.floor(absMinutes / 1440);
  const hours = Math.floor((absMinutes % 1440) / 60);
  const minutes = absMinutes % 60;

  let text: string;
  if (days >= 1) text = `${days} hari`;
  else if (hours >= 1) text = `${hours} jam`;
  else text = `${Math.max(minutes, 1)} menit`;

  return overdue ? `${text} lalu` : `${text} lagi`;
}

/** Slug dari nama: "Perkakas Pro" → "perkakas-pro". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

/** Tambah hari ke tanggal (kalau `from` kosong → mulai dari sekarang). */
export function addDays(from: Date | string | null | undefined, days: number): Date {
  const base = from ? new Date(from) : new Date();
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(safeBase.getTime() + days * 86_400_000);
}

/** Tanggal (YYYY-MM-DD) di zona waktu Asia/Jakarta. */
export function toJakartaDateKey(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts;
}

/** Label pendek untuk sumbu X chart: "12 Jun". */
export function formatShortDay(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

/** Awal hari (00:00) dalam UTC untuk zona waktu Jakarta. */
export function startOfJakartaDay(daysAgo = 0): Date {
  const now = new Date();
  const key = toJakartaDateKey(now);
  const [y, m, d] = key.split("-").map((part) => Number.parseInt(part, 10));
  // Jakarta = UTC+7, jadi 00:00 WIB = 17:00 UTC hari sebelumnya.
  const utcMidnight = Date.UTC(y, m - 1, d, -7, 0, 0, 0);
  return new Date(utcMidnight - daysAgo * 86_400_000);
}

/** Nama hari singkat: "Sen", "Sel", ... */
export function formatWeekday(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

/** Potong teks panjang untuk preview di tabel. */
export function truncate(input: string, max = 32): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

/** Label status key. */
/** Label aksi credit log (dipakai tabel Marketing/Credit Log & export CSV). */
export const CREDIT_ACTION_LABEL: Record<string, string> = {
  topup: "Topup",
  generate: "Generate",
  extend: "Perpanjang",
  refund: "Pengembalian",
  adjustment: "Penyesuaian",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  expired: "Expired",
  banned: "Banned",
};

/** Label aksi audit log (dipakai tabel Audit Log & export CSV). */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  key_ban: "Ban key",
  key_unban: "Unban key",
  key_delete: "Hapus key",
  hwid_reset: "Reset HWID",
  hwid_reset_all: "Reset semua HWID",
  key_auto_ban: "Auto-ban (HWID)",
};

/** Label alasan ban terstruktur (dipakai tabel Audit Log, badge key, & export CSV). */
export const BAN_REASON_LABEL: Record<string, string> = {
  manual: "Manual",
  auto_hwid: "Auto (HWID)",
  refund: "Refund",
  other: "Lainnya",
};

/** Label alasan hasil /api/validate (dipakai halaman Validation Attempts & export CSV). */
export const VALIDATION_REASON_LABEL: Record<string, string> = {
  invalid_request: "Request tidak valid",
  invalid_key: "Key tidak valid",
  key_expired: "Key kedaluwarsa",
  key_banned: "Key diblokir",
  wrong_tool: "Tool salah",
  wrong_version: "Versi salah",
  device_limit_exceeded: "Device melebihi batas",
  rate_limited: "Kena rate limit",
  server_error: "Server error",
};

/** Warna titik status (class Tailwind memakai token warna). */
export const STATUS_DOT: Record<string, string> = {
  active: "bg-active",
  expired: "bg-expired",
  banned: "bg-banned",
};
