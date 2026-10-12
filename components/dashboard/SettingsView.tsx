"use client";

import { Check, Globe, Palette, Rows3, RotateCcw, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { ApiKeysCard } from "@/components/dashboard/ApiKeysCard";
import { LoginHistoryCard } from "@/components/dashboard/LoginHistoryCard";
import { PasswordCard } from "@/components/dashboard/PasswordCard";
import { SessionsCard } from "@/components/dashboard/SessionsCard";
import { SystemSettingsCard } from "@/components/dashboard/SystemSettingsCard";
import { TelegramCard } from "@/components/dashboard/TelegramCard";
import { ActiveBadge, Badge, RoleBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, Input } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import {
  ACCENT_PRESETS,
  BASE_PALETTES,
  DEFAULT_THEME,
  RADIUS_OPTIONS,
  THEME_COLOR_OPTIONS,
  accentForeground,
  applyThemeToDocument,
  basePaletteColors,
  isDefaultTheme,
  normalizeHex,
  resolveSurfaceColors,
  resolvedThemeColors,
  serializeTheme,
  THEME_COOKIE,
  themeContrastIssues,
  type ThemeColorKey,
  type ThemePreference,
  type ThemeSurfaceColorOverrides,
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

export function SettingsView({
  account,
  appInfo,
  initialTheme,
  initialDensity,
  resellers,
}: {
  account: AccountInfo;
  appInfo: AppInfo;
  initialTheme: ThemePreference;
  initialDensity: Density;
  resellers: { id: string; username: string }[];
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

      <h2 className="text-subtitle font-medium">Keamanan Akun</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PasswordCard />
        <SessionsCard />
      </div>

      <h2 className="text-subtitle font-medium">Integrasi</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TelegramCard isOwner={account.role === "owner"} />
        <ApiKeysCard isOwner={account.role === "owner"} resellers={resellers} />
      </div>

      <LoginHistoryCard description="20 percobaan login terakhir ke akun ini — waktu, perangkat, dan alamat IP. Kalau ada yang tidak kamu kenali, putus sesinya di kartu Sesi Aktif lalu ganti password." />

      {account.role === "owner" ? <SystemSettingsCard /> : null}

      <DensityCard initialDensity={initialDensity} />

      <ThemeCard initialTheme={initialTheme} />
    </div>
  );
}

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
        Ganti password sendiri di kartu <span className="text-text">Ganti Password</span> — data
        akun lain (username/email){" "}
        {isReseller ? "masih perlu bantuan Owner." : "bisa diubah dari menu Resellers."}
      </p>
    </section>
  );
}

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
                {appInfo.dbMode === "supabase" ? "Server" : "SQLite"}
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
              label="Signing"
              value={
                <ActiveBadge
                  active={appInfo.signingKeyReady}
                  labelOn="Terpasang"
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
        <div role="group" aria-label="Pilih kepadatan tabel" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {DENSITY_OPTIONS.map((option) => {
            const selected = option.id === density;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
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

function ThemeCard({ initialTheme }: { initialTheme: ThemePreference }) {
  const toast = useToast();
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [customHex, setCustomHex] = useState(initialTheme.accent);
  const [hexError, setHexError] = useState<string | null>(null);
  const [surfaceDrafts, setSurfaceDrafts] = useState(() => resolvedThemeColors(initialTheme));
  const [surfaceErrors, setSurfaceErrors] = useState<Partial<Record<ThemeColorKey, string>>>({});

  useEffect(() => {
    setCustomHex(theme.accent);
    setHexError(null);
  }, [theme.accent]);

  const commit = (next: ThemePreference, message?: string) => {
    setTheme(next);
    applyThemeToDocument(next);
    writeCookie(THEME_COOKIE.name, serializeTheme(next), THEME_COOKIE.maxAgeSeconds);
    if (message) toast.success(message);
  };

  const pickAccent = (hex: string, label?: string) => {
    const normalized = normalizeHex(hex);
    if (!normalized) return;
    commit(
      { ...theme, accent: normalized },
      label ? `Warna aksen: ${label}` : "Warna aksen diperbarui",
    );
  };

  const pickPalette = (id: string, label: string) => {
    const currentColors = resolvedThemeColors(theme);
    const nextColors = resolveSurfaceColors(id, theme.surfaceColors);

    setSurfaceDrafts((previous) => {
      const next = { ...previous };
      THEME_COLOR_OPTIONS.forEach((option) => {
        if (normalizeHex(previous[option.key]) === currentColors[option.key]) {
          next[option.key] = nextColors[option.key];
        }
      });
      return next;
    });
    setSurfaceErrors((previous) => {
      const next = { ...previous };
      THEME_COLOR_OPTIONS.forEach((option) => {
        if (normalizeHex(surfaceDrafts[option.key]) === currentColors[option.key]) {
          delete next[option.key];
        }
      });
      return next;
    });

    commit({ ...theme, base: id }, `Palet dasar: ${label}`);
  };

  const pickRadius = (radius: ThemePreference["radius"], label: string) =>
    commit({ ...theme, radius }, `Bentuk sudut: ${label}`);

  const submitCustomHex = () => {
    const normalized = normalizeHex(customHex);
    if (!normalized) {
      setHexError("Format hex tidak valid — contoh: #ff7c4c");
      return;
    }
    setHexError(null);
    pickAccent(normalized);
  };

  const updateSurfaceDraft = (key: ThemeColorKey, value: string) => {
    setSurfaceDrafts((previous) => ({ ...previous, [key]: value }));
    setSurfaceErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const applySurfaceColors = () => {
    const errors: Partial<Record<ThemeColorKey, string>> = {};
    const overrides: ThemeSurfaceColorOverrides = {};
    const paletteColors = basePaletteColors(theme.base);
    const normalizedDrafts = { ...paletteColors };

    THEME_COLOR_OPTIONS.forEach((option) => {
      const normalized = normalizeHex(surfaceDrafts[option.key]);
      if (!normalized) {
        errors[option.key] = "Format hex tidak valid — gunakan 6 digit, contoh #1c1b19.";
      } else {
        normalizedDrafts[option.key] = normalized;
      }
      if (normalized && normalized !== paletteColors[option.key]) {
        overrides[option.key] = normalized;
      }
    });

    setSurfaceErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSurfaceDrafts(normalizedDrafts);
    commit({ ...theme, surfaceColors: overrides }, "Warna permukaan diperbarui");
  };

  const resetSurfaceColors = () => {
    setSurfaceDrafts(basePaletteColors(theme.base));
    setSurfaceErrors({});
    commit({ ...theme, surfaceColors: {} }, "Warna permukaan mengikuti palet dasar");
  };

  const reset = () => {
    setCustomHex(DEFAULT_THEME.accent);
    setHexError(null);
    setSurfaceDrafts(basePaletteColors(DEFAULT_THEME.base));
    setSurfaceErrors({});
    commit(DEFAULT_THEME, "Tema dikembalikan ke default");
  };

  const activePresetId = ACCENT_PRESETS.find(
    (preset) => normalizeHex(preset.hex) === normalizeHex(theme.accent),
  )?.id ?? null;
  const appliedColors = resolvedThemeColors(theme);
  const paletteColors = basePaletteColors(theme.base);
  const hasSurfaceDraftChanges = THEME_COLOR_OPTIONS.some(
    (option) => normalizeHex(surfaceDrafts[option.key]) !== appliedColors[option.key],
  );
  const customColorCount = Object.keys(theme.surfaceColors).length;
  const contrastIssues = themeContrastIssues(theme);

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
        {/* Palet dasar */}
        <section aria-labelledby="theme-palette-title" className="space-y-3">
          <div>
            <h3 id="theme-palette-title" className="text-body font-medium">Palet dasar</h3>
            <p className="text-label text-muted">
              Pilih nuansa gelap sebagai dasar. Warna khusus yang sudah diterapkan tetap menimpa warna palet terkait.
            </p>
          </div>

          <div role="group" aria-label="Palet dasar" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {BASE_PALETTES.map((palette) => {
              const selected = palette.id === theme.base;
              return (
                <button
                  key={palette.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => pickPalette(palette.id, palette.label)}
                  className={cn(
                    "flex min-h-[72px] items-start gap-3 rounded-card border p-3 text-left transition-colors duration-150 ease-out",
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
        </section>

        {/* Warna aksen */}
        <section aria-labelledby="theme-accent-title" className="space-y-3 border-t border-border pt-5">
          <div>
            <h3 id="theme-accent-title" className="text-body font-medium">Warna aksen</h3>
            <p className="text-label text-muted">
              Dipakai untuk tombol utama, menu aktif, logo, dan sorotan. Preset dan color picker langsung diterapkan.
            </p>
          </div>

          <div role="group" aria-label="Preset warna aksen" className="flex flex-wrap gap-2">
            {ACCENT_PRESETS.map((preset) => {
              const selected = preset.id === activePresetId;
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
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
                    {selected ? (
                      <Check
                        size={12}
                        strokeWidth={2.5}
                        style={{ color: `rgb(${accentForeground(preset.hex)})` }}
                      />
                    ) : null}
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
                  title="Pilih warna aksen"
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
        </section>

        {/* Kustomisasi warna permukaan */}
        <section aria-labelledby="theme-surface-title" className="space-y-3 border-t border-border pt-5">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="theme-surface-title" className="text-body font-medium">Kustomisasi lanjutan</h3>
              <p className="mt-1 text-label text-muted">
                Ubah latar, kartu, garis, atau warna teks. Isi HEX lalu pilih Terapkan warna.
                Nilai ini disimpan di browser dan menimpa warna dari palet dasar.
              </p>
            </div>
            {customColorCount > 0 ? <Badge tone="accent">{customColorCount} warna khusus</Badge> : null}
          </header>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {THEME_COLOR_OPTIONS.map((option) => (
              <ThemeColorField
                key={option.key}
                colorKey={option.key}
                label={option.label}
                description={option.description}
                value={surfaceDrafts[option.key]}
                fallback={paletteColors[option.key]}
                error={surfaceErrors[option.key]}
                onChange={(value) => updateSurfaceDraft(option.key, value)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={applySurfaceColors}
              disabled={!hasSurfaceDraftChanges}
            >
              Terapkan warna
            </Button>
            <Button
              size="sm"
              onClick={resetSurfaceColors}
              disabled={customColorCount === 0 && !hasSurfaceDraftChanges}
            >
              Ikuti warna palet
            </Button>
            <span className="text-label text-muted">
              {customColorCount === 0 ? "Semua warna permukaan mengikuti palet." : "Warna khusus dapat direset kapan saja."}
            </span>
          </div>
        </section>

        {/* Bentuk sudut komponen */}
        <section aria-labelledby="theme-radius-title" className="space-y-3 border-t border-border pt-5">
          <div>
            <h3 id="theme-radius-title" className="text-body font-medium">Bentuk sudut</h3>
            <p className="text-label text-muted">
              Mengubah sudut tombol, input, dropdown, modal, dan kartu tanpa mengubah ukuran atau jarak.
            </p>
          </div>
          <div role="group" aria-label="Bentuk sudut komponen" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {RADIUS_OPTIONS.map((option) => {
              const selected = option.id === theme.radius;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => pickRadius(option.id, option.label)}
                  className={cn(
                    "flex min-h-[76px] items-center gap-3 rounded-card border p-3 text-left transition-colors duration-150 ease-out",
                    selected
                      ? "border-accent/60 bg-accent/10"
                      : "border-border bg-surface hover:bg-surface-raised",
                  )}
                >
                  <span className="flex h-11 w-14 shrink-0 flex-col justify-center gap-1.5 rounded-control border border-border bg-bg p-1.5">
                    <span
                      className="h-3 w-full border border-accent/70 bg-accent/15"
                      style={{ borderRadius: option.controlRadius }}
                    />
                    <span
                      className="h-4 w-full border border-border bg-surface-raised"
                      style={{ borderRadius: option.cardRadius }}
                    />
                  </span>
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
        </section>

        {/* Pratinjau */}
        <section aria-labelledby="theme-preview-title" className="space-y-2 border-t border-border pt-5">
          <h3 id="theme-preview-title" className="text-body font-medium">Pratinjau</h3>
          <div className="grid gap-3 rounded-card border border-border bg-bg p-3 md:grid-cols-2">
            <div className="rounded-card border border-border bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-body font-medium text-text">Panel contoh</p>
                  <p className="text-label text-muted">Teks sekunder dan permukaan kartu</p>
                </div>
                <Badge tone="accent">Owner</Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control border border-border bg-surface-raised p-2">
                <Button variant="primary" size="sm">Tombol utama</Button>
                <Button size="sm">Tombol biasa</Button>
                <span className="font-mono text-[13px] text-text">XLVP-AB12-CD34</span>
              </div>
            </div>
            <div className="rounded-card border border-border bg-surface p-3">
              <p className="text-label text-muted">Contoh baris tabel</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-control border border-border bg-surface-raised px-3 py-2">
                <span className="font-mono text-label text-text">XLVP-AB12-CD34</span>
                <span className="text-label text-active">● Active</span>
              </div>
              <p className="mt-2 text-label text-muted">Palet, warna permukaan, aksen, dan sudut akan terlihat di sini.</p>
            </div>
          </div>
          {contrastIssues.length > 0 ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-card border border-expired/40 bg-expired/10 px-3 py-2.5 text-label text-expired"
            >
              <p className="font-medium">
                {contrastIssues.length} kombinasi warna perlu diperiksa (rasio minimum WCAG AA 4.5:1 untuk teks).
              </p>
              <ul className="mt-1 list-inside list-disc">
                {contrastIssues.slice(0, 3).map((issue) => (
                  <li key={issue.label}>
                    {issue.label}: {issue.ratio.toFixed(1)}:1 (disarankan ≥ {issue.minimum.toFixed(1)}:1)
                  </li>
                ))}
              </ul>
              {contrastIssues.length > 3 ? (
                <p className="mt-1">dan {contrastIssues.length - 3} kombinasi lainnya.</p>
              ) : null}
              <p className="mt-1">Gunakan kembali warna palet atau sesuaikan teks agar lebih mudah dibaca.</p>
            </div>
          ) : (
            <p role="status" className="text-label text-active">
              Kontras teks dan warna status memenuhi rasio minimum WCAG AA pada permukaan tema ini.
            </p>
          )}
          <p className="text-label text-muted">
            Preferensi tema disimpan di cookie browser ini, jadi tiap perangkat bisa punya warna sendiri.
          </p>
        </section>
      </div>
    </section>
  );
}

function ThemeColorField({
  colorKey,
  label,
  description,
  value,
  fallback,
  error,
  onChange,
}: {
  colorKey: ThemeColorKey;
  label: string;
  description: string;
  value: string;
  fallback: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = `theme-${colorKey}`;
  const colorValue = normalizeHex(value) ?? fallback;

  return (
    <Field
      label={label}
      htmlFor={`${id}-hex`}
      hint={error ? undefined : description}
      error={error}
    >
      <div className="flex items-center gap-2">
        <label
          htmlFor={`${id}-picker`}
          className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-control border border-border"
          title={`Pilih warna: ${label}`}
          style={{ backgroundColor: colorValue }}
        >
          <span className="sr-only">Pilih warna {label.toLowerCase()}</span>
          <input
            id={`${id}-picker`}
            type="color"
            aria-label={`Pilih warna ${label.toLowerCase()}`}
            value={colorValue}
            onChange={(event) => onChange(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          id={`${id}-hex`}
          mono
          value={value}
          invalid={Boolean(error)}
          maxLength={7}
          spellCheck={false}
          autoCapitalize="characters"
          onChange={(event) => onChange(event.target.value)}
          placeholder={fallback}
        />
      </div>
    </Field>
  );
}

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
