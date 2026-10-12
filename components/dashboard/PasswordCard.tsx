"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Toggle } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, apiPost } from "@/lib/api/client";

export function PasswordCard() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [logoutOthers, setLogoutOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!currentPassword || !newPassword) {
      setError("Password lama dan password baru wajib diisi");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password baru minimal 8 karakter");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Ulangi password baru dengan benar");
      return;
    }

    setBusy(true);
    try {
      const result = await apiPost<{ updated: boolean; other_sessions_revoked: number }>(
        "/api/auth/password",
        {
          current_password: currentPassword,
          new_password: newPassword,
          logout_others: logoutOthers,
        },
      );

      const revoked = result.other_sessions_revoked;
      toast.success(
        logoutOthers
          ? revoked > 0
            ? `Password diganti. ${revoked} sesi lain sudah diputus.`
            : "Password diganti. Semua sesi lain sudah diputus."
          : "Password berhasil diganti.",
      );
      reset();
    } catch (err) {
      const message =
        err instanceof ApiClientError ? err.message : "Gagal mengganti password. Coba lagi.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-muted" aria-hidden="true">
          <KeyRound size={16} strokeWidth={1.5} />
        </span>
        <h2 className="text-body font-medium">Ganti Password</h2>
      </header>

      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        <p className="text-label text-muted">
          Password baru langsung berlaku untuk login berikutnya. Minimal 8 karakter — sebaiknya
          campuran huruf besar, huruf kecil, dan angka.
        </p>

        <Field label="Password lama" hint="Dipakai untuk memastikan ini benar-benar kamu.">
          <Input
            type="password"
            value={currentPassword}
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="••••••••"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Password baru"
            error={tooShort ? "Minimal 8 karakter" : undefined}
          >
            <Input
              type="password"
              value={newPassword}
              autoComplete="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="••••••••"
            />
          </Field>

          <Field
            label="Ulangi password baru"
            error={mismatch ? "Belum sama dengan password baru" : undefined}
          >
            <Input
              type="password"
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="••••••••"
            />
          </Field>
        </div>

        <div className="rounded-md border border-border bg-surface/60 px-3 py-2.5">
          <Toggle
            checked={logoutOthers}
            onChange={setLogoutOthers}
            label="Keluar dari semua perangkat lain"
          />
          <p className="mt-1 text-label text-muted">
            Semua sesi di perangkat/browser lain langsung diputus setelah password berubah.
          </p>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-label text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-label text-muted">
            <ShieldCheck size={14} strokeWidth={1.5} aria-hidden="true" />
            Sesi di perangkat ini tetap aktif.
          </span>
          <Button type="submit" loading={busy}>
            Simpan
          </Button>
        </div>
      </form>
    </section>
  );
}
