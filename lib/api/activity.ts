import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActivityAction } from "@/lib/activity-labels";
import type { AuditActorRole, Database, ProfileRow } from "@/lib/types/database";

/**
 * Activity log — aktivitas akun & sistem yang **bukan** aksi pada key:
 * ganti password, putus sesi, API key dibuat/dicabut, pengaturan diubah,
 * Telegram dihubungkan/ditautkan, dan sejenisnya.
 *
 * Penulisannya digabung bersama `audit_logs` (aksi pada key) di halaman Audit
 * Log terpadu — lihat `listMergedLogs` di `lib/api/audit.ts`.
 * Sama seperti audit log: identitas di-denormalisasi supaya jejaknya tetap
 * terbaca walau akun pelakunya sudah dihapus, dan penulisannya tidak boleh
 * menggagalkan aksi utama (kegagalan hanya di-warn).
 */

export {
  ACTIVITY_ACTIONS,
  ACTIVITY_ACTION_LABEL,
  type ActivityAction,
} from "@/lib/activity-labels";

export interface ActivityEntry {
  actorId: string | null;
  actorUsername: string | null;
  actorRole: AuditActorRole;
  action: ActivityAction;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function recordActivity(
  admin: SupabaseClient<Database>,
  entry: ActivityEntry,
): Promise<void> {
  try {
    const { error } = await admin.from("activity_logs").insert({
      actor_id: entry.actorId,
      actor_username: entry.actorUsername,
      actor_role: entry.actorRole,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      target_label: entry.targetLabel ?? null,
      detail: entry.detail ?? null,
    });
    if (error) console.warn("[activity] activity_logs insert gagal:", error.message);
  } catch (error) {
    console.warn("[activity] activity_logs insert gagal:", (error as Error)?.message ?? error);
  }
}

/** Helper: catat aktivitas dari konteks auth (`ctx`). */
export async function recordActivityFromContext(
  admin: SupabaseClient<Database>,
  actor: { userId: string; profile: Pick<ProfileRow, "username" | "role"> },
  entry: Omit<ActivityEntry, "actorId" | "actorUsername" | "actorRole">,
): Promise<void> {
  await recordActivity(admin, {
    actorId: actor.userId,
    actorUsername: actor.profile.username,
    actorRole: actor.profile.role,
    ...entry,
  });
}
