"use client";

import { Download, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ACTIVITY_ACTION_LABEL } from "@/lib/activity-labels";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { apiGet, buildQuery } from "@/lib/api/client";
import { formatDateTime, formatRelativeToNow } from "@/lib/utils/format";

/**
 * Tabel "Aktivitas Akun & Sistem" — melengkapi Audit Log (yang khusus aksi pada
 * key). Isinya: ganti password, putus sesi, API key dibuat/dicabut, pengaturan
 * diubah, topup/penyesuaian credit, dan bot Telegram.
 *
 * Dipakai di halaman Audit Log (Owner, semua aktor) dan bisa dipakai ulang
 * untuk aktivitas pribadi.
 */

export interface ActivityLogItem {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  detail: Record<string, unknown> | null;
}

export interface ActivityLogResponse {
  items: ActivityLogItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Semua aktivitas" },
  ...Object.entries(ACTIVITY_ACTION_LABEL).map(([value, label]) => ({ value, label })),
];

/** Warna label aksi: keamanan → kuning, penghapusan → merah, sisanya muted. */
function actionTone(action: string): string {
  if (action === "api_key_revoke" || action === "telegram_disconnect") return "text-banned";
  if (action === "security") return "text-expired";
  if (action === "password_change" || action === "sessions_revoke" || action === "api_key_create") {
    return "text-active";
  }
  return "text-muted";
}

/** Ubah detail JSON jadi satu baris kecil yang bisa dibaca. */
function detailSummary(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  const parts: string[] = [];

  if (Array.isArray(detail.changes)) {
    parts.push(`perubahan: ${(detail.changes as unknown[]).slice(0, 4).join(", ")}`);
  }
  if (typeof detail.amount === "number") parts.push(`jumlah: ${detail.amount}`);
  if (typeof detail.balance_after === "number") parts.push(`saldo: ${detail.balance_after}`);
  if (typeof detail.reason === "string") parts.push(`alasan: ${detail.reason}`);
  if (typeof detail.revoked === "number" && detail.revoked >= 0) {
    parts.push(`${detail.revoked} sesi diputus`);
  }
  if (typeof detail.key_prefix === "string") parts.push(`key: ${detail.key_prefix}…`);
  if (typeof detail.token_prefix === "string") parts.push(`API key: ${detail.token_prefix}…`);
  if (typeof detail.bot_username === "string") parts.push(`bot: @${detail.bot_username}`);
  if (typeof detail.ip === "string") parts.push(`IP: ${detail.ip}`);

  return parts.join(" · ");
}

export function ActivityLogTable({ actorFilter }: { actorFilter?: string }) {
  const toast = useToast();
  const [filters, setFilters] = useState({ from: "", to: "", action: "" });
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [data, setData] = useState<ActivityLogResponse>({
    items: [],
    total: 0,
    page: 1,
    per_page: 50,
    total_pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildQuery({
        from: filters.from,
        to: filters.to,
        action: filters.action,
        actor: actorFilter,
        page,
        per_page: perPage,
      });
      const response = await apiGet<ActivityLogResponse>(`/api/activity${query}`);
      setData(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat aktivitas");
    } finally {
      setLoading(false);
    }
  }, [filters, page, perPage, actorFilter, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const query = buildQuery({
        from: filters.from,
        to: filters.to,
        action: filters.action,
        actor: actorFilter,
        format: "csv",
      });
      const response = await fetch(`/api/activity${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Gagal export CSV");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `aktivitas-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Aktivitas diexport");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal export CSV");
    } finally {
      setExporting(false);
    }
  };

  const hasFilter = filters.from || filters.to || filters.action;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <Field label="Dari tanggal">
            <Input
              type="date"
              value={filters.from}
              onChange={(event) => {
                setFilters((previous) => ({ ...previous, from: event.target.value }));
                setPage(1);
              }}
            />
          </Field>
          <Field label="Sampai tanggal">
            <Input
              type="date"
              value={filters.to}
              onChange={(event) => {
                setFilters((previous) => ({ ...previous, to: event.target.value }));
                setPage(1);
              }}
            />
          </Field>
          <Field label="Jenis aktivitas">
            <Select
              ariaLabel="Filter jenis aktivitas"
              value={filters.action || null}
              placeholder="Semua aktivitas"
              onChange={(value) => {
                setFilters((previous) => ({ ...previous, action: value }));
                setPage(1);
              }}
              options={ACTION_OPTIONS}
            />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          {hasFilter ? (
            <Button
              size="sm"
              onClick={() => {
                setFilters({ from: "", to: "", action: "" });
                setPage(1);
              }}
              icon={<X size={15} strokeWidth={1.5} />}
            >
              Reset
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => void load()}
            loading={loading}
            icon={<RefreshCw size={15} strokeWidth={1.5} />}
            aria-label="Muat ulang aktivitas"
          >
            Muat ulang
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={exportCsv}
            loading={exporting}
            icon={<Download size={15} strokeWidth={1.5} />}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <SkeletonRows rows={8} columns={5} />
      ) : data.items.length === 0 ? (
        <EmptyState message="Belum ada aktivitas pada rentang ini." />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-[150px]">Waktu</th>
                <th className="w-[150px]">Aktor</th>
                <th className="w-[190px]">Aktivitas</th>
                <th className="w-[150px]">Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => {
                const detail = detailSummary(item.detail);
                return (
                  <tr key={item.id}>
                    <td
                      className="whitespace-nowrap text-muted"
                      title={formatDateTime(item.created_at)}
                    >
                      {formatRelativeToNow(item.created_at)}
                    </td>
                    <td className="whitespace-nowrap">
                      {item.actor_username ?? "Sistem"}
                      {item.actor_role ? (
                        <span className="text-muted"> · {item.actor_role}</span>
                      ) : null}
                    </td>
                    <td className={`whitespace-nowrap ${actionTone(item.action)}`}>
                      {ACTIVITY_ACTION_LABEL[item.action] ?? item.action}
                    </td>
                    <td className="max-w-[160px] truncate text-muted" title={item.target_label ?? ""}>
                      {item.target_label ?? item.target_id ?? "-"}
                    </td>
                    <td className="max-w-[360px] truncate text-muted" title={detail}>
                      {detail || "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.total > 0 ? (
        <Pagination
          page={data.page}
          totalPages={data.total_pages}
          total={data.total}
          perPage={data.per_page}
          onChange={setPage}
        />
      ) : null}
    </>
  );
}
