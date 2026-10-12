"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ActiveBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Toggle } from "@/components/ui/Form";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api/client";
import type { DurationPresetRow } from "@/lib/types/database";
import { formatNumber } from "@/lib/utils/format";

interface FormState {
  id: string | null;
  name: string;
  days: string;
  creditCost: string;
  isActive: boolean;
}

const EMPTY: FormState = { id: null, name: "", days: "30", creditCost: "10", isActive: true };

export function DurationsView() {
  const toast = useToast();

  const [presets, setPresets] = useState<DurationPresetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DurationPresetRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiGet<{ presets: DurationPresetRow[] }>("/api/durations");
      setPresets(response.presets);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat preset durasi");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (preset: DurationPresetRow) => {
    setForm({
      id: preset.id,
      name: preset.name,
      days: String(preset.days),
      creditCost: String(preset.credit_cost),
      isActive: preset.is_active,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    setFormError(null);
    const name = form.name.trim();
    const days = Number.parseInt(form.days, 10);
    const creditCost = Number.parseInt(form.creditCost, 10);

    if (name.length === 0) return setFormError("Nama durasi wajib diisi");
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      return setFormError("Jumlah hari harus antara 1 dan 3650");
    }
    if (!Number.isFinite(creditCost) || creditCost < 0) {
      return setFormError("Harga credit tidak boleh negatif");
    }

    setSaving(true);
    try {
      const payload = { name, days, credit_cost: creditCost, is_active: form.isActive };
      if (form.id) {
        await apiPut(`/api/durations/${form.id}`, payload);
        toast.success("Preset durasi diperbarui");
      } else {
        await apiPost("/api/durations", payload);
        toast.success("Preset durasi ditambahkan");
      }
      setFormOpen(false);
      await load();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Gagal menyimpan preset");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (preset: DurationPresetRow) => {
    try {
      await apiPut(`/api/durations/${preset.id}`, { is_active: !preset.is_active });
      toast.success(preset.is_active ? "Preset dinonaktifkan" : "Preset diaktifkan");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah status preset");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiDelete(`/api/durations/${deleteTarget.id}`);
      toast.success("Preset durasi dihapus");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus preset");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium">Duration Setting</h1>
          <p className="mt-1 text-body text-muted">
            Preset durasi yang bisa dipilih Reseller saat generate key.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={openCreate} icon={<Plus size={16} strokeWidth={1.5} />}>
          Tambah Preset
        </Button>
      </header>

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={4} columns={5} />
        ) : presets.length === 0 ? (
          <EmptyState
            message="Belum ada preset durasi"
            action={
              <Button variant="primary" size="sm" onClick={openCreate}>
                Tambah Preset
              </Button>
            }
          />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[720px] text-body">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-label text-muted">
                  <th scope="col" className="px-3 py-2 font-normal">
                    Nama durasi
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Hari
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Harga credit
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
                {presets.map((preset) => (
                  <tr key={preset.id} className="row-hover h-11">
                    <td className="px-3 py-1.5">{preset.name}</td>
                    <td className="px-3 py-1.5 tabular-nums text-muted">{preset.days}</td>
                    <td className="px-3 py-1.5 tabular-nums text-muted">
                      {formatNumber(preset.credit_cost)}
                    </td>
                    <td className="px-3 py-1.5">
                      <ActiveBadge active={preset.is_active} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          onClick={() => openEdit(preset)}
                          icon={<Pencil size={14} strokeWidth={1.5} />}
                        >
                          Edit
                        </Button>
                        <Button size="sm" onClick={() => void toggleActive(preset)}>
                          {preset.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </Button>
                        <Button
                          size="sm"
                                                    onClick={() => setDeleteTarget(preset)}
                          icon={<Trash2 size={14} strokeWidth={1.5} />}
                          aria-label="Hapus preset"
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

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.id ? "Edit Preset Durasi" : "Tambah Preset Durasi"}
        description="Harga credit dipotong saat Reseller generate key dengan durasi ini."
        size="sm"
        busy={saving}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={save}>
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nama durasi" required hint='Contoh: "1 Minggu", "1 Bulan", "3 Bulan"'>
            <Input
              value={form.name}
              onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
              placeholder="1 Bulan"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Jumlah hari" required>
              <Input
                type="number"
                min={1}
                max={3650}
                value={form.days}
                onChange={(event) => setForm((previous) => ({ ...previous, days: event.target.value }))}
              />
            </Field>

            <Field label="Harga credit" required hint="Credit per 1 key">
              <Input
                type="number"
                min={0}
                value={form.creditCost}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, creditCost: event.target.value }))
                }
              />
            </Field>
          </div>

          <Toggle
            checked={form.isActive}
            onChange={(value) => setForm((previous) => ({ ...previous, isActive: value }))}
            label="Preset aktif (bisa dipilih Reseller)"
          />

          {formError ? <p className="text-label text-banned">{formError}</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus preset durasi?"
        message={
          <span>
            Preset <span className="text-text">{deleteTarget?.name}</span> akan dihapus. Key yang sudah
            dibuat dengan durasi ini tidak terpengaruh.
          </span>
        }
        confirmLabel="Hapus"
        danger
        loading={busy}
        onConfirm={remove}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
