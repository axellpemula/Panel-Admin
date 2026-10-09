import type { Metadata } from "next";

import { ResellersView } from "@/components/dashboard/ResellersView";
import { requireOwner } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Reseller · XLOOP PANEL",
};

export default async function ResellersPage() {
  await requireOwner("/resellers");
  return <ResellersView />;
}
