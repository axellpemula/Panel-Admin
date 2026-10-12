import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActivityAction } from "@/lib/activity-labels";
import type { ActivityLogRow, AuditActorRole, Database, ProfileRow } from "@/lib/types/database";

/**
 * Activity log — aktivitas akun & sistem yang **bukan** aksi pada key:
 * ganti password, putus sesi, API key dibuat/dicabut, pengaturan diubah,
 * Telegram dihubungkan/ditautkan, dan sejenisnya.
 *
 * Ini pelengkap `audit_logs` (yang khusus aksi pada key: ban/unban/hapus/reset HWID).
 * Sama seperti audit log: identitas di-denormalisasi supaya jejaknya tetap terbaca
 * walau akun pelakunya sudah dihapus, dan penulisannya tidak boleh menggagalkan aksi
 * utama (kegagalan hanya di-warn).
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

export interface ActivityItem {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  detail: Record<string, unknown> | null;
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

export interface ListActivityOptions {
  from?: string;
  to?: string;
  action?: string;
  actor?: string;
  page?: number;
  perPage?: number;
}

export interface ListActivityResult {
  items: ActivityItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

function normalize(record: Record<string, unknown>): ActivityItem {
  return {
    id: String(record.id),
    created_at: String(record.created_at),
    actor_id: (record.actor_id as string | null) ?? null,
    actor_username: (record.actor_username as string | null) ?? null,
    actor_role: (record.actor_role as string | null) ?? null,
    action: String(record.action ?? ""),
    target_type: (record.target_type as string | null) ?? null,
    target_id: (record.target_id as string | null) ?? null,
    target_label: (record.target_label as string | null) ?? null,
    detail: (record.detail as Record<string, unknown> | null) ?? null,
  };
}

/** Daftar aktivitas (terbaru dulu) dengan filter + pagination. */
export async function listActivity(
  admin: SupabaseClient<Database>,
  options: ListActivityOptions = {},
): Promise<ListActivityResult> {
  const page = Math.min(1_000_000, Math.max(1, options.page ?? 1));
  const perPage = Math.min(200, Math.max(5, options.perPage ?? 50));
  const from = (page - 1) * perPage;

  let query = admin.from("activity_logs").select("*", { count: "exact" });
  if (options.from) query = query.gte("created_at", options.from);
  if (options.to) query = query.lte("created_at", options.to);
  if (options.action) query = query.eq("action", options.action);
  if (options.actor) query = query.eq("actor_id", options.actor);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const total = count ?? rows.length;

  return {
    items: rows.map(normalize),
    total,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export type { ActivityLogRow };
