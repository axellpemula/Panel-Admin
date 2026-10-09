/**
 * Cookie sisi klien untuk preferensi tampilan (bukan data sensitif).
 *
 * Dipakai komponen client; server membaca nilainya lewat `cookies()`
 * (lihat `lib/supabase/middleware.ts` untuk cookie sesi Supabase).
 */
export function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;

  document.cookie =
    `${name}=${encodeURIComponent(value)}` +
    `; path=/; max-age=${maxAgeSeconds}; samesite=lax`;
}
