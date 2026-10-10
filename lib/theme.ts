/**
 * Tema warna panel — dipakai server (root layout, baca cookie) dan client
 * (halaman Pengaturan, pratinjau langsung). File ini murni: tanpa import
 * Node/Next supaya aman di-bundle ke browser.
 *
 * Preferensi tema disimpan di cookie `xloop_theme` dan diterapkan sebagai CSS
 * variables di `<html>`. Parser tetap mendukung format lama `palet.hex` supaya
 * tema yang tersimpan sebelum versi ini tidak hilang setelah upgrade.
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
  { id: "red", label: "Merah", hex: "#f07975" },
] as const;

export interface BasePalette {
  id: string;
  label: string;
  description: string;
  /** Nilai triplet "R G B" (tanpa koma) — format token di globals.css. */
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  muted: string;
}

/** Palet dasar gelap. Palet pertama adalah tampilan bawaan panel. */
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
  {
    id: "ocean",
    label: "Ocean",
    description: "Biru laut dalam dengan nuansa dingin.",
    bg: "20 27 38",
    surface: "26 36 50",
    surfaceRaised: "34 46 62",
    border: "51 68 87",
    text: "231 238 245",
    muted: "151 170 191",
  },
  {
    id: "forest",
    label: "Forest",
    description: "Hijau hutan gelap yang tenang.",
    bg: "20 29 26",
    surface: "27 38 33",
    surfaceRaised: "35 48 42",
    border: "51 68 58",
    text: "232 239 232",
    muted: "152 173 159",
  },
  {
    id: "plum",
    label: "Plum",
    description: "Ungu gelap dengan kesan hangat.",
    bg: "30 24 34",
    surface: "39 31 45",
    surfaceRaised: "49 39 56",
    border: "69 55 77",
    text: "239 233 243",
    muted: "171 157 178",
  },
] as const;

export const THEME_COLOR_OPTIONS = [
  { key: "bg", label: "Latar halaman", description: "Latar utama di belakang konten." },
  { key: "surface", label: "Kartu & panel", description: "Kartu, tabel, sidebar, dan navigasi." },
  { key: "surfaceRaised", label: "Permukaan terangkat", description: "Hover, menu, dan panel di atas kartu." },
  { key: "border", label: "Garis & border", description: "Pemisah tabel, kartu, dan kontrol." },
  { key: "text", label: "Teks utama", description: "Judul dan isi utama." },
  { key: "muted", label: "Teks sekunder", description: "Label, hint, dan informasi tambahan." },
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_OPTIONS)[number]["key"];
export type ThemeSurfaceColors = Record<ThemeColorKey, string>;
export type ThemeSurfaceColorOverrides = Partial<Record<ThemeColorKey, string>>;
export type ThemeRadius = "square" | "standard" | "rounded";

export interface RadiusOption {
  id: ThemeRadius;
  label: string;
  description: string;
  controlRadius: string;
  cardRadius: string;
}

/** Radius yang diterapkan ke seluruh komponen berbasis rounded-control/card. */
export const RADIUS_OPTIONS: readonly RadiusOption[] = [
  {
    id: "square",
    label: "Tajam",
    description: "Sudut lebih tegas dan minimal.",
    controlRadius: "2px",
    cardRadius: "4px",
  },
  {
    id: "standard",
    label: "Standar",
    description: "Bentuk bawaan panel.",
    controlRadius: "6px",
    cardRadius: "8px",
  },
  {
    id: "rounded",
    label: "Membulat",
    description: "Sudut lebih lembut tanpa mengubah ukuran komponen.",
    controlRadius: "10px",
    cardRadius: "14px",
  },
] as const;

export interface ThemePreference {
  /** id palet dasar (lihat BASE_PALETTES). */
  base: string;
  /** Warna aksen dalam hex 6 digit huruf kecil, dengan `#`. */
  accent: string;
  /** Warna dasar dapat ditimpa satu per satu lewat Kustomisasi Lanjutan. */
  surfaceColors: ThemeSurfaceColorOverrides;
  /** Bentuk sudut untuk seluruh komponen yang memakai token radius. */
  radius: ThemeRadius;
}

export const DEFAULT_THEME: ThemePreference = {
  base: BASE_PALETTES[0].id,
  accent: ACCENT_PRESETS[0].hex,
  surfaceColors: {},
  radius: "standard",
};

/** Cookie preferensi tema (umur 1 tahun, bukan data sensitif). */
export const THEME_COOKIE = {
  name: "xloop_theme",
  maxAgeSeconds: 60 * 60 * 24 * 365,
} as const;

