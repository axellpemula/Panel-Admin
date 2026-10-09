import { cn } from "@/lib/utils/cn";

/**
 * Logo XLOOP — huruf "X" 3D.
 *
 * Digambar sebagai SVG inline (tanpa file eksternal, tanpa ilustrasi raster):
 * tiga lapisan path yang sama, digeser diagonal, dengan tone berbeda supaya
 * terbaca sebagai objek 3D tanpa gradient, glow, atau shadow.
 *
 * - Tanpa background/border — hanya glyph-nya.
 * - Warna memakai token panel (`--c-accent` dengan beberapa tingkat opacity),
 *   jadi ikonnya otomatis ikut kalau token accent diubah.
 * - Ukuran diatur lewat prop `size` (px), bukan class, supaya tidak bentrok
 *   dengan utility Tailwind lain di dalam `className`.
 */
export function XloopMark({
  size = 28,
  className,
  title = "XLOOP PANEL",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  // Satu bentuk X (12 titik): 4 ujung lengan tajam + 4 notch.
  const xShape =
    "M18.364 5.636 L15.585 11.385 L18.364 18.364 L12.615 15.585 " +
    "L5.636 18.364 L8.415 12.615 L5.636 5.636 L11.385 8.415 Z";

  const layer = (offset: number, opacity: number) => (
    <path
      d={xShape}
      transform={offset > 0 ? `translate(${offset} ${offset})` : undefined}
      fill={`rgb(var(--c-accent) / ${opacity})`}
      stroke={`rgb(var(--c-accent) / ${opacity})`}
      strokeWidth="0.5"
      strokeLinejoin="round"
    />
  );

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      width={size}
      height={size}
      role="img"
      aria-label={title}
      className={cn("shrink-0", className)}
    >
      <title>{title}</title>
      {layer(1, 0.42)}
      {layer(0.5, 0.66)}
      {layer(0, 1)}
    </svg>
  );
}

export default XloopMark;
