"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, apiPut } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";

export interface AdjustTarget {
  id: string;
  username: string;
  credit: number;
}

export function CreditAdjustModal({
  target,
  onClose,
  onDone,
}: {
  target: AdjustTarget | null;
  onClose: () => void;
  onDone: (balance: number) => void;
}) {
  const toast = useToast();
  const [direction, setDirection] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("10");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setDirection("add");
      setAmount("10");
      setReason("");
      setNote("");
    }
  }, [target]);

  if (!target) return null;

  const parsed = Number.parseInt(amount, 10);
  const delta = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  const signedDelta = direction === "add" ? delta : -delta;
  const after = target.credit + signedDelta;
  const insufficient = signedDelta < 0 && after < 0;
  const reasonTooShort = reason.trim().length < 3;
  const canSubmit = delta > 0 && !insufficient && !reasonTooShort && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const result = await apiPut<{ balance: number; adjusted: number }>(
        `/api/resellers/${target.id}`,
        {
          action: "adjust_credit",
          amount: signedDelta,
          reason: reason.trim(),
          note: note.trim() || undefined,
        },
      );

      toast.success(
        `Saldo ${target.username} ${signedDelta > 0 ? "ditambah" : "dikurangi"} ${formatNumber(
          Math.abs(signedDelta),
        )} → ${formatNumber(result.balance)} credit`,
      );
      onDone(result.balance);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Gagal menyesuaikan credit",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Sesuaikan Credit"
      description={`Untuk ${target.username} · saldo sekarang ${formatNumber(target.credit)} credit`}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()} disabled={!canSubmit}>
            {signedDelta >= 0 ? "Tambah Credit" : "Kurangi Credit"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          role="group"
          aria-label="Arah penyesuaian"
          className="grid grid-cols-2 gap-2 rounded-control border border-border bg-surface p-1"
        >
          {(
            [
              { value: "add" as const, label: "Tambah", icon: <Plus size={14} strokeWidth={1.5} /> },
              {
                value: "subtract" as const,
                label: "Kurangi",
                icon: <Minus size={14} strokeWidth={1.5} />,
              },
            ]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={direction === option.value}
              onClick={() => setDirection(option.value)}
              className={cn(
                "flex h-8 items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] text-label transition-colors duration-150",
                direction === option.value
                  ? option.value === "subtract"
                    ? "bg-banned/15 text-banned"
                    : "bg-accent/15 text-accent"
                  : "text-muted hover:text-text",
              )}
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>

        <Field label="Jumlah credit" required hint="Bilangan bulat, minimal 1.">
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="tabular-nums"
            autoFocus
          />
        </Field>

        <Field
          label="Alasan"
          required
          error={reasonTooShort && reason.length > 0 ? "Minimal 3 karakter" : undefined}
          hint="Wajib — tercatat di Credit Log & Audit Log."
        >
          <Input
            value={reason}
            maxLength={200}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Kompensasi key yang error"
          />
        </Field>

        <Field label="Catatan tambahan" hint="Opsional.">
          <Textarea
            value={note}
            rows={2}
            maxLength={300}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Detail singkat untuk jejak audit"
          />
        </Field>

        <div
          className={cn(
            "rounded-md border px-3 py-2 text-label",
            insufficient
              ? "border-banned/40 bg-banned/10 text-banned"
              : "border-border bg-surface/60 text-muted",
          )}
        >
          {insufficient ? (
            <>Saldo tidak cukup: {formatNumber(target.credit)} credit, pengurangan {formatNumber(delta)}.</>
          ) : (
            <>
              Saldo setelah disimpan:{" "}
              <span className="font-medium tabular-nums text-text">
                {formatNumber(Math.max(0, after))} credit
              </span>
              {delta > 0 ? (
                <>
                  {" "}
                  ({signedDelta > 0 ? "+" : "−"}
                  {formatNumber(delta)})
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
