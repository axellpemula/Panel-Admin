"use client";

import dynamic from "next/dynamic";

import { SkeletonChart } from "@/components/ui/Skeleton";
import type { ChartPoint } from "@/lib/api/stats";

/**
 * Recharts hanya di-load di halaman dashboard, dan hanya di client
 * (next/dynamic dengan ssr: false) supaya bundle awal tetap ringan.
 */
const KeyChart = dynamic(() => import("@/components/dashboard/KeyChart"), {
  ssr: false,
  loading: () => <SkeletonChart />,
});

export function KeyChartDynamic({ data, title }: { data: ChartPoint[]; title: string }) {
  return <KeyChart data={data} title={title} />;
}
