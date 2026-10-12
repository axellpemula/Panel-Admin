"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Toggle } from "@/components/ui/Form";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ApiClientError, apiGet, apiPut } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";

/**
 * Kartu "Batas & Sistem" (Owner) — form konfigurasi runtime.
 *
 * Nilai-nilai ini menggantikan konstanta yang dulu dipaku di `lib/constants.ts`:
 * rate limit validasi, kuota reset HWID, batas key/device, retensi log, ambang
 * analitik, API publik, dan notifikasi. Default tetap dari constants; kalau field
 * dibiarkan kosong pada penyimpanan, yang tersimpan adalah nilai saat ini.
 *
 * Semua nilai dijepit di server (lihat SETTINGS_BOUNDS) — form hanya memandu,
 * bukan satu-satunya pengaman.
 */

type Section = "validate" | "hwid" | "keys" | "retention" | "analytics" | "api" | "notify";
type EventKey = "autoBan" | "loginBurst" | "validationBurst" | "lowCredit" | "digest" | "security";

interface RuntimeShape {
  validate: Record<string, number>;
  hwid: Record<string, number>;
  keys: Record<string, number>;
  retention: Record<string, number>;
  analytics: Record<string, number>;
  api: { enabled: boolean; rateLimitPerMinute: number };
  notify: {
    enabled: boolean;
    loginBurstFailures: number;
    lowCreditThreshold: number;
    dedupeMinutes: number;
    notifyReseller: boolean;
    events: Record<EventKey, boolean>;
  };
}

interface SettingsResponse {
  runtime: RuntimeShape;
  defaults: RuntimeShape;
  bounds: Record<string, [number, number]>;
  telegram: {
    connected: boolean;
    bot_username: string | null;
    webhook_url: string | null;
    notifications_enabled: boolean;
  };
}

interface NumberField {
  section: Section;
  key: string;
  label: string;
  hint: string;
  /** Satuan yang ditampilkan di belakang input (mis. "menit"). */
  suffix?: string;
  /** Pengali tampilan → nilai tersimpan (mis. TTL ditampilkan dalam menit). */
  scale?: number;
}

