"use client";

import {
  KeyRound,
  Pencil,
  Plus,
  ShieldOff,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CreditAdjustModal } from "@/components/dashboard/CreditAdjustModal";
import { ActiveBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Form";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { TopReseller } from "@/lib/api/stats";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import { CREDIT_ACTION_LABEL, formatDateTime, formatNumber } from "@/lib/utils/format";

/** Reseller Management (Owner): tambah, topup, aktif/nonaktif, reset password, hapus. */
export function ResellersView() {
  const toast = useToast();

  const [resellers, setResellers] = useState<TopReseller[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", email: "", password: "", credit: "0" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [topupTarget, setTopupTarget] = useState<TopReseller | null>(null);
  const [topupAmount, setTopupAmount] = useState("10");
  const [topupNote, setTopupNote] = useState("");
  const [adjustTarget, setAdjustTarget] = useState<TopReseller | null>(null);

  const [passwordTarget, setPasswordTarget] = useState<TopReseller | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [editTarget, setEditTarget] = useState<TopReseller | null>(null);
  const [editForm, setEditForm] = useState({ username: "", email: "" });

  const [deleteTarget, setDeleteTarget] = useState<TopReseller | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiGet<{ resellers: TopReseller[] }>("/api/resellers");
      setResellers(response.resellers);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat reseller");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const createReseller = async () => {
    setCreateError(null);
    const credit = Number.parseInt(createForm.credit, 10);
    if (!createForm.username.trim()) return setCreateError("Username wajib diisi");
    if (!createForm.email.trim()) return setCreateError("Email wajib diisi");
    if (createForm.password.length < 8) return setCreateError("Password minimal 8 karakter");
    if (!Number.isFinite(credit) || credit < 0) return setCreateError("Credit awal tidak valid");

    setSaving(true);
    try {
      await apiPost("/api/resellers", {
        username: createForm.username.trim(),
        email: createForm.email.trim(),
        password: createForm.password,
        credit,
      });
      toast.success("Reseller dibuat");
      setCreateOpen(false);
      setCreateForm({ username: "", email: "", password: "", credit: "0" });
      await load();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Gagal membuat reseller");
    } finally {
      setSaving(false);
    }
  };

  const topup = async () => {
    if (!topupTarget) return;
    const amount = Number.parseInt(topupAmount, 10);
    if (!Number.isFinite(amount) || amount < 1) {
      toast.error("Jumlah credit minimal 1");
      return;
    }

    setBusy(true);
    try {
      await apiPut(`/api/resellers/${topupTarget.id}`, {
        action: "topup",
        amount,
        note: topupNote.trim().length > 0 ? topupNote.trim() : null,
      });
      toast.success(`Topup ${formatNumber(amount)} credit berhasil`);
      setTopupTarget(null);
      setTopupNote("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal topup credit");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (reseller: TopReseller) => {
    try {
      await apiPut(`/api/resellers/${reseller.id}`, {
        action: "set_active",
        is_active: !reseller.is_active,
      });
      toast.success(reseller.is_active ? "Reseller dinonaktifkan" : "Reseller diaktifkan");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah status reseller");
    }
  };

  const resetPassword = async () => {
    if (!passwordTarget) return;
    if (newPassword.length < 8) {
      toast.error("Password minimal 8 karakter");
      return;
    }

    setBusy(true);
    try {
      await apiPut(`/api/resellers/${passwordTarget.id}`, {
        action: "reset_password",
        password: newPassword,
      });
      toast.success("Password reseller diubah");
      setPasswordTarget(null);
      setNewPassword("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah password");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setBusy(true);
    try {
      await apiPut(`/api/resellers/${editTarget.id}`, {
        action: "update",
        username: editForm.username.trim(),
        email: editForm.email.trim(),
      });
      toast.success("Data reseller diperbarui");
      setEditTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui reseller");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const result = await apiDelete<{ removed_keys: number }>(`/api/resellers/${deleteTarget.id}`, {
        confirm_username: deleteTarget.username,
      });
      toast.success(`Reseller dihapus${result.removed_keys > 0 ? ` beserta ${result.removed_keys} key` : ""}`);
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus reseller");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium">Reseller</h1>
          <p className="mt-1 text-body text-muted">
            Kelola akun reseller, credit, dan akses login mereka.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setCreateError(null);
            setCreateOpen(true);
          }}
          icon={<Plus size={16} strokeWidth={1.5} />}
        >
          Tambah Reseller
        </Button>
      </header>

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={4} columns={5} />
        ) : resellers.length === 0 ? (
          <EmptyState
            message="Belum ada reseller"
            action={
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                Tambah Reseller
              </Button>
            }
          />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[920px] text-body">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-label text-muted">
                  <th scope="col" className="px-3 py-2 font-normal">
                    Username
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Email
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Sisa credit
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Total key
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-normal">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resellers.map((reseller) => (
                  <tr key={reseller.id} className="row-hover h-11">
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/resellers/${reseller.id}`}
                        className="transition-colors duration-150 hover:text-accent"
                        title="Buka halaman detail reseller"
                      >
                        {reseller.username}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-muted">{reseller.email}</td>
                    <td className="px-3 py-1.5 tabular-nums">{formatNumber(reseller.credit)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-muted">{formatNumber(reseller.key_count)}</td>
                    <td className="px-3 py-1.5">
                      <ActiveBadge active={reseller.is_active} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          onClick={() => {
                            setTopupTarget(reseller);
                            setTopupAmount("10");
                          }}
                          icon={<Wallet size={14} strokeWidth={1.5} />}
                        >
                          Topup
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => setAdjustTarget(reseller)}
                          icon={<SlidersHorizontal size={14} strokeWidth={1.5} />}
                          aria-label={`Sesuaikan credit ${reseller.username}`}
                        >
                          Sesuaikan
                        </Button>
                        <Link href={`/resellers/${reseller.id}`} className="inline-flex">
                          <Button size="sm" icon={<KeyRound size={14} strokeWidth={1.5} />}>
                            Detail
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditTarget(reseller);
                            setEditForm({ username: reseller.username, email: reseller.email });
                          }}
                          icon={<Pencil size={14} strokeWidth={1.5} />}
                          aria-label="Edit reseller"
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setPasswordTarget(reseller);
                            setNewPassword("");
                          }}
                        >
                          Password
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void toggleActive(reseller)}
                          icon={
                            reseller.is_active ? (
                              <ShieldOff size={14} strokeWidth={1.5} />
                            ) : (
                              <ShieldCheck size={14} strokeWidth={1.5} />
                            )
                          }
                        >
                          {reseller.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </Button>
                        <Button
                          size="sm"
                                                    onClick={() => setDeleteTarget(reseller)}
                          icon={<Trash2 size={14} strokeWidth={1.5} />}
                          aria-label="Hapus reseller"
                        >
                          Hapus
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tambah reseller */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Tambah Reseller"
        description="Owner menentukan password awal. Tidak ada halaman register publik."
        size="sm"
        busy={saving}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={createReseller}>
              Buat Reseller
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Username" required hint="3–32 karakter: huruf, angka, titik, garis bawah, strip.">
            <Input
              value={createForm.username}
              onChange={(event) =>
                setCreateForm((previous) => ({ ...previous, username: event.target.value }))
              }
              autoComplete="off"
            />
          </Field>
          <Field label="Email" required>
            <Input
              type="email"
              value={createForm.email}
              onChange={(event) => setCreateForm((previous) => ({ ...previous, email: event.target.value }))}
              autoComplete="off"
            />
          </Field>
          <Field label="Password" required hint="Minimal 8 karakter. Sampaikan ke reseller.">
            <Input
              type="text"
              value={createForm.password}
              onChange={(event) =>
                setCreateForm((previous) => ({ ...previous, password: event.target.value }))
              }
              autoComplete="off"
            />
          </Field>
          <Field label="Credit awal" hint="Dicatat sebagai transaksi topup di Credit Log.">
            <Input
              type="number"
              min={0}
              value={createForm.credit}
              onChange={(event) => setCreateForm((previous) => ({ ...previous, credit: event.target.value }))}
            />
          </Field>
          {createError ? <p className="text-label text-banned">{createError}</p> : null}
        </div>
      </Modal>

      {/* Topup */}
      <Modal
        open={topupTarget !== null}
        onClose={() => setTopupTarget(null)}
        title="Topup Credit"
        description={topupTarget ? `Untuk ${topupTarget.username} · sisa ${formatNumber(topupTarget.credit)}` : undefined}
        size="sm"
        busy={busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTopupTarget(null)} disabled={busy}>
              Batal
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={topup}>
              Tambah Credit
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Jumlah credit" required>
            <Input
              type="number"
              min={1}
              value={topupAmount}
              onChange={(event) => setTopupAmount(event.target.value)}
            />
          </Field>
          <Field label="Note (opsional)">
            <Input
              value={topupNote}
              maxLength={500}
              onChange={(event) => setTopupNote(event.target.value)}
              placeholder="Contoh: transfer BCA 250k"
            />
          </Field>
        </div>
      </Modal>

      {/* Penyesuaian credit (tambah / kurang + alasan wajib) */}
      <CreditAdjustModal
        target={adjustTarget}
        onClose={() => setAdjustTarget(null)}
        onDone={() => {
          void load();
        }}
      />

      {/* Reset password */}
      <Modal
        open={passwordTarget !== null}
        onClose={() => setPasswordTarget(null)}
        title="Reset Password"
        description={passwordTarget ? `Untuk ${passwordTarget.username}` : undefined}
        size="sm"
        busy={busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setPasswordTarget(null)} disabled={busy}>
              Batal
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={resetPassword}>
              Simpan Password
            </Button>
          </>
        }
      >
        <Field label="Password baru" required hint="Minimal 8 karakter.">
          <Input
            type="text"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="off"
          />
        </Field>
      </Modal>

      {/* Edit data reseller */}
      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Edit Reseller"
        size="sm"
        busy={busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)} disabled={busy}>
              Batal
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={saveEdit}>
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Username" required>
            <Input
              value={editForm.username}
              onChange={(event) => setEditForm((previous) => ({ ...previous, username: event.target.value }))}
            />
          </Field>
          <Field label="Email" required>
            <Input
              type="email"
              value={editForm.email}
              onChange={(event) => setEditForm((previous) => ({ ...previous, email: event.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      {/* Hapus reseller */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus reseller permanen?"
        message={
          <span>
            Akun, seluruh key ({formatNumber(deleteTarget?.key_count ?? 0)}), HWID terdaftar, dan riwayat
            credit milik <span className="text-text">{deleteTarget?.username}</span> akan dihapus dan tidak
            bisa dikembalikan. Kalau hanya ingin memblokir akses, pakai Nonaktifkan.
          </span>
        }
        confirmLabel="Hapus permanen"
        danger
        loading={busy}
        requireText={deleteTarget?.username}
        onConfirm={remove}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="truncate text-body" title={value}>
        {value}
      </dd>
    </div>
  );
}
