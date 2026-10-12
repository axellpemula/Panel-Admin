"use client";

import {
  ArrowDown,
  ArrowUp,
  Ban,
  Clock,
  KeyRound,
  Pencil,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";
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
  formatRelativeToNow,
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

const EXPIRING_SOON_MS = 3 * 60 * 60 * 1000;

function isExpiringSoon(item: KeyListItem): boolean {
  if (item.status !== "active" || !item.expired_at) return false;
  const diff = new Date(item.expired_at).getTime() - Date.now();
  return diff > 0 && diff <= EXPIRING_SOON_MS;
}

export function KeyTable(props: KeyTableProps) {
  const { items, loading = false, emptyMessage = "Belum ada key" } = props;

  if (loading) {
    return (
      <div className="w-full">
        <SkeletonRows rows={6} columns={6} />
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <>
      <div className="hidden sm:block">
        <DesktopTable {...props} />
      </div>
      <div className="sm:hidden">
        <MobileCards {...props} />
      </div>
    </>
  );
}

function DesktopTable({
  items,
  isOwner,
  sort,
  order,
  onSortChange,
  onOpenDetail,
  onEdit,
  onToggleBan,
  onDelete,
}: KeyTableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[1180px] border-collapse text-body">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-border text-left text-label text-muted">
            <SortableHeader column="key_value" label="Key" sort={sort} order={order} onSortChange={onSortChange} />
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
              Tool / Version
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
            <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
              Last used
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
          {items.map((item) => (
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
              <td className="whitespace-nowrap px-3 py-1.5">
                <ToolVersion toolName={item.tool_name} versionName={item.version_name} />
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">
                <StatusCell item={item} />
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted tabular-nums">
                {item.duration_days === null ? LIFETIME_LABEL : `${item.duration_days} hari`}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                <ExpiredCell item={item} />
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted">
                {formatDeviceUsage(item.devices_used, item.max_device)}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                <LastUsed value={item.last_used} />
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
                  <RowActions
                    item={item}
                    onOpenDetail={onOpenDetail}
                    onEdit={onEdit}
                    onToggleBan={onToggleBan}
                    onDelete={onDelete}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileCards({
  items,
  isOwner,
  onOpenDetail,
  onEdit,
  onToggleBan,
  onDelete,
}: KeyTableProps) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="space-y-2 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onOpenDetail(item)}
                className="truncate font-mono text-[13px] tracking-tight text-text"
              >
                {item.key_value}
              </button>
              <CopyButton value={item.key_value} label="Copy key" size={14} />
            </div>
            <StatusCell item={item} />
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-label">
            <div className="col-span-2 flex items-center gap-1.5 text-muted">
              <ToolVersion toolName={item.tool_name} versionName={item.version_name} />
            </div>
            <div>
              <dt className="text-muted">Expired</dt>
              <dd className="text-text">
                <ExpiredCell item={item} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">Device</dt>
              <dd className="tabular-nums text-text">{formatDeviceUsage(item.devices_used, item.max_device)}</dd>
            </div>
            <div>
              <dt className="text-muted">Last used</dt>
              <dd className="text-text">
                <LastUsed value={item.last_used} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">{isOwner ? "Created by" : "Durasi"}</dt>
              <dd className="text-text">
                {isOwner
                  ? (item.created_by_username ?? "-")
                  : item.duration_days === null
                    ? LIFETIME_LABEL
                    : `${item.duration_days} hari`}
              </dd>
            </div>
          </dl>

          <div className="flex items-center justify-end gap-1 border-t border-border pt-2">
            <RowActions
              item={item}
              onOpenDetail={onOpenDetail}
              onEdit={onEdit}
              onToggleBan={onToggleBan}
              onDelete={onDelete}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ToolVersion({ toolName, versionName }: { toolName: string; versionName: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-muted">
      <Wrench size={13} strokeWidth={1.5} className="shrink-0 opacity-70" aria-hidden="true" />
      <span className="truncate text-text">{toolName}</span>
      <span className="rounded-control border border-border px-1.5 py-0.5 font-mono text-[11px] leading-none">
        {versionName}
      </span>
    </span>
  );
}

function StatusCell({ item }: { item: KeyListItem }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={item.status} />
      {item.status === "banned" && item.ban_reason ? (
        <span
          className="rounded-control border border-border px-1.5 py-0.5 text-[11px] text-muted"
          title={item.ban_note ?? BAN_REASON_LABEL[item.ban_reason]}
        >
          {BAN_REASON_LABEL[item.ban_reason] ?? item.ban_reason}
        </span>
      ) : null}
      {isExpiringSoon(item) ? (
        <span
          className="inline-flex items-center gap-1 rounded-control border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent"
          title={`Expired ${formatRelativeToNow(item.expired_at)}`}
        >
          <Clock size={11} strokeWidth={1.75} aria-hidden="true" />
          Segera expired
        </span>
      ) : null}
    </div>
  );
}

function ExpiredCell({ item }: { item: KeyListItem }) {
  if (!item.expired_at) return <span>{LIFETIME_LABEL}</span>;
  return (
    <span title={formatRelativeToNow(item.expired_at)} className="cursor-help decoration-dotted underline-offset-2 hover:underline">
      {formatDateTime(item.expired_at)}
    </span>
  );
}

function LastUsed({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted/70">Belum pernah</span>;
  return (
    <span title={formatDateTime(value)} className="cursor-help">
      {formatRelativeToNow(value)}
    </span>
  );
}

function RowActions({
  item,
  onOpenDetail,
  onEdit,
  onToggleBan,
  onDelete,
}: Pick<KeyTableProps, "onOpenDetail" | "onEdit" | "onToggleBan" | "onDelete"> & { item: KeyListItem }) {
  return (
    <>
      <IconAction
        label="Detail & HWID"
        onClick={() => onOpenDetail(item)}
        icon={<KeyRound size={16} strokeWidth={1.5} />}
      />
      <IconAction label="Edit key" onClick={() => onEdit(item)} icon={<Pencil size={16} strokeWidth={1.5} />} />
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
      <IconAction label="Hapus key" onClick={() => onDelete(item)} icon={<Trash2 size={16} strokeWidth={1.5} />} />
    </>
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

function IconAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
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