const GROUPS: Array<{ id: string; title: string; description: string; fields: NumberField[] }> = [
  {
    id: "validate",
    title: "Validasi & proteksi",
    description: "Rate limit endpoint /api/validate, proteksi brute-force, auto-ban, dan masa berlaku token lisensi.",
    fields: [
      { section: "validate", key: "perIpPerMinute", label: "Rate limit per IP", hint: "Permintaan validasi per menit dari satu IP.", suffix: "/menit" },
      { section: "validate", key: "perKeyPerMinute", label: "Rate limit per key", hint: "Permintaan validasi per menit untuk satu license key.", suffix: "/menit" },
      { section: "validate", key: "bruteForceFailures", label: "Ambang brute-force", hint: "Jumlah kegagalan `invalid_key` sebelum IP disamarkan.", suffix: "kegagalan" },
      { section: "validate", key: "bruteForceWindowMinutes", label: "Window brute-force", hint: "Rentang waktu penghitungan kegagalan.", suffix: "menit" },
      { section: "validate", key: "autoBanDistinctHwids", label: "Auto-ban: jumlah HWID", hint: "Banyaknya HWID berbeda yang memakai satu key sebelum diblokir.", suffix: "HWID" },
      { section: "validate", key: "autoBanWindowMinutes", label: "Auto-ban: window", hint: "Rentang waktu penghitungan HWID untuk auto-ban.", suffix: "menit" },
      { section: "validate", key: "tokenTtlSeconds", label: "Masa berlaku token", hint: "Umur token validasi (nilai di response `token_expires_at`).", suffix: "menit", scale: 60 },
    ],
  },
  {
    id: "hwid",
    title: "Reset HWID",
    description: "Kuota reset device untuk reseller (Owner selalu bebas kuota).",
    fields: [
      { section: "hwid", key: "resetLimit", label: "Kuota reset", hint: "Maksimal reset per key dalam satu window.", suffix: "×" },
      { section: "hwid", key: "resetWindowHours", label: "Window cooldown", hint: "Panjang window kuota reset.", suffix: "jam" },
    ],
  },
  {
    id: "keys",
    title: "Generate & device",
    description: "Batas input saat membuat key baru dan saat mengubah jumlah device.",
    fields: [
      { section: "keys", key: "maxDeviceMin", label: "Min device", hint: "Batas bawah jumlah device per key.", suffix: "device" },
      { section: "keys", key: "maxDeviceMax", label: "Max device", hint: "Batas atas jumlah device per key.", suffix: "device" },
      { section: "keys", key: "quantityOwnerMax", label: "Maks quantity (Owner)", hint: "Jumlah key maksimal sekali generate untuk Owner.", suffix: "key" },
      { section: "keys", key: "quantityResellerMax", label: "Maks quantity (reseller)", hint: "Jumlah key maksimal sekali generate untuk reseller.", suffix: "key" },
    ],
  },
  {
    id: "retention",
    title: "Retensi log",
    description: "Umur data sebelum dibersihkan otomatis oleh cron harian (/api/cron/cleanup).",
    fields: [
      { section: "retention", key: "attemptsDays", label: "Riwayat validasi", hint: "Log percobaan validasi (halaman Validation Attempts).", suffix: "hari" },
      { section: "retention", key: "apiLogsDays", label: "Log API publik", hint: "Pemakaian API key reseller (/api/v1).", suffix: "hari" },
      { section: "retention", key: "notificationDays", label: "Riwayat notifikasi", hint: "Catatan notifikasi Telegram/webhook yang terkirim.", suffix: "hari" },
    ],
  },
  {
    id: "analytics",
    title: "Analitik anti-abuse",
    description: "Ambang deteksi di halaman Validation Attempts (HWID dipakai banyak key, key dari banyak IP).",
    fields: [
      { section: "analytics", key: "suspectFailedMin", label: "IP mencurigakan", hint: "Jumlah kegagalan minimal agar satu IP ditandai.", suffix: "gagal" },
      { section: "analytics", key: "sharedHwidKeysMin", label: "HWID dipakai berapa key", hint: "Satu HWID dipakai ≥ N key berbeda → indikasi jual-ulang HWID.", suffix: "key" },
      { section: "analytics", key: "multiIpKeysMin", label: "Key dari berapa IP", hint: "Satu key dipakai dari ≥ N IP → indikasi key dibagi-bagikan.", suffix: "IP" },
    ],
  },
  {
    id: "api",
    title: "API publik (/api/v1)",
    description: "Akses mesin untuk reseller (generate key, cek saldo) memakai API key dari kartu API Key.",
    fields: [
      { section: "api", key: "rateLimitPerMinute", label: "Rate limit API key", hint: "Permintaan per menit untuk satu API key.", suffix: "/menit" },
    ],
  },
  {
    id: "notify",
    title: "Notifikasi",
    description: "Ambang & anti-spam notifikasi Telegram/webhook (bot diatur di kartu Telegram).",
    fields: [
      { section: "notify", key: "loginBurstFailures", label: "Login gagal berulang", hint: "Jumlah kegagalan login satu akun dalam 15 menit sebelum Owner diberi tahu.", suffix: "gagal" },
      { section: "notify", key: "lowCreditThreshold", label: "Ambang saldo tipis", hint: "Kirim peringatan saat saldo reseller turun melewati angka ini.", suffix: "credit" },
      { section: "notify", key: "dedupeMinutes", label: "Anti-spam", hint: "Jeda minimal sebelum notifikasi sejenis dikirim lagi.", suffix: "menit" },
    ],
  },
];

const NOTIFY_EVENTS: Array<{ key: EventKey; label: string }> = [
  { key: "autoBan", label: "Key diblokir otomatis" },
  { key: "loginBurst", label: "Login gagal berulang" },
  { key: "validationBurst", label: "Brute-force validasi" },
  { key: "lowCredit", label: "Saldo reseller tipis" },
  { key: "digest", label: "Ringkasan harian" },
  { key: "security", label: "Kejadian keamanan akun" },
];

