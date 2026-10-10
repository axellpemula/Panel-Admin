import type { CSSProperties } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Skeleton base — blok dengan shimmer gradient yang menyapu kiri→kanan.
 * Lebih hidup daripada pulse opacity polos: ada aksen cahaya bergerak yang
 * memberi kesan "data sedang dialirkan".
 */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={{
        ...style,
        backgroundImage:
          "linear-gradient(90deg, rgb(var(--c-surface-raised)) 0%, rgb(var(--c-border)) 50%, rgb(var(--c-surface-raised)) 100%)",
        backgroundSize: "200% 100%",
      }}
      className={cn(
        "relative overflow-hidden rounded-control bg-surface-raised animate-skeleton-shimmer",
        className,
      )}
    />
  );
}

/** Skeleton untuk baris tabel (tinggi baris 44px). */
export function SkeletonRows({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-border" role="status" aria-label="Memuat data">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="flex h-11 items-center gap-4 px-4"
          style={{ animationDelay: `${rowIndex * 40}ms` }}
        >
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn(
                "h-3 animate-fade-in opacity-0",
                columnIndex === 0 ? "w-40" : columnIndex === 1 ? "w-24" : "w-16",
              )}
              style={{ animationDelay: `${rowIndex * 40 + columnIndex * 60}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Skeleton untuk kartu statistik — masuk berurutan dengan fade-up. */
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      role="status"
      aria-label="Memuat statistik"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="card animate-fade-up p-4 opacity-0"
          style={{ animationDelay: `${index * 70}ms` }}
        >
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-16" />
          <div className="mt-2 flex items-center gap-1.5">
            <Skeleton className="h-2.5 w-2.5 rounded-full" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton blok chart — batang naik-turun dengan wave bergantian. */
export function SkeletonChart({ height = 240 }: { height?: number }) {
  // Tinggi acak tapi deterministik (ditentukan saat compile) supaya bar
  // tidak loncat tiap render, namun tetap terlihat bervariasi.
  const bars = [42, 68, 35, 82, 58, 74, 48, 88, 63, 79, 52, 70];

  return (
    <div
      className="card animate-fade-up p-4 opacity-0"
      role="status"
      aria-label="Memuat grafik"
      style={{ animationDelay: "120ms" }}
    >
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-5 w-16 rounded-control" />
      </div>
      <div
        className="mt-6 flex items-end gap-2"
        style={{ height }}
      >
        {bars.map((value, index) => (
          <div key={index} className="flex-1" style={{ height: `${value}%` }}>
            <Skeleton
              className="h-full w-full origin-bottom animate-skeleton-bar"
              style={{
                animationDelay: `${index * 90}ms`,
                animationDuration: "1.8s",
                borderBottomLeftRadius: "2px",
                borderBottomRightRadius: "2px",
                borderTopLeftRadius: "3px",
                borderTopRightRadius: "3px",
              }}
            />
          </div>
        ))}
      </div>
      {/* Sumbu X — titik-titik label palsu. */}
      <div className="mt-2 flex gap-2">
        {bars.map((_, index) => (
          <Skeleton
            key={index}
            className="h-2 flex-1 max-w-[40px] mx-auto"
            style={{ animationDelay: `${index * 50 + 200}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/** Skeleton panel samping (misal Top Reseller / Recent Activity). */
export function SkeletonPanel({
  rows = 5,
  style,
}: {
  rows?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="card animate-fade-up p-4 opacity-0"
      style={style}
      role="status"
    >
      <Skeleton className="h-3 w-36" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton
              className="h-8 w-8 rounded-full"
              style={{ animationDelay: `${index * 60}ms` }}
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton
                className="h-2.5 w-3/4"
                style={{ animationDelay: `${index * 60 + 30}ms` }}
              />
              <Skeleton
                className="h-2 w-1/2"
                style={{ animationDelay: `${index * 60 + 60}ms` }}
              />
            </div>
            <Skeleton
              className="h-2.5 w-10"
              style={{ animationDelay: `${index * 60 + 90}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
