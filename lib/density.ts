/**
 * Kepadatan tabel (Nyaman / Kompak) — preferensi per browser, disimpan di cookie
 * dan dibaca server-side di root layout supaya HTML pertama sudah benar
 * (sama polanya dengan tema di lib/theme.ts).
 *
 * Implementasi CSS: class `density-compact` di <html> (lihat akhir globals.css).
 */

export type Density = "comfortable" | "compact";

export const DENSITY_COOKIE = {
  name: "xloop_density",
  maxAgeSeconds: 60 * 60 * 24 * 365,
} as const;

export const DENSITY_CLASS = "density-compact";

export const DENSITY_OPTIONS: { id: Density; label: string; description: string }[] = [
  { id: "comfortable", label: "Nyaman", description: "Baris 44px — mudah dibaca & ditekan di layar sentuh." },
  { id: "compact", label: "Kompak", description: "Baris 36px — lebih banyak key terlihat tanpa scroll." },
];

export function parseDensity(raw: string | undefined | null): Density {
  return raw === "compact" ? "compact" : "comfortable";
}

export function applyDensityToDocument(density: Density): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(DENSITY_CLASS, density === "compact");
}
