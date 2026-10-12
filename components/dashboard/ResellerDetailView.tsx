"use client";

import { ArrowLeft, ExternalLink, KeyRound, SlidersHorizontal, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CreditAdjustModal } from "@/components/dashboard/CreditAdjustModal";
import { KeyChartDynamic } from "@/components/dashboard/KeyChartDynamic";
import { LoginHistoryCard } from "@/components/dashboard/LoginHistoryCard";
import { StatCard, StatGrid } from "@/components/dashboard/StatCard";
import { ActiveBadge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { SkeletonCards, SkeletonChart, SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { apiGet, apiPut, buildQuery } from "@/lib/api/client";
import type { ActivityItem, ChartPoint, ResellerStats, TopReseller } from "@/lib/api/stats";
import type { KeyListItem } from "@/lib/types/database";
import {
  CREDIT_ACTION_LABEL,
  formatDateTime,
  formatNumber,
  formatRelativeToNow,
  LIFETIME_LABEL,
} from "@/lib/utils/format";

interface ResellerDetail {
  reseller: TopReseller;
  created_at: string;
  history: ActivityItem[];
  totals: ResellerStats["totals"];
  chart: ChartPoint[];
}

const KEY_PREVIEW = 10;

/**
 * Detail reseller penuh (Owner): ringkasan + chart 7 hari + key terbaru +
 * riwayat credit lengkap + riwayat login. Aksi lain (edit, password, hapus)
 * tetap di daftar /resellers supaya satu sumber kebenaran.
 */
export function ResellerDetailView({ id }: { id: string }) {
  const toast = useToast();
  const [detail, setDetail] = useState<ResellerDetail | null>(null);
  const [keys, setKeys] = useState<{ items: KeyListItem[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState("10");
  const [topupNote, setTopupNote] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [detailResponse, keysResponse] = await Promise.all([
        apiGet<ResellerDetail>(`/api/resellers/${id}?history_limit=100`),
        apiGet<{ items: KeyListItem[]; total: number }>(
          `/api/keys${buildQuery({ created_by: id, per_page: KEY_PREVIEW, page: 1 })}`,
        ),
      ]);
      setDetail(detailResponse);
      setKeys({ items: keysResponse.items, total: keysResponse.total });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat detail reseller");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const topup = async () => {
    if (!detail) return;
    const amount = Number.parseInt(topupAmount, 10);
    if (!Number.isFinite(amount) || amount < 1) {
      toast.error("Jumlah credit minimal 1");
      return;
    }
    setBusy(true);
    try {
      await apiPut(`/api/resellers/${id}`, { action: "topup", amount, note: topupNote.trim() || undefined });
      toast.success(`Topup ${formatNumber(amount)} credit ke ${detail.reseller.username}`);
      setTopupOpen(false);
      setTopupNote("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal topup credit");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <BackLink />
        <section className="card">
          <EmptyState
            message={error}
            action={
              <Button size="sm" onClick={() => void load()}>
                Coba lagi
              </Button>
            }
          />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {detail ? (
            <>
              <h1 className="flex flex-wrap items-center gap-2 text-title font-medium">
                {detail.reseller.username}
                <ActiveBadge active={detail.reseller.is_active} />
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-body text-muted">
                <span>{detail.reseller.email}</span>
                <span aria-hidden="true">·</span>
                <span>Terdaftar {formatDateTime(detail.created_at)}</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-mono text-label">
                  {detail.reseller.id.slice(0, 8)}…
                  <CopyButton value={detail.reseller.id} label="Copy ID reseller" size={13} />
                </span>
              </p>
            </>
          ) : (
            <>
              <h1 className="text-title font-medium">Detail Reseller</h1>
              <p className="mt-1 text-body text-muted">Memuat…</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!detail}
            onClick={() => {
              setTopupAmount("10");
              setTopupOpen(true);
            }}
            icon={<Wallet size={14} strokeWidth={1.5} />}
          >
            Topup Credit
          </Button>
          <Button
            size="sm"
            disabled={!detail}
            onClick={() => setAdjustOpen(true)}
            icon={<SlidersHorizontal size={14} strokeWidth={1.5} />}
          >
            Sesuaikan
          </Button>
          <Link href={`/keys?created_by=${id}`} className="inline-flex">
            <Button size="sm" icon={<KeyRound size={14} strokeWidth={1.5} />}>
              Semua key
            </Button>
          </Link>
        </div>
      </header>

      {detail ? (
        <StatGrid>
          <StatCard label="Sisa credit" value={detail.totals.credit} tone="accent" />
          <StatCard
            label="Total key"
            value={detail.totals.all}
            hint={`${formatNumber(detail.totals.created_week)} dibuat 7 hari terakhir`}
          />
          <StatCard label="Key aktif" value={detail.totals.active} tone="active" />
          <StatCard
            label="Expired / Banned"
            value={`${formatNumber(detail.totals.expired)} / ${formatNumber(detail.totals.banned)}`}
            tone="expired"
          />
        </StatGrid>
      ) : (
        <SkeletonCards />
      )}

      {detail ? <KeyChartDynamic data={detail.chart} title="Key dibuat reseller ini" /> : <SkeletonChart />}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Key terbaru */}
        <section className="card overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-body font-medium">
              Key terbaru
              {keys ? <span className="ml-2 text-label text-muted">{formatNumber(keys.total)} total</span> : null}
            </h2>
            <Link
              href={`/keys?created_by=${id}`}
              className="inline-flex items-center gap-1 text-label text-muted transition-colors duration-150 hover:text-text"
            >
              Buka di Key List
              <ExternalLink size={13} strokeWidth={1.5} />
            </Link>
          </header>
          {!keys ? (
            <SkeletonRows rows={5} columns={4} />
          ) : keys.items.length === 0 ? (
            <EmptyState message="Reseller ini belum membuat key." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-body">
                <thead>
                  <tr className="border-b border-border text-label text-muted">
                    <th className="px-4 py-2 font-normal">Key</th>
                    <th className="px-4 py-2 font-normal">Tool</th>
                    <th className="px-4 py-2 font-normal">Status</th>
                    <th className="px-4 py-2 font-normal">Expired</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {keys.items.map((key) => (
                    <tr key={key.id} className="row-hover h-11">
                      <td className="whitespace-nowrap px-4">
                        <span className="flex items-center gap-1">
                          <Link
                            href={`/keys?q=${encodeURIComponent(key.key_value)}`}
                            className="font-mono text-[13px] tracking-tight transition-colors duration-150 hover:text-accent"
                          >
                            {key.key_value}
                          </Link>
                          <CopyButton value={key.key_value} label="Copy key" size={13} />
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 text-muted">
                        {key.tool_name} <span className="text-label">· {key.version_name}</span>
                      </td>
                      <td className="whitespace-nowrap px-4">
                        <StatusBadge status={key.status} />
                      </td>
                      <td
                        className="whitespace-nowrap px-4 text-muted"
                        title={key.expired_at ? formatRelativeToNow(key.expired_at) : undefined}
                      >
                        {key.expired_at ? formatDateTime(key.expired_at) : LIFETIME_LABEL}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Riwayat credit */}
        <section className="card overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-body font-medium">
              Riwayat credit
              {detail ? (
                <span className="ml-2 text-label text-muted">{formatNumber(detail.history.length)} transaksi terakhir</span>
              ) : null}
            </h2>
            <Link
              href="/credits"
              className="inline-flex items-center gap-1 text-label text-muted transition-colors duration-150 hover:text-text"
            >
              Credit Log
              <ExternalLink size={13} strokeWidth={1.5} />
            </Link>
          </header>
          {!detail ? (
            <SkeletonRows rows={5} columns={3} />
          ) : detail.history.length === 0 ? (
            <EmptyState message="Belum ada transaksi credit." />
          ) : (
            <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
              {detail.history.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-body">{CREDIT_ACTION_LABEL[item.action] ?? item.action}</p>
                    <p className="truncate text-label text-muted">{item.note ?? "-"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-body tabular-nums ${item.amount > 0 ? "text-active" : item.amount < 0 ? "text-text" : "text-muted"}`}>
                      {item.amount > 0 ? "+" : ""}
                      {formatNumber(item.amount)}
                    </p>
                    <p className="text-label text-muted tabular-nums">
                      sisa {formatNumber(item.balance_after)} · {formatDateTime(item.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <LoginHistoryCard
        userId={id}
        title="Riwayat login reseller"
        description="20 percobaan login terakhir ke akun reseller ini."
      />

      {/* Penyesuaian credit (tambah / kurang + alasan wajib) */}
      <CreditAdjustModal
        target={
          adjustOpen && detail
            ? {
                id,
                username: detail.reseller.username,
                credit: detail.totals.credit,
              }
            : null
        }
        onClose={() => setAdjustOpen(false)}
        onDone={() => {
          void load();
        }}
      />

      {/* Topup */}
      <Modal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        title="Topup Credit"
        description={detail ? `Untuk ${detail.reseller.username} · sisa ${formatNumber(detail.reseller.credit)}` : undefined}
        size="sm"
        busy={busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setTopupOpen(false)} disabled={busy}>
              Batal
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={topup}>
              Tambah Credit
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Jumlah credit" required>
            <Input
              type="number"
              min={1}
              value={topupAmount}
              onChange={(event) => setTopupAmount(event.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Catatan" hint="Opsional — tampil di Credit Log.">
            <Input value={topupNote} onChange={(event) => setTopupNote(event.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/resellers"
      className="inline-flex items-center gap-1.5 text-label text-muted transition-colors duration-150 hover:text-text"
    >
      <ArrowLeft size={14} strokeWidth={1.5} />
      Kembali ke daftar reseller
    </Link>
  );
}
