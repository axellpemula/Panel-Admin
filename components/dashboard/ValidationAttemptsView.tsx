"use client";

import dynamic from "next/dynamic";
import { Download, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { StatCard, StatGrid } from "@/components/dashboard/StatCard";
import type { ValidationTrendPoint } from "@/components/dashboard/ValidationTrendChart";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Form";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { SkeletonCards, SkeletonChart, SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { apiGet, buildQuery } from "@/lib/api/client";
import { VALIDATION_REASONS } from "@/lib/constants";
import {
  VALIDATION_REASON_LABEL,
  formatDateTime,
  formatNumber,
  truncate,
} from "@/lib/utils/format";

// Recharts hanya di-load di halaman ini, dan hanya di client (bundle awal tetap ringan).
const ValidationTrendChart = dynamic(
  () => import("@/components/dashboard/ValidationTrendChart"),
  { ssr: false, loading: () => <SkeletonChart /> },
);

interface AttemptItem {
  id: string;
  ip: string;
  key_value: string | null;
  hardware_id: string | null;
  success: boolean;
  reason: string | null;
  created_at: string;
}

interface SuspiciousIp {
  ip: string;
  total: number;
  failed: number;
  invalid_key: number;
  distinct_keys: number;
  first_seen: string;
  last_seen: string;
  suspect: boolean;
}

interface FailingKey {
  key_value: string;
  total: number;
  succeeded: number;
  failed: number;
  distinct_ips: number;
  reasons: Record<string, number>;
  last_seen: string;
}

interface ValidationAttemptsResponse {
  range: { from: string; to: string; hourly: boolean };
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    failure_rate: number;
    distinct_ips: number;
    distinct_keys: number;
    capped: boolean;
  };
  trend: ValidationTrendPoint[];
  suspicious_ips: SuspiciousIp[];
  top_failing_keys: FailingKey[];
  items: AttemptItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

const RESULT_OPTIONS = [
  { value: "", label: "Semua hasil" },
  { value: "success", label: "Sukses" },
  { value: "failed", label: "Gagal" },
];

const REASON_OPTIONS = [
  { value: "", label: "Semua alasan" },
  ...VALIDATION_REASONS.map((reason) => ({
    value: reason,
    label: VALIDATION_REASON_LABEL[reason] ?? reason,
  })),
];

/** Tanggal hari ini (YYYY-MM-DD) menurut zona waktu Asia/Jakarta. */
function todayJakarta(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Ringkas breakdown alasan gagal: "Key tidak valid ×12 · Key kedaluwarsa ×3". */
function reasonBreakdown(reasons: Record<string, number>): string {
  return Object.entries(reasons)
    .map(([reason, count]) => `${VALIDATION_REASON_LABEL[reason] ?? reason} ×${formatNumber(count)}`)
    .join(" · ");
}

/**
 * Validation Attempts (Owner only): semua percobaan validasi key yang tercatat —
 * ringkasan, tren per jam, IP mencurigakan, key yang paling sering gagal, dan
 * daftar percobaan lengkap (filter + pagination + export CSV).
 */
export function ValidationAttemptsView() {
  const toast = useToast();

  const [filters, setFilters] = useState({
    from: todayJakarta(),
    to: "",
    result: "",
    reason: "",
    ip: "",
    key: "",
  });
  const [ipInput, setIpInput] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [data, setData] = useState<ValidationAttemptsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildQuery({
        from: filters.from,
        to: filters.to,
        result: filters.result,
        reason: filters.reason,
        ip: filters.ip,
        key: filters.key,
        page,
        per_page: perPage,
      });
      const response = await apiGet<ValidationAttemptsResponse>(
        `/api/validation-attempts${query}`,
      );
      setData(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat validation attempts");
    } finally {
      setLoading(false);
    }
  }, [filters, page, perPage, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  // --- Debounce input pencarian IP & key (300 ms) ---
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((previous) =>
        previous.ip === ipInput && previous.key === keyInput
          ? previous
          : { ...previous, ip: ipInput, key: keyInput },
      );
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [ipInput, keyInput]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const query = buildQuery({
        from: filters.from,
        to: filters.to,
        result: filters.result,
        reason: filters.reason,
        ip: filters.ip,
        key: filters.key,
        format: "csv",
      });
      const response = await fetch(`/api/validation-attempts${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Gagal export CSV");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `validation-attempts-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("Validation attempts diexport");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal export CSV");
    } finally {
      setExporting(false);
    }
  };

  const hasFilter =
    filters.to.length > 0 ||
    filters.result.length > 0 ||
    filters.reason.length > 0 ||
    filters.ip.length > 0 ||
    filters.key.length > 0;

  const resetFilter = () => {
    setIpInput("");
    setKeyInput("");
    setFilters({ from: todayJakarta(), to: "", result: "", reason: "", ip: "", key: "" });
    setPage(1);
  };

  const summary = data?.summary;
  const suspiciousIps = data?.suspicious_ips ?? [];
  const failingKeys = data?.top_failing_keys ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium">Validation Attempts</h1>
          <p className="mt-1 text-body text-muted">
            Semua percobaan validasi key yang tercatat: IP mencurigakan, key yang paling sering
            gagal, dan tren per jam. Data disimpan 7 hari terakhir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void load()}
            loading={loading}
            icon={<RefreshCw size={16} strokeWidth={1.5} />}
            aria-label="Muat ulang validation attempts"
            title="Muat ulang validation attempts"
          >
            Muat ulang
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

      {loading && !data ? (
        <SkeletonCards count={4} />
      ) : summary ? (
        <StatGrid>
          <StatCard
            label="Total percobaan"
            value={summary.total}
            hint={
              summary.capped
                ? `Ringkasan dari ${formatNumber(summary.total)} baris terbaru (dibatasi)`
                : `${formatNumber(summary.distinct_ips)} IP unik`
            }
          />
          <StatCard label="Sukses" value={summary.succeeded} tone="active" />
          <StatCard
            label="Gagal"
            value={summary.failed}
            tone="banned"
            hint={`${summary.failure_rate}% dari total`}
          />
          <StatCard
            label="Key unik"
            value={summary.distinct_keys}
            tone="accent"
            hint="key yang muncul di log"
          />
        </StatGrid>
      ) : null}

      {loading && !data ? (
        <SkeletonChart />
      ) : data && data.trend.length > 0 ? (
        <ValidationTrendChart data={data.trend} hourly={data.range.hourly} />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card overflow-hidden">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-body font-medium">IP mencurigakan</h2>
            <p className="text-label text-muted">
              Top IP dengan percobaan gagal terbanyak pada rentang aktif
            </p>
          </header>
          {loading && !data ? (
            <SkeletonRows rows={5} columns={6} />
          ) : suspiciousIps.length === 0 ? (
            <EmptyState message="Tidak ada IP terekam pada rentang ini" />
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[640px] text-body">
                <thead className="bg-surface">
                  <tr className="border-b border-border text-left text-label text-muted">
                    <th scope="col" className="px-3 py-2 font-normal">
                      IP
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      Percobaan
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      Gagal
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      Invalid key
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      Key dicoba
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      Terakhir terlihat
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {suspiciousIps.map((item) => (
                    <tr key={item.ip} className="row-hover h-11">
                      <td className="whitespace-nowrap px-3 py-1.5">
                        <span
                          className={`font-mono text-[13px] ${item.suspect ? "text-banned" : "text-text"}`}
                        >
                          {item.ip}
                        </span>
                        {item.suspect ? (
                          <Badge tone="banned" className="ml-2">
                            mencurigakan
                          </Badge>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                        {formatNumber(item.total)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-banned">
                        {formatNumber(item.failed)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                        {formatNumber(item.invalid_key)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                        {formatNumber(item.distinct_keys)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                        {formatDateTime(item.last_seen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card overflow-hidden">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-body font-medium">Key paling sering gagal</h2>
            <p className="text-label text-muted">
              Top key dengan percobaan gagal terbanyak pada rentang aktif
            </p>
          </header>
          {loading && !data ? (
            <SkeletonRows rows={5} columns={6} />
          ) : failingKeys.length === 0 ? (
            <EmptyState message="Belum ada key yang gagal pada rentang ini" />
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-[640px] text-body">
                <thead className="bg-surface">
                  <tr className="border-b border-border text-left text-label text-muted">
                    <th scope="col" className="px-3 py-2 font-normal">
                      Key
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      Gagal
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      Sukses
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      Alasan gagal
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      IP
                    </th>
                    <th scope="col" className="px-3 py-2 font-normal">
                      Terakhir
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {failingKeys.map((item) => {
                    const breakdown = reasonBreakdown(item.reasons);
                    return (
                      <tr key={item.key_value} className="row-hover h-11">
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <span className="font-mono text-[13px] text-text">{item.key_value}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-banned">
                          {formatNumber(item.failed)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-active">
                          {formatNumber(item.succeeded)}
                        </td>
                        <td
                          className="max-w-[260px] truncate px-3 py-1.5 text-muted"
                          title={breakdown}
                        >
                          {breakdown}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                          {formatNumber(item.distinct_ips)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                          {formatDateTime(item.last_seen)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="card p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
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
          <Field label="Hasil">
            <Select
              ariaLabel="Filter hasil"
              value={filters.result || null}
              placeholder="Semua hasil"
              onChange={(value) => {
                setFilters((previous) => ({ ...previous, result: value }));
                setPage(1);
              }}
              options={RESULT_OPTIONS}
            />
          </Field>
          <Field label="Alasan">
            <Select
              ariaLabel="Filter alasan"
              value={filters.reason || null}
              placeholder="Semua alasan"
              onChange={(value) => {
                setFilters((previous) => ({ ...previous, reason: value }));
                setPage(1);
              }}
              options={REASON_OPTIONS}
            />
          </Field>
          <Field label="Cari IP">
            <div className="relative">
              <Search
                size={16}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                className="field pl-9 font-mono"
                placeholder="203.0.113…"
                value={ipInput}
                onChange={(event) => setIpInput(event.target.value)}
                aria-label="Cari IP"
                spellCheck={false}
              />
            </div>
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
                placeholder="XLVP-…"
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
        {loading && !data ? (
          <SkeletonRows rows={8} columns={6} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState message="Belum ada percobaan validasi pada rentang ini" />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[960px] text-body">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border text-left text-label text-muted">
                  <th scope="col" className="px-3 py-2 font-normal">
                    Tanggal
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    IP
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Key
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    HWID
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Hasil
                  </th>
                  <th scope="col" className="px-3 py-2 font-normal">
                    Alasan
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((item) => (
                  <tr key={item.id} className="row-hover h-11">
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                      {formatDateTime(item.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className="font-mono text-[13px] text-text">{item.ip}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {item.key_value ? (
                        <span className="font-mono text-[13px] text-text">{item.key_value}</span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {item.hardware_id ? (
                        <span
                          className="font-mono text-[13px] text-muted"
                          title={item.hardware_id}
                        >
                          {truncate(item.hardware_id, 24)}
                        </span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {item.success ? (
                        <Badge tone="active">Sukses</Badge>
                      ) : (
                        <Badge tone="banned">Gagal</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                      {item.reason
                        ? (VALIDATION_REASON_LABEL[item.reason] ?? item.reason)
                        : item.success
                          ? "-"
                          : "tanpa alasan"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > 0 ? (
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
