"use client";

import { BellRing, Link2, RefreshCw, Send, Unlink, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, Input } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, apiDelete, apiGet, apiPost } from "@/lib/api/client";
import { formatDateTime } from "@/lib/utils/format";

/**
 * Kartu "Telegram" (Pengaturan):
 * - **Semua user**: menautkan akun panel ke chat Telegram (kode sekali pakai
 *   `/start <KODE>`) — dipakai untuk menerima notifikasi pribadi + perintah bot,
 * - **Owner**: menghubungkan bot (token dari @BotFather), memasang webhook, dan
 *   mengirim pesan uji.
 *
 * Token bot disimpan sebagai dokumen rahasia di `app_settings` dan TIDAK PERNAH
 * dikirim ke browser — panel hanya menerima statusnya.
 */

interface TelegramStatus {
  connected: boolean;
  bot_username: string | null;
  webhook_url: string | null;
  notifications_enabled: boolean;
}

interface LinkStatus {
  bot_username: string | null;
  bot_ready: boolean;
  linked: { chat_id: string; username: string | null; linked_at: string } | null;
}

export function TelegramCard({ isOwner }: { isOwner: boolean }) {
  const toast = useToast();

  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [webhookActual, setWebhookActual] = useState<string | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [link, setLink] = useState<LinkStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [tokenInput, setTokenInput] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [linkCode, setLinkCode] = useState<{ code: string; deep_link: string | null; expires_at: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const linkStatus = await apiGet<LinkStatus>("/api/telegram/link");
      setLink(linkStatus);
    } catch {
      // Status tautan tidak kritikal untuk Owner; biarkan kosong.
    }

    if (!isOwner) return;
    try {
      const response = await apiGet<{
        telegram: TelegramStatus;
        webhook_actual: string | null;
        webhook_error: string | null;
      }>("/api/settings/telegram");
      setStatus(response.telegram);
      setWebhookActual(response.webhook_actual);
      setWebhookError(response.webhook_error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat status Telegram");
    }
  }, [isOwner, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const callTelegram = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const response = await apiPost<{
        telegram: TelegramStatus;
        webhook?: { ok: boolean; url: string | null; error?: string | null };
        note?: string;
        outcome?: { sent: boolean; errors?: string[] };
      }>("/api/settings/telegram", { action, ...body });

      setStatus(response.telegram);
      if (response.webhook) {
        setWebhookActual(response.webhook.url);
        if (!response.webhook.ok) setWebhookError(response.webhook.error ?? "gagal");
      }

      if (action === "test") {
        if (response.outcome?.sent) toast.success("Pesan uji terkirim");
        else toast.error(response.note ?? "Pesan uji tidak terkirim");
      } else {
        toast.success(response.note ?? "Berhasil disimpan");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Aksi Telegram gagal");
    } finally {
      setBusy(null);
    }
  };

  const createLinkCode = async () => {
    setBusy("link");
    try {
      const response = await apiPost<{ code: string; deep_link: string | null; expires_at: string }>(
        "/api/telegram/link",
      );
      setLinkCode(response);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Gagal membuat kode tautan");
    } finally {
      setBusy(null);
    }
  };

  const unlink = async () => {
    setBusy("unlink");
    try {
      await apiDelete("/api/telegram/link");
      toast.success("Tautan chat dilepas");
      await load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Gagal melepas tautan");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-muted" aria-hidden="true">
            <BellRing size={16} strokeWidth={1.5} />
          </span>
          <div>
            <h2 className="text-body font-medium">Telegram</h2>
            <p className="text-label text-muted">
              Notifikasi penting (auto-ban, saldo tipis, ringkasan harian) + perintah bot
            </p>
          </div>
        </div>
        {isOwner && status ? (
          status.connected ? (
            <Badge tone="active">
              {status.bot_username ? `@${status.bot_username}` : "bot terhubung"}
            </Badge>
          ) : (
            <Badge tone="neutral">belum dihubungkan</Badge>
          )
        ) : null}
      </header>

      <div className="space-y-4 px-4 py-4">
        {/* ---------- Penautan akun (semua user) ---------- */}
        <div className="rounded-md border border-border bg-surface/60 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Link2 size={15} strokeWidth={1.5} className="text-muted" aria-hidden="true" />
              <span className="text-body font-medium">Tautkan akun kamu</span>
            </div>
            {link?.linked ? (
              <Badge tone="active">
                {link.linked.username ? `@${link.linked.username}` : link.linked.chat_id}
              </Badge>
            ) : (
              <Badge tone="neutral">belum tertaut</Badge>
            )}
          </div>

          <p className="mt-1.5 text-label text-muted">
            {link?.bot_ready
              ? "Kirim kode tautan ke bot supaya notifikasi pribadi bisa masuk ke chat kamu."
              : "Bot panel belum dihubungkan oleh Owner — tautan belum bisa dibuat."}
          </p>

          {link?.linked ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-label text-muted">
                Tertaut {formatDateTime(link.linked.linked_at)}
              </span>
              <Button
                size="sm"
                onClick={() => void unlink()}
                loading={busy === "unlink"}
                icon={<Unlink size={14} strokeWidth={1.5} />}
              >
                Lepas tautan
              </Button>
            </div>
          ) : (
            <div className="mt-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => void createLinkCode()}
                loading={busy === "link"}
                disabled={!link?.bot_ready}
                icon={<Zap size={14} strokeWidth={1.5} />}
              >
                Buat kode tautan
              </Button>
            </div>
          )}
        </div>

        {/* ---------- Konfigurasi bot (Owner) ---------- */}
        {isOwner ? (
          <div className="space-y-3 rounded-md border border-border bg-surface/60 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-body font-medium">Bot panel (Owner)</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void load()}
                icon={<RefreshCw size={14} strokeWidth={1.5} />}
                aria-label="Muat ulang status bot"
              >
                Status
              </Button>
            </div>

            <Field
              label="Bot token"
              hint="Dari @BotFather (/newbot). Disimpan sebagai rahasia — tidak pernah dikirim ke browser."
            >
              <Input
                type="password"
                value={tokenInput}
                placeholder={status?.connected ? "••• (tersimpan)" : "123456789:ABC-DEF…"}
                onChange={(event) => setTokenInput(event.target.value)}
                autoComplete="off"
              />
            </Field>

            <Field
              label="URL publik panel"
              hint="Opsional. Dipakai untuk webhook — kosongkan untuk memakai URL request ini."
            >
              <Input
                value={publicUrl}
                onChange={(event) => setPublicUrl(event.target.value)}
                placeholder="https://panel-kamu.com"
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                loading={busy === "connect"}
                onClick={() =>
                  void callTelegram("connect", {
                    bot_token: tokenInput.trim(),
                    public_url: publicUrl.trim() || undefined,
                  })
                }
                disabled={tokenInput.trim().length < 10}
              >
                Simpan & pasang webhook
              </Button>
              <Button
                size="sm"
                loading={busy === "set_webhook"}
                disabled={!status?.connected}
                onClick={() =>
                  void callTelegram("set_webhook", { public_url: publicUrl.trim() || undefined })
                }
              >
                Pasang ulang webhook
              </Button>
              <Button
                size="sm"
                loading={busy === "remove_webhook"}
                disabled={!status?.connected}
                onClick={() => void callTelegram("remove_webhook")}
              >
                Hapus webhook
              </Button>
              <Button
                size="sm"
                loading={busy === "test"}
                disabled={!status?.connected}
                onClick={() => void callTelegram("test")}
                icon={<Send size={14} strokeWidth={1.5} />}
              >
                Uji kirim
              </Button>
              <Button
                size="sm"
                loading={busy === "disconnect"}
                disabled={!status?.connected}
                onClick={() => void callTelegram("disconnect")}
              >
                Putuskan bot
              </Button>
            </div>

            {status?.webhook_url ? (
              <p className="break-all font-mono text-label text-muted">
                webhook tersimpan: {status.webhook_url}
              </p>
            ) : null}
            {webhookActual && webhookActual !== status?.webhook_url ? (
              <p className="break-all text-label text-expired">
                webhook aktif di Telegram: {webhookActual}
              </p>
            ) : null}
            {webhookError ? (
              <p className="text-label text-banned">
                Pesan error dari Telegram: {webhookError}
              </p>
            ) : null}

            <div className="border-t border-border pt-2">
              <Button
                size="sm"
                variant="ghost"
                loading={busy === "notifications"}
                disabled={!status?.connected}
                onClick={() =>
                  void callTelegram("notifications", { enabled: !status?.notifications_enabled })
                }
              >
                {status?.notifications_enabled
                  ? "Matikan kirim notifikasi ke Telegram"
                  : "Nyalakan kirim notifikasi ke Telegram"}
              </Button>
            </div>

            <p className="text-label text-muted">
              Notifikasi yang dikirim: auto-ban key, login gagal berulang, brute-force validasi,
              saldo reseller tipis, dan ringkasan harian. Jenis & ambangnya diatur di kartu
              “Batas &amp; Sistem”. Perintah bot: /help.
            </p>
          </div>
        ) : null}
      </div>

      {/* Kode tautan */}
      <Modal
        open={linkCode !== null}
        onClose={() => setLinkCode(null)}
        title="Kode tautan Telegram"
        description="Kirim kode ini ke bot panel dari chat Telegram kamu."
        size="sm"
        footer={
          <Button variant="primary" size="sm" onClick={() => setLinkCode(null)}>
            Tutup
          </Button>
        }
      >
        {linkCode ? (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-surface p-3">
              <code className="font-mono text-[18px] tracking-[0.2em]">{linkCode.code}</code>
              <CopyButton value={linkCode.code} label="Copy kode" size={16} />
            </div>
            <p className="text-label text-muted">
              Perintah lengkapnya: <span className="font-mono">/start {linkCode.code}</span>
              {link?.bot_username ? (
                <>
                  {" "}
                  atau buka{" "}
                  <a
                    className="text-accent hover:underline"
                    href={linkCode.deep_link ?? `https://t.me/${link.bot_username}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    @{link.bot_username}
                  </a>
                </>
              ) : null}
              .
            </p>
            <p className="text-label text-muted">
              Kode berlaku sampai {formatDateTime(linkCode.expires_at)} dan hanya bisa dipakai sekali.
            </p>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
