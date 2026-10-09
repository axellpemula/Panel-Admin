"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Kalau true, tombol Esc & klik overlay tidak menutup modal (mis. saat submit). */
  busy?: boolean;
}

/**
 * Modal dasar: fokus otomatis ke field pertama, tutup dengan Esc,
 * tombol aksi di kanan bawah, shadow tipis satu lapis.
 *
 * PENTING (perbaikan bug fokus):
 * Effect yang mengunci scroll body + memasang listener Esc HARUS tidak
 * bergantung pada identitas prop `onClose`, karena `onClose` biasanya berupa
 * arrow function inline di komponen induk (`onClose={() => setX(null)}`).
 * Kalau effect itu ikut jalan ulang setiap komponen induk re-render — misalnya
 * setiap kali user mengetik 1 huruf ke dalam form modal — maka cleanup-nya
 * (yang mengembalikan fokus ke elemen pemicu) akan mencuri fokus dari input
 * yang sedang diisi. Di mobile, keyboard langsung tertutup karenanya.
 *
 * Solusinya: simpan callback terbaru di ref, sehingga effect cukup bergantung
 * pada `open`, dan pengembalian fokus hanya terjadi saat modal benar-benar
 * ditutup.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  busy = false,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  // Callback terbaru disimpan di ref: effect di bawah tidak perlu ikut
  // "berkedip" saat identitas prop berubah.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  /** Tutup modal — stabil, aman dipakai di listener maupun handler. */
  const requestClose = useCallback(() => {
    if (busyRef.current) return;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Kunci scroll body + listener Esc + kelola fokus, hanya saat `open` berubah.
  useEffect(() => {
    if (!open) return;

    lastFocused.current = (document.activeElement as HTMLElement | null) ?? null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      requestClose();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;

      // Kembalikan fokus ke elemen pemicu HANYA saat modal benar-benar ditutup
      // (atau unmount), bukan saat effect ini sekadar dijalankan ulang.
      const trigger = lastFocused.current;
      if (trigger && document.contains(trigger)) trigger.focus?.();
      lastFocused.current = null;
    };
  }, [open, requestClose]);

  // Fokus otomatis ke field pertama (atau elemen fokusable pertama) saat dibuka.
  useEffect(() => {
    if (!open) return;

    const timer = window.setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      // Kalau user sudah memilih field sendiri, jangan rebut fokusnya.
      if (container.contains(document.activeElement)) return;

      // Prioritas: field pertama di dalam form, baru tombol lain.
      const firstField = container.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
      );
      const fallback = container.querySelector<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      (firstField ?? fallback)?.focus();
    }, 20);

    return () => window.clearTimeout(timer);
  }, [open]);

  if (!mounted || !open) return null;

  const sizes = {
    sm: "max-w-md",
    md: "max-w-xl",
    lg: "max-w-3xl",
  } as const;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Tutup"
        onClick={requestClose}
        className="fixed inset-0 cursor-default bg-black/60"
        tabIndex={-1}
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 w-full rounded-t-card border border-border bg-surface-raised shadow-pop",
          "animate-pop-in sm:rounded-card",
          sizes[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[15px] font-medium text-text">{title}</h2>
            {description ? <p className="mt-0.5 text-label text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Tutup modal"
            className="rounded-control p-1 text-muted transition-colors duration-150 hover:bg-surface hover:text-text"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </header>

        {children ? <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div> : null}

        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  /** Kalau diisi, user wajib mengetik teks ini (mis. username) untuk konfirmasi. */
  requireText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Dialog konfirmasi. Tombol destruktif memakai warna `banned` hanya di sini.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  danger = false,
  loading = false,
  requireText,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const canConfirm = requireText ? typed.trim() === requireText : true;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      busy={loading}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
            loading={loading}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-body text-muted">
        <div>{message}</div>
        {requireText ? (
          <label className="block space-y-1.5">
            <span className="text-label text-muted">
              Ketik <span className="font-mono text-text">{requireText}</span> untuk konfirmasi
            </span>
            <input
              className="field font-mono"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
