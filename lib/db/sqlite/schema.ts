import type { SqliteDatabase } from "@/lib/db/sqlite/driver";

/**
 * Skema SQLite — cerminan tabel & index dari `migration.sql` (versi Postgres),
 * ditambah dua tabel khusus mode lokal: `auth_accounts` dan `auth_sessions`
 * (di Supabase, keduanya adalah `auth.users` bawaan Supabase Auth).
 *
 * Perbedaan yang disengaja:
 * - UUID      → TEXT
 * - BOOLEAN   → INTEGER 0/1 (dikonversi otomatis oleh adapter)
 * - TIMESTAMPTZ → TEXT ISO-8601 UTC (`new Date().toISOString()`), aman
 *   dibandingkan secara leksikografis untuk filter gte/lte.
 * - RLS/policy tidak ada: mode SQLite selalu "service role" (semua akses lewat
 *   API route panel yang sudah memeriksa sesi + role + kepemilikan data).
 */

/**
 * DDL tabel `credit_logs` disimpan terpisah supaya bisa dipakai ulang oleh
 * migrasi ringan di bawah (SQLite tidak bisa ALTER CHECK constraint).
 */
const CREDIT_LOGS_DDL = `CREATE TABLE IF NOT EXISTS credit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN ('topup', 'generate', 'extend', 'refund', 'adjustment')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note TEXT,
  created_by TEXT REFERENCES profiles(id),
  created_at TEXT NOT NULL
);`;

/** Nilai aksi credit yang sah — dipakai migrasi ringan untuk memeriksa CHECK lama. */
const CREDIT_ACTIONS_SQLITE = ["topup", "generate", "extend", "refund", "adjustment"] as const;

export const SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'reseller')),
  credit INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES profiles(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_versions (
  id TEXT PRIMARY KEY,
  tool_type_id TEXT NOT NULL REFERENCES tool_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tool_type_id, name)
);

CREATE TABLE IF NOT EXISTS duration_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  days INTEGER NOT NULL,
  credit_cost INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keys (
  id TEXT PRIMARY KEY,
  key_value TEXT UNIQUE NOT NULL,
  tool_type_id TEXT NOT NULL REFERENCES tool_types(id),
  tool_version_id TEXT NOT NULL REFERENCES tool_versions(id),
  created_by TEXT NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'banned')),
  duration_days INTEGER,
  expired_at TEXT,
  max_device INTEGER NOT NULL DEFAULT 1,
  credit_cost INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  last_used TEXT,
  -- Metadata ban (audit): alasan terstruktur + siapa yang ban. auto_hwid = auto-ban sistem.
  ban_reason TEXT CHECK (ban_reason IN ('manual', 'auto_hwid', 'refund', 'other')),
  ban_note TEXT,
  banned_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  banned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS device_logs (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL REFERENCES keys(id) ON DELETE CASCADE,
  hardware_id TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  UNIQUE (key_id, hardware_id)
);

${CREDIT_LOGS_DDL}

