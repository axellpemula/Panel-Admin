"use client";

import { Download, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ActivityLogTable } from "@/components/dashboard/ActivityLogTable";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { TopReseller } from "@/lib/api/stats";
import { apiGet, buildQuery } from "@/lib/api/client";
import type { AuditAction, BanReason } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";
import {
  AUDIT_ACTION_LABEL,
  BAN_REASON_LABEL,
  formatDateTime,
} from "@/lib/utils/format";

interface AuditLogItem {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_role: string | null;
  action: AuditAction;
  key_id: string | null;
  key_value: string;
  key_owner_id: string | null;
  key_owner_username: string | null;
  ban_reason: BanReason | null;
  note: string | null;
  detail: Record<string, unknown> | null;
}

interface AuditResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Semua aksi" },
  { value: "key_ban", label: AUDIT_ACTION_LABEL.key_ban },
  { value: "key_unban", label: AUDIT_ACTION_LABEL.key_unban },
  { value: "key_auto_ban", label: AUDIT_ACTION_LABEL.key_auto_ban },
  { value: "key_delete", label: AUDIT_ACTION_LABEL.key_delete },
  { value: "hwid_reset", label: AUDIT_ACTION_LABEL.hwid_reset },
  { value: "hwid_reset_all", label: AUDIT_ACTION_LABEL.hwid_reset_all },
];

function actionTone(action: AuditAction): string {
  if (action === "key_unban") return "text-active";
  if (action === "key_ban" || action === "key_auto_ban" || action === "key_delete") {
    return "text-banned";
  }
  return "text-muted";
}

