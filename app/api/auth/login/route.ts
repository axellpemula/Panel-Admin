import type { NextRequest } from "next/server";

import { checkLoginAttempt, clearLoginFailures, recordLoginFailure } from "@/lib/api/login-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/types/database";
import { clientIp, jsonError, jsonOk, errorMessage } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

/**
 * POST /api/auth/login
 * Login lewat Supabase Auth, lalu cek `profiles.is_active`.
 * Akun nonaktif ditolak dengan pesan "Akun kamu dinonaktifkan".
 *
 * Rate limit: maksimal 10 percobaan GAGAL per IP per 10 menit (anti brute-force,
 * lihat lib/api/login-guard.ts).
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  const guard = checkLoginAttempt(ip);
  if (!guard.allowed) {
    const minutes = Math.ceil(guard.retryAfterSeconds / 60);
    return jsonError(
      `Terlalu banyak percobaan login. Coba lagi dalam ${minutes} menit.`,
      "rate_limited",
      429,
    );
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return jsonError("Format request tidak valid", "validation_error", 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return jsonError("Email dan password wajib diisi", "validation_error", 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError("Format email tidak valid", "validation_error", 400);
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      recordLoginFailure(ip);
      const message = error?.message?.toLowerCase() ?? "";
      if (message.includes("email not confirmed")) {
        return jsonError("Email belum dikonfirmasi. Hubungi Owner.", "unauthorized", 401);
      }
      if (message.includes("invalid login") || message.includes("invalid credentials")) {
        return jsonError("Email atau password salah", "unauthorized", 401);
      }
      return jsonError(error?.message ?? "Email atau password salah", "unauthorized", 401);
    }

    // Cek status akun lewat service role (RLS tidak menghalangi).
    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .maybeSingle<ProfileRow>();

    if (profileError) {
      await supabase.auth.signOut();
      return jsonError("Gagal membaca profil akun", "server_error", 500);
    }

    if (!profile) {
      await supabase.auth.signOut();
      return jsonError("Profil akun tidak ditemukan. Hubungi Owner.", "forbidden", 403);
    }

    if (profile.is_active === false) {
      await supabase.auth.signOut();
      return jsonError("Akun kamu dinonaktifkan", "forbidden", 403);
    }

    // Login sukses → riwayat gagal IP ini direset.
    clearLoginFailures(ip);

    return jsonOk({
      user: {
        id: profile.id,
        username: profile.username,
        email: profile.email,
        role: profile.role,
        credit: profile.credit,
      },
    });
  } catch (error) {
    return jsonError(errorMessage(error), "server_error", 500);
  }
}