CREATE TABLE IF NOT EXISTS tool_secrets (
  tool_type_id TEXT PRIMARY KEY REFERENCES tool_types(id) ON DELETE CASCADE,
  secret_payload TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS validation_attempts (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  key_value TEXT,
  hardware_id TEXT,
  success INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

-- Audit log: jejak aksi Owner/Reseller/sistem (ban, unban, hapus key, reset HWID,
-- auto-ban). Identitas di-denormalisasi (username) supaya jejak tetap terbaca
-- walau akun atau key sudah dihapus (ON DELETE SET NULL).
-- Kolom detail di SQLite berupa TEXT (JSON di-serialize adapter); di Postgres JSONB.
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  actor_username TEXT,
  actor_role TEXT CHECK (actor_role IN ('owner', 'reseller', 'system')),
  action TEXT NOT NULL CHECK (
    action IN ('key_ban', 'key_unban', 'key_delete', 'hwid_reset', 'hwid_reset_all', 'key_auto_ban')
  ),
  key_id TEXT REFERENCES keys(id) ON DELETE SET NULL,
  key_value TEXT NOT NULL,
  key_owner_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  key_owner_username TEXT,
  ban_reason TEXT CHECK (ban_reason IN ('manual', 'auto_hwid', 'refund', 'other')),
  note TEXT,
  detail TEXT
);

-- Riwayat login (sukses & gagal) — tampil di menu Pengaturan.
CREATE TABLE IF NOT EXISTS login_logs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  email TEXT,
  success INTEGER NOT NULL,
  reason TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS auth_accounts (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- IP & user-agent dipakai kartu "Sesi aktif" di Pengaturan (mode SQLite).
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Konfigurasi runtime (diatur Owner dari menu Pengaturan). Satu baris per dokumen:
--   'runtime'  → override limit/analitik/API/notifikasi,
--   'telegram' → kredensial bot Telegram (RAHASIA — tidak pernah dikirim ke browser).
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT REFERENCES profiles(id) ON DELETE SET NULL
);

-- API key reseller untuk akses /api/v1 (token asli hanya tampil sekali).
CREATE TABLE IF NOT EXISTS reseller_api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  requests_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Log request /api/v1 (rate limit per token + statistik pemakaian).
CREATE TABLE IF NOT EXISTS api_request_logs (
  id TEXT PRIMARY KEY,
  api_key_id TEXT REFERENCES reseller_api_keys(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  method TEXT,
  path TEXT,
  status INTEGER,
  ip TEXT,
  created_at TEXT NOT NULL
);

-- Tautan akun panel ⇄ chat Telegram.
CREATE TABLE IF NOT EXISTS telegram_links (
  user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  chat_id TEXT UNIQUE NOT NULL,
  username TEXT,
  linked_at TEXT
);

-- Kode sekali pakai untuk menautkan chat (perintah /start <kode>).
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Jejak notifikasi keluar + anti-spam (dedupe per kejadian).
CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  event TEXT NOT NULL,
  dedupe_key TEXT,
  target TEXT NOT NULL,
  success INTEGER NOT NULL,
  summary TEXT,
  detail TEXT
);

-- Aktivitas akun & sistem di luar aksi key (ganti password, API key, pengaturan, dst).
CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  actor_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  actor_username TEXT,
  actor_role TEXT CHECK (actor_role IN ('owner', 'reseller', 'system')),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  target_label TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_validation_ip_time ON validation_attempts (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validation_key_time ON validation_attempts (key_value, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validation_reason_time ON validation_attempts (key_value, reason, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_keys_created_by ON keys (created_by);
CREATE INDEX IF NOT EXISTS idx_keys_status ON keys (status);
CREATE INDEX IF NOT EXISTS idx_keys_tool_type ON keys (tool_type_id);
CREATE INDEX IF NOT EXISTS idx_keys_tool_version ON keys (tool_version_id);
CREATE INDEX IF NOT EXISTS idx_keys_expired_at ON keys (expired_at);
CREATE INDEX IF NOT EXISTS idx_keys_created_at ON keys (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_logs_key_id ON device_logs (key_id);
CREATE INDEX IF NOT EXISTS idx_device_logs_hwid ON device_logs (hardware_id);
CREATE INDEX IF NOT EXISTS idx_credit_logs_user_id ON credit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_credit_logs_created_at ON credit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_key ON audit_logs (key_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_key_value ON audit_logs (key_value);
-- Dipakai query cooldown reset HWID (hitung aksi hwid_reset/hwid_reset_all per key
-- dalam window 24 jam terakhir).
CREATE INDEX IF NOT EXISTS idx_audit_logs_key_action_time
  ON audit_logs (key_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_versions_tool_type ON tool_versions (tool_type_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_login_logs_user_time ON login_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_created_at ON login_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reseller_api_keys_user ON reseller_api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_reseller_api_keys_hash ON reseller_api_keys (token_hash);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_key_time ON api_request_logs (api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at ON api_request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user ON telegram_link_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_dedupe ON notification_logs (dedupe_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs (action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor ON activity_logs (actor_id);
`;

/** Kolom boolean per tabel (INTEGER 0/1 di SQLite, boolean di JS). */
export const BOOLEAN_COLUMNS: Record<string, readonly string[]> = {
  profiles: ["is_active"],
  tool_types: ["is_active"],
  tool_versions: ["is_active"],
  duration_presets: ["is_active"],
  validation_attempts: ["success"],
  login_logs: ["success"],
  reseller_api_keys: ["is_active"],
  notification_logs: ["success"],
};

/**
 * Relasi embedded yang dipakai panel (`select` PostgREST), mis.
 * `tool_types(id,name)`, `profiles!keys_created_by_fkey(username)`.
 * Semua relasi di sini bertipe "to-one" (satu baris atau null).
 */
export interface Relation {
  /** Kolom foreign key di tabel sumber. */
  column: string;
  /** Tabel tujuan. */
  table: string;
}

export const RELATIONS: Record<string, Record<string, Relation>> = {
  keys: {
    tool_types: { column: "tool_type_id", table: "tool_types" },
    tool_versions: { column: "tool_version_id", table: "tool_versions" },
    profiles: { column: "created_by", table: "profiles" },
  },
  credit_logs: {
    profiles: { column: "user_id", table: "profiles" },
    creator: { column: "created_by", table: "profiles" },
  },
};

/** Nama constraint FK Postgres → kolom, untuk select seperti `profiles!credit_logs_user_id_fkey(...)`. */
export const FK_COLUMNS: Record<string, string> = {
  keys_created_by_fkey: "created_by",
  credit_logs_user_id_fkey: "user_id",
  credit_logs_created_by_fkey: "created_by",
};

/** Tabel yang punya kolom `updated_at` (diisi otomatis saat UPDATE). */
export const TABLES_WITH_UPDATED_AT = new Set([
  "profiles",
  "tool_types",
  "tool_versions",
  "duration_presets",
  "keys",
  "tool_secrets",
]);

/**
 * Migrasi ringan untuk database lama (idempotent, aman dijalankan berulang).
 *
 * Dua hal yang ditangani:
 *
 * 1. **Kolom `keys.credit_cost`** — menyimpan berapa credit yang benar-benar dipakai untuk
 *    sebuah key (generate + perpanjang). Dipakai fitur pengembalian credit saat Owner
 *    menghapus key reseller yang masih aktif & belum expired. Database lama belum punya
 *    kolom ini, jadi ditambahkan lewat `ALTER TABLE` lalu diisi perkiraan dari preset
 *    (hari sama → preset ≥ terdekat → preset terpanjang) × max_device. Khusus key milik
 *    reseller; key Owner tetap 0 karena Owner tidak pernah dipotong credit. Key yang dibuat
 *    setelah fitur ini ada selalu menyimpan angka persisnya, jadi perkiraan ini hanya untuk
 *    data lama.
 *
 * 2. **CHECK constraint `credit_logs.action`** — SQLite tidak bisa mengubah CHECK, jadi
 *    tabelnya dibangun ulang (rename → create → copy → drop) kalau ada nilai aksi baru
 *    (`extend`, `refund`, `adjustment`) yang belum ada di definisinya.
 *
 * 3. **Kolom metadata ban di `keys`** (`ban_reason`, `ban_note`, `banned_by`,
 *    `banned_at`) — dipakai fitur audit log & alasan ban terstruktur. Tabel
 *    `audit_logs` sendiri dibuat oleh `SQLITE_SCHEMA_SQL` (CREATE IF NOT EXISTS).
 *
 * 4. **Kolom `auth_sessions.ip` & `auth_sessions.user_agent`** — ditampilkan di
 *    kartu "Sesi aktif" (Pengaturan → Keamanan Akun).
 */
export function migrateSqliteSchema(db: SqliteDatabase): string[] {
  const changes: string[] = [];

  // --- 1. Kolom keys.credit_cost ---
  const keyColumns = db.prepare("PRAGMA table_info(keys)").all() as { name: string }[];
  if (keyColumns.length > 0 && !keyColumns.some((column) => column.name === "credit_cost")) {
    db.transaction(() => {
      db.exec("ALTER TABLE keys ADD COLUMN credit_cost INTEGER NOT NULL DEFAULT 0");
      // Perkiraan untuk data lama (key baru selalu dicatat persis sejak dibuat):
      // 1) preset dengan jumlah hari yang sama persis;
      // 2) kalau tidak ada (durasi custom), preset terdekat di atasnya (paling murah yang ≥);
      // 3) kalau durasinya melebihi semua preset, preset terpanjang.
      // Hasilnya dikali max_device, karena 1 unit harga = 1 device.
      db.exec(`
        UPDATE keys
        SET credit_cost = max_device * COALESCE(
          (SELECT dp.credit_cost FROM duration_presets dp WHERE dp.days = keys.duration_days LIMIT 1),
          (SELECT dp.credit_cost FROM duration_presets dp WHERE dp.days >= keys.duration_days ORDER BY dp.days ASC LIMIT 1),
          (SELECT dp.credit_cost FROM duration_presets dp ORDER BY dp.days DESC LIMIT 1),
          0
        )
        WHERE created_by IN (SELECT id FROM profiles WHERE role = 'reseller')
          AND keys.duration_days IS NOT NULL
      `);
    })();
    changes.push("keys.credit_cost ditambahkan + diisi perkiraan dari preset");
  }

  // --- 2. CHECK constraint credit_logs ---
  const logs = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'credit_logs'")
    .get() as { sql: string } | undefined;

  const needsRebuild =
    Boolean(logs) && CREDIT_ACTIONS_SQLITE.some((action) => !logs!.sql.includes(`'${action}'`));

  if (needsRebuild) {
    const rebuild = CREDIT_LOGS_DDL.replace("IF NOT EXISTS ", "").replace(
      "credit_logs",
      "credit_logs_baru",
    );

    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec("ALTER TABLE credit_logs RENAME TO credit_logs_lama");
        db.exec(rebuild);
        db.exec(
          `INSERT INTO credit_logs_baru (id, user_id, action, amount, balance_after, note, created_by, created_at)
           SELECT id, user_id, action, amount, balance_after, note, created_by, created_at FROM credit_logs_lama`,
        );
        db.exec("DROP TABLE credit_logs_lama");
      })();
    } finally {
      db.pragma("foreign_keys = ON");
    }
    changes.push(`CHECK credit_logs dibangun ulang (aksi: ${CREDIT_ACTIONS_SQLITE.join(", ")})`);
  }

  // --- 3. Kolom metadata ban di keys (audit log) ---
  const banColumns: [string, string][] = [
    ["ban_reason", "TEXT CHECK (ban_reason IN ('manual', 'auto_hwid', 'refund', 'other'))"],
    ["ban_note", "TEXT"],
    ["banned_by", "TEXT REFERENCES profiles(id) ON DELETE SET NULL"],
    ["banned_at", "TEXT"],
  ];
  const existingColumns = new Set(keyColumns.map((column) => column.name));
  const missing = banColumns.filter(([name]) => !existingColumns.has(name));

  if (keyColumns.length > 0 && missing.length > 0) {
    db.transaction(() => {
      missing.forEach(([name, definition]) => {
        db.exec(`ALTER TABLE keys ADD COLUMN ${name} ${definition}`);
      });
    })();
    changes.push(`keys: kolom metadata ban ditambahkan (${missing.map(([name]) => name).join(", ")})`);
  }

  // --- 4. Kolom ip & user_agent di auth_sessions (kartu Sesi Aktif) ---
  const sessionColumns = db.prepare("PRAGMA table_info(auth_sessions)").all() as { name: string }[];
  if (sessionColumns.length > 0) {
    const sessionCols = new Set(sessionColumns.map((column) => column.name));
    const missingSessionCols: string[] = [];
    if (!sessionCols.has("ip")) {
      db.exec("ALTER TABLE auth_sessions ADD COLUMN ip TEXT");
      missingSessionCols.push("ip");
    }
    if (!sessionCols.has("user_agent")) {
      db.exec("ALTER TABLE auth_sessions ADD COLUMN user_agent TEXT");
      missingSessionCols.push("user_agent");
    }
    if (missingSessionCols.length > 0) {
      changes.push(`auth_sessions: kolom ditambahkan (${missingSessionCols.join(", ")})`);
    }
  }

  return changes;
}
