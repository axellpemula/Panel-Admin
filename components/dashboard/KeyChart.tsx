"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChartPoint } from "@/lib/api/stats";

/**
 * Grafik key per hari (7 hari terakhir) — line chart.
 * Komponen ini di-load lewat next/dynamic({ ssr: false }) hanya di halaman dashboard.
 */
export function KeyChart({ data, title }: { data: ChartPoint[]; title: string }) {
  const total = data.reduce((sum, point) => sum + point.count, 0);

  return (
    <section className="card p-4">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-body font-medium">{title}</h2>
          <p className="text-label text-muted">7 hari terakhir</p>
        </div>
        <p className="text-label text-muted tabular-nums">{total} key</p>
      </header>

      <div className="h-[240px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid stroke="rgb(var(--c-border))" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="weekday"
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
              cursor={{ stroke: "rgb(var(--c-border))" }}
              contentStyle={{
                background: "rgb(var(--c-surface-raised))",
                border: "1px solid rgb(var(--c-border))",
                borderRadius: 8,
                fontSize: 12,
                color: "rgb(var(--c-text))",
              }}
              labelStyle={{ color: "rgb(var(--c-muted))", fontSize: 11 }}
              formatter={(value: number) => [`${value} key`, "Dibuat"]}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="rgb(var(--c-accent))"
              strokeWidth={1.5}
              dot={{ r: 2.5, fill: "rgb(var(--c-accent))", strokeWidth: 0 }}
              activeDot={{ r: 4, fill: "rgb(var(--c-accent))", strokeWidth: 0 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export default KeyChart;
