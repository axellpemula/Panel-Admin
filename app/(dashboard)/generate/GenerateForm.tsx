"use client";

import { Download, KeyRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Textarea } from "@/components/ui/Form";
import { Select, RadioGroup } from "@/components/ui/Select";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { ToolTypeItem } from "@/app/api/tools/route";
import { LIMITS } from "@/lib/constants";
import { ApiClientError, apiGet, apiPost } from "@/lib/api/client";
import type { DurationPresetRow } from "@/lib/types/database";
import { formatDateTime, formatNumber, LIFETIME_LABEL } from "@/lib/utils/format";
import { CREDIT_UNIT_RULE, generateCreditCost } from "@/lib/utils/pricing";

interface GenerateResponse {
  keys: {
    id: string;
    key_value: string;
    expired_at: string | null;
    max_device: number;
    status: string;
  }[];
  summary: {
    tool_name: string;
    version_name: string;
    duration_label: string;
    duration_days: number | null;
    max_device: number;
    quantity: number;
    expired_at: string | null;
    unit_price: number;
    credit_cost: number;
    credit_balance_after: number;
  };
}

export function GenerateForm({
  isOwner,
  initialCredit,
}: {
  isOwner: boolean;
  initialCredit: number;
}) {
  const toast = useToast();

  const [tools, setTools] = useState<ToolTypeItem[]>([]);
  const [presets, setPresets] = useState<DurationPresetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [toolTypeId, setToolTypeId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [durationMode, setDurationMode] = useState<"preset" | "custom">("preset");
  const [presetId, setPresetId] = useState<string | null>(null);
  const [customDays, setCustomDays] = useState("30");
  const [maxDevice, setMaxDevice] = useState("1");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [credit, setCredit] = useState(initialCredit);

  const quantityMax = isOwner ? LIMITS.quantityOwnerMax : LIMITS.quantityResellerMax;

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const [toolsResponse, presetsResponse] = await Promise.all([
        apiGet<{ tools: ToolTypeItem[] }>("/api/tools"),
        apiGet<{ presets: DurationPresetRow[] }>("/api/durations"),
      ]);

      const activeTools = toolsResponse.tools
        .filter((tool) => tool.is_active)
        .map((tool) => ({
          ...tool,
          versions: tool.versions.filter((version) => version.is_active),
        }));

      const activePresets = presetsResponse.presets.filter((preset) => preset.is_active);

      setTools(activeTools);
      setPresets(activePresets);

      setToolTypeId((previous) => previous ?? activeTools[0]?.id ?? null);
      setPresetId((previous) => previous ?? activePresets[0]?.id ?? null);
    } catch (loadError) {
      toast.error(loadError instanceof Error ? loadError.message : "Gagal memuat pilihan");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === toolTypeId) ?? null,
    [toolTypeId, tools],
  );

  useEffect(() => {
    const firstVersion = selectedTool?.versions[0]?.id ?? null;
    setVersionId((previous) => {
      if (previous && selectedTool?.versions.some((version) => version.id === previous)) {
        return previous;
      }
      return firstVersion;
    });
  }, [selectedTool]);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === presetId) ?? null,
    [presetId, presets],
  );

  const quantityNumber = Number.parseInt(quantity, 10) || 0;
  const maxDeviceNumber = Number.parseInt(maxDevice, 10) || 0;
  const estimatedCost = isOwner
    ? 0
    : generateCreditCost(selectedPreset?.credit_cost ?? 0, quantityNumber, maxDeviceNumber);
  const unitPrice = selectedPreset?.credit_cost ?? 0;
  const creditNotEnough = !isOwner && estimatedCost > credit;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!toolTypeId) return setError("Pilih tool type dulu");
    if (!versionId) return setError("Pilih version dulu");
    if (durationMode === "preset" && !presetId) return setError("Pilih preset durasi dulu");

    if (
      !Number.isFinite(maxDeviceNumber) ||
      maxDeviceNumber < LIMITS.maxDeviceMin ||
      maxDeviceNumber > LIMITS.maxDeviceMax
    ) {
      return setError(`Max device harus antara ${LIMITS.maxDeviceMin} dan ${LIMITS.maxDeviceMax}`);
    }
    if (!Number.isFinite(quantityNumber) || quantityNumber < 1 || quantityNumber > quantityMax) {
      return setError(`Quantity harus antara 1 dan ${quantityMax}`);
    }
    if (durationMode === "custom") {
      const days = Number.parseInt(customDays, 10);
      if (!Number.isFinite(days) || days < 0 || days > 3650) {
        return setError("Jumlah hari custom harus antara 0 (Lifetime) dan 3650");
      }
    }
    if (creditNotEnough) {
      return setError(
        `Credit tidak cukup (sisa ${credit}). Butuh ${estimatedCost} credit untuk ${quantityNumber} key x ${maxDeviceNumber} device.`,
      );
    }

    setSubmitting(true);
    try {
      const response = await apiPost<GenerateResponse>("/api/keys/generate", {
        tool_type_id: toolTypeId,
        tool_version_id: versionId,
        duration_mode: durationMode,
        duration_preset_id: durationMode === "preset" ? presetId : null,
        custom_days: durationMode === "custom" ? Number.parseInt(customDays, 10) : null,
        max_device: maxDeviceNumber,
        quantity: quantityNumber,
        note: note.trim().length > 0 ? note : null,
      });

      setResult(response);
      setCredit(response.summary.credit_balance_after);
      toast.success(`${response.keys.length} key berhasil dibuat`);
      setNote("");
    } catch (submitError) {
      if (submitError instanceof ApiClientError) {
        setError(submitError.message);
        if (submitError.code === "insufficient_credit") {
          const balance = submitError.details?.credit_balance;
          if (typeof balance === "number") setCredit(balance);
        }
      } else {
        setError("Gagal generate key");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const exportTxt = () => {
    if (!result) return;
    const header = [
      `# XLOOP PANEL — ${result.summary.tool_name} ${result.summary.version_name}`,
      `# Durasi: ${result.summary.duration_label}`,
      `# Expired: ${result.summary.expired_at ? formatDateTime(result.summary.expired_at) : LIFETIME_LABEL}`,
      `# Max device: ${result.summary.max_device}`,
      `# Jumlah: ${result.summary.quantity}`,
      `# Dibuat: ${formatDateTime(new Date())}`,
      "",
    ].join("\n");
    const keys = result.keys.map((key) => key.key_value).join("\n");
    const blob = new Blob([`${header}${keys}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `xloop-keys-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="card p-4">
        <SkeletonRows rows={5} columns={2} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="card p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Tool Type" required>
            <Select
              value={toolTypeId}
              onChange={setToolTypeId}
              placeholder="Pilih tool"
              options={tools.map((tool) => ({
                value: tool.id,
                label: tool.name,
                hint: `${tool.slug} · ${tool.versions.length} version aktif`,
              }))}
            />
          </Field>

          <Field label="Version" required>
            <Select
              value={versionId}
              onChange={setVersionId}
              placeholder={selectedTool ? "Pilih version" : "Pilih tool dulu"}
              disabled={!selectedTool || selectedTool.versions.length === 0}
              options={(selectedTool?.versions ?? []).map((version) => ({
                value: version.id,
                label: version.name,
              }))}
            />
          </Field>

          <Field label="Durasi" required>
            {isOwner ? (
              <div className="space-y-2">
                <RadioGroup
                  name="duration-mode"
                  value={durationMode}
                  onChange={(value) => setDurationMode(value as "preset" | "custom")}
                  options={[
                    { value: "preset", label: "Pilih Preset" },
                    { value: "custom", label: "Custom" },
                  ]}
                />
                {durationMode === "preset" ? (
                  <Select
                    value={presetId}
                    onChange={setPresetId}
                    placeholder="Pilih preset durasi"
                    options={presets.map((preset) => ({
                      value: preset.id,
                      label: preset.name,
                      hint: `${preset.days} hari · ${formatNumber(preset.credit_cost)} credit per device`,
                    }))}
                  />
                ) : (
                  <Input
                    type="number"
                    min={0}
                    max={3650}
                    value={customDays}
                    onChange={(event) => setCustomDays(event.target.value)}
                    placeholder="Jumlah hari"
                  />
                )}
                {durationMode === "custom" ? (
                  <p className="text-label text-muted">
                    Isi 0 untuk membuat key tanpa expired.
                  </p>
                ) : null}
              </div>
            ) : (
              <Select
                value={presetId}
                onChange={setPresetId}
                placeholder="Pilih durasi"
                options={presets.map((preset) => ({
                  value: preset.id,
                  label: preset.name,
                  hint: `${preset.days} hari · ${formatNumber(preset.credit_cost)} credit per device`,
                }))}
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={`Max Device (${LIMITS.maxDeviceMin}–${LIMITS.maxDeviceMax})`} required>
              <Input
                type="number"
                min={LIMITS.maxDeviceMin}
                max={LIMITS.maxDeviceMax}
                value={maxDevice}
                onChange={(event) => setMaxDevice(event.target.value)}
              />
            </Field>

            <Field label={`Quantity (1–${quantityMax})`} required>
              <Input
                type="number"
                min={1}
                max={quantityMax}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
          </div>
        </div>

        <div className="mt-4">
          <Field label="Note (opsional)" hint="Catatan internal.">
            <Textarea
              value={note}
              maxLength={LIMITS.noteMax}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Contoh: pesanan reseller Andi, batch Oktober"
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="text-label text-muted">
            {isOwner ? (
              <span>Owner tidak dikenakan credit.</span>
            ) : (
              <span className="tabular-nums">
                Sisa credit: <span className="text-text">{formatNumber(credit)}</span> · Estimasi biaya:{" "}
                <span className={creditNotEnough ? "text-banned" : "text-text"}>
                  {formatNumber(estimatedCost)}
                </span>{" "}
              </span>
            )}
          </div>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            icon={<KeyRound size={16} strokeWidth={1.5} />}
          >
            Buat Key
          </Button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-control border border-banned/40 bg-banned/10 px-3 py-2 text-label text-banned">
            {error}
          </p>
        ) : null}
      </form>

      {result ? (
        <section className="card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-body font-medium">Hasil Generate</h2>
              <p className="text-label text-muted">
                {result.summary.tool_name} · {result.summary.version_name} ·{" "}
                {result.summary.duration_label} · max {result.summary.max_device} device ·{" "}
                {result.summary.quantity} key
              </p>
              <p className="text-label text-muted">
                Expired:{" "}
                {result.summary.expired_at ? formatDateTime(result.summary.expired_at) : LIFETIME_LABEL}
                {!isOwner
                  ? ` · credit terpakai ${formatNumber(result.summary.credit_cost)} · sisa ${formatNumber(result.summary.credit_balance_after)}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <CopyButton
                value={result.keys.map((key) => key.key_value).join("\n")}
                label="Copy Semua"
                showLabel
                className="border border-border px-2 py-1.5"
              />
              <Button size="sm" onClick={exportTxt} icon={<Download size={16} strokeWidth={1.5} />}>
                Export .txt
              </Button>
            </div>
          </header>

          {result.keys.length === 0 ? (
            <EmptyState message="Tidak ada key yang dibuat" />
          ) : (
            <ul className="divide-y divide-border">
              {result.keys.map((key) => (
                <li key={key.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="font-mono text-body">{key.key_value}</span>
                  <CopyButton value={key.key_value} label="Copy key" showLabel />
                </li>
              ))}
            </ul>
          )}

          <footer className="border-t border-border px-4 py-3">
            <Link href="/keys" className="text-label text-accent hover:underline">
              Lihat di Key List
            </Link>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
