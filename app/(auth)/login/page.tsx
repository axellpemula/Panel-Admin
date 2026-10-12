import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/(auth)/login/LoginForm";
import { XloopMark } from "@/components/ui/XloopMark";
import { isSqliteMode, sqliteDatabasePath } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Login · XLOOP PANEL",
};

const ERROR_MESSAGES: Record<string, string> = {
  inactive: "Akun kamu dinonaktifkan",
  no_profile: "Profil akun tidak ditemukan. Hubungi Owner.",
  session: "Sesi kamu berakhir. Silakan login lagi.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const sqliteMode = isSqliteMode();

  const errorMessage = searchParams.error
    ? (ERROR_MESSAGES[searchParams.error] ?? "Gagal login. Coba lagi.")
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <XloopMark size={32} />
          <div>
            <h1 className="text-[15px] font-medium leading-5">XLOOP PANEL</h1>
            <p className="text-label text-muted">Masuk untuk mengelola key</p>
          </div>
        </div>

        {sqliteMode ? (
          <div className="card mb-4 border-accent/40 p-3 text-label text-muted">
            <span className="font-medium text-text">Mode SQLite aktif</span> — env Database server belum diisi,
            jadi data disimpan lokal di <span className="font-mono">{sqliteDatabasePath()}</span>.
          </div>
        ) : null}

        <div className="card p-4">
          <LoginForm initialError={errorMessage} nextPath={searchParams.next ?? "/dashboard"} />
        </div>

        <p className="mt-4 text-label text-muted">
          Belum punya akses? Hubungi Owner untuk mendapatkan akses.
        </p>
      </div>
    </main>
  );
}
