import { cookies } from "next/headers";

import { DashboardShell } from "@/components/layout/DashboardShell";
import { requireSession } from "@/lib/api/session";
import { SIDEBAR_COOKIE } from "@/lib/constants";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const sidebarHidden = cookies().get(SIDEBAR_COOKIE.name)?.value === SIDEBAR_COOKIE.hidden;

  return (
    <DashboardShell
      user={{
        username: session.profile.username,
        email: session.profile.email,
        role: session.profile.role,
        credit: session.profile.credit,
      }}
      role={session.profile.role}
      initialCollapsed={sidebarHidden}
    >
      {children}
    </DashboardShell>
  );
}
