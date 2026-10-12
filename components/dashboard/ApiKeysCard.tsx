"use client";

import { BookOpen, KeySquare, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Form";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, apiDelete, apiGet, apiPost } from "@/lib/api/client";
import { formatDateTime, formatNumber, formatRelativeToNow } from "@/lib/utils/format";

interface ApiKeyItem {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  requests_count: number;
  created_at: string;
  revoked_at: string | null;
  username?: string | null;
}

interface ApiKeysResponse {
  items: ApiKeyItem[];
  max_active: number;
}

export function ApiKeysCard({
  isOwner,
  resellers,
}: {
  isOwner: boolean;
  resellers: { id: string; username: string }[];
}) {
  const toast = useToast();
  const [items, setItems] = useState<ApiKeyItem[]>([]);
  const [maxActive, setMaxActive] = useState(5);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [busy, setBusy] = useState(false);

  const [createdToken, setCreatedToken] = useState<{ token: string; name: string } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiGet<ApiKeysResponse>("/api/api-keys");
      setItems(response.items);
      setMaxActive(response.max_active);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat API key");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (name.trim().length < 3) {
      toast.error("Nama API key minimal 3 karakter");
      return;
    }
    setBusy(true);
    try {
      const response = await apiPost<{ token: string; api_key: ApiKeyItem }>("/api/api-keys", {
        name: name.trim(),
        user_id: targetUser || undefined,
      });
      setCreateOpen(false);
      setName("");
      setTargetUser("");
      setCreatedToken({ token: response.token, name: response.api_key.name });
      await load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Gagal membuat API key");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    setBusy(true);
    try {
      await apiDelete(`/api/api-keys/${revokeTarget.id}`);
      toast.success(`API key "${revokeTarget.name}" dicabut`);
      setRevokeTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Gagal mencabut API key");
    } finally {
      setBusy(false);
    }
  };

  const activeCount = items.filter((item) => item.is_active).length;

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-muted" aria-hidden="true">
            <KeySquare size={16} strokeWidth={1.5} />
          </span>
          <div>
            <h2 className="text-body font-medium">API Key</h2>
            <p className="text-label text-muted">
              Maks {maxActive} key aktif ({formatNumber(activeCount)} dipakai)
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => setCreateOpen(true)}
          icon={<Plus size={14} strokeWidth={1.5} />}
          disabled={activeCount >= maxActive}
        >
          Buat API key
        </Button>
      </header>

      {loading ? (
        <SkeletonRows rows={3} columns={4} />
      ) : items.length === 0 ? (
        <EmptyState message="Belum ada API key. Buat satu untuk integrasi otomatis (cek saldo, generate key, reset HWID)." />
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[760px] text-body">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-left text-label text-muted">
                <th scope="col" className="px-3 py-2 font-normal">
                  Nama
                </th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
                  Token
                </th>
                {isOwner ? (
                  <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
                    Pemilik
                  </th>
                ) : null}
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
                  Terakhir dipakai
                </th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
                  Request
                </th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-normal">
                  Status
                </th>
                <th scope="col" className="w-[90px] px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.id} className="row-hover h-11">
                  <td className="max-w-[220px] truncate px-3 py-1.5" title={item.name}>
                    {item.name}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className="font-mono text-label text-muted">{item.token_prefix}…</span>
                  </td>
                  {isOwner ? (
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                      {item.username ?? "-"}
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                    {item.last_used_at ? formatRelativeToNow(item.last_used_at) : "belum dipakai"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                    {formatNumber(item.requests_count)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {item.is_active ? (
                      <Badge tone="active">aktif</Badge>
                    ) : (
                      <Badge tone="neutral">dicabut</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {item.is_active ? (
                      <Button
                        size="sm"
                        onClick={() => setRevokeTarget(item)}
                        icon={<Trash2 size={14} strokeWidth={1.5} />}
                        aria-label={`Cabut API key ${item.name}`}
                      >
                        Cabut
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="border-t border-border px-4 py-3 text-label text-muted">
        <summary className="flex cursor-pointer items-center gap-1.5 hover:text-text">
          <BookOpen size={14} strokeWidth={1.5} />
          Cara pakai (dokumentasi singkat)
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            Semua request wajib header <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>.
            Endpoint tersedia:{" "}
            <span className="font-mono">
              GET /api/v1/me · GET /api/v1/tools · GET /api/v1/presets · GET|POST /api/v1/keys ·
              GET /api/v1/keys/&#123;id|key&#125; · POST /api/v1/keys/&#123;id|key&#125;/hwid-reset ·
              GET /api/v1/credits
            </span>
            .
          </p>
          <pre className="overflow-x-auto rounded-md border border-border bg-surface p-2 font-mono text-[12px]">
{`curl -H "Authorization: Bearer $XLOOP_API_KEY" \\
  https://panel-kamu.com/api/v1/keys?status=active

curl -X POST https://panel-kamu.com/api/v1/keys \\
  -H "Authorization: Bearer $XLOOP_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"tool_type_id":"…","tool_version_id":"…","duration_preset_id":"…","quantity":1}'`}
          </pre>
          <p>
            Dokumentasi lengkap (termasuk batas rate limit & reset HWID):{" "}
            <span className="font-mono">docs/RESELLER_API.md</span> di repositori panel.
          </p>
        </div>
      </details>

      {/* Buat API key */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Buat API Key"
        description="Token hanya ditampilkan sekali — simpan di tempat aman."
        size="sm"
        busy={busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={busy}>
              Batal
            </Button>
            <Button variant="primary" size="sm" loading={busy} onClick={() => void create()}>
              Buat
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nama" required hint="Untuk mengenali key ini, mis. “Bot Discord”.">
            <Input
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              placeholder="Bot Discord"
            />
          </Field>

          {isOwner ? (
            <Field label="Untuk akun" hint="Kosongkan untuk akun kamu sendiri.">
              <Select
                ariaLabel="Pemilik API key"
                value={targetUser || null}
                placeholder="Saya sendiri"
                onChange={setTargetUser}
                options={[
                  { value: "", label: "Saya sendiri" },
                  ...resellers.map((reseller) => ({
                    value: reseller.id,
                    label: reseller.username,
                  })),
                ]}
              />
            </Field>
          ) : null}
        </div>
      </Modal>

      {/* Token sekali tampil */}
      <Modal
        open={createdToken !== null}
        onClose={() => setCreatedToken(null)}
        title="API key dibuat"
        description="Salin sekarang — token ini tidak bisa dilihat lagi."
        size="md"
        footer={
          <Button variant="primary" size="sm" onClick={() => setCreatedToken(null)}>
            Sudah saya simpan
          </Button>
        }
      >
        {createdToken ? (
          <div className="space-y-3">
            <p className="text-label text-muted">
              Nama: <span className="text-text">{createdToken.name}</span>
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface p-2">
              <code className="min-w-0 flex-1 break-all font-mono text-[12px]">
                {createdToken.token}
              </code>
              <CopyButton value={createdToken.token} label="Copy API token" size={16} />
            </div>
            <p className="text-label text-banned">
              Simpan di tempat aman. Kalau token bocor, hapus key-nya lalu buat yang baru.
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Cabut API key?"
        message={`Key "${revokeTarget?.name ?? ""}" tidak bisa dipakai lagi seketika. Integrasi yang memakainya akan menerima 401.`}
        confirmLabel="Cabut key"
        danger
        loading={busy}
        onConfirm={() => void revoke()}
        onClose={() => setRevokeTarget(null)}
      />
    </section>
  );
}
