import { Skeleton, SkeletonCards, SkeletonChart, SkeletonPanel } from "@/components/ui/Skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Header — masuk paling dulu. */}
      <header className="animate-fade-up opacity-0" style={{ animationDelay: "0ms" }}>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-2 h-3 w-72" />
      </header>

      {/* Baris kartu statistik pertama. */}
      <SkeletonCards count={4} />

      {/* Baris kartu statistik kedua (sedikit offset delay via komponen). */}
      <div style={{ animationDelay: "80ms" }}>
        <SkeletonCards count={4} />
      </div>

      {/* Chart — batang skeleton naik-turun dengan wave. */}
      <SkeletonChart />

      {/* Dua panel samping (Top Reseller & Recent Activity) — muncul bersama. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SkeletonPanel rows={5} style={{ animationDelay: "180ms" }} />
        <SkeletonPanel rows={5} style={{ animationDelay: "260ms" }} />
      </div>
    </div>
  );
}
