import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  KeyListItem,
  KeyStatus,
  KeyWithRelations,
} from "@/lib/types/database";

/**
 * Query key list yang dipakai /api/keys (panel) dan dashboard.
 * Semua query di sini dijalankan lewat service role, tapi filter role
 * (owner vs reseller) WAJIB sudah diterapkan oleh pemanggil.
 */

export const KEY_SELECT =
  "*, tool_types(id,name,slug,is_active), tool_versions(id,name,is_active), profiles!keys_created_by_fkey(id,username,email)";

export type SortColumn = "created_at" | "expired_at" | "status" | "key_value";

const SORTABLE: Record<SortColumn, string> = {
  created_at: "created_at",
  expired_at: "expired_at",
  status: "status",
  key_value: "key_value",
};

export interface ListKeysOptions {
  userId?: string;
  search?: string;
  status?: string;
  toolTypeId?: string;
  versionId?: string;
  createdBy?: string;
  sort?: SortColumn;
  order?: "asc" | "desc";
  page?: number;
  perPage?: number;
}

export interface ListKeysResult {
  items: KeyListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/** Bersihkan input pencarian supaya tidak merusak sintaks filter PostgREST. */
function sanitizeSearch(input: string): string {
  return input.replace(/[%_,()\\]/g, "").trim().slice(0, 64);
}

export function normalizeKey(row: KeyWithRelations, devicesUsed = 0): KeyListItem {
  return {
    id: row.id,
    key_value: row.key_value,
    status: row.status,
    tool_type_id: row.tool_type_id,
    tool_name: row.tool_types?.name ?? "-",
    tool_slug: row.tool_types?.slug ?? "-",
    tool_version_id: row.tool_version_id,
    version_name: row.tool_versions?.name ?? "-",
    duration_days: row.duration_days,
    expired_at: row.expired_at,
    max_device: row.max_device,
    devices_used: devicesUsed,
    credit_cost: Number(row.credit_cost) || 0,
    note: row.note,
    last_used: row.last_used,
    ban_reason: row.ban_reason ?? null,
    ban_note: row.ban_note ?? null,
    banned_by: row.banned_by ?? null,
    banned_at: row.banned_at ?? null,
    created_at: row.created_at,
    created_by: row.created_by,
    created_by_username: row.profiles?.username ?? null,
  };
}

/** Ambil jumlah device terpakai untuk sekumpulan key (1 query). */
export async function fetchDeviceCounts(
  admin: SupabaseClient<Database>,
  keyIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (keyIds.length === 0) return map;

  const { data, error } = await admin.rpc("key_device_counts", { p_key_ids: keyIds });
  if (error || !data) {
    // Fallback: hitung per key (tetap benar, hanya lebih banyak request).
    const fallback = await Promise.all(
      keyIds.map(async (id) => {
        const { count } = await admin
          .from("device_logs")
          .select("id", { count: "exact", head: true })
          .eq("key_id", id);
        return [id, count ?? 0] as const;
      }),
    );
    fallback.forEach(([id, count]) => map.set(id, count));
    return map;
  }

  (data as { key_id: string; device_count: number }[]).forEach((row) => {
    map.set(row.key_id, Number(row.device_count) || 0);
  });
  return map;
}

/** Pastikan status key yang sudah lewat tanggal expired langsung terbaca expired. */
export async function refreshExpiredKeys(admin: SupabaseClient<Database>): Promise<void> {
  const { error } = await admin.rpc("update_expired_keys");
  if (error) {
    console.warn("[keys] update_expired_keys gagal:", error.message);
  }
}

export async function listKeys(
  admin: SupabaseClient<Database>,
  options: ListKeysOptions,
): Promise<ListKeysResult> {
  // Page di-clamp ke [1, 1jt]: nilai ekstrem (mis. 1e20) membuat offset melewati
  // batas integer SQLite/Postgres → error 500 yang tidak perlu.
  const page = Math.min(1_000_000, Math.max(1, options.page ?? 1));
  const perPage = Math.min(100, Math.max(5, options.perPage ?? 20));
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = admin.from("keys").select(KEY_SELECT, { count: "exact" });

  if (options.userId) query = query.eq("created_by", options.userId);
  if (options.createdBy) query = query.eq("created_by", options.createdBy);
  if (options.status && ["active", "expired", "banned"].includes(options.status)) {
    query = query.eq("status", options.status as KeyStatus);
  }
  if (options.toolTypeId) query = query.eq("tool_type_id", options.toolTypeId);
  if (options.versionId) query = query.eq("tool_version_id", options.versionId);
  if (options.search && options.search.trim().length > 0) {
    const term = sanitizeSearch(options.search);
    if (term.length > 0) query = query.ilike("key_value", `%${term.toUpperCase()}%`);
  }

  const sortColumn = SORTABLE[options.sort ?? "created_at"] ?? "created_at";
  query = query.order(sortColumn, {
    ascending: (options.order ?? "desc") === "asc",
    nullsFirst: false,
  });

  const { data, error, count } = await query.range(from, to);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as KeyWithRelations[];
  const counts = await fetchDeviceCounts(
    admin,
    rows.map((row) => row.id),
  );
  const items = rows.map((row) => normalizeKey(row, counts.get(row.id) ?? 0));
  const total = count ?? items.length;

  return {
    items,
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** Ambil satu key + relasinya, sudah dinormalisasi untuk UI. */
export async function getKeyDetail(
  admin: SupabaseClient<Database>,
  keyId: string,
): Promise<KeyListItem | null> {
  const { data, error } = await admin
    .from("keys")
    .select(KEY_SELECT)
    .eq("id", keyId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as unknown as KeyWithRelations;
  const counts = await fetchDeviceCounts(admin, [row.id]);
  return normalizeKey(row, counts.get(row.id) ?? 0);
}
