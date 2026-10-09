import type { Metadata } from "next";

import { AuditView } from "@/components/dashboard/AuditView";
import { requireOwner } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Audit Log · XLOOP PANEL",
};

export default async function AuditPage() {
  const session = await requireOwner("/audit");
  return (
    <AuditView
      currentUserId={session.userId}
      currentUsername={session.profile.username}
    />
  );
}
