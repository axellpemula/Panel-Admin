import type { Metadata } from "next";

import { ToolsView } from "@/components/dashboard/ToolsView";
import { requireOwner } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Tool Management · XLOOP PANEL",
};

export default async function ToolsPage() {
  await requireOwner("/tools");
  return <ToolsView />;
}
