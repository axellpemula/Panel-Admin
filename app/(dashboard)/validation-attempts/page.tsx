import type { Metadata } from "next";

import { ValidationAttemptsView } from "@/components/dashboard/ValidationAttemptsView";
import { requireOwner } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Validation Attempts · XLOOP PANEL",
};

export default async function ValidationAttemptsPage() {
  await requireOwner("/validation-attempts");
  return <ValidationAttemptsView />;
}
