import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Middleware global — hanya untuk HALAMAN:
 * - mode Supabase: refresh sesi + redirect ke /login kalau belum login,
 *   redirect ke /dashboard kalau sudah login tapi membuka /login,
 *   tolak akun nonaktif;
 * - mode SQLite: cek cookie sesi lokal `xloop_session` (lihat lib/supabase/middleware.ts).
 *
 * Seluruh `/api/*` sengaja DIKECUALIKAN: route API memeriksa sesi sendiri
 * (`withAuth` / `withOwner`) dan menjawab `401 {ok:false}` — bukan redirect HTML.
 * Jadi klien panel bisa membedakan "sesi habis" dari error lain, dan endpoint
 * mesin (/api/validate, /api/cron/cleanup) tetap punya proteksinya sendiri.
 * Aset statis juga dikecualikan.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Jalankan untuk semua path kecuali:
     * - /api/* : route API memakai withAuth/withOwner (401 JSON), bukan redirect
     * - _next/static, _next/image, favicon
     * - file statis (punya ekstensi)
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|json)$).*)",
  ],
};
