"use client";

import { AlertTriangle, Clock, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, apiDelete, apiGet } from "@/lib/api/client";
import { HWID_RESET } from "@/lib/constants";
import type { KeyListItem } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";
import { formatDateTime, formatNumber, LIFETIME_LABEL } from "@/lib/utils/format";

interface CooldownInfo {
  used: number;
  limit: number;
  remaining: number;
  window_start: string | null;
  next_reset_at: string | null;
  retry_after_seconds: number | null;
}

interface DeviceItem {
  id: string;
  hardware_id: string;
  first_seen: string;
  last_seen: string;
}

interface DevicesResponse {
  devices: DeviceItem[];
  used: number;
  max_device: number;
  cooldown: CooldownInfo;
}

export function HwidModal({
  keyId,
  open,
  onClose,
  onChanged,
}: {
  keyId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<KeyListItem | null>(null);
  const [devices, setDevices] = useState<DeviceItem[] | null>(null);
  const [slot, setSlot] = useState<{ used: number; max: number }>({ used: 0, max: 0 });
  const [cooldown, setCooldown] = useState<CooldownInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<DeviceItem | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);

  const load = useCallback(async () => {
    if (!keyId) return;
    setLoading(true);
    try {
      const [detailResponse, deviceResponse] = await Promise.all([
        apiGet<{ key: KeyListItem | null }>(`/api/keys/${keyId}`),
        apiGet<DevicesResponse>(`/api/keys/${keyId}/devices`),
      ]);
      setDetail(detailResponse.key);
      setDevices(deviceResponse.devices);
      setSlot({ used: deviceResponse.used, max: deviceResponse.max_device });
      setCooldown(deviceResponse.cooldown);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat detail key");
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [keyId, toast]);

  useEffect(() => {
    if (open && keyId) void load();
  }, [open, keyId, load]);

  useEffect(() => {
    if (!cooldown || cooldown.retry_after_seconds === null) return;
    if (cooldown.retry_after_seconds <= 0) {
      void load();
      return;
    }
    const id = window.setInterval(() => {
      setCooldown((prev) => {
        if (!prev || prev.retry_after_seconds === null) return prev;
        const next = prev.retry_after_seconds - 1;
        if (next <= 0) {
          window.clearInterval(id);
          void load();
          return { ...prev, retry_after_seconds: 0, remaining: 1 };
        }
        return { ...prev, retry_after_seconds: next };
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown?.retry_after_seconds]);

  const resetDevice = async () => {
    if (!keyId || !resetTarget) return;
    setBusy(true);
    try {
      const result = await apiDelete<{ cooldown?: CooldownInfo }>(
        `/api/keys/${keyId}/devices/${resetTarget.id}`,
      );
      toast.success("HWID berhasil direset");
      setResetTarget(null);
      if (result.cooldown) setCooldown(result.cooldown);
      await load();
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "hwid_reset_cooldown") {
        const quota = error.details as CooldownInfo | undefined;
        if (quota) setCooldown(quota);
      }
      toast.error(error instanceof Error ? error.message : "Gagal reset HWID");
    } finally {
      setBusy(false);
    }
  };

  const resetAll = async () => {
    if (!keyId) return;
    setBusy(true);
    try {
      const result = await apiDelete<{ removed: number; cooldown?: CooldownInfo }>(
        `/api/keys/${keyId}/devices`,
      );
      toast.success(`${result.removed} HWID direset`);
      setResetAllOpen(false);
      if (result.cooldown) setCooldown(result.cooldown);
      await load();
      onChanged?.();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "hwid_reset_cooldown") {
        const quota = error.details as CooldownInfo | undefined;
        if (quota) setCooldown(quota);
      }
      toast.error(error instanceof Error ? error.message : "Gagal reset semua HWID");
    } finally {
      setBusy(false);
    }
  };

  const resetDisabled = Boolean(
    cooldown && cooldown.remaining !== -1 && cooldown.remaining <= 0,
  );
  const resetHint = resetDisabled
    ? `Cooldown — coba lagi dalam ${formatWait(cooldown?.retry_after_seconds ?? null) ?? "beberapa saat"}`
    : cooldown && cooldown.remaining !== -1
      ? `Sisa ${cooldown.remaining}/${cooldown.limit} reset`
      : null;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Detail Key"
        description={detail ? `${detail.tool_name} · ${detail.version_name}` : "Memuat…"}
        size="lg"
        busy={busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Tutup
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setResetAllOpen(true)}
              disabled={busy || !devices || devices.length === 0 || resetDisabled}
              title={resetDisabled ? resetHint ?? undefined : undefined}
              icon={<RotateCcw size={16} strokeWidth={1.5} />}
            >
              Reset Semua HWID
            </Button>
            {resetHint && !resetDisabled ? (
              <span className="ml-2 text-label text-muted">{resetHint}</span>
            ) : null}
          </>
        }
      >
        {loading || !detail ? (
          <SkeletonRows rows={4} columns={3} />
        ) : (
          <div className="space-y-4">
            <div className="rounded-card border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-body">{detail.key_value}</span>
                <CopyButton value={detail.key_value} label="Copy key" />
                <StatusBadge status={detail.status} />
              </div>
              {detail.note ? (
                <p className="mt-2 text-label text-muted">Catatan: {detail.note}</p>
              ) : null}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-body sm:grid-cols-3">
              <Info label="Tool" value={detail.tool_name} />
              <Info label="Version" value={detail.version_name} />
              <Info
                label="Durasi"
                value={detail.duration_days === null ? LIFETIME_LABEL : `${detail.duration_days} hari`}
              />
              <Info
                label="Expired at"
                value={detail.expired_at ? formatDateTime(detail.expired_at) : LIFETIME_LABEL}
              />
              <Info
                label="Device"
                value={`${formatNumber(slot.used)} dari ${formatNumber(slot.max)} slot terpakai`}
              />
              <Info
                label="Last used"
                value={detail.last_used ? formatDateTime(detail.last_used) : "Belum pernah"}
              />
              <Info label="Dibuat" value={formatDateTime(detail.created_at)} />
              <Info label="Dibuat oleh" value={detail.created_by_username ?? "-"} />
              <Info label="Max device" value={String(detail.max_device)} />
            </dl>

            <CooldownBanner cooldown={cooldown} />

            <section className="rounded-card border border-border">
              <header className="flex items-center justify-between border-b border-border px-3 py-2">
                <h3 className="text-body font-medium">HWID List</h3>
                <p className="text-label text-muted tabular-nums">
                  {formatNumber(slot.used)} dari {formatNumber(slot.max)} slot device terpakai
                </p>
              </header>

              {!devices || devices.length === 0 ? (
                <EmptyState message="Belum ada device yang terdaftar" />
              ) : (
                <div className="w-full overflow-x-auto">
                  <table className="w-full min-w-[640px] text-body">
                    <thead className="bg-surface">
                      <tr className="border-b border-border text-left text-label text-muted">
                        <th scope="col" className="px-3 py-2 font-normal">
                          No
                        </th>
                        <th scope="col" className="px-3 py-2 font-normal">
                          HWID
                        </th>
                        <th scope="col" className="px-3 py-2 font-normal">
                          Pertama dipakai
                        </th>
                        <th scope="col" className="px-3 py-2 font-normal">
                          Terakhir dipakai
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-normal">
                          Aksi
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {devices.map((device, index) => (
                        <tr key={device.id} className="row-hover h-11">
                          <td className="px-3 py-1.5 text-muted tabular-nums">{index + 1}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1">
                              <span className="max-w-[240px] truncate font-mono text-[13px]" title={device.hardware_id}>
                                {device.hardware_id}
                              </span>
                              <CopyButton value={device.hardware_id} label="Copy HWID" size={14} />
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                            {formatDateTime(device.first_seen)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                            {formatDateTime(device.last_seen)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right">
                            <Button
                              size="sm"
                              onClick={() => setResetTarget(device)}
                              disabled={busy || resetDisabled}
                              title={resetDisabled ? resetHint ?? undefined : undefined}
                              icon={<RotateCcw size={14} strokeWidth={1.5} />}
                            >
                              Reset HWID
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={resetTarget !== null}
        title="Reset HWID ini?"
        message={
          <span>
            Slot device akan dikosongkan sehingga device lain bisa memakai key ini. HWID{" "}
            <span className="font-mono text-text">{resetTarget?.hardware_id}</span> akan dihapus dari
            daftar.
            {cooldown && cooldown.remaining !== -1 ? (
              <em className="mt-2 block text-label text-muted not-italic">
                Sisa kuota reset:{" "}
                <span className="font-mono text-text">
                  {Math.max(0, cooldown.remaining - 1)}/{cooldown.limit}
                </span>{" "}
                dalam {HWID_RESET.windowHours} jam terakhir.
              </em>
            ) : null}
          </span>
        }
        confirmLabel="Reset HWID"
        danger
        loading={busy}
        onConfirm={resetDevice}
        onClose={() => setResetTarget(null)}
      />

      <ConfirmDialog
        open={resetAllOpen}
        title="Reset semua HWID?"
        message={
          <span>
            Semua {formatNumber(slot.used)} device pada key ini akan dihapus dari daftar slot. Key
            tetap aktif, tapi setiap device harus registrasi ulang. Tindakan ini menghabiskan{" "}
            <span className="font-medium text-text">1 kuota reset</span> (sama dengan reset satu
            HWID).
            {cooldown && cooldown.remaining !== -1 ? (
              <em className="mt-2 block text-label text-muted not-italic">
                Sisa kuota setelah reset:{" "}
                <span className="font-mono text-text">
                  {Math.max(0, cooldown.remaining - 1)}/{cooldown.limit}
                </span>{" "}
                dalam {HWID_RESET.windowHours} jam terakhir.
              </em>
            ) : null}
          </span>
        }
        confirmLabel="Reset Semua"
        danger
        loading={busy}
        onConfirm={resetAll}
        onClose={() => setResetAllOpen(false)}
      />
    </>
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

function formatWait(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  if (seconds < 60) return `${seconds} d`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} m`;
  return `${Math.ceil(seconds / 3600)} j`;
}

function CooldownBanner({ cooldown }: { cooldown: CooldownInfo | null }) {
  if (!cooldown) return null;
  if (cooldown.remaining === -1) return null;

  const exhausted = cooldown.remaining <= 0;
  const waitText = formatWait(cooldown.retry_after_seconds);

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-card border p-3 text-label",
        exhausted
          ? "border-banned/40 bg-banned/10 text-banned"
          : "border-accent/30 bg-accent/5 text-muted",
      )}
    >
      {exhausted ? (
        <AlertTriangle size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" />
      ) : (
        <Clock size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
      )}
      <div className="min-w-0 flex-1">
        <p className={exhausted ? "font-medium text-banned" : "font-medium text-text"}>
          Cooldown reset HWID
        </p>
        <p className="mt-0.5">
          {exhausted ? (
            <>
              Kuota reset HWID untuk key ini sudah habis (maks {cooldown.limit}x per{" "}
              {HWID_RESET.windowHours} jam).
              {waitText ? (
                <>
                  {" "}
                  Coba lagi dalam <span className="font-mono text-text">{waitText}</span>.
                </>
              ) : null}
            </>
          ) : (
            <>
              Tersisa{" "}
              <span className="font-mono text-text">
                {cooldown.remaining}/{cooldown.limit}
              </span>{" "}
              reset dalam {HWID_RESET.windowHours} jam terakhir. Reset Semua juga menghabiskan 1
              kuota.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
