"use client";

import { AlertTriangle, Check, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils/cn";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Durasi tampil toast: 4 detik, lalu hilang otomatis. */
const TOAST_DURATION = 4000;

/** Penghitung id toast — monoton, tidak mungkin tabrakan antar toast. */
let nextToastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info") => {
      nextToastId += 1;
      const id = nextToastId;
      setItems((previous) => [...previous.slice(-3), { id, tone, message }]);
      window.setTimeout(() => remove(id), TOAST_DURATION);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (message: string) => toast(message, "success"),
      error: (message: string) => toast(message, "error"),
      info: (message: string) => toast(message, "info"),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((item) => (
          <ToastRow key={item.id} item={item} onDismiss={() => remove(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 10);
    return () => window.clearTimeout(timer);
  }, []);

  const tones: Record<ToastTone, { icon: ReactNode; className: string }> = {
    success: {
      icon: <Check size={16} strokeWidth={1.5} className="text-active" />,
      className: "border-active/40",
    },
    error: {
      icon: <AlertTriangle size={16} strokeWidth={1.5} className="text-banned" />,
      className: "border-banned/40",
    },
    info: {
      icon: <Info size={16} strokeWidth={1.5} className="text-muted" />,
      className: "border-border",
    },
  };

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-card border bg-surface-raised px-3 py-2.5 text-body shadow-pop",
        "transition-all duration-150 ease-out",
        tones[item.tone].className,
        visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
    >
      <span className="mt-0.5 shrink-0">{tones[item.tone].icon}</span>
      <p className="min-w-0 flex-1 break-words text-text">{item.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Tutup notifikasi"
        className="shrink-0 rounded-control p-0.5 text-muted transition-colors duration-150 hover:text-text"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast harus dipakai di dalam <ToastProvider>");
  }
  return context;
}
