"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ValidationTrendPoint {
  bucket: string;
  label: string;
  total: number;
  succeeded: number;
  failed: number;
}

/**
 * Tren percobaan validasi (per jam / per hari) — stacked bar: sukses vs gagal.
 * Komponen ini di-load lewat next/dynamic({ ssr: false }) dari halaman
 * Validation Attempts (recharts hanya untuk halaman ini).
 */
export function ValidationTrendChart({
  data,
  hourly,
}: {
  data: ValidationTrendPoint[];
  hourly: boolean;
}) {
  const total = data.reduce((sum, point) => sum + point.total, 0);
  // Banyaknya label maksimal ~12 supaya tidak bertumpuk di layar kecil.
  const tickInterval = Math.max(0, Math.ceil(data.length / 12) - 1);

  return (
    <section className="card p-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-body font-medium">Tren {hourly ? "per jam" : "per hari"}</h2>
          <p className="text-label text-muted">
            Jumlah percobaan validasi {hourly ? "per jam" : "per hari"} (WIB)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-label text-muted">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-active" />
            Sukses
          </span>
          <span className="flex items-center gap-1.5 text-label text-muted">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-banned" />
            Gagal
          </span>
          <p className="text-label text-muted tabular-nums">{total} percobaan</p>
        </div>
      </header>

      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="rgb(var(--c-border))" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="label"
              interval={tickInterval}
              tick={{ fill: "rgb(var(--c-muted))", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "rgb(var(--c-border))" }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "rgb(var(--c-muted))", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "rgb(var(--c-surface-raised))" }}
              contentStyle={{
                background: "rgb(var(--c-surface-raised))",
                border: "1px solid rgb(var(--c-border))",
                borderRadius: 8,
                fontSize: 12,
                color: "rgb(var(--c-text))",
              }}
              labelStyle={{ color: "rgb(var(--c-muted))", fontSize: 11 }}
              formatter={(value, name) => [
                `${value}`,
                name === "succeeded" ? "Sukses" : "Gagal",
              ]}
            />
            <Bar
              dataKey="succeeded"
              stackId="trend"
              fill="rgb(var(--c-active))"
              isAnimationActive={false}
            />
            <Bar
              dataKey="failed"
              stackId="trend"
              fill="rgb(var(--c-banned))"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export default ValidationTrendChart;
