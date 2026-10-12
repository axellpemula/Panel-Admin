"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Form";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { RadioGroup, Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, apiGet, apiPut } from "@/lib/api/client";
import { LIMITS } from "@/lib/constants";
import type { DurationPresetRow, KeyListItem } from "@/lib/types/database";
import { formatDateTime, formatNumber, LIFETIME_LABEL } from "@/lib/utils/format";
import { CREDIT_UNIT_RULE, extendCreditCost } from "@/lib/utils/pricing";

type EditMode = "preset" | "extend" | "set" | "lifetime" | "none";

interface EditResponse {
  credit?: {
    cost: number;
    unit_price: number;
    max_device: number;
    balance_before: number;
    balance_after: number;
  };
}

export function KeyEditModal({
  target,
  open,
  onClose,
  onSaved,
  isOwner,
}: {
  target: KeyListItem | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  isOwner: boolean;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<EditMode>(isOwner ? "extend" : "preset");
  const [addDays, setAddDays] = useState("30");
  const [newDate, setNewDate] = useState("");
  const [presetId, setPresetId] = useState<string | null>(null);
  const [presets, setPresets] = useState<DurationPresetRow[]>([]);
  const [credit, setCredit] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [maxDevice, setMaxDevice] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadOptions = useCallback(async () => {
    const [presetsResult, sessionResult] = await Promise.allSettled([
      apiGet<{ presets: DurationPresetRow[] }>("/api/durations"),
      fetch("/api/auth/session", { cache: "no-store" }).then(async (response) =>
        response.ok
          ? ((await response.json()) as { session: { credit: number } | null })
          : null,
      ),
    ]);

    if (presetsResult.status === "fulfilled") {
      const activePresets = presetsResult.value.presets.filter((preset) => preset.is_active);
      setPresets(activePresets);
      setPresetId((previous) =>
        previous && activePresets.some((preset) => preset.id === previous)
          ? previous
          : (activePresets[0]?.id ?? null),
      );
    }

    setCredit(
      sessionResult.status === "fulfilled" ? (sessionResult.value?.session?.credit ?? null) : null,
    );
  }, []);

  useEffect(() => {
    if (!target) return;
    setMode(isOwner ? "extend" : "preset");
    setAddDays("30");
    setNewDate("");
    setNote(target.note ?? "");
    setMaxDevice(String(target.max_device));
    setError(null);
    setConfirmOpen(false);
    void loadOptions();
  }, [target, isOwner, loadOptions]);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === presetId) ?? null,
    [presetId, presets],
  );

  if (!target) return null;

  const maxValue = Number.parseInt(maxDevice, 10);
  const deviceIncreased =
    Number.isFinite(maxValue) && maxValue > target.max_device;
  const maxDeviceForCost = Number.isFinite(maxValue) ? Math.max(maxValue, 1) : target.max_device;

  const chargeable = !isOwner && mode === "preset" && selectedPreset !== null;
  const cost = chargeable ? extendCreditCost(selectedPreset?.credit_cost ?? 0, maxDeviceForCost) : 0;
  const creditEnough = credit === null || cost <= credit;

  const validate = (): string | null => {
    if (!Number.isFinite(maxValue) || maxValue < LIMITS.maxDeviceMin || maxValue > LIMITS.maxDeviceMax) {
      return `Max device harus antara ${LIMITS.maxDeviceMin} dan ${LIMITS.maxDeviceMax}`;
    }
    if (maxValue < target.devices_used) {
      return `Max device tidak boleh lebih kecil dari device terdaftar (${target.devices_used})`;
    }
    if (mode === "preset" && !presetId) return "Preset durasi wajib dipilih";
    if (mode === "extend") {
      const value = Number.parseInt(addDays, 10);
      if (!Number.isFinite(value) || value < 1 || value > 3650) {
        return "Jumlah hari harus antara 1 dan 3650";
      }
    }
    if (mode === "set" && !newDate) return "Tanggal expired baru wajib diisi";
    if (!isOwner && deviceIncreased && mode !== "preset") {
      return "Pilih preset durasi untuk menambah max device — device baru ikut dihitung biaya";
    }
    if (cost > 0 && credit !== null && cost > credit) {
      return `Credit tidak cukup (sisa ${credit}, butuh ${cost})`;
    }
    if (
      mode === "none" &&
      note.trim() === (target.note ?? "").trim() &&
      maxValue === target.max_device
    ) {
      return "Tidak ada perubahan";
    }
    return null;
  };

  const summaryText = (() => {
    const parts: string[] = [];
    if (mode === "preset") {
      parts.push(`Perpanjang ${selectedPreset ? selectedPreset.name : "(preset belum dipilih)"}`);
    }
    if (mode === "extend") parts.push(`Tambah ${addDays} hari dari tanggal expired saat ini`);
    if (mode === "set") parts.push(`Set expired ke ${newDate}`);
    if (mode === "lifetime") parts.push("Jadikan Lifetime (tanpa tanggal expired)");
    if (Number.isFinite(maxValue) && maxValue !== target.max_device) {
      parts.push(`Max device ${target.max_device} → ${maxValue}`);
    }
    if (note.trim() !== (target.note ?? "").trim()) parts.push("Catatan diubah");
    return parts.length > 0 ? parts.join(", ") : "Tidak ada perubahan";
  })();

  const submit = () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setConfirmOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        mode,
        note: note.trim().length > 0 ? note : null,
        max_device: maxValue,
      };
      if (mode === "preset") body.duration_preset_id = presetId;
      if (mode === "extend") body.add_days = Number.parseInt(addDays, 10);
      if (mode === "set") body.expired_at = newDate;

      const response = await apiPut<EditResponse>(`/api/keys/${target.id}`, body);
      const charged = response.credit?.cost ?? 0;

      if (charged > 0) {
        setCredit(response.credit?.balance_after ?? null);
        toast.success(
          `Key diperbarui · ${formatNumber(charged)} credit terpakai (sisa ${formatNumber(
            response.credit?.balance_after ?? 0,
          )})`,
        );
      } else {
        toast.success("Key berhasil diperbarui");
      }

      setConfirmOpen(false);
      onSaved();
      onClose();
    } catch (saveError) {
      if (saveError instanceof ApiClientError && saveError.details) {
        const balance = saveError.details.credit_balance;
        if (typeof balance === "number") setCredit(balance);
      }
      toast.error(saveError instanceof Error ? saveError.message : "Gagal menyimpan key");
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Edit Key"
        description={`${target.key_value} · ${target.tool_name} ${target.version_name}`}
        busy={saving}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Batal
            </Button>
            <Button variant="primary" size="sm" onClick={submit} disabled={saving}>
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-card border border-border bg-surface px-3 py-2 text-label text-muted">
            Expired saat ini:{" "}
            <span className="text-text">
              {target.expired_at ? formatDateTime(target.expired_at) : LIFETIME_LABEL}
            </span>{" "}
            · Device terpakai: <span className="text-text">{target.devices_used}/{target.max_device}</span>
          </div>

          {isOwner ? (
            <Field label="Perpanjang durasi">
              <RadioGroup
                name="edit-mode"
                value={mode}
                onChange={(value) => {
                  setMode(value as EditMode);
                  setError(null);
                }}
                options={[
                  { value: "preset", label: "Pakai preset" },
                  { value: "extend", label: "Tambah hari" },
                  { value: "set", label: "Set expired" },
                  { value: "lifetime", label: "Lifetime" },
                ]}
              />
            </Field>
          ) : null}

          {mode === "preset" ? (
            <Field
              label={isOwner ? "Preset durasi" : "Perpanjang durasi"}
              hint={
                isOwner
                  ? "Durasi ditambahkan dari tanggal expired saat ini (Lifetime / sudah lewat: dari sekarang)."
                  : "Reseller hanya bisa memperpanjang pakai preset. Device yang terdaftar ikut diperpanjang."
              }
              required
            >
              <Select
                value={presetId}
                onChange={(value) => {
                  setPresetId(value);
                  setError(null);
                }}
                placeholder="Pilih preset durasi"
                options={presets.map((preset) => ({
                  value: preset.id,
                  label: preset.name,
                  hint: `${preset.days} hari · ${formatNumber(preset.credit_cost)} credit per device`,
                }))}
              />
            </Field>
          ) : null}

          {mode === "extend" ? (
            <Field
              label="Tambah berapa hari"
              hint="Ditambahkan dari tanggal expired saat ini. Kalau key Lifetime, hitungan mulai dari sekarang."
            >
              <Input
                type="number"
                min={1}
                max={3650}
                value={addDays}
                onChange={(event) => setAddDays(event.target.value)}
                invalid={Boolean(error && mode === "extend")}
              />
            </Field>
          ) : null}

          {mode === "set" ? (
            <Field label="Tanggal expired baru" hint="Berlaku sampai akhir hari (WIB).">
              <Input
                type="date"
                value={newDate}
                onChange={(event) => setNewDate(event.target.value)}
                invalid={Boolean(error && mode === "set")}
              />
            </Field>
          ) : null}

          {mode === "lifetime" ? (
            <p className="text-label text-muted">
              Key akan aktif tanpa tanggal expired. Status otomatis jadi Active (kecuali sedang banned).
            </p>
          ) : null}

          <Field label={`Max device (1–${LIMITS.maxDeviceMax})`}>
            <Input
              type="number"
              min={LIMITS.maxDeviceMin}
              max={LIMITS.maxDeviceMax}
              value={maxDevice}
              onChange={(event) => {
                setMaxDevice(event.target.value);
                setError(null);
              }}
            />
          </Field>

          {!isOwner ? (
            <div
              className={`rounded-card border px-3 py-2 text-label ${
                creditEnough ? "border-border bg-surface text-muted" : "border-banned/40 bg-banned/10 text-banned"
              }`}
            >
              <p>
                Biaya perpanjang:{" "}
                <span className="text-text tabular-nums">
                  {chargeable
                    ? `${maxDeviceForCost} device × ${formatNumber(selectedPreset?.credit_cost ?? 0)} credit = ${formatNumber(cost)} credit`
                    : "0 credit"}
                </span>
              </p>
              <p className="mt-0.5">
                {chargeable
                  ? `Menambah max device dihitung device baru. Sisa credit: ${credit === null ? "-" : formatNumber(credit)}`
                  : "Ubah catatan / kurangi max device: tanpa biaya. Perpanjang: pilih preset."}{" "}
              </p>
            </div>
          ) : null}

          <Field label="Catatan (opsional)">
            <Textarea
              value={note}
              maxLength={LIMITS.noteMax}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Catatan internal untuk key ini"
            />
          </Field>

          {error ? <p className="text-label text-banned">{error}</p> : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="Simpan perubahan key?"
        message={
          <span>
            <span className="font-mono text-text">{target.key_value}</span>
            <br />
            {summaryText}
            {cost > 0 ? (
              <>
                <br />
                <span className="text-text tabular-nums">
                  Biaya: {formatNumber(cost)} credit
                  {credit !== null ? ` (sisa sekarang ${formatNumber(credit)})` : ""}
                </span>
              </>
            ) : null}
          </span>
        }
        confirmLabel="Simpan"
        loading={saving}
        onConfirm={save}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}
