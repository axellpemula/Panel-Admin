import type { Metadata } from "next";

import { DurationsView } from "@/components/dashboard/DurationsView";
import { requireOwner } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Duration Setting · XLOOP PANEL",
};

export default async function DurationsPage() {
  await requireOwner("/durations");
  return <DurationsView />;
}
