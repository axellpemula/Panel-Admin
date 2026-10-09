import { createClient } from "@/lib/supabase/server";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — hapus sesi Supabase. */
export async function POST() {
  try {
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Sesi mungkin sudah kedaluwarsa — tetap anggap logout berhasil.
      console.warn("[auth] signOut:", error.message);
    }
    return jsonOk({ loggedOut: true });
  } catch (error) {
    return jsonError(errorMessage(error), "server_error", 500);
  }
}
