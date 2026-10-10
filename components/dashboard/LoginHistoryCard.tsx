"use client";

import { History, Monitor, RefreshCw, Smartphone, Tablet, TerminalSquare } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { apiGet } from "@/lib/api/client";
import { LOGIN_REASON_LABEL, type LoginLogItem } from "@/lib/api/login-log";
import { formatDateTime, formatRelativeToNow } from "@/lib/utils/format";
import { parseUserAgent, type DeviceInfo } from "@/lib/utils/user-agent";

/**
 * Kartu "Riwayat Login": waktu, IP, perangkat, dan hasil (sukses/gagal).
 * Dipakai di Pengaturan (akun sendiri) dan detail reseller (Owner, lewat `userId`).
 */
export function LoginHistoryCard({
  userId,
  limit = 20,
  title = "Riwayat Login",
  description,
}: {
  /** Kosong = akun yang sedang login. */
  userId?: string;
  limit?: number;
  title?: string;
  description?: string;
}) {
  const [items, setItems] = useState<LoginLogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (userId) params.set("user_id", userId);
      const data = await apiGet<{ items: LoginLogItem[] }>(`/api/auth/logins?${params.toString()}`);
      setItems(data.items);
    } catch (err) {
      setError((err as Error).message || "Gagal memuat riwayat login");
    } finally {
      setLoading(false);
    }
  }, [limit, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const failedCount = items?.filter((item) => !item.success).length ?? 0;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-body font-medium">
            <span className="text-muted">
              <History size={16} strokeWidth={1.5} />
            </span>
            {title}
            {items && failedCount > 0 ? <Badge tone="banned">{failedCount} gagal</Badge> : null}
          </h2>
          {description ? <p className="mt-0.5 text-label text-muted">{description}</p> : null}
        </div>
        <Button
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          icon={<RefreshCw size={14} strokeWidth={1.5} className={loading ? "animate-spin" : undefined} />}
          aria-label="Muat ulang riwayat login"
        >
          Muat ulang
        </Button>
      </header>

      {items === null && !error ? (
        <SkeletonRows rows={5} columns={4} />
      ) : error ? (
        <EmptyState
          message={error}
          action={
            <Button size="sm" onClick={() => void load()}>
              Coba lagi
            </Button>
          }
        />
      ) : items && items.length === 0 ? (
        <EmptyState message="Belum ada riwayat login yang tercatat." />
      ) : (
        <>
          {/* Tabel (≥ sm) */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-left text-body">
              <thead>
                <tr className="border-b border-border text-label text-muted">
                  <th className="h-10 px-4 font-medium">Waktu</th>
                  <th className="h-10 px-4 font-medium">Perangkat</th>
                  <th className="h-10 px-4 font-medium">IP</th>
                  <th className="h-10 px-4 font-medium">Hasil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items?.map((item) => {
                  const device = parseUserAgent(item.user_agent);
                  return (
                    <tr key={item.id} className="row-hover h-11">
                      <td className="whitespace-nowrap px-4" title={formatRelativeToNow(item.created_at)}>
                        {formatDateTime(item.created_at)}
                      </td>
                      <td className="px-4">
                        <span className="flex items-center gap-2" title={item.user_agent ?? undefined}>
                          <span className="text-muted">
                            <DeviceIcon kind={device.kind} />
                          </span>
                          <span className="truncate">{device.label}</span>
                        </span>
                      </td>
                      <td className="px-4 font-mono text-[13px] text-muted">{item.ip ?? "-"}</td>
                      <td className="px-4">
                        <ResultBadge item={item} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Kartu (HP) */}
          <ul className="divide-y divide-border sm:hidden">
            {items?.map((item) => {
              const device = parseUserAgent(item.user_agent);
              return (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 text-muted">
                    <DeviceIcon kind={device.kind} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center justify-between gap-2">
                      <span className="truncate text-body">{device.label}</span>
                      <ResultBadge item={item} />
                    </p>
                    <p className="mt-0.5 text-label text-muted">
                      {formatDateTime(item.created_at)} · <span className="font-mono">{item.ip ?? "-"}</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function ResultBadge({ item }: { item: LoginLogItem }) {
  if (item.success) return <Badge tone="active">Berhasil</Badge>;
  const label = item.reason ? (LOGIN_REASON_LABEL[item.reason] ?? item.reason) : "Gagal";
  return (
    <Badge tone="banned">
      <span title={label}>Gagal</span>
      <span className="hidden font-normal opacity-80 lg:inline"> · {label}</span>
    </Badge>
  );
}

function DeviceIcon({ kind }: { kind: DeviceInfo["kind"] }): ReactNode {
  const props = { size: 15, strokeWidth: 1.5 } as const;
  if (kind === "mobile") return <Smartphone {...props} />;
  if (kind === "tablet") return <Tablet {...props} />;
  if (kind === "unknown") return <TerminalSquare {...props} />;
  return <Monitor {...props} />;
}
