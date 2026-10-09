import type { Metadata } from "next";

import { KeysView } from "@/components/dashboard/KeysView";
import { requireSession } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Key List · XLOOP PANEL",
};

export default async function KeysPage() {
  const session = await requireSession("/keys");

  return <KeysView isOwner={session.isOwner} currentUserId={session.userId} />;
}
