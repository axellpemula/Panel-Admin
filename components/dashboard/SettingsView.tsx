"use client";

import { Check, Globe, Palette, Rows3, RotateCcw, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { LoginHistoryCard } from "@/components/dashboard/LoginHistoryCard";
import { ActiveBadge, Badge, RoleBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, Input } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import {
  ACCENT_PRESETS,
  BASE_PALETTES,
  DEFAULT_THEME,
  applyThemeToDocument,
  isDefaultTheme,
  normalizeHex,
  serializeTheme,
  THEME_COOKIE,
  type ThemePreference,
} from "@/lib/theme";
import {
  applyDensityToDocument,
  DENSITY_COOKIE,
  DENSITY_OPTIONS,
  type Density,
} from "@/lib/density";
import { cn } from "@/lib/utils/cn";
import { writeCookie } from "@/lib/utils/cookie";
import { formatDate, formatNumber } from "@/lib/utils/format";

export interface AccountInfo {
  id: string;
  username: string;
  email: string;
  role: "owner" | "reseller";
  credit: number;
  createdAt: string;
}

export interface AppInfo {
  name: string;
  version: string;
  nextVersion: string;
  nodeVersion: string;
  dbMode: "supabase" | "sqlite";
  sqlitePath: string | null;
  signingKeyReady: boolean;
  tokenTtlSeconds: number;
  timezone: string;
  keyFormat: string;
  limits: {
    maxDeviceMin: number;
    maxDeviceMax: number;
    quantityOwnerMax: number;
    quantityResellerMax: number;
    hwidResetLimit: number;
    hwidResetWindowHours: number;
    attemptsRetentionDays: number;
  };
}

/**
 * Halaman Pengaturan: info akun, info web, dan tema warna.
 *
 * Tema diterapkan LANGSUNG ke dokumen saat dipilih (pratinjau instan) dan
 * sekaligus disimpan ke cookie — jadi tidak ada tombol "Simpan" terpisah;
 * reload maupun pindah halaman tetap memakai warna yang sama.
 */
export function SettingsView({
  account,
  appInfo,
  initialTheme,
  initialDensity,
}: {
  account: AccountInfo;
  appInfo: AppInfo;
  initialTheme: ThemePreference;
  initialDensity: Density;
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title font-medium">Pengaturan</h1>
        <p className="mt-1 text-body text-muted">
          Info akun yang sedang login, riwayat login, info web panel, dan tampilan.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AccountCard account={account} />
        <WebInfoCard appInfo={appInfo} isOwner={account.role === "owner"} />
      </div>

      <LoginHistoryCard description="20 percobaan login terakhir ke akun ini — waktu, perangkat, dan alamat IP. Kalau ada yang tidak kamu kenali, segera ganti password." />

      <DensityCard initialDensity={initialDensity} />

      <ThemeCard initialTheme={initialTheme} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Info akun                                                           */
/* ------------------------------------------------------------------ */

function AccountCard({ account }: { account: AccountInfo }) {
  const isReseller = account.role === "reseller";
  const initial = account.username.trim().charAt(0).toUpperCase() || "?";

  return (
    <section className="card overflow-hidden">
      <CardHeader icon={<UserRound size={16} strokeWidth={1.5} />} title="Info Akun" />

      <div className="flex items-center gap-3 border-b border-border px-4 py-4">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-[18px] font-medium text-accent"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium">{account.username}</p>
          <p className="truncate text-label text-muted">{account.email}</p>
        </div>
        <RoleBadge role={account.role} />
      </div>

      <dl className="divide-y divide-border">
        <InfoRow label="Nama pengguna" value={account.username} />
        <InfoRow label="Email" value={account.email} />
        <InfoRow label="Role" value={account.role === "owner" ? "Owner" : "Reseller"} />
        {isReseller ? (
          <InfoRow
            label="Sisa credit"
            value={
              <span className="flex items-center gap-2">
                <span className="font-medium tabular-nums text-accent">
                  {formatNumber(account.credit)} credit
                </span>
                <Link href="/credits" className="text-label text-muted hover:text-text hover:underline">
                  Lihat riwayat
                </Link>
              </span>
            }
          />
        ) : null}
        <InfoRow label="Terdaftar sejak" value={formatDate(account.createdAt)} />
        <InfoRow
          label="ID akun"
          value={
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate font-mono text-label text-muted" title={account.id}>
                {account.id}
              </span>
              <CopyButton value={account.id} label="Copy ID akun" size={14} />
            </span>
          }
        />
      </dl>

      <p className="border-t border-border px-4 py-3 text-label text-muted">
        {isReseller
          ? "Ingin ganti password atau data akun? Hubungi Owner."
          : "Password Owner diganti lewat dashboard database."}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Info web                                                            */
/* ------------------------------------------------------------------ */

function WebInfoCard({ appInfo, isOwner }: { appInfo: AppInfo; isOwner: boolean }) {
  const { limits } = appInfo;
  const ttlMinutes = Math.round(appInfo.tokenTtlSeconds / 60);

  return (
    <section className="card overflow-hidden">
      <CardHeader icon={<Globe size={16} strokeWidth={1.5} />} title="Info Web" />

      <dl className="divide-y divide-border">
        <InfoRow
          label="Aplikasi"
          value={
            <span className="flex items-center gap-2">
              {appInfo.name}
              <Badge tone="neutral">v{appInfo.version}</Badge>
            </span>
          }
        />
        <InfoRow
          label="Mode database"
          value={
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={appInfo.dbMode === "supabase" ? "active" : "accent"}>
                {appInfo.dbMode === "supabase" ? "Supabase" : "SQLite lokal"}
              </Badge>
              {isOwner && appInfo.sqlitePath ? (
                <span className="truncate font-mono text-label text-muted" title={appInfo.sqlitePath}>
                  {appInfo.sqlitePath}
                </span>
              ) : null}
            </span>
          }
        />
        {isOwner ? (
          <>
            <InfoRow
              label="Signing key lisensi"
              value={
                <ActiveBadge
                  active={appInfo.signingKeyReady}
                  labelOn="Terpasang (Ed25519)"
                  labelOff="Belum diisi"
                />
              }
            />
            <InfoRow label="Masa berlaku token validasi" value={`${ttlMinutes} menit`} />
            <InfoRow
              label="Runtime"
              value={`Next.js ${appInfo.nextVersion} · Node ${appInfo.nodeVersion}`}
            />
          </>
        ) : null}
        <InfoRow label="Zona waktu" value={appInfo.timezone} />
        <InfoRow label="Format key" value={<span className="font-mono">{appInfo.keyFormat}</span>} />
        <InfoRow
          label="Batas per key"
          value={`${limits.maxDeviceMin}–${limits.maxDeviceMax} device · maks ${
            isOwner ? limits.quantityOwnerMax : limits.quantityResellerMax
          } key per generate`}
        />
        <InfoRow
          label="Reset HWID"
          value={
            isOwner
              ? `Owner tanpa batas · Reseller ${limits.hwidResetLimit}× per ${limits.hwidResetWindowHours} jam per key`
              : `Maks ${limits.hwidResetLimit}× per ${limits.hwidResetWindowHours} jam per key`
          }
        />
        {isOwner ? (
          <InfoRow
            label="Retensi log validasi"
            value={`${limits.attemptsRetentionDays} hari`}
          />
        ) : null}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Kepadatan tabel                                                     */
/* ------------------------------------------------------------------ */

function DensityCard({ initialDensity }: { initialDensity: Density }) {
  const toast = useToast();
  const [density, setDensity] = useState<Density>(initialDensity);

  const pick = (next: Density, label: string) => {
    setDensity(next);
    applyDensityToDocument(next);
    writeCookie(DENSITY_COOKIE.name, next, DENSITY_COOKIE.maxAgeSeconds);
    toast.success(`Kepadatan tabel: ${label}`);
  };

  return (
    <section className="card overflow-hidden">
      <CardHeader icon={<Rows3 size={16} strokeWidth={1.5} />} title="Kepadatan Tabel" />
      <div className="space-y-3 px-4 py-4">
        <p className="text-label text-muted">
          Berlaku untuk semua tabel (Key List, Reseller, Credit, Log).
        </p>
        <div role="radiogroup" aria-label="Kepadatan tabel" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DENSITY_OPTIONS.map((option) => {
            const selected = option.id === density;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => pick(option.id, option.label)}
                className={cn(
                  "flex items-start gap-3 rounded-card border p-3 text-left transition-colors duration-150 ease-out",
                  selected ? "border-accent/60 bg-accent/10" : "border-border bg-surface hover:bg-surface-raised",
                )}
              >
                <DensityPreview compact={option.id === "compact"} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-body text-text">
                    {option.label}
                    {selected ? <Check size={14} strokeWidth={2} className="text-accent" /> : null}
                  </span>
                  <span className="block text-label text-muted">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Miniatur baris tabel: rapat vs longgar. */
function DensityPreview({ compact }: { compact: boolean }) {
  const rows = compact ? 5 : 3;
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-16 shrink-0 flex-col justify-center rounded-control border border-border bg-bg px-1.5"
      style={{ gap: compact ? 3 : 7 }}
    >
      {Array.from({ length: rows }).map((_, index) => (
        <span key={index} className="h-1 w-full rounded-sm bg-muted/50" />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Tema                                                                */
/* ------------------------------------------------------------------ */

function ThemeCard({ initialTheme }: { initialTheme: ThemePreference }) {
  const toast = useToast();
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [customHex, setCustomHex] = useState(initialTheme.accent);
  const [hexError, setHexError] = useState<string | null>(null);

  // Sinkronkan kolom hex saat aksen berubah lewat preset / color picker.
  useEffect(() => {
    setCustomHex(theme.accent);
    setHexError(null);
  }, [theme.accent]);

  /** Terapkan + simpan. Satu jalur untuk semua perubahan supaya selalu konsisten. */
  const commit = (next: ThemePreference, message?: string) => {
    setTheme(next);
    applyThemeToDocument(next);
    writeCookie(THEME_COOKIE.name, serializeTheme(next), THEME_COOKIE.maxAgeSeconds);
    if (message) toast.success(message);
  };

  const pickAccent = (hex: string, label?: string) =>
    commit({ ...theme, accent: hex }, label ? `Warna aksen: ${label}` : "Warna aksen diperbarui");

  const pickPalette = (id: string, label: string) =>
    commit({ ...theme, base: id }, `Palet dasar: ${label}`);

  const submitCustomHex = () => {
    const normalized = normalizeHex(customHex);
    if (!normalized) {
      setHexError("Format hex tidak valid — contoh: #ff7c4c");
      return;
    }
    setHexError(null);
    pickAccent(normalized);
  };

  const reset = () => commit(DEFAULT_THEME, "Tema dikembalikan ke default");

  const activePresetId = ACCENT_PRESETS.find((preset) => preset.hex === theme.accent)?.id ?? null;

  return (
    <section className="card overflow-hidden">
      <CardHeader
        icon={<Palette size={16} strokeWidth={1.5} />}
        title="Tema Warna"
        action={
          <Button
            size="sm"
            onClick={reset}
            disabled={isDefaultTheme(theme)}
            icon={<RotateCcw size={14} strokeWidth={1.5} />}
          >
            Reset
          </Button>
        }
      />

      <div className="space-y-6 px-4 py-4">
        {/* Warna aksen */}
        <div className="space-y-3">
          <div>
            <h3 className="text-body font-medium">Warna aksen</h3>
            <p className="text-label text-muted">
              Dipakai untuk tombol utama, menu aktif, logo, dan sorotan. Perubahan langsung terpasang.
            </p>
          </div>

          <div role="radiogroup" aria-label="Preset warna aksen" className="flex flex-wrap gap-2">
            {ACCENT_PRESETS.map((preset) => {
              const selected = preset.id === activePresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={`${preset.label} · ${preset.hex}`}
                  onClick={() => pickAccent(preset.hex, preset.label)}
                  className={cn(
                    "flex min-h-[40px] items-center gap-2 rounded-control border px-2.5 text-label transition-colors duration-150 ease-out",
                    selected
                      ? "border-accent/60 bg-accent/10 text-text"
                      : "border-border bg-surface text-muted hover:bg-surface-raised hover:text-text",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 items-center justify-center rounded-full border border-black/30"
                    style={{ backgroundColor: preset.hex }}
                  >
                    {selected ? <Check size={12} strokeWidth={2.5} className="text-black/70" /> : null}
                  </span>
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Field label="Warna custom (hex)" htmlFor="accent-hex" error={hexError ?? undefined} className="w-44">
              <div className="flex items-center gap-2">
                <label
                  className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-control border border-border"
                  title="Pilih warna"
                  style={{ backgroundColor: normalizeHex(customHex) ?? theme.accent }}
                >
                  <span className="sr-only">Pilih warna aksen</span>
                  <input
                    type="color"
                    aria-label="Pilih warna aksen"
                    value={normalizeHex(customHex) ?? theme.accent}
                    onChange={(event) => pickAccent(event.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </label>
                <Input
                  id="accent-hex"
                  mono
                  value={customHex}
                  invalid={Boolean(hexError)}
                  maxLength={7}
                  spellCheck={false}
                  onChange={(event) => {
                    setCustomHex(event.target.value);
                    setHexError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitCustomHex();
                    }
                  }}
                  placeholder="#ff7c4c"
                />
              </div>
            </Field>
            <Button size="md" onClick={submitCustomHex} disabled={normalizeHex(customHex) === theme.accent}>
              Terapkan
            </Button>
          </div>
        </div>

        {/* Palet dasar */}
        <div className="space-y-3">
          <div>
            <h3 className="text-body font-medium">Palet dasar</h3>
            <p className="text-label text-muted">
              Nuansa latar, kartu, dan garis. Semua tetap gelap — panel memang dirancang dark-only.
            </p>
          </div>

          <div role="radiogroup" aria-label="Palet dasar" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {BASE_PALETTES.map((palette) => {
              const selected = palette.id === theme.base;
              return (
                <button
                  key={palette.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => pickPalette(palette.id, palette.label)}
                  className={cn(
                    "flex items-start gap-3 rounded-card border p-3 text-left transition-colors duration-150 ease-out",
                    selected
                      ? "border-accent/60 bg-accent/10"
                      : "border-border bg-surface hover:bg-surface-raised",
                  )}
                >
                  <PalettePreview palette={palette} accent={theme.accent} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-body text-text">
                      {palette.label}
                      {selected ? <Check size={14} strokeWidth={2} className="text-accent" /> : null}
                    </span>
                    <span className="block text-label text-muted">{palette.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Pratinjau */}
        <div className="space-y-2">
          <h3 className="text-body font-medium">Pratinjau</h3>
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-bg p-3">
            <Button variant="primary" size="sm">
              Tombol utama
            </Button>
            <Button size="sm">Tombol biasa</Button>
            <Badge tone="accent">Owner</Badge>
            <span className="rounded-control bg-surface-raised px-2.5 py-1.5 text-label text-accent">
              Menu aktif
            </span>
            <span className="font-mono text-[13px] text-text">XLVP-AB12-CD34</span>
          </div>
          <p className="text-label text-muted">
            Preferensi tema disimpan di cookie browser ini, jadi tiap perangkat bisa
            punya warna sendiri.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Miniatur palet: latar + kartu + garis aksen. */
function PalettePreview({
  palette,
  accent,
}: {
  palette: (typeof BASE_PALETTES)[number];
  accent: string;
}) {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-16 shrink-0 flex-col gap-1 rounded-control border p-1.5"
      style={{ backgroundColor: `rgb(${palette.bg})`, borderColor: `rgb(${palette.border})` }}
    >
      <span className="h-1.5 w-8 rounded-sm" style={{ backgroundColor: accent }} />
      <span
        className="flex-1 rounded-sm border"
        style={{ backgroundColor: `rgb(${palette.surface})`, borderColor: `rgb(${palette.border})` }}
      />
      <span className="h-1 w-10 rounded-sm" style={{ backgroundColor: `rgb(${palette.muted})` }} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Bagian kecil yang dipakai bersama                                   */
/* ------------------------------------------------------------------ */

function CardHeader({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <h2 className="flex items-center gap-2 text-body font-medium">
        <span className="text-muted">{icon}</span>
        {title}
      </h2>
      {action}
    </header>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-[160px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-label text-muted">{label}</dt>
      <dd className="min-w-0 text-body text-text">{value}</dd>
    </div>
  );
}
