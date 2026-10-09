/**
 * Validator input sederhana untuk API routes (tanpa dependency tambahan).
 * Semua fungsi mengembalikan nilai yang sudah bersih atau null kalau tidak valid.
 */

export function asString(value: unknown, maxLength = 255, { trim = true } = {}): string | null {
  if (typeof value !== "string") return null;
  const result = trim ? value.trim() : value;
  if (result.length === 0) return null;
  if (result.length > maxLength) return null;
  return result;
}

export function asOptionalString(value: unknown, maxLength = 500): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

export function asInt(value: unknown, min: number, max: number): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

export function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function asUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(trimmed) ? trimmed : null;
}

export function asEmail(value: unknown): string | null {
  const raw = asString(value, 254);
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) return null;
  return lower;
}

/**
 * Cek tanggal kalender yang NYATA. Date.UTC menggulung nilai tidak valid
 * (2026-02-30 → 2 Maret) dan tahun 0–99 dianggap 19xx — dua-duanya musti ditolak.
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** ISO datetime dari string tanggal/ISO. */
export function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // String date-only (YYYY-MM-DD) divalidasi ketat: parser bisa menggulung
  // tanggal tidak valid (mis. 2026-02-30 menjadi 2 Maret) tanpa error.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number.parseInt(dateOnly[1], 10);
    const month = Number.parseInt(dateOnly[2], 10);
    const day = Number.parseInt(dateOnly[3], 10);
    if (!isRealCalendarDate(year, month, day)) return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Tanggal YYYY-MM-DD → ISO di akhir hari (23:59:59.999 WIB). */
export function asDateOnlyToIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!isRealCalendarDate(year, month, day)) return null;
  // Akhir hari di zona Asia/Jakarta (UTC+7) → 16:59:59.999Z.
  const utc = Date.UTC(year, month - 1, day, 16, 59, 59, 999);
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Password minimal 8 karakter. */
export function asPassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < 8 || value.length > 72) return null;
  return value;
}

/** Slug: huruf kecil, angka, dan tanda hubung. */
export function asSlug(value: unknown): string | null {
  const raw = asString(value, 64);
  if (!raw) return null;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : null;
}
