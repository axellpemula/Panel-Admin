"use client";

import { Laptop, LogOut, RefreshCw, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, apiDelete, apiGet } from "@/lib/api/client";
import { formatDateTime } from "@/lib/utils/format";
import { parseUserAgent } from "@/lib/utils/user-agent";

interface SessionItem {
  id: string;
  created_at: string | null;
  expires_at: string | null;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
}

interface SessionResponse {
  items: SessionItem[];
  limited: boolean;
  mode: "sqlite" | "supabase";
}

export function SessionsCard() {
  const toast = useToast();
  const [data, setData] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      try {
        const result = await apiGet<SessionResponse>("/api/auth/sessions");
        setData(result);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : "Gagal memuat daftar sesi");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const revokeOthers = async () => {
    setRevoking(true);
    try {
      const result = await apiDelete<{ revoked: number; message: string }>("/api/auth/sessions");
      toast.success(result.message);
      setConfirmOpen(false);
      await load({ silent: true });
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Gagal memutus sesi lain");
    } finally {
      setRevoking(false);
    }
  };

  const others = (data?.items ?? []).filter((item) => !item.current);
  const current = (data?.items ?? []).find((item) => item.current) ?? null;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-muted" aria-hidden="true">
            <Laptop size={16} strokeWidth={1.5} />
          </span>
          <h2 className="text-body font-medium">Sesi Aktif</h2>
          {others.length > 0 ? <Badge tone="active">{others.length} perangkat lain</Badge> : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Muat ulang daftar sesi"
        >
          <RefreshCw size={14} strokeWidth={1.5} className={loading ? "animate-spin" : undefined} />
        </Button>
      </header>

      {loading ? (
        <div className="space-y-2 px-4 py-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : error ? (
        <p className="px-4 py-4 text-label text-danger">{error}</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {current ? <SessionRow item={current} /> : null}
            {others.map((item) => (
              <SessionRow key={item.id} item={item} />
            ))}
            {!current && others.length === 0 ? (
              <li className="px-4 py-4 text-label text-muted">Tidak ada sesi aktif yang terbaca.</li>
            ) : null}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="max-w-md text-label text-muted">
              {data?.limited
                ? "Mode server tidak menampilkan daftar perangkat lengkap, tapi tombol di samping tetap memutus semua sesi lain."
                : "Sesi yang tidak kamu kenali? Putus semuanya, lalu ganti password."}
            </p>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={others.length === 0}
            >
              <LogOut size={14} strokeWidth={1.5} />
              Keluar dari semua perangkat
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Putus semua sesi lain?"
        message="Semua perangkat dan browser lain yang sedang login ke akun ini akan langsung keluar."
        confirmLabel="Putus semua"
        danger
        loading={revoking}
        onConfirm={() => void revokeOthers()}
        onClose={() => setConfirmOpen(false)}
      />
    </section>
  );
}

function SessionRow({ item }: { item: SessionItem }) {
  const device = parseUserAgent(item.user_agent);
  const isMobile = /mobile|android|iphone|ios/i.test(item.user_agent ?? "");
  const Icon = isMobile ? Smartphone : Laptop;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 text-muted" aria-hidden="true">
        <Icon size={16} strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-body">{device.label}</span>
          {item.current ? <Badge tone="accent">Sesi ini</Badge> : null}
        </div>
        <p className="mt-0.5 text-label text-muted">
          {item.ip ? `IP ${item.ip} · ` : ""}
          {item.created_at ? `Masuk ${formatDateTime(item.created_at)}` : "Waktu masuk tidak tersedia"}
        </p>
        {item.expires_at ? (
          <p className="text-label text-muted">Berakhir {formatDateTime(item.expires_at)}</p>
        ) : null}
      </div>
    </li>
  );
}