function detailSummary(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  const parts: string[] = [];
  if (typeof detail.hardware_id === "string") parts.push(`HWID: ${detail.hardware_id}`);
  if (typeof detail.removed === "number") parts.push(`removed: ${detail.removed}`);
  if (typeof detail.previous_status === "string") {
    parts.push(`status sebelumnya: ${detail.previous_status}`);
  }
  if (typeof detail.new_status === "string") parts.push(`status baru: ${detail.new_status}`);
  if (typeof detail.source_ip === "string") parts.push(`IP: ${detail.source_ip}`);
  if (detail.refund && typeof detail.refund === "object") {
    const refund = detail.refund as Record<string, unknown>;
    if (typeof refund.amount === "number" && refund.amount > 0) {
      parts.push(`refund: ${refund.amount} credit`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : JSON.stringify(detail);
}

export function AuditView({
  currentUserId,
  currentUsername,
}: {
  currentUserId: string;
  currentUsername: string;
}) {
  const toast = useToast();

  const [scope, setScope] = useState<"key" | "activity">("key");
  const [filters, setFilters] = useState({ from: "", to: "", action: "", actor: "", key: "" });
  const [keyInput, setKeyInput] = useState("");
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [data, setData] = useState<AuditResponse>({
    items: [],
    total: 0,
    page: 1,
    per_page: 50,
    total_pages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [resellers, setResellers] = useState<TopReseller[]>([]);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildQuery({
        from: filters.from,
        to: filters.to,
        action: filters.action,
        actor: filters.actor,
        key: filters.key,
        page,
        per_page: perPage,
      });
      const response = await apiGet<AuditResponse>(`/api/audit${query}`);
      setData(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat audit log");
    } finally {
      setLoading(false);
    }
  }, [filters, page, perPage, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    const loadResellers = async () => {
      try {
        const response = await apiGet<{ resellers: TopReseller[] }>("/api/resellers");
        if (!cancelled) setResellers(response.resellers);
      } catch {
      }
    };
    void loadResellers();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((previous) =>
        previous.key === keyInput ? previous : { ...previous, key: keyInput },
      );
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyInput]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const query = buildQuery({
        from: filters.from,
        to: filters.to,
        action: filters.action,
        actor: filters.actor,
        key: filters.key,
        format: "csv",
      });
      const response = await fetch(`/api/audit${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Gagal export CSV");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Audit log diexport");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal export CSV");
    } finally {
      setExporting(false);
    }
  };

  const hasFilter =
    filters.from.length > 0 ||
    filters.to.length > 0 ||
    filters.action.length > 0 ||
    filters.actor.length > 0 ||
    filters.key.length > 0;

  const resetFilter = () => {
    setKeyInput("");
    setFilters({ from: "", to: "", action: "", actor: "", key: "" });
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium">Audit Log</h1>
          <p className="mt-1 text-body text-muted">
            {scope === "key"
              ? "Jejak semua aksi pada key: siapa yang ban, unban, hapus key, atau reset HWID — lengkap dengan alasan ban. Auto-ban (HWID)."
              : "Aktivitas akun & sistem: ganti password, putus sesi, API key dibuat/dicabut, pengaturan diubah, topup/penyesuaian credit, dan bot Telegram."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Jenis log"
            className="flex items-center gap-1 rounded-control border border-border bg-surface p-1"
          >
            {(
              [
                { value: "key" as const, label: "Aksi Key" },
                { value: "activity" as const, label: "Aktivitas Akun & Sistem" },
              ]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={scope === option.value}
                onClick={() => setScope(option.value)}
                className={cn(
                  "h-7 rounded-[calc(var(--radius-control)-2px)] px-2.5 text-label transition-colors duration-150",
                  scope === option.value ? "bg-accent/15 text-accent" : "text-muted hover:text-text",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {scope === "key" ? (
            <>
              <Button
                size="sm"
                onClick={() => void load()}
                loading={loading}
                icon={<RefreshCw size={16} strokeWidth={1.5} />}
                aria-label="Muat ulang audit log"
                title="Muat ulang audit log"
              >
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={exportCsv}
                loading={exporting}
                icon={<Download size={16} strokeWidth={1.5} />}
              >
                Export CSV
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {scope === "activity" ? (
        <section className="card overflow-hidden">
          <ActivityLogTable actorFilter={filters.actor || undefined} />
        </section>
      ) : (
        <>

      <section className="card p-4">
        <div className="grid gap-3 lg:grid-cols-5">
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
          <Field label="Aksi">
            <Select
              ariaLabel="Filter aksi"
              value={filters.action || null}
              placeholder="Semua aksi"
              onChange={(value) => {
                setFilters((previous) => ({ ...previous, action: value }));
                setPage(1);
              }}
              options={ACTION_OPTIONS}
            />
          </Field>
          <Field label="Aktor">
            <Select
              ariaLabel="Filter aktor"
              value={filters.actor || null}
              placeholder="Semua aktor"
              onChange={(value) => {
                setFilters((previous) => ({ ...previous, actor: value }));
                setPage(1);
              }}
              options={[
                { value: "", label: "Semua aktor" },
                { value: currentUserId, label: `Saya (${currentUsername})` },
                { value: "system", label: "Sistem (auto-ban)" },
                ...resellers.map((reseller) => ({
                  value: reseller.id,
                  label: reseller.username,
                })),
              ]}
            />
          </Field>
          <Field label="Cari key">
            <div className="relative">
              <Search
                size={16}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                className="field pl-9 font-mono"
                placeholder="Cari Key..."
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value.toUpperCase())}
                aria-label="Cari key"
                spellCheck={false}
              />
            </div>
          </Field>
        </div>

        {hasFilter ? (
          <div className="mt-3">
            <Button size="sm" onClick={resetFilter} icon={<X size={14} strokeWidth={1.5} />}>
              Reset filter
            </Button>
          </div>
        ) : null}
      </section>

      <section className="card overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} columns={7} />
        ) : data.items.length === 0 ? (
          <EmptyState message="Belum ada aksi tercatat di audit log" />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[960px] text-body">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-label text-muted">
                  <th scope="col" className="px-3 py-2 font-normal">
                    Tanggal
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Aktor
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Aksi
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Key
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Pemilik
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Alasan
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Catatan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((item) => {
                  const detailText = detailSummary(item.detail);
                  return (
                    <tr key={item.id} className="row-hover h-11">
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                        {formatDateTime(item.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className="text-text">{item.actor_username ?? "system"}</span>
                        {item.actor_role ? (
                          <span className="text-muted"> ({item.actor_role})</span>
                        ) : null}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-1.5 ${actionTone(item.action)}`}>
                        {AUDIT_ACTION_LABEL[item.action] ?? item.action}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span className="font-mono text-[13px] text-text">{item.key_value}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                        {item.key_owner_username ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                        {item.ban_reason ? (BAN_REASON_LABEL[item.ban_reason] ?? item.ban_reason) : "-"}
                      </td>
                      <td
                        className="max-w-[320px] truncate px-3 py-1.5 text-muted"
                        title={[item.note, detailText].filter(Boolean).join("\n")}
                      >
                        {item.note ?? (detailText ? (
                          <span className="text-muted">{detailText}</span>
                        ) : (
                          "-"
                        ))}
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
      </section>
        </>
      )}
    </div>
  );
}
