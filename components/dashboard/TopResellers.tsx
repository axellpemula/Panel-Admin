import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import type { TopReseller } from "@/lib/api/stats";
import { formatNumber } from "@/lib/utils/format";

export function TopResellers({ items }: { items: TopReseller[] }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-body font-medium">Top Reseller</h2>
        <Link href="/resellers" className="text-label text-accent hover:underline">
          Lihat semua
        </Link>
      </header>

      {items.length === 0 ? (
        <EmptyState message="Belum ada reseller" />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item, index) => (
            <li key={item.id} className="row-hover flex items-center gap-3 px-4 py-3">
              <span className="w-4 text-label text-muted tabular-nums">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-body">{item.username}</p>
                <p className="truncate text-label text-muted">{item.email}</p>
              </div>
              <div className="text-right">
                <p className="text-body tabular-nums">{formatNumber(item.key_count)}</p>
                <p className="text-label text-muted tabular-nums">{formatNumber(item.credit)} credit</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