const HEX_REGEX = /^#?([0-9a-f]{6})$/i;
const VERSIONED_THEME_PREFIX = "v2|";
const DARK_FOREGROUND = "#000000";
const LIGHT_FOREGROUND = "#ffffff";
// Harus selaras dengan token status di app/globals.css.
const STATUS_TEXT_COLORS = [
  { label: "status Active", color: "#6fae82" },
  { label: "status Expired", color: "#c9a35b" },
  { label: "status Banned", color: "#df817b" },
] as const;

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

function tripletToHex(triplet: string): string {
  const channels = triplet.split(/\s+/).map((channel) => Number.parseInt(channel, 10));
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return "#000000";
  }
  return `#${channels.map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(hex: string): number {
  const normalized = normalizeHex(hex) ?? "#000000";
  const channels = [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index + 1, index + 3), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Rasio kontras WCAG untuk dua warna hex (1:1 sampai 21:1). */
export function contrastRatio(first: string, second: string): number {
  const luminanceA = relativeLuminance(first);
  const luminanceB = relativeLuminance(second);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pilih teks gelap atau putih berdasarkan rasio kontras terbaik, bukan nilai
 * YIQ saja. Ini membuat label tombol utama tetap terbaca pada aksen custom.
 */
export function accentForeground(hex: string): string {
  const normalized = normalizeHex(hex) ?? DEFAULT_THEME.accent;
  const darkRatio = contrastRatio(normalized, DARK_FOREGROUND);
  const lightRatio = contrastRatio(normalized, LIGHT_FOREGROUND);
  return lightRatio > darkRatio ? "255 255 255" : "0 0 0";
}

export function findPalette(id: string | null | undefined): BasePalette {
  return BASE_PALETTES.find((palette) => palette.id === id) ?? BASE_PALETTES[0];
}

export function findRadius(id: string | null | undefined): RadiusOption {
  return RADIUS_OPTIONS.find((option) => option.id === id) ?? RADIUS_OPTIONS[1];
}

/** Warna hex yang disediakan oleh palet dasar, tanpa override custom. */
export function basePaletteColors(id: string | null | undefined): ThemeSurfaceColors {
  const palette = findPalette(id);
  return {
    bg: tripletToHex(palette.bg),
    surface: tripletToHex(palette.surface),
    surfaceRaised: tripletToHex(palette.surfaceRaised),
    border: tripletToHex(palette.border),
    text: tripletToHex(palette.text),
    muted: tripletToHex(palette.muted),
  };
}

/** Warna permukaan efektif setelah override custom diterapkan. */
export function resolveSurfaceColors(
  baseId: string,
  overrides: ThemeSurfaceColorOverrides = {},
): ThemeSurfaceColors {
  const base = basePaletteColors(baseId);
  return THEME_COLOR_OPTIONS.reduce((colors, option) => {
    const custom = normalizeHex(overrides[option.key]);
    colors[option.key] = custom ?? base[option.key];
    return colors;
  }, { ...base });
}

export function resolvedThemeColors(theme: ThemePreference): ThemeSurfaceColors {
  return resolveSurfaceColors(theme.base, theme.surfaceColors);
}

/**
 * Ringkasan pasangan teks/latar yang belum memenuhi rasio WCAG AA normal (4.5:1).
 * Peringatan membantu pengguna memperbaiki kombinasi custom tanpa mengunci
 * pilihan warna yang mungkin sengaja dipakai untuk kebutuhan tertentu.
 */
export interface ThemeContrastIssue {
  label: string;
  ratio: number;
  minimum: number;
}

export function themeContrastIssues(theme: ThemePreference): ThemeContrastIssue[] {
  const colors = resolvedThemeColors(theme);
  const accent = normalizeHex(theme.accent) ?? DEFAULT_THEME.accent;
  const accentText = accentForeground(accent) === "255 255 255" ? LIGHT_FOREGROUND : DARK_FOREGROUND;
  const surfaces: { label: string; color: string }[] = [
    { label: "latar halaman", color: colors.bg },
    { label: "kartu", color: colors.surface },
    { label: "permukaan terangkat", color: colors.surfaceRaised },
  ];
  const textColors = [
    { label: "teks utama", color: colors.text },
    { label: "teks sekunder", color: colors.muted },
  ];
  const issues: ThemeContrastIssue[] = [];

  textColors.forEach((text) => {
    surfaces.forEach((surface) => {
      const ratio = contrastRatio(text.color, surface.color);
      if (ratio < 4.5) {
        issues.push({ label: `${text.label} dengan ${surface.label}`, ratio, minimum: 4.5 });
      }
    });
  });

  STATUS_TEXT_COLORS.forEach((status) => {
    surfaces.forEach((surface) => {
      const ratio = contrastRatio(status.color, surface.color);
      if (ratio < 4.5) {
        issues.push({ label: `${status.label} dengan ${surface.label}`, ratio, minimum: 4.5 });
      }
    });
  });

  const accentRatio = contrastRatio(accentText, accent);
  if (accentRatio < 4.5) {
    issues.push({ label: "teks tombol utama dengan warna aksen", ratio: accentRatio, minimum: 4.5 });
  }

  surfaces.forEach((surface) => {
    const ratio = contrastRatio(accent, surface.color);
    if (ratio < 4.5) {
      issues.push({ label: `teks aksen dengan ${surface.label}`, ratio, minimum: 4.5 });
    }
  });

  return issues;
}

/** Serialize ke format versi 2; format cookie lama tetap bisa dibaca parser. */
export function serializeTheme(theme: ThemePreference): string {
  const palette = findPalette(theme.base);
  const accent = (normalizeHex(theme.accent) ?? DEFAULT_THEME.accent).slice(1);
  const radius = findRadius(theme.radius).id;
  const colors = THEME_COLOR_OPTIONS.map((option) => {
    const normalized = normalizeHex(theme.surfaceColors?.[option.key]);
    return normalized ? normalized.slice(1) : "-";
  });
  return ["v2", palette.id, accent, radius, ...colors].join("|");
}

/** Parse cookie tema; nilai rusak/asing → fallback aman, tidak pernah melempar. */
export function parseTheme(raw: string | null | undefined): ThemePreference {
  if (!raw) return DEFAULT_THEME;

  if (raw.startsWith(VERSIONED_THEME_PREFIX)) {
    const parts = raw.split("|");
    const base = findPalette(parts[1]).id;
    const accent = normalizeHex(parts[2]) ?? DEFAULT_THEME.accent;
    const radius = findRadius(parts[3]).id;
    const surfaceColors: ThemeSurfaceColorOverrides = {};

    THEME_COLOR_OPTIONS.forEach((option, index) => {
      const rawColor = parts[index + 4];
      if (!rawColor || rawColor === "-") return;
      const normalized = normalizeHex(rawColor);
      if (normalized) surfaceColors[option.key] = normalized;
    });

    return { base, accent, radius, surfaceColors };
  }

  // Kompatibilitas dengan cookie sebelum palet custom/radius ditambahkan.
  const [base, accentRaw] = raw.split(".");
  return {
    ...DEFAULT_THEME,
    base: findPalette(base).id,
    accent: normalizeHex(accentRaw) ?? DEFAULT_THEME.accent,
  };
}

export function isDefaultTheme(theme: ThemePreference): boolean {
  const hasCustomSurfaceColors = THEME_COLOR_OPTIONS.some((option) =>
    normalizeHex(theme.surfaceColors?.[option.key]),
  );
  return (
    theme.base === DEFAULT_THEME.base &&
    normalizeHex(theme.accent) === DEFAULT_THEME.accent &&
    findRadius(theme.radius).id === DEFAULT_THEME.radius &&
    !hasCustomSurfaceColors
  );
}

/**
 * CSS variables yang dipasang di `<html>`. Nama variabel cocok dengan token
 * globals.css/Tailwind agar seluruh halaman dan komponen ikut berubah seragam.
 */
export function themeCssVariables(theme: ThemePreference): Record<string, string> {
  const colors = resolvedThemeColors(theme);
  const accent = normalizeHex(theme.accent) ?? DEFAULT_THEME.accent;
  const radius = findRadius(theme.radius);
  return {
    "--c-bg": hexToTriplet(colors.bg),
    "--c-surface": hexToTriplet(colors.surface),
    "--c-surface-raised": hexToTriplet(colors.surfaceRaised),
    "--c-border": hexToTriplet(colors.border),
    "--c-text": hexToTriplet(colors.text),
    "--c-muted": hexToTriplet(colors.muted),
    "--c-accent": hexToTriplet(accent),
    "--c-accent-fg": accentForeground(accent),
    "--r-control": radius.controlRadius,
    "--r-card": radius.cardRadius,
  };
}

/** Warna `theme-color` browser (bar atas di HP) mengikuti latar efektif tema. */
export function themeColorHex(theme: ThemePreference): string {
  return resolvedThemeColors(theme).bg;
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
