"use client";

import { ArrowDown, ArrowUp, Ban, KeyRound, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/Badge";
import type { SortColumn } from "@/lib/api/keys";
import type { KeyListItem } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";
import {
  BAN_REASON_LABEL,
  formatDateTime,
  formatDeviceUsage,
  LIFETIME_LABEL,
} from "@/lib/utils/format";

export interface KeyTableProps {
  items: KeyListItem[];
  loading?: boolean;
  /** Owner melihat kolom "Created by"; Reseller tidak. */
  isOwner: boolean;
  sort: SortColumn;
  order: "asc" | "desc";
  onSortChange: (column: SortColumn) => void;
  onOpenDetail: (key: KeyListItem) => void;
  onEdit: (key: KeyListItem) => void;
  onToggleBan: (key: KeyListItem) => void;
  onDelete: (key: KeyListItem) => void;
  emptyMessage?: string;
}

/**
 * Tabel key reusable: sort, hover row, header sticky, scroll horizontal
 * di dalam container (halaman tidak ikut geser).
 */
export function KeyTable({
  items,
  loading = false,
  isOwner,
  sort,
  order,
  onSortChange,
  onOpenDetail,
  onEdit,
  onToggleBan,
  onDelete,
  emptyMessage = "Belum ada key",
}: KeyTableProps) {
  const columnCount = isOwner ? 10 : 9;

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[1080px] border-collapse text-body">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-border text-left text-label text-muted">
            <SortableHeader column="key_value" label="Key" sort={sort} order={order} onSortChange={onSortChange} />
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
              Tool
            </th>
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
              Version
            </th>
            <SortableHeader column="status" label="Status" sort={sort} order={order} onSortChange={onSortChange} />
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
              Durasi
            </th>
            <SortableHeader
              column="expired_at"
              label="Expired"
              sort={sort}
              order={order}
              onSortChange={onSortChange}
            />
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
              Device
            </th>
            {isOwner ? (
              <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
                Created by
              </th>
            ) : null}
            <SortableHeader
              column="created_at"
              label="Created"
              sort={sort}
              order={order}
              onSortChange={onSortChange}
            />
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-normal">
              Aksi
            </th>
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {loading ? (
            <tr>
              <td colSpan={columnCount} className="p-0">
                <SkeletonRows rows={6} columns={columnCount} />
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="p-0">
                <EmptyState message={emptyMessage} />
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id} className="row-hover h-11 align-middle">
                <td className="whitespace-nowrap px-3 py-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onOpenDetail(item)}
                      title="Lihat detail & HWID"
                      className="rounded-control px-1 py-0.5 font-mono text-[13px] tracking-tight text-text transition-colors duration-150 hover:text-accent"
                    >
                      {item.key_value}
                    </button>
                    <CopyButton value={item.key_value} label="Copy key" size={14} />
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted">{item.tool_name}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted">{item.version_name}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={item.status} />
                    {item.status === "banned" && item.ban_reason ? (
                      <span
                        className="rounded-control border border-border px-1.5 py-0.5 text-[11px] text-muted"
                        title={item.ban_note ?? BAN_REASON_LABEL[item.ban_reason]}
                      >
                        {BAN_REASON_LABEL[item.ban_reason] ?? item.ban_reason}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted tabular-nums">
                  {item.duration_days === null ? LIFETIME_LABEL : `${item.duration_days} hari`}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                  {item.expired_at ? formatDateTime(item.expired_at) : LIFETIME_LABEL}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted">
                  {formatDeviceUsage(item.devices_used, item.max_device)}
                </td>
                {isOwner ? (
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                    {item.created_by_username ?? "-"}
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                  {formatDateTime(item.created_at)}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <div className="flex items-center justify-end gap-1">
                    <IconAction
                      label="Detail & HWID"
                      onClick={() => onOpenDetail(item)}
                      icon={<KeyRound size={16} strokeWidth={1.5} />}
                    />
                    <IconAction
                      label="Edit key"
                      onClick={() => onEdit(item)}
                      icon={<Pencil size={16} strokeWidth={1.5} />}
                    />
                    <IconAction
                      label={item.status === "banned" ? "Unban key" : "Ban key"}
                      onClick={() => onToggleBan(item)}
                      icon={
                        item.status === "banned" ? (
                          <ShieldCheck size={16} strokeWidth={1.5} />
                        ) : (
                          <Ban size={16} strokeWidth={1.5} />
                        )
                      }
                    />
                    <IconAction
                      label="Hapus key"
                      onClick={() => onDelete(item)}
                      icon={<Trash2 size={16} strokeWidth={1.5} />}
                    />
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  column,
  label,
  sort,
  order,
  onSortChange,
}: {
  column: SortColumn;
  label: string;
  sort: SortColumn;
  order: "asc" | "desc";
  onSortChange: (column: SortColumn) => void;
}) {
  const active = sort === column;
  return (
    <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
      <button
        type="button"
        onClick={() => onSortChange(column)}
        className={cn(
          "inline-flex items-center gap-1 rounded-control transition-colors duration-150 hover:text-text",
          active && "text-text",
        )}
        aria-label={`Urutkan berdasarkan ${label}`}
      >
        {label}
        {active ? (
          order === "asc" ? (
            <ArrowUp size={14} strokeWidth={1.5} />
          ) : (
            <ArrowDown size={14} strokeWidth={1.5} />
          )
        ) : null}
      </button>
    </th>
  );
}

function IconAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-control p-1.5 text-muted transition-colors duration-150 hover:bg-surface-raised hover:text-text"
    >
      {icon}
    </button>
  );
}
