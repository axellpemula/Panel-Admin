import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ResellerDetailView } from "@/components/dashboard/ResellerDetailView";
import { isUuid } from "@/lib/api/auth";
import { requireOwner } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Detail Reseller · XLOOP PANEL",
};

export const dynamic = "force-dynamic";

export default async function ResellerDetailPage({ params }: { params: { id: string } }) {
  await requireOwner(`/resellers/${params.id}`);
  if (!isUuid(params.id)) notFound();
  return <ResellerDetailView id={params.id} />;
}
