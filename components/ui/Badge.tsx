import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";
import type { KeyStatus } from "@/lib/types/database";

const STATUS_TEXT: Record<KeyStatus, string> = {
  active: "Active",
  expired: "Expired",
  banned: "Banned",
};

const STATUS_COLOR: Record<KeyStatus, string> = {
  active: "text-active",
  expired: "text-expired",
  banned: "text-banned",
};

const STATUS_DOT: Record<KeyStatus, string> = {
  active: "bg-active",
  expired: "bg-expired",
  banned: "bg-banned",
};

/**
 * Badge status key: teks kecil + titik warna di kiri, tanpa background terang.
 */
export function StatusBadge({ status }: { status: KeyStatus | string }) {
  const key = (["active", "expired", "banned"].includes(status) ? status : "expired") as KeyStatus;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-label font-medium", STATUS_COLOR[key])}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[key])} />
      {STATUS_TEXT[key]}
    </span>
  );
}

/** Badge kecil generik (dipakai untuk role, status aktif tool, dsb). */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "active" | "expired" | "banned";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-border text-muted",
    accent: "border-accent/50 text-accent",
    active: "border-active/50 text-active",
    expired: "border-expired/50 text-expired",
    banned: "border-banned/50 text-banned",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] leading-4",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Badge role user (Owner / Reseller). */
export function RoleBadge({ role }: { role: string }) {
  return (
    <Badge tone={role === "owner" ? "accent" : "neutral"}>
      {role === "owner" ? "Owner" : "Reseller"}
    </Badge>
  );
}

/** Badge status aktif/nonaktif. */
export function ActiveBadge({ active, labelOn = "Aktif", labelOff = "Nonaktif" }: { active: boolean; labelOn?: string; labelOff?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-label",
        active ? "text-active" : "text-muted",
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-active" : "bg-muted")} />
      {active ? labelOn : labelOff}
    </span>
  );
}
