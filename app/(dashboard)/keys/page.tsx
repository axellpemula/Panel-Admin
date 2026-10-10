import type { Metadata } from "next";

import { KeysView } from "@/components/dashboard/KeysView";
import { requireSession } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Key List · XLOOP PANEL",
};

export const dynamic = "force-dynamic";

export default async function KeysPage({
  searchParams,
}: {
  searchParams?: { q?: string; created_by?: string; status?: string };
}) {
  const session = await requireSession("/keys");

  return (
    <KeysView
      isOwner={session.isOwner}
      currentUserId={session.userId}
      initialQuery={(searchParams?.q ?? "").slice(0, 64)}
      initialCreatedBy={searchParams?.created_by ?? ""}
      initialStatus={searchParams?.status ?? ""}
    />
  );
}
