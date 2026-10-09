import type { Metadata } from "next";

import { KeyChartDynamic } from "@/components/dashboard/KeyChartDynamic";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { StatCard, StatGrid } from "@/components/dashboard/StatCard";
import { TopResellers } from "@/components/dashboard/TopResellers";
import { ownerStats, resellerStats } from "@/lib/api/stats";
import { requireSession } from "@/lib/api/session";
import { formatNumber } from "@/lib/utils/format";

export const metadata: Metadata = {
  title: "Dashboard · XLOOP PANEL",
};

export const dynamic = "force-dynamic";

/**
 * Dashboard overview.
 * Susunan: kartu statistik → grafik → dua kolom (Top Reseller & Recent Activity).
 * Di mobile semuanya jadi satu kolom.
 */
export default async function DashboardPage() {
  const session = await requireSession("/dashboard");

  if (session.isOwner) {
    const stats = await ownerStats(await adminClient());

    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-title font-medium">Dashboard</h1>
          <p className="mt-1 text-body text-muted">Ringkasan seluruh key, reseller, dan aktivitas.</p>
        </header>

        <StatGrid>
          <StatCard label="Total Key" value={stats.totals.all} hint="Semua key di sistem" />
          <StatCard label="Key Active" value={stats.totals.active} tone="active" />
          <StatCard label="Key Expired" value={stats.totals.expired} tone="expired" />
          <StatCard label="Key Banned" value={stats.totals.banned} tone="banned" />
        </StatGrid>

        <StatGrid>
          <StatCard
            label="Reseller Aktif"
            value={stats.totals.resellers_active}
            hint={`${formatNumber(stats.totals.resellers)} reseller terdaftar`}
          />
          <StatCard label="Key Dibuat Hari Ini" value={stats.totals.created_today} tone="accent" />
          <StatCard label="Key Dibuat Minggu Ini" value={stats.totals.created_week} />
          <StatCard
            label="Rata-rata / Hari"
            value={Math.round(stats.totals.created_week / 7)}
            hint="7 hari terakhir"
          />
        </StatGrid>

        <KeyChartDynamic data={stats.chart} title="Key Dibuat" />

        {/*
          grid-cols-1 wajib eksplisit: tanpa itu, di layar kecil kolom tunggal
          ikut melebar ke lebar teks aktivitas yang nowrap (truncate), sehingga
          box keluar dari layar. Dengan minmax(0,1fr) lebarnya selalu mengikuti container.
        */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TopResellers items={stats.topResellers} />
          <RecentActivity items={stats.recentActivity} showUser />
        </div>
      </div>
    );
  }

  const stats = await resellerStats(await adminClient(), session.userId);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title font-medium">Dashboard</h1>
        <p className="mt-1 text-body text-muted">Ringkasan key dan credit milikmu.</p>
      </header>

      <StatGrid>
        <StatCard label="Total Key" value={stats.totals.all} hint="Key milikmu" />
        <StatCard label="Key Active" value={stats.totals.active} tone="active" />
        <StatCard label="Key Expired" value={stats.totals.expired} tone="expired" />
        <StatCard label="Key Banned" value={stats.totals.banned} tone="banned" />
      </StatGrid>

      <StatGrid>
        <StatCard label="Sisa Credit" value={stats.totals.credit} tone="accent" hint="Dipakai untuk generate key" />
        <StatCard label="Key Dibuat Hari Ini" value={stats.totals.created_today} />
        <StatCard label="Key Dibuat Minggu Ini" value={stats.totals.created_week} />
        <StatCard
          label="Rata-rata / Hari"
          value={Math.round(stats.totals.created_week / 7)}
          hint="7 hari terakhir"
        />
      </StatGrid>

      <KeyChartDynamic data={stats.chart} title="Key Milikmu" />

      <RecentActivity items={stats.recentActivity} />
    </div>
  );
}

/** Admin client dipisah supaya tidak pernah ikut ter-bundle ke client. */
async function adminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}
