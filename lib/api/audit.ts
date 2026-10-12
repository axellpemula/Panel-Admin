import type { SupabaseClient } from "@supabase/supabase-js";

import { ACTIVITY_ACTIONS, type ActivityAction } from "@/lib/activity-labels";
import { AUDIT_ACTIONS, BAN_REASONS } from "@/lib/constants";
import type {
  AuditAction,
  AuditActorRole,
  BanReason,
  Database,
  ProfileRow,
} from "@/lib/types/database";

/**
 * Audit log — jejak aksi Owner/Reseller/sistem terhadap key: ban, unban,
 * hapus key, reset HWID, dan auto-ban. Ini yang pertama dicari kalau ada
 * sengketa dengan reseller ("siapa yang ban / unban / reset HWID / hapus key?").
 *
 * Semua identitas di-denormalisasi saat tulis (actor_username, key_owner_username,
 * key_value) supaya jejak tetap terbaca walau akun atau key-nya sudah dihapus.
 */

export interface AuditEntry {
  /** Pelaku aksi. NULL untuk aksi sistem (auto-ban). */
  actorId: string | null;
  actorUsername: string | null;
  actorRole: AuditActorRole;
  action: AuditAction;
  /** Boleh NULL (mis. aksi pada key yang sudah tidak ada). */
  keyId: string | null;
  /** Nilai key saat aksi — tetap tersimpan walau key-nya dihapus. */
  keyValue: string;
  /** Pemilik key (reseller) — kolom inti saat sengketa. */
  keyOwnerId: string | null;
  keyOwnerUsername: string | null;
  /** Diisi untuk aksi ban/unban/auto-ban. */
  banReason?: BanReason | null;
  note?: string | null;
  /** Metadata tambahan (HWID direset, jumlah device, hasil refund, dsb). */
  detail?: Record<string, unknown> | null;
}

/**
 * Catat satu baris audit log.
 * Kegagalan menulis log TIDAK boleh membatalkan aksi utama (hanya di-warn) —
 * sama seperti perilaku `recordCreditLog`, supaya panel tetap jalan walau
 * tabel log bermasalah. Ditangani dua lapis: `error` dari hasil insert AND
 * exception (adapter SQLite bisa melempar langsung, bukan mengembalikan { error }).
 */
export async function recordAuditLog(
  admin: SupabaseClient<Database>,
  entry: AuditEntry,
): Promise<void> {
  try {
    const { error } = await admin.from("audit_logs").insert({
      actor_id: entry.actorId,
      actor_username: entry.actorUsername,
      actor_role: entry.actorRole,
      action: entry.action,
      key_id: entry.keyId,
      key_value: entry.keyValue,
      key_owner_id: entry.keyOwnerId,
      key_owner_username: entry.keyOwnerUsername,
      ban_reason: entry.banReason ?? null,
      note: entry.note ?? null,
      detail: entry.detail ?? null,
    });

    if (error) {
      console.warn("[audit] audit_logs insert gagal:", error.message);
    }
  } catch (error) {
    console.warn("[audit] audit_logs insert gagal:", (error as Error)?.message ?? error);
  }
}

/** Ambil username satu profil (untuk di-denormalisasi ke audit log). */
export async function getProfileUsername(
  admin: SupabaseClient<Database>,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await admin
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .maybeSingle<Pick<ProfileRow, "username">>();

  if (error) {
    console.warn("[audit] gagal membaca username profil:", error.message);
    return null;
  }
  return data?.username ?? null;
}

// ---------------------------------------------------------------------------
// Audit log terpadu — merge `audit_logs` (aksi pada key) + `activity_logs`
// (aktivitas akun & sistem) menjadi satu daftar kronologis untuk halaman
// Audit Log. Kedua tabel memakai kolom aktor + created_at yang sama, jadi
// merge-nya cukup dilakukan di sisi aplikasi lalu diurutkan berdasarkan waktu.
// ---------------------------------------------------------------------------

/** Sumber baris: `key` = aksi pada key (audit_logs), `activity` = akun & sistem (activity_logs). */
export type MergedLogSource = "key" | "activity";

