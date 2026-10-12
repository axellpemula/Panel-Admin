"use client";

import { Download, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { TopReseller } from "@/lib/api/stats";
import { apiGet, buildQuery } from "@/lib/api/client";
import { CREDIT_ACTION_LABEL, formatDateTime, formatNumber } from "@/lib/utils/format";

interface CreditLogItem {
  id: string;
  created_at: string;
  user_id: string;
  username: string | null;
  email: string | null;
  action: "topup" | "generate" | "extend" | "refund" | "adjustment";
  amount: number;
  balance_after: number;
  note: string | null;
  created_by_username: string | null;
}

interface CreditsResponse {
  items: CreditLogItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export function CreditsView({ isOwner }: { isOwner: boolean }) {
  const toast = useToast();

  const [filters, setFilters] = useState({ from: "", to: "", action: "", userId: "" });
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [data, setData] = useState<CreditsResponse>({
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
        user_id: filters.userId,
        page,
        per_page: perPage,
      });
      const response = await apiGet<CreditsResponse>(`/api/credits${query}`);
      setData(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat credit log");
    } finally {
      setLoading(false);
    }
  }, [filters, page, perPage, toast]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    const loadResellers = async () => {
      try {
        const response = await apiGet<{ resellers: TopReseller[] }>("/api/resellers");
        if (!cancelled) setResellers(response.resellers);
      } catch {
        // Filter reseller tidak wajib.
      }
    };
    void loadResellers();
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const query = buildQuery({
        from: filters.from,
        to: filters.to,
        action: filters.action,
        user_id: filters.userId,
        format: "csv",
      });
      const response = await fetch(`/api/credits${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Gagal export CSV");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `credit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Credit log diexport");
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
    filters.userId.length > 0;

  const resetFilter = () => {
    setFilters({ from: "", to: "", action: "", userId: "" });
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium">Credit Log</h1>
          <p className="mt-1 text-body text-muted">
            {isOwner
              ? "Semua transaksi credit: topup, generate, perpanjang, dan pengembalian credit."
              : "Riwayat topup, generate, perpanjang, dan pengembalian credit milikmu."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void load()}
            loading={loading}
            icon={<RefreshCw size={16} strokeWidth={1.5} />}
            aria-label="Muat ulang credit log"
            title="Muat ulang credit log"
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
        </div>
      </header>

      <section className="card p-4">
        <div className="grid gap-3 lg:grid-cols-4">
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
              options={[
                { value: "", label: "Semua aksi" },
                { value: "topup", label: "Topup" },
                { value: "generate", label: "Generate" },
                { value: "extend", label: "Perpanjang" },
                { value: "refund", label: "Pengembalian" },
                { value: "adjustment", label: "Penyesuaian" },
              ]}
            />
          </Field>
          {isOwner ? (
            <Field label="Reseller">
              <Select
                ariaLabel="Filter reseller"
                value={filters.userId || null}
                placeholder="Semua reseller"
                onChange={(value) => {
                  setFilters((previous) => ({ ...previous, userId: value }));
                  setPage(1);
                }}
                options={[
                  { value: "", label: "Semua reseller" },
                  ...resellers.map((reseller) => ({
                    value: reseller.id,
                    label: reseller.username,
                  })),
                ]}
              />
            </Field>
          ) : null}
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
          <SkeletonRows rows={6} columns={isOwner ? 6 : 5} />
        ) : data.items.length === 0 ? (
          <EmptyState message="Belum ada transaksi credit" />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[960px] text-body">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-label text-muted">
                  <th scope="col" className="px-3 py-2 font-normal">
                    Tanggal
                  </th>
                  {isOwner ? (
                    <th scope="col" className="px-3 py-2 font-normal">
                      Reseller
                    </th>
                  ) : null}
                  <th scope="col" className="px-3 py-2 font-normal">
                    Aksi
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Jumlah
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Saldo setelah
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((item) => (
                  <tr key={item.id} className="row-hover h-11">
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                      {formatDateTime(item.created_at)}
                    </td>
                    {isOwner ? (
                      <td className="whitespace-nowrap px-3 py-1.5">
                        {item.username ?? "-"}
                        {item.created_by_username && item.created_by_username !== item.username ? (
                          <span className="text-muted"> (oleh {item.created_by_username})</span>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span
                        className={
                          item.action === "topup" || item.action === "adjustment"
                            ? "text-active"
                            : "text-muted"
                        }
                      >
                        {CREDIT_ACTION_LABEL[item.action] ?? item.action}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                      <span className={item.amount > 0 ? "text-active" : "text-banned"}>
                        {item.amount > 0 ? "+" : ""}
                        {formatNumber(item.amount)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted">
                      {formatNumber(item.balance_after)}
                    </td>
                    <td className="max-w-[320px] truncate px-3 py-1.5 text-muted" title={item.note ?? ""}>
                      {item.note ?? "-"}
                    </td>
                  </tr>
                ))}
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
    </div>
  );
}
