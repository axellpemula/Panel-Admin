/**
 * Helper JSON untuk nilai kolom yang tipenya berbeda antar mode database:
 * - Postgres menyimpan `JSONB` → supabase-js mengembalikan **objek**,
 * - SQLite menyimpan `TEXT` → adapter mengembalikan **string JSON**.
 *
 * Semua kode pembaca kolom JSON (app_settings.value, activity_logs.detail,
 * notification_logs.detail, dst.) harus lewat helper ini supaya perilakunya sama
 * di kedua mode.
 */

/** Ubah nilai apa pun jadi objek (bukan array) atau null kalau tidak bisa. */
export function parseJsonObject<T = Record<string, unknown>>(value: unknown): T | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "object") {
    return Array.isArray(value) ? null : (value as T);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
    } catch {
      return null;
    }
  }

  return null;
}

/** Sama seperti `parseJsonObject`, tapi selalu mengembalikan objek (default `{}`). */
export function parseJsonObjectOrEmpty<T = Record<string, unknown>>(value: unknown): T {
  return parseJsonObject<T>(value) ?? ({} as T);
}
