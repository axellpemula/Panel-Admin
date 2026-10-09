import type { Metadata } from "next";

import { CreditsView } from "@/components/dashboard/CreditsView";
import { requireSession } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Credit Log · XLOOP PANEL",
};

export default async function CreditsPage() {
  const session = await requireSession("/credits");
  return <CreditsView isOwner={session.isOwner} />;
}
