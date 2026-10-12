import { NextResponse } from "next/server";

import { dbMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { ProfileRow } from "@/lib/types/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const mode = dbMode();

  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ session: null, configured: true, mode });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, email, role, credit, is_active")
      .eq("id", user.id)
      .maybeSingle<Pick<ProfileRow, "id" | "username" | "email" | "role" | "credit" | "is_active">>();

    if (!profile) {
      return NextResponse.json({ session: null, configured: true, mode });
    }

    return NextResponse.json({
      session: {
        id: profile.id,
        username: profile.username,
        email: profile.email,
        role: profile.role,
        credit: profile.credit,
        is_active: profile.is_active,
      },
      configured: true,
      mode,
    });
  } catch {
    return NextResponse.json({ session: null, configured: false, mode });
  }
}