export function SystemSettingsCard() {
  const toast = useToast();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<RuntimeShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiGet<SettingsResponse>("/api/settings");
      setData(result);
      setDraft(result.runtime);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal memuat pengaturan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const numberValue = (section: Section, key: string, scale = 1): number => {
    if (!draft) return 0;
    const raw = (draft[section] as Record<string, unknown>)[key];
    return Math.round((typeof raw === "number" ? raw : 0) / scale);
  };

  const setNumber = (section: Section, key: string, value: number, scale = 1) => {
    setDraft((previous) =>
      previous
        ? {
            ...previous,
            [section]: { ...(previous[section] as Record<string, unknown>), [key]: value * scale },
          }
        : previous,
    );
  };

  const boundsFor = (key: string, scale = 1): [number, number] => {
    const bounds = data?.bounds[key] ?? [0, 100_000];
    return [Math.ceil(bounds[0] / scale), Math.floor(bounds[1] / scale)];
  };

  const defaultFor = (section: Section, key: string, scale = 1): number => {
    if (!data) return 0;
    const raw = (data.defaults[section] as Record<string, unknown>)[key];
    return Math.round((typeof raw === "number" ? raw : 0) / scale);
  };

  /** Patch hanya berisi field yang benar-benar berubah (server merge sisanya). */
  const patch = useMemo(() => {
    if (!data || !draft) return {};
    const out: Record<string, Record<string, unknown>> = {};

    const compareSection = (section: Section, keys: string[]) => {
      const currentValues = data.runtime[section] as Record<string, unknown>;
      const draftValues = draft[section] as Record<string, unknown>;
      for (const key of keys) {
        if (currentValues[key] !== draftValues[key]) {
          out[section] = { ...(out[section] ?? {}), [key]: draftValues[key] };
        }
      }
    };

    for (const group of GROUPS) {
      compareSection(
        group.id as Section,
        group.fields.map((field) => field.key),
      );
    }
    compareSection("api", ["enabled"]);
    compareSection("notify", ["enabled", "notifyReseller"]);

    const events: Record<string, boolean> = {};
    for (const event of NOTIFY_EVENTS) {
      if (data.runtime.notify.events[event.key] !== draft.notify.events[event.key]) {
        events[event.key] = draft.notify.events[event.key];
      }
    }
    if (Object.keys(events).length > 0) {
      out.notify = { ...(out.notify ?? {}), events };
    }

    return out;
  }, [data, draft]);

  const changedCount = Object.values(patch).reduce(
    (total, values) => total + Object.keys(values).length,
    0,
  );

  const save = async () => {
    if (!draft || changedCount === 0) return;
    setSaving(true);
    try {
      const result = await apiPut<{ runtime: RuntimeShape; changed: string[] }>(
        "/api/settings",
        patch,
      );
      setData((previous) => (previous ? { ...previous, runtime: result.runtime } : previous));
      setDraft(result.runtime);
      toast.success(
        result.changed.length > 0
          ? `${result.changed.length} pengaturan disimpan`
          : "Pengaturan disimpan",
      );
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "Gagal menyimpan pengaturan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-muted" aria-hidden="true">
            <SlidersHorizontal size={16} strokeWidth={1.5} />
          </span>
          <div>
            <h2 className="text-body font-medium">Batas &amp; Sistem</h2>
            <p className="text-label text-muted">
              Hanya Owner · berlaku langsung tanpa deploy ulang
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading || saving}>
          <RotateCcw size={14} strokeWidth={1.5} />
          Muat ulang
        </Button>
      </header>

      {loading ? (
        <div className="space-y-3 px-4 py-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error || !draft || !data ? (
        <p className="px-4 py-4 text-label text-danger">
          {error ?? "Pengaturan tidak tersedia"}
        </p>
      ) : (
        <>
          <div className="divide-y divide-border">
            {GROUPS.map((group) => (
              <div key={group.id} className="px-4 py-4">
                <h3 className="text-body font-medium">{group.title}</h3>
                <p className="mt-0.5 text-label text-muted">{group.description}</p>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.fields.map((field) => {
                    const scale = field.scale ?? 1;
                    const [min, max] = boundsFor(field.key, scale);
                    const value = numberValue(field.section, field.key, scale);
                    const fallback = defaultFor(field.section, field.key, scale);
                    const isChanged = value !== fallback;

                    return (
                      <Field
                        key={field.key}
                        label={field.label}
                        hint={field.hint}
                        className="min-w-0"
                      >
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={min}
                            max={max}
                            value={Number.isFinite(value) ? value : ""}
                            onChange={(event) => {
                              const parsed = Number.parseInt(event.target.value, 10);
                              setNumber(
                                field.section,
                                field.key,
                                Number.isFinite(parsed) ? parsed : 0,
                                scale,
                              );
                            }}
                            className="tabular-nums"
                          />
                          {field.suffix ? (
                            <span className="shrink-0 text-label text-muted">{field.suffix}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-2 text-label text-muted">
                          <span>
                            {min}–{max}
                          </span>
                          {isChanged ? (
                            <button
                              type="button"
                              onClick={() =>
                                setNumber(field.section, field.key, fallback, scale)
                              }
                              className="text-muted underline decoration-dotted hover:text-text"
                            >
                              default {fallback}
                            </button>
                          ) : (
                            <span className={cn("text-muted")}>default</span>
                          )}
                        </div>
                      </Field>
                    );
                  })}
                </div>

                {group.id === "api" ? (
                  <div className="mt-3 rounded-md border border-border bg-surface/60 px-3 py-2.5">
                    <Toggle
                      checked={draft.api.enabled}
                      onChange={(value) =>
                        setDraft({ ...draft, api: { ...draft.api, enabled: value } })
                      }
                      label="Aktifkan API publik /api/v1"
                    />
                    <p className="mt-1 text-label text-muted">
                      Kalau dimatikan, semua request dengan API key ditolak 403 — panel tetap
                      berjalan normal.
                    </p>
                  </div>
                ) : null}

                {group.id === "notify" ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-md border border-border bg-surface/60 px-3 py-2.5">
                      <Toggle
                        checked={draft.notify.enabled}
                        onChange={(value) =>
                          setDraft({ ...draft, notify: { ...draft.notify, enabled: value } })
                        }
                        label="Kirim notifikasi"
                      />
                      <p className="mt-1 text-label text-muted">
                        Notifikasi dikirim ke Telegram (bot yang ditautkan) dan/atau webhook
                        `XLOOP_NOTIFY_WEBHOOK_URL` kalau diisi.
                      </p>
                    </div>

                    <div className="rounded-md border border-border bg-surface/60 px-3 py-2.5">
                      <Toggle
                        checked={draft.notify.notifyReseller}
                        onChange={(value) =>
                          setDraft({ ...draft, notify: { ...draft.notify, notifyReseller: value } })
                        }
                        label="Kabari reseller juga"
                      />
                      <p className="mt-1 text-label text-muted">
                        Kalau aktif, reseller yang terdampak (mis. saldo tipis) juga menerima pesan —
                        asalkan chat Telegram-nya sudah ditautkan.
                      </p>
                    </div>

                    <div className="rounded-md border border-border bg-surface/60 px-3 py-2.5">
                      <p className="text-label text-muted">Jenis notifikasi</p>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {NOTIFY_EVENTS.map((event) => (
                          <Toggle
                            key={event.key}
                            checked={draft.notify.events[event.key]}
                            onChange={(value) =>
                              setDraft({
                                ...draft,
                                notify: {
                                  ...draft.notify,
                                  events: { ...draft.notify.events, [event.key]: value },
                                },
                              })
                            }
                            label={event.label}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-label text-muted">
              {changedCount > 0
                ? `${changedCount} perubahan belum disimpan`
                : "Semua nilai masih sama dengan yang berlaku."}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft(data.runtime)}
                disabled={changedCount === 0 || saving}
              >
                Batalkan
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void save()}
                loading={saving}
                disabled={changedCount === 0}
              >
                Simpan perubahan
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
