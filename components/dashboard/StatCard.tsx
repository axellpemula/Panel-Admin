import { formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "active" | "expired" | "banned" | "accent";
}) {
  const tones: Record<string, string> = {
    default: "text-text",
    active: "text-active",
    expired: "text-expired",
    banned: "text-banned",
    accent: "text-accent",
  };

  return (
    <div className="card p-4">
      <p className="text-label text-muted">{label}</p>
      <p className={cn("mt-2 text-[22px] leading-7 font-medium tabular-nums", tones[tone])}>
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      {hint ? <p className="mt-1 text-label text-muted">{hint}</p> : null}
    </div>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}
