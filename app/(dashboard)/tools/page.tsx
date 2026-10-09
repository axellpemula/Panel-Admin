import type { Metadata } from "next";

import { ToolsView } from "@/components/dashboard/ToolsView";
import { requireOwner } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Tool Management · XLOOP PANEL",
};

/** Tool Management hanya untuk Owner (reseller di-redirect ke dashboard). */
export default async function ToolsPage() {
  await requireOwner("/tools");
  return <ToolsView />;
}
