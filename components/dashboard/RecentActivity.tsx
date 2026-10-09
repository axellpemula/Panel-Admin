import { EmptyState } from "@/components/ui/EmptyState";
import type { ActivityItem } from "@/lib/api/stats";
import { CREDIT_ACTION_LABEL, formatDateTime, formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

/**
 * 10 aktivitas terakhir (topup, generate, perpanjang, pengembalian) dari credit_logs.
 */
export function RecentActivity({
  items,
  showUser = false,
}: {
  items: ActivityItem[];
  showUser?: boolean;
}) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-body font-medium">Aktivitas Terakhir</h2>
      </header>

      {items.length === 0 ? (
        <EmptyState message="Belum ada aktivitas" />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            // Label mengikuti aksi sebenarnya; tanda +/ mengikuti arah saldo.
            const positive = item.amount > 0;
            return (
              <li key={item.id} className="row-hover flex items-start gap-3 px-4 py-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    positive ? "bg-active" : "bg-accent",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body">
                    {CREDIT_ACTION_LABEL[item.action] ?? item.action}
                    {showUser ? (
                      <span className="text-muted"> · {item.username ?? "-"}</span>
                    ) : null}
                  </p>
                  <p className="truncate text-label text-muted">
                    {item.note ?? (positive ? "Penambahan credit" : "Pemakaian credit")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={cn(
                      "text-body tabular-nums",
                      positive ? "text-active" : "text-muted",
                    )}
                  >
                    {positive ? "+" : ""}
                    {formatNumber(item.amount)}
                  </p>
                  <p className="text-label text-muted">{formatDateTime(item.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
