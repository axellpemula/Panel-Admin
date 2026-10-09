import type { SupabaseClient } from "@supabase/supabase-js";

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
