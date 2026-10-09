import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/constants";
import { isSqliteMode, supabaseAnonKey, supabaseUrl } from "@/lib/env";

/**
 * Proteksi route di middleware (jalan di Edge runtime).
 *
 * - Mode Supabase: refresh sesi + redirect (lihat bawah).
 * - Mode SQLite: Edge tidak bisa membuka file SQLite, jadi middleware hanya
 *   memeriksa KEBERADAAN cookie sesi `xloop_session`; validasi token + status
 *   akun dilakukan di server (`requireSession` / `withAuth`). Kalau tokennya
 *   sudah tidak valid, halaman akan melempar ke /login — tidak ada loop.
 *
 * - Belum login & bukan halaman publik → redirect /login?next=<path>
 * - Sudah login tapi buka /login → redirect /dashboard
 * - Akun nonaktif (profiles.is_active = false) → cookie dibersihkan + redirect /login?error=inactive
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (isSqliteMode()) return sqliteSessionGuard(request);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLoginRoute = path === "/login" || path.startsWith("/login/");

  if (!user) {
    if (isLoginRoute) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (path !== "/dashboard") url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Sesi valid — cek status akun (RLS: user hanya bisa baca profilnya sendiri).
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("error", "inactive");
    const redirect = NextResponse.redirect(url);
    request.cookies.getAll().forEach((cookie) => {
      if (cookie.name.startsWith("sb-")) redirect.cookies.delete(cookie.name);
    });
    return redirect;
  }

  if (isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

/** Guard ringan untuk mode SQLite (Edge runtime tidak punya akses file DB). */
function sqliteSessionGuard(request: NextRequest): NextResponse {
  const response = NextResponse.next({ request });
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  const path = request.nextUrl.pathname;
  const isLoginRoute = path === "/login" || path.startsWith("/login/");

  if (!hasSession && !isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (path !== "/dashboard") url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (hasSession && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
