/**
 * Tema warna panel — dipakai server (root layout, baca cookie) dan client
 * (halaman Pengaturan, pratinjau langsung). File ini murni: tanpa import
 * Node/Next supaya aman di-bundle ke browser.
 *
 * Yang bisa diubah user:
 * - **Warna aksen** (`--c-accent`): preset atau hex custom.
 * - **Palet dasar** (`--c-bg`, `--c-surface`, dst): beberapa nuansa gelap.
 *
 * Preferensi disimpan di cookie `xloop_theme` dengan format `<palet>.<hex>`
 * (mis. `warm.ff7c4c`). Root layout membacanya di server dan menulis CSS
 * variable sebagai inline style di `<html>`, jadi warna sudah benar di HTML
 * pertama — tidak ada "kedip" dari warna default ke warna pilihan.
 */

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

/** Warna aksen siap pilih. Urutan pertama = default panel. */
export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: "orange", label: "Oranye", hex: "#ff7c4c" },
  { id: "amber", label: "Kuning", hex: "#e8b84a" },
  { id: "green", label: "Hijau", hex: "#4fc38a" },
  { id: "teal", label: "Teal", hex: "#3ec5c5" },
  { id: "blue", label: "Biru", hex: "#5b9cf6" },
  { id: "violet", label: "Ungu", hex: "#a78bfa" },
  { id: "pink", label: "Merah muda", hex: "#f472b6" },
  { id: "red", label: "Merah", hex: "#ef6461" },
] as const;

export interface BasePalette {
  id: string;
  label: string;
  description: string;
  /** Nilai triplet "R G B" (tanpa koma) — format yang dipakai token di globals.css. */
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  muted: string;
}

/** Palet dasar (semua gelap — panel memang dark-only). Pertama = default. */
export const BASE_PALETTES: readonly BasePalette[] = [
  {
    id: "warm",
    label: "Hangat",
    description: "Abu kecokelatan — tampilan bawaan panel.",
    bg: "28 27 25",
    surface: "35 34 32",
    surfaceRaised: "42 41 39",
    border: "54 52 47",
    text: "236 233 228",
    muted: "154 149 140",
  },
  {
    id: "graphite",
    label: "Grafit",
    description: "Abu netral tanpa nuansa warna.",
    bg: "23 23 24",
    surface: "30 30 32",
    surfaceRaised: "38 38 41",
    border: "52 52 56",
    text: "232 232 235",
    muted: "150 150 158",
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Biru tua kebiruan, nyaman di malam hari.",
    bg: "17 21 30",
    surface: "23 28 39",
    surfaceRaised: "30 36 49",
    border: "44 52 70",
    text: "228 232 240",
    muted: "140 150 170",
  },
  {
    id: "oled",
    label: "Hitam pekat",
    description: "Latar hitam murni — hemat baterai layar OLED.",
    bg: "0 0 0",
    surface: "12 12 12",
    surfaceRaised: "22 22 22",
    border: "40 40 40",
    text: "236 236 236",
    muted: "150 150 150",
  },
] as const;

export interface ThemePreference {
  /** id palet dasar (lihat BASE_PALETTES). */
  base: string;
  /** Warna aksen dalam hex 6 digit huruf kecil, dengan `#`. */
  accent: string;
}

export const DEFAULT_THEME: ThemePreference = {
  base: BASE_PALETTES[0].id,
  accent: ACCENT_PRESETS[0].hex,
};

/** Cookie preferensi tema (umur 1 tahun, bukan data sensitif). */
export const THEME_COOKIE = {
  name: "xloop_theme",
  maxAgeSeconds: 60 * 60 * 24 * 365,
} as const;

const HEX_REGEX = /^#?([0-9a-f]{6})$/i;

/** Normalisasi hex ke bentuk `#rrggbb` huruf kecil; null kalau tidak valid. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const match = HEX_REGEX.exec(input.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

/** `#ff7c4c` → `255 124 76` (format triplet token CSS). */
export function hexToTriplet(hex: string): string {
  const normalized = normalizeHex(hex) ?? DEFAULT_THEME.accent;
  const value = normalized.slice(1);
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/**
 * Warna teks di atas aksen (tombol primary): gelap untuk aksen terang, putih
 * untuk aksen gelap. Memakai rumus YIQ sederhana — cukup akurat untuk UI.
 */
export function accentForeground(hex: string): string {
  const [r, g, b] = hexToTriplet(hex).split(" ").map((part) => Number.parseInt(part, 10));
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "32 20 15" : "255 255 255";
}

export function findPalette(id: string | null | undefined): BasePalette {
  return BASE_PALETTES.find((palette) => palette.id === id) ?? BASE_PALETTES[0];
}

/** Serialize ke nilai cookie: `warm.ff7c4c`. */
export function serializeTheme(theme: ThemePreference): string {
  const palette = findPalette(theme.base);
  const accent = (normalizeHex(theme.accent) ?? DEFAULT_THEME.accent).slice(1);
  return `${palette.id}.${accent}`;
}

/** Parse nilai cookie; nilai rusak/asing → tema default (tidak pernah melempar). */
export function parseTheme(raw: string | null | undefined): ThemePreference {
  if (!raw) return DEFAULT_THEME;
  const [base, accentRaw] = raw.split(".");
  const palette = findPalette(base);
  const accent = normalizeHex(accentRaw) ?? DEFAULT_THEME.accent;
  return { base: palette.id, accent };
}

export function isDefaultTheme(theme: ThemePreference): boolean {
  return theme.base === DEFAULT_THEME.base && normalizeHex(theme.accent) === DEFAULT_THEME.accent;
}

/**
 * CSS variable yang harus dipasang di `<html>` untuk tema ini. Nama variabel
 * sama persis dengan token di globals.css, jadi seluruh komponen (yang memang
 * dilarang hardcode hex) otomatis ikut.
 */
export function themeCssVariables(theme: ThemePreference): Record<string, string> {
  const palette = findPalette(theme.base);
  const accent = normalizeHex(theme.accent) ?? DEFAULT_THEME.accent;
  return {
    "--c-bg": palette.bg,
    "--c-surface": palette.surface,
    "--c-surface-raised": palette.surfaceRaised,
    "--c-border": palette.border,
    "--c-text": palette.text,
    "--c-muted": palette.muted,
    "--c-accent": hexToTriplet(accent),
    "--c-accent-fg": accentForeground(accent),
  };
}

/** Warna `theme-color` browser (bar atas di HP) = warna latar palet. */
export function themeColorHex(theme: ThemePreference): string {
  const [r, g, b] = findPalette(theme.base).bg.split(" ").map((part) => Number.parseInt(part, 10));
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Terapkan tema ke dokumen (client) — dipakai pratinjau langsung di Pengaturan. */
export function applyThemeToDocument(theme: ThemePreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  Object.entries(themeCssVariables(theme)).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = themeColorHex(theme);
}
