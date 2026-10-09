"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Tombol copy kecil. Fallback ke textarea + execCommand untuk browser lama
 * atau konteks non-HTTPS.
 */
export function CopyButton({
  value,
  label,
  className,
  size = 16,
  showLabel = false,
  onCopied,
}: {
  value: string;
  label?: string;
  className?: string;
  size?: number;
  showLabel?: boolean;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    const text = value;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "true");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
      onCopied?.();
    } catch {
      setCopied(false);
    }
  }, [onCopied, value]);

  return (
    <button
      type="button"
      onClick={copy}
      title={label ?? "Copy"}
      aria-label={label ?? "Copy"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control px-1.5 py-1 text-muted transition-colors duration-150",
        "hover:bg-surface-raised hover:text-text",
        copied && "text-active",
        className,
      )}
    >
      {copied ? (
        <Check size={size} strokeWidth={1.5} />
      ) : (
        <Copy size={size} strokeWidth={1.5} />
      )}
      {showLabel ? <span className="text-label">{copied ? "Tersalin" : (label ?? "Copy")}</span> : null}
    </button>
  );
}