export interface MergedLogItem {
  /** Berprefiks sumber (`key:<uuid>` / `activity:<uuid>`) supaya unik untuk React key. */
  id: string;
  source: MergedLogSource;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_role: string | null;
  action: string;
  /** Hanya untuk baris aksi key — nilai key tetap tersimpan walau key sudah dihapus. */
  key_value: string | null;
  key_owner_username: string | null;
  ban_reason: string | null;
  note: string | null;
  /** Hanya untuk baris aktivitas — label target (mis. nama API key, username). */
  target_label: string | null;
  detail: Record<string, unknown> | null;
}

export interface AuditLogItem {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_role: string | null;
  action: AuditAction;
  key_id: string | null;
  key_value: string;
  key_owner_id: string | null;
  key_owner_username: string | null;
  ban_reason: BanReason | null;
  note: string | null;
  detail: Record<string, unknown> | null;
}

/** Parse `detail` yang bisa datang sebagai JSONB (object) atau TEXT (SQLite). */
function parseDetail(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function normalizeAuditLog(row: unknown): AuditLogItem {
  const record = row as Record<string, unknown>;
  const banReason = record.ban_reason;

  return {
    id: String(record.id),
    created_at: String(record.created_at),
    actor_id: record.actor_id ? String(record.actor_id) : null,
    actor_username: (record.actor_username as string | null) ?? null,
    actor_role: (record.actor_role as string | null) ?? null,
    action: record.action as AuditAction,
    key_id: record.key_id ? String(record.key_id) : null,
    key_value: String(record.key_value ?? ""),
    key_owner_id: record.key_owner_id ? String(record.key_owner_id) : null,
    key_owner_username: (record.key_owner_username as string | null) ?? null,
    ban_reason: BAN_REASONS.includes(banReason as BanReason) ? (banReason as BanReason) : null,
    note: (record.note as string | null) ?? null,
    detail: parseDetail(record.detail),
  };
}

function normalizeActivityLog(row: unknown): MergedLogItem {
  const record = row as Record<string, unknown>;
  return {
    id: `activity:${String(record.id)}`,
    source: "activity",
    created_at: String(record.created_at),
    actor_id: record.actor_id ? String(record.actor_id) : null,
    actor_username: (record.actor_username as string | null) ?? null,
    actor_role: (record.actor_role as string | null) ?? null,
    action: String(record.action ?? ""),
    key_value: null,
    key_owner_username: null,
    ban_reason: null,
    note: null,
    target_label: (record.target_label as string | null) ?? null,
    detail: parseDetail(record.detail),
  };
}

function normalizeMergedAudit(row: unknown): MergedLogItem {
  const item = normalizeAuditLog(row);
  return {
    id: `key:${item.id}`,
    source: "key",
    created_at: item.created_at,
    actor_id: item.actor_id,
    actor_username: item.actor_username,
    actor_role: item.actor_role,
    action: item.action,
    key_value: item.key_value,
    key_owner_username: item.key_owner_username,
    ban_reason: item.ban_reason,
    note: item.note,
    target_label: null,
    detail: item.detail,
  };
}

export interface ListMergedLogsOptions {
  from?: string;
  to?: string;
  /** Satu aksi (audit atau activity). Nilai tak dikenal diabaikan → semua sumber. */
  action?: string;
  /** user_id aktor, atau "system" untuk baris tanpa aktor. */
  actor?: string;
  /** Cari substring di `key_value` (hanya berlaku untuk baris aksi key). */
  key?: string;
  page?: number;
  perPage?: number;
}

export interface ListMergedLogsResult {
  items: MergedLogItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

/** Batas baris per sumber yang diambil untuk satu merge (setara cap export CSV lama). */
export const MERGED_LOG_SCAN_LIMIT = 5_000;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

interface FetchMergedOptions {
  from?: string;
  to?: string;
  action?: string;
  actor?: string;
  key?: string;
  /** Ambil N baris teratas per sumber (setelah filter) sebelum di-merge. */
  scan: number;
}

/**
 * Ambil baris terbaru dari kedua tabel log sesuai filter, lalu merge & urutkan
 * desc. `scan` membatasi berapa baris teratas per sumber yang diambil — untuk
 * halaman ke-P cukup `page × perPage` baris per sumber, dan untuk export CSV
 * dipakai `MERGED_LOG_SCAN_LIMIT`.
 */
async function fetchMergedLogs(
  admin: SupabaseClient<Database>,
  options: FetchMergedOptions,
): Promise<{ items: MergedLogItem[]; total: number }> {
  const scan = clamp(options.scan, 1, MERGED_LOG_SCAN_LIMIT);
  const action = options.action;
  const isKeyAction = AUDIT_ACTIONS.includes(action as AuditAction);
  const isActivityAction = ACTIVITY_ACTIONS.includes(action as ActivityAction);

  // Filter aksi hanya relevan untuk tabel sumbernya; filter key hanya untuk
  // audit_logs (activity_logs tidak menyimpan key_value) — jadi saat mencari
  // key, activity_logs tidak ikut di-query sama sekali.
  const keySearch = (options.key ?? "").trim();
  const wantAudit = !action || isKeyAction;
  const wantActivity = (!action || isActivityAction) && keySearch.length === 0;

  const results: MergedLogItem[] = [];
  let total = 0;

  const runQuery = async (
    table: "audit_logs" | "activity_logs",
    normalize: (row: unknown) => MergedLogItem,
  ) => {
    let query = admin.from(table).select("*", { count: "exact" });
    if (options.from) query = query.gte("created_at", options.from);
    if (options.to) query = query.lte("created_at", options.to);
    if (options.actor === "system") {
      query = query.is("actor_id", null);
    } else if (options.actor) {
      query = query.eq("actor_id", options.actor);
    }
    if (table === "audit_logs") {
      if (action && isKeyAction) query = query.eq("action", action);
      if (keySearch.length > 0) {
        query = query.ilike("key_value", `%${keySearch.toUpperCase()}%`);
      }
    } else if (action && isActivityAction) {
      query = query.eq("action", action);
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range(0, scan - 1);
    if (error) throw new Error(error.message);

    results.push(...((data ?? []) as unknown[]).map(normalize));
    total += count ?? (data?.length ?? 0);
  };

  if (wantAudit) await runQuery("audit_logs", normalizeMergedAudit);
  if (wantActivity) await runQuery("activity_logs", normalizeActivityLog);

  // Terbaru dulu; kalau waktunya sama, aksi key dulu, lalu id sebagai tie-break
  // supaya urutan deterministik.
  results.sort((a, b) => {
    const byTime = b.created_at.localeCompare(a.created_at);
    if (byTime !== 0) return byTime;
    if (a.source !== b.source) return a.source === "key" ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { items: results, total };
}

/** Daftar log terpadu (terbaru dulu) dengan filter + pagination. */
export async function listMergedLogs(
  admin: SupabaseClient<Database>,
  options: ListMergedLogsOptions = {},
): Promise<ListMergedLogsResult> {
  const page = clamp(options.page ?? 1, 1, 1_000_000);
  const perPage = clamp(options.perPage ?? 50, 5, 500);

  const { items, total } = await fetchMergedLogs(admin, {
    from: options.from,
    to: options.to,
    action: options.action,
    actor: options.actor,
    key: options.key,
    scan: Math.min(page * perPage, MERGED_LOG_SCAN_LIMIT),
  });

  const start = (page - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    total,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/**
 * Semua baris terpadu untuk export CSV (maks `MERGED_LOG_SCAN_LIMIT` per sumber,
 * hasil merge dipotong ke batas yang sama).
 */
export async function listMergedLogsForExport(
  admin: SupabaseClient<Database>,
  options: Omit<ListMergedLogsOptions, "page" | "perPage"> = {},
): Promise<MergedLogItem[]> {
  const { items } = await fetchMergedLogs(admin, {
    from: options.from,
    to: options.to,
    action: options.action,
    actor: options.actor,
    key: options.key,
    scan: MERGED_LOG_SCAN_LIMIT,
  });
  return items.slice(0, MERGED_LOG_SCAN_LIMIT);
}
