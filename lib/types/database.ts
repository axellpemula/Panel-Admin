/**
 * Tipe database (mirror dari migration.sql).
 * Dipakai sebagai generic Supabase client supaya query bertipe.
 */

export type UserRole = "owner" | "reseller";
export type KeyStatus = "active" | "expired" | "banned";
export type CreditAction = "topup" | "generate" | "extend" | "refund";

/** Alasan ban yang terstruktur. `auto_hwid` dikhususkan untuk auto-ban sistem. */
export type BanReason = "manual" | "auto_hwid" | "refund" | "other";

/** Aksi yang dicatat di audit log (jejak siapa melakukan apa terhadap key). */
export type AuditAction =
  | "key_ban"
  | "key_unban"
  | "key_delete"
  | "hwid_reset"
  | "hwid_reset_all"
  | "key_auto_ban";

/** Role aktor saat aksi dicatat. `system` = auto-ban dari endpoint validasi. */
export type AuditActorRole = "owner" | "reseller" | "system";

export type ProfileRow = {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  credit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ToolTypeRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ToolVersionRow = {
  id: string;
  tool_type_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type DurationPresetRow = {
  id: string;
  name: string;
  days: number;
  credit_cost: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type KeyRow = {
  id: string;
  key_value: string;
  tool_type_id: string;
  tool_version_id: string;
  created_by: string;
  status: KeyStatus;
  duration_days: number | null;
  expired_at: string | null;
  max_device: number;
  /** Credit yang sudah dipakai untuk key ini (generate + perpanjang); 0 kalau tidak ada. */
  credit_cost: number;
  note: string | null;
  last_used: string | null;
  /** Alasan ban terstruktur (null kalau tidak sedang banned). */
  ban_reason: BanReason | null;
  /** Catatan tambahan saat di-ban (mis. alasan refund / sengketa). */
  ban_note: string | null;
  /** Siapa yang melakukan ban (null kalau auto-ban sistem). Di-set NULL kalau akun dihapus. */
  banned_by: string | null;
  /** Kapan key di-ban. */
  banned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DeviceLogRow = {
  id: string;
  key_id: string;
  hardware_id: string;
  first_seen: string;
  last_seen: string;
};

export type CreditLogRow = {
  id: string;
  user_id: string;
  action: CreditAction;
  amount: number;
  balance_after: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type ToolSecretRow = {
  tool_type_id: string;
  secret_payload: string | null;
  updated_at: string;
};

export type ValidationAttemptRow = {
  id: string;
  ip: string;
  key_value: string | null;
  hardware_id: string | null;
  success: boolean;
  reason: string | null;
  created_at: string;
};

/**
 * Audit log — jejak aksi Owner/Reseller/sistem terhadap key (ban, unban,
 * hapus key, reset HWID, auto-ban). Semua kolom identitas di-denormalisasi
 * (username) supaya jejak tetap terbaca walau akun atau key sudah dihapus.
 */
export type AuditLogRow = {
  id: string;
  created_at: string;
  /** Pelaku aksi; NULL kalau aksi oleh sistem (auto-ban) atau akunnya sudah dihapus. */
  actor_id: string | null;
  actor_username: string | null;
  actor_role: AuditActorRole | null;
  action: AuditAction;
  /** Di-set NULL kalau key sudah dihapus (jejak tetap ada via key_value). */
  key_id: string | null;
  /** Nilai key saat aksi — tidak ikut terhapus walau key-nya dihapus. */
  key_value: string;
  /** Pemilik key (reseller) — kolom inti kalau ada sengketa dengan reseller. */
  key_owner_id: string | null;
  key_owner_username: string | null;
  /** Diisi untuk aksi ban/unban/auto-ban. */
  ban_reason: BanReason | null;
  note: string | null;
  /** Metadata tambahan (HWID yang direset, jumlah device, hasil refund, dsb). */
  detail: Record<string, unknown> | null;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        {
          id: string;
          username: string;
          email: string;
          role?: UserRole;
          credit?: number;
          is_active?: boolean;
        }
      >;
      tool_types: Table<
        ToolTypeRow,
        { name: string; slug: string; is_active?: boolean; created_by?: string | null }
      >;
      tool_versions: Table<
        ToolVersionRow,
        { tool_type_id: string; name: string; is_active?: boolean }
      >;
      duration_presets: Table<
        DurationPresetRow,
        { name: string; days: number; credit_cost?: number; is_active?: boolean }
      >;
      keys: Table<
        KeyRow,
        {
          key_value: string;
          tool_type_id: string;
          tool_version_id: string;
          created_by: string;
          status?: KeyStatus;
          duration_days?: number | null;
          expired_at?: string | null;
          max_device?: number;
          note?: string | null;
          last_used?: string | null;
        }
      >;
      device_logs: Table<DeviceLogRow, { key_id: string; hardware_id: string }>;
      credit_logs: Table<
        CreditLogRow,
        {
          user_id: string;
          action: CreditAction;
          amount: number;
          balance_after: number;
          note?: string | null;
          created_by?: string | null;
        }
      >;
      tool_secrets: Table<ToolSecretRow, { tool_type_id: string; secret_payload?: string | null }>;
      validation_attempts: Table<
        ValidationAttemptRow,
        {
          ip: string;
          key_value?: string | null;
          hardware_id?: string | null;
          success: boolean;
          reason?: string | null;
        }
      >;
      audit_logs: Table<
        AuditLogRow,
        {
          actor_id?: string | null;
          actor_username?: string | null;
          actor_role?: AuditActorRole | null;
          action: AuditAction;
          key_id?: string | null;
          key_value: string;
          key_owner_id?: string | null;
          key_owner_username?: string | null;
          ban_reason?: BanReason | null;
          note?: string | null;
          detail?: Record<string, unknown> | null;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      register_device: {
        Args: { p_key_id: string; p_hwid: string };
        Returns: { result: string; current_devices: number }[];
      };
      update_expired_keys: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      cleanup_validation_attempts: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      check_auto_ban: {
        Args: {
          p_key_id: string;
          p_hwid: string;
          p_ip: string;
          p_distinct_limit: number;
          p_window_minutes: number;
          p_note: string;
        };
        Returns: { result: string; distinct_hwids?: number }[];
      };
      is_owner: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      key_device_counts: {
        Args: { p_key_ids: string[] };
        Returns: { key_id: string; device_count: number }[];
      };
      key_counts_by_version: {
        Args: Record<string, never>;
        Returns: {
          tool_type_id: string;
          tool_version_id: string;
          total_keys: number;
          active_keys: number;
        }[];
      };
      spend_credit: {
        Args: { p_user_id: string; p_amount: number };
        Returns: { success: boolean; balance: number; message: string }[];
      };
      add_credit: {
        Args: { p_user_id: string; p_amount: number };
        Returns: { success: boolean; balance: number }[];
      };
      reseller_summary: {
        Args: Record<string, never>;
        Returns: {
          user_id: string;
          username: string;
          email: string;
          credit: number;
          is_active: boolean;
          key_count: number;
          created_at: string;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

/** Data key yang sudah di-join dengan tool type, version, dan pemiliknya. */
export interface KeyWithRelations extends KeyRow {
  tool_types: Pick<ToolTypeRow, "id" | "name" | "slug" | "is_active"> | null;
  tool_versions: Pick<ToolVersionRow, "id" | "name" | "is_active"> | null;
  profiles: Pick<ProfileRow, "id" | "username" | "email"> | null;
  device_count?: number;
}

/** Baris key list yang sudah dinormalisasi untuk UI. */
export interface KeyListItem {
  id: string;
  key_value: string;
  status: KeyStatus;
  tool_type_id: string;
  tool_name: string;
  tool_slug: string;
  tool_version_id: string;
  version_name: string;
  duration_days: number | null;
  expired_at: string | null;
  max_device: number;
  devices_used: number;
  /** Credit yang dipakai untuk key ini — dikembalikan kalau Owner menghapus key aktif yang belum expired. */
  credit_cost: number;
  note: string | null;
  last_used: string | null;
  /** Alasan ban terstruktur (null kalau tidak sedang banned) — untuk badge & aturan unban. */
  ban_reason: BanReason | null;
  ban_note: string | null;
  banned_by: string | null;
  banned_at: string | null;
  created_at: string;
  created_by: string;
  created_by_username: string | null;
}
