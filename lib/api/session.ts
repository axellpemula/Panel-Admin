import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProfileRow } from "@/lib/types/database";

export interface SessionContext {
  userId: string;
  email: string | null;
  profile: ProfileRow;
  isOwner: boolean;
}

/**
 * Ambil session + profil untuk Server Component.
 * Belum login → redirect /login. Akun nonaktif → redirect /login?error=inactive.
 */
export async function requireSession(nextPath?: string): Promise<SessionContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (!profile) {
    redirect("/login?error=no_profile");
  }

  if (profile.is_active === false) {
    redirect("/login?error=inactive");
  }

  return {
    userId: user.id,
    email: user.email ?? profile.email,
    profile,
    isOwner: profile.role === "owner",
  };
}

/** Sama seperti requireSession, tapi menolak role selain owner. */
export async function requireOwner(nextPath?: string): Promise<SessionContext> {
  const session = await requireSession(nextPath);
  if (!session.isOwner) {
    redirect("/dashboard");
  }
  return session;
}
