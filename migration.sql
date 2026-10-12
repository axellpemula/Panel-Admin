-- ============================================================================
-- XLOOP PANEL — migration.sql
-- Jalankan seluruh file ini di Supabase → SQL Editor → New query → Run.
-- Aman dijalankan ulang (idempotent): semua object dibuat dengan IF NOT EXISTS,
-- policy/fungsi di-drop & dibuat ulang.
--
-- Isi file ini:
--   1. Ekstensi & tabel
--   2. Index
--   3. Fungsi (register_device, spend_credit, add_credit, update_expired_keys, dst)
--   4. Trigger updated_at
--   5. Row Level Security + policies
--   6. GRANT untuk service_role (dipakai API routes)
-- ============================================================================

-- ============================================================================
-- 1. EKSTENSI & TABEL
-- ============================================================================

-- gen_random_uuid() dan crypt() (untuk seed password owner)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles (extend auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  role TEXT CHECK (role IN ('owner', 'reseller')) NOT NULL,
  credit INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Tool Types
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Tool Versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_type_id UUID REFERENCES tool_types(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tool_type_id, name)
);

-- ---------------------------------------------------------------------------
-- Duration Presets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS duration_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  days INTEGER NOT NULL,
  credit_cost INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Keys
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_value TEXT UNIQUE NOT NULL,
  tool_type_id UUID REFERENCES tool_types(id) NOT NULL,
  tool_version_id UUID REFERENCES tool_versions(id) NOT NULL,
  created_by UUID REFERENCES profiles(id) NOT NULL,
  status TEXT CHECK (status IN ('active', 'expired', 'banned')) DEFAULT 'active',
  duration_days INTEGER,
  expired_at TIMESTAMPTZ,
  max_device INTEGER DEFAULT 1,
  -- Berapa credit yang benar-benar dipakai untuk key ini (generate + perpanjang).
  -- Dipakai untuk mengembalikan credit saat Owner menghapus key reseller yang
  -- masih aktif & belum expired.
  credit_cost INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  last_used TIMESTAMPTZ,
  -- Metadata ban (audit): alasan terstruktur + siapa yang ban.
  -- Diisi saat ban, dikosongkan saat unban. `auto_hwid` = auto-ban sistem.
  ban_reason TEXT CHECK (ban_reason IN ('manual', 'auto_hwid', 'refund', 'other')),
  ban_note TEXT,
  banned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  banned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kolom metadata ban untuk database yang dibuat sebelum fitur audit log ada.
-- Idempotent: aman dijalankan berulang.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'keys' AND column_name = 'ban_reason'
  ) THEN
    ALTER TABLE keys ADD COLUMN ban_reason TEXT
      CHECK (ban_reason IN ('manual', 'auto_hwid', 'refund', 'other'));
    ALTER TABLE keys ADD COLUMN ban_note TEXT;
    ALTER TABLE keys ADD COLUMN banned_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
    ALTER TABLE keys ADD COLUMN banned_at TIMESTAMPTZ;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Device HWID Logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id UUID REFERENCES keys(id) ON DELETE CASCADE NOT NULL,
  hardware_id TEXT NOT NULL,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (key_id, hardware_id)
);

-- ---------------------------------------------------------------------------
-- Credit Logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) NOT NULL,
  action TEXT CHECK (action IN ('topup', 'generate', 'extend')) NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  note TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Untuk database yang dibuat sebelum aksi 'extend' (perpanjang key), 'refund'
-- (pengembalian credit), dan 'adjustment' (penyesuaian saldo oleh Owner) ada.
-- Idempotent: aman dijalankan berulang.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_logs_action_check'
      AND conrelid = 'credit_logs'::regclass
      AND (
        pg_get_constraintdef(oid) NOT LIKE '%extend%'
        OR pg_get_constraintdef(oid) NOT LIKE '%refund%'
        OR pg_get_constraintdef(oid) NOT LIKE '%adjustment%'
      )
  ) THEN
    ALTER TABLE credit_logs DROP CONSTRAINT credit_logs_action_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_logs_action_check'
      AND conrelid = 'credit_logs'::regclass
  ) THEN
    ALTER TABLE credit_logs
      ADD CONSTRAINT credit_logs_action_check
      CHECK (action IN ('topup', 'generate', 'extend', 'refund', 'adjustment'));
  END IF;
END $$;

-- Kolom `keys.credit_cost` untuk database yang dibuat sebelum fitur pengembalian ada.
-- Diisi perkiraan dari preset dengan jumlah hari yang sama × max_device (hanya key
-- milik reseller; key Owner memang tidak pernah dipotong credit).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'keys' AND column_name = 'credit_cost'
  ) THEN
    ALTER TABLE keys ADD COLUMN credit_cost INTEGER NOT NULL DEFAULT 0;

    -- Perkiraan untuk data lama (key baru selalu mencatat angka persisnya):
    -- preset dengan hari sama → preset ≥ terdekat → preset terpanjang, lalu × max_device.
    UPDATE keys
    SET credit_cost = COALESCE(max_device, 1) * COALESCE(
      (SELECT dp.credit_cost FROM duration_presets dp WHERE dp.days = keys.duration_days LIMIT 1),
      (SELECT dp.credit_cost FROM duration_presets dp WHERE dp.days >= keys.duration_days ORDER BY dp.days ASC LIMIT 1),
      (SELECT dp.credit_cost FROM duration_presets dp ORDER BY dp.days DESC LIMIT 1),
      0
    )
    WHERE created_by IN (SELECT id FROM profiles WHERE role = 'reseller')
      AND duration_days IS NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Secret payload per tool (RLS aktif tanpa policy = hanya bisa diakses service role)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_secrets (
  tool_type_id UUID PRIMARY KEY REFERENCES tool_types(id) ON DELETE CASCADE,
  secret_payload TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE tool_secrets ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Log percobaan validasi (RLS aktif tanpa policy = hanya service role)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS validation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip TEXT NOT NULL,
  key_value TEXT,
  hardware_id TEXT,
  success BOOLEAN NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE validation_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_validation_ip_time ON validation_attempts (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validation_key_time ON validation_attempts (key_value, created_at DESC);
-- Tambahan untuk fitur auto-ban (5 HWID berbeda dalam 1 jam):
CREATE INDEX IF NOT EXISTS idx_validation_reason_time
  ON validation_attempts (key_value, reason, created_at DESC);

-- ---------------------------------------------------------------------------
-- Audit Logs (jejak aksi Owner/Reseller/sistem: ban, unban, hapus key,
-- reset HWID, auto-ban)
--
-- Desain: append-only, semua identitas di-denormalisasi (username) supaya jejak
-- tetap terbaca walau akun pelaku/pemilik atau key-nya sudah dihapus
-- (ON DELETE SET NULL pada key_id/actor_id/key_owner_id/banned_by).
-- Diisi/di matures lewat service role (API route) — seperti credit_logs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_username TEXT,
  actor_role TEXT CHECK (actor_role IN ('owner', 'reseller', 'system')),
  action TEXT NOT NULL CHECK (
    action IN ('key_ban', 'key_unban', 'key_delete', 'hwid_reset', 'hwid_reset_all', 'key_auto_ban')
  ),
  key_id UUID REFERENCES keys(id) ON DELETE SET NULL,
  key_value TEXT NOT NULL,
  key_owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  key_owner_username TEXT,
  ban_reason TEXT CHECK (ban_reason IN ('manual', 'auto_hwid', 'refund', 'other')),
  note TEXT,
  detail JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_key ON audit_logs (key_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_key_value ON audit_logs (key_value);
-- Dipakai query cooldown reset HWID (hitung aksi hwid_reset/hwid_reset_all per key
-- dalam window 24 jam terakhir).
CREATE INDEX IF NOT EXISTS idx_audit_logs_key_action_time
  ON audit_logs (key_id, action, created_at DESC);

-- ---------------------------------------------------------------------------
-- Login Logs (riwayat login per akun — tampil di menu Pengaturan)
--
-- Dicatat oleh /api/auth/login untuk percobaan SUKSES maupun GAGAL.
-- user_id NULL kalau email tidak dikenal; email tetap disimpan supaya Owner bisa
-- melihat percobaan ke akun yang tidak ada. Append-only, ditulis lewat service role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  email TEXT,
  success BOOLEAN NOT NULL,
  reason TEXT,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_logs_user_time ON login_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_logs_created_at ON login_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- App Settings (konfigurasi runtime yang diatur Owner dari menu Pengaturan)
--
-- Satu baris per dokumen:
--   'runtime'  → override limit/analitik/API/notifikasi (JSON),
--   'telegram' → kredensial bot Telegram (JSON, RAHASIA — tidak pernah dikirim
--                kembali ke browser, hanya statusnya).
--
-- RLS aktif tanpa policy: hanya service_role (API route) yang bisa membaca/menulis.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- API key reseller (akses mesin ke /api/v1 — lihat docs/RESELLER_API.md)
--
-- Token asli HANYA ditampilkan sekali saat dibuat. Yang disimpan:
--   token_prefix → 12 karakter pertama (untuk ditampilkan di panel),
--   token_hash   → sha256(token) — cukup dibandingkan konstanta-waktu.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reseller_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ,
  requests_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reseller_api_keys_user ON reseller_api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_reseller_api_keys_hash ON reseller_api_keys (token_hash);
ALTER TABLE reseller_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages api keys" ON reseller_api_keys;
CREATE POLICY "Owner manages api keys" ON reseller_api_keys FOR ALL USING (is_owner());

DROP POLICY IF EXISTS "Reseller sees own api keys" ON reseller_api_keys;
CREATE POLICY "Reseller sees own api keys" ON reseller_api_keys
  FOR SELECT USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Log request /api/v1 — dipakai untuk rate limit per token (query, bukan
-- in-memory, supaya aman di serverless) + statistik pemakaian API.
-- Dibersihkan cron (retensi diatur di Pengaturan).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES reseller_api_keys(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  method TEXT,
  path TEXT,
  status INTEGER,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_key_time
  ON api_request_logs (api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at
  ON api_request_logs (created_at DESC);
ALTER TABLE api_request_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Telegram: tautan akun panel ⇄ chat Telegram (bot dua arah + notifikasi)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_links (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  chat_id TEXT UNIQUE NOT NULL,
  username TEXT,
  linked_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE telegram_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own telegram link" ON telegram_links;
CREATE POLICY "Users see own telegram link" ON telegram_links
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner sees all telegram links" ON telegram_links;
CREATE POLICY "Owner sees all telegram links" ON telegram_links FOR SELECT USING (is_owner());

-- Kode sekali pakai untuk menautkan chat (`/start <kode>`).
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code TEXT PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user ON telegram_link_codes (user_id);
ALTER TABLE telegram_link_codes ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Notification logs (outbox) — jejak notifikasi keluar (Telegram/webhook) +
-- dasar anti-spam (dedupe_key: satu notifikasi per kejadian per window).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  event TEXT NOT NULL,
  dedupe_key TEXT,
  target TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  summary TEXT,
  detail JSONB
);
CREATE INDEX IF NOT EXISTS idx_notification_logs_dedupe
  ON notification_logs (dedupe_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at
  ON notification_logs (created_at DESC);
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Activity logs — aktivitas akun & sistem yang BUKAN aksi pada key
-- (ganti password, putus sesi, API key dibuat/dicabut, pengaturan diubah,
-- Telegram ditautkan, dsb). Pelengkap audit_logs; sama-sama hanya untuk Owner.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_username TEXT,
  actor_role TEXT CHECK (actor_role IN ('owner', 'reseller', 'system')),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  target_label TEXT,
  detail JSONB
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs (action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor ON activity_logs (actor_id);
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner sees all activity logs" ON activity_logs;
CREATE POLICY "Owner sees all activity logs" ON activity_logs FOR ALL USING (is_owner());

-- ============================================================================
-- 2. INDEX PERFORMA
-- ============================================================================
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
CREATE INDEX IF NOT EXISTS idx_tool_versions_tool_type ON tool_versions (tool_type_id);
-- Dipakai query cooldown reset HWID (hitung aksi hwid_reset/hwid_reset_all per key
-- dalam window 24 jam terakhir — lihat lib/api/hwid-reset.ts).
CREATE INDEX IF NOT EXISTS idx_audit_logs_key_action_time
  ON audit_logs (key_id, action, created_at DESC);

-- ============================================================================
-- 3. FUNGSI
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Daftarkan device secara atomic (lock baris key supaya slot tidak bisa
-- direbut dua request paralel).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION register_device(p_key_id UUID, p_hwid TEXT)
RETURNS TABLE(result TEXT, current_devices INTEGER) AS $$
DECLARE
  v_max INTEGER;
  v_count INTEGER;
BEGIN
  SELECT max_device INTO v_max FROM keys WHERE id = p_key_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM device_logs WHERE key_id = p_key_id AND hardware_id = p_hwid) THEN
    UPDATE device_logs SET last_seen = NOW() WHERE key_id = p_key_id AND hardware_id = p_hwid;
    SELECT COUNT(*) INTO v_count FROM device_logs WHERE key_id = p_key_id;
    RETURN QUERY SELECT 'ok'::TEXT, v_count;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_count FROM device_logs WHERE key_id = p_key_id;

  IF v_count >= COALESCE(v_max, 1) THEN
    RETURN QUERY SELECT 'limit'::TEXT, v_count;
    RETURN;
  END IF;

  INSERT INTO device_logs (key_id, hardware_id) VALUES (p_key_id, p_hwid);
  RETURN QUERY SELECT 'ok'::TEXT, v_count + 1;
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION register_device(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION register_device(UUID, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Cleanup log validasi lama
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_validation_attempts()
RETURNS void AS $$
BEGIN
  DELETE FROM validation_attempts WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION cleanup_validation_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_validation_attempts() TO service_role;

-- ---------------------------------------------------------------------------
-- Helper: cek owner tanpa rekursi RLS di tabel profiles
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_owner()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner');
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- ---------------------------------------------------------------------------
-- Function: auto update expired keys
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_expired_keys()
RETURNS void AS $$
BEGIN
  UPDATE keys
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'active'
    AND expired_at IS NOT NULL
    AND expired_at < NOW();
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION update_expired_keys() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION update_expired_keys() TO service_role;

-- ---------------------------------------------------------------------------
-- Potong credit secara atomic (dipakai saat Reseller generate key).
-- Return satu baris: success + saldo terbaru.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION spend_credit(p_user_id UUID, p_amount INTEGER)
RETURNS TABLE(success BOOLEAN, balance INTEGER, message TEXT) AS $$
DECLARE
  v_new INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SELECT credit INTO v_new FROM profiles WHERE id = p_user_id;
    RETURN QUERY SELECT true, COALESCE(v_new, 0), 'noop'::TEXT;
    RETURN;
  END IF;

  UPDATE profiles
  SET credit = credit - p_amount, updated_at = NOW()
  WHERE id = p_user_id AND credit >= p_amount
  RETURNING credit INTO v_new;

  IF v_new IS NULL THEN
    SELECT credit INTO v_new FROM profiles WHERE id = p_user_id;
    RETURN QUERY SELECT false, COALESCE(v_new, 0), 'insufficient_credit'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_new, 'ok'::TEXT;
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION spend_credit(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION spend_credit(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Tambah credit secara atomic (topup oleh Owner).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_credit(p_user_id UUID, p_amount INTEGER)
RETURNS TABLE(success BOOLEAN, balance INTEGER) AS $$
DECLARE
  v_new INTEGER;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SELECT credit INTO v_new FROM profiles WHERE id = p_user_id;
    RETURN QUERY SELECT true, COALESCE(v_new, 0);
    RETURN;
  END IF;

  UPDATE profiles
  SET credit = credit + p_amount, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credit INTO v_new;

  IF v_new IS NULL THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_new;
END;
$$ LANGUAGE plpgsql;
REVOKE EXECUTE ON FUNCTION add_credit(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION add_credit(UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Jumlah device terpakai untuk sekumpulan key (1 query untuk 1 halaman tabel).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION key_device_counts(p_key_ids UUID[])
RETURNS TABLE(key_id UUID, device_count INTEGER) AS $$
  SELECT dl.key_id, COUNT(*)::INTEGER
  FROM device_logs dl
  WHERE dl.key_id = ANY(p_key_ids)
  GROUP BY dl.key_id;
$$ LANGUAGE sql STABLE;
REVOKE EXECUTE ON FUNCTION key_device_counts(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION key_device_counts(UUID[]) TO service_role;

-- ---------------------------------------------------------------------------
-- Auto-ban key kalau terdeteksi terlalu banyak HWID berbeda dalam window waktu
-- (device_limit_exceeded dari register_device). Dipanggil dari dalam transaksi
-- register_device supaya memegang advisory lock per key — burst paralel dari
-- banyak HWID berbeda tidak bisa melewati pemeriksaan (race condition).
--
-- Mengembalikan:
--   'banned'   → key baru saja di-auto-ban oleh panggilan ini,
--   'already'  → key sudah dibanned (panggilan sebelumnya yang ke-lock duluan),
--   'ok'       → belum mencapai ambang ban.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_auto_ban(p_key_id UUID, p_hwid TEXT, p_ip TEXT, p_distinct_limit INTEGER, p_window_minutes INTEGER, p_note TEXT)
RETURNS TEXT AS $$
DECLARE
  v_key_value     TEXT;
  v_created_by    UUID;
  v_distinct      INTEGER;
  v_already_banned BOOLEAN;
BEGIN
  -- Ambil metadata key untuk audit log (harus ada).
  SELECT key_value, created_by INTO v_key_value, v_created_by
    FROM keys WHERE id = p_key_id;
  IF NOT FOUND THEN RETURN 'ok'; END IF;

  -- Advisory lock per key — transaksi lain untuk key yang sama akan menunggu.
  -- Kunci ini otomatis dilepas saat transaksi berakhir.
  PERFORM pg_advisory_xact_lock(hashtext('xloop:auto_ban:' || p_key_id::TEXT));

  -- Double-check: kalau transaksi sebelumnya sudah membanned key ini, lewati.
  SELECT EXISTS (
    SELECT 1 FROM keys WHERE id = p_key_id AND status = 'banned'
  ) INTO v_already_banned;
  IF v_already_banned THEN RETURN 'already'; END IF;

  -- Hitung HWID UNIK yang sudah mencoba (tercatat) dalam window ditambah
  -- HWID saat ini (p_hwid) — request SEKARANG sudah tercatat di
  -- validation_attempts sebelum fungsi ini dipanggil.
  SELECT COUNT(DISTINCT hardware_id) INTO v_distinct
    FROM validation_attempts
    WHERE key_value = v_key_value
      AND reason = 'device_limit_exceeded'
      AND hardware_id IS NOT NULL
      AND created_at >= NOW() - (p_window_minutes || ' minutes')::INTERVAL;

  IF v_distinct < p_distinct_limit THEN RETURN 'ok'; END IF;

  -- Ban key (hanya kalau belum banned — double-checked di atas).
  UPDATE keys
    SET status = 'banned',
        ban_reason = 'auto_hwid',
        ban_note = p_note,
        banned_at = NOW(),
        banned_by = NULL
    WHERE id = p_key_id AND status <> 'banned';

  -- Catat audit log (denormalisasi, sama seperti versi Node.js).
  INSERT INTO audit_logs (
    created_at, actor_id, actor_username, actor_role, action,
    key_id, key_value, key_owner_id, key_owner_username,
    ban_reason, note, detail
  ) VALUES (
    NOW(), NULL, NULL, 'system', 'key_auto_ban',
    p_key_id, v_key_value, v_created_by,
    (SELECT username FROM profiles WHERE id = v_created_by),
    'auto_hwid', p_note,
    jsonb_build_object(
      'source_ip', p_ip,
      'trigger_hwid', p_hwid,
      'distinct_hwids', v_distinct,
      'window_minutes', p_window_minutes
    )
  );

  RETURN 'banned';
END;
$$ LANGUAGE plpgsql VOLATILE;
REVOKE EXECUTE ON FUNCTION check_auto_ban(UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_auto_ban(UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Jumlah key per version (dipakai halaman Tool Management).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION key_counts_by_version()
RETURNS TABLE(
  tool_type_id UUID,
  tool_version_id UUID,
  total_keys BIGINT,
  active_keys BIGINT
) AS $$
  SELECT k.tool_type_id,
         k.tool_version_id,
         COUNT(*)::BIGINT,
         COUNT(*) FILTER (WHERE k.status = 'active')::BIGINT
  FROM keys k
  GROUP BY k.tool_type_id, k.tool_version_id;
$$ LANGUAGE sql STABLE;
REVOKE EXECUTE ON FUNCTION key_counts_by_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION key_counts_by_version() TO service_role;

-- ---------------------------------------------------------------------------
-- Ringkasan reseller + jumlah key (dipakai halaman Reseller & Top Reseller).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reseller_summary()
RETURNS TABLE(
  user_id UUID,
  username TEXT,
  email TEXT,
  credit INTEGER,
  is_active BOOLEAN,
  key_count BIGINT,
  created_at TIMESTAMPTZ
) AS $$
  SELECT p.id,
         p.username,
         p.email,
         p.credit,
         p.is_active,
         COUNT(k.id)::BIGINT,
         p.created_at
  FROM profiles p
  LEFT JOIN keys k ON k.created_by = p.id
  WHERE p.role = 'reseller'
  GROUP BY p.id;
$$ LANGUAGE sql STABLE;
REVOKE EXECUTE ON FUNCTION reseller_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reseller_summary() TO service_role;

-- ============================================================================
-- 4. TRIGGER updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS keys_updated_at ON keys;
CREATE TRIGGER keys_updated_at BEFORE UPDATE ON keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tool_types_updated_at ON tool_types;
CREATE TRIGGER tool_types_updated_at BEFORE UPDATE ON tool_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tool_versions_updated_at ON tool_versions;
CREATE TRIGGER tool_versions_updated_at BEFORE UPDATE ON tool_versions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS duration_presets_updated_at ON duration_presets;
CREATE TRIGGER duration_presets_updated_at BEFORE UPDATE ON duration_presets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS tool_secrets_updated_at ON tool_secrets;
CREATE TRIGGER tool_secrets_updated_at BEFORE UPDATE ON tool_secrets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE duration_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_logs ENABLE ROW LEVEL SECURITY;

-- --- Profiles ---------------------------------------------------------------
DROP POLICY IF EXISTS "Users see own profile" ON profiles;
CREATE POLICY "Users see own profile" ON profiles FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Owner sees all profiles" ON profiles;
CREATE POLICY "Owner sees all profiles" ON profiles FOR SELECT USING (is_owner());

DROP POLICY IF EXISTS "Owner manages profiles" ON profiles;
CREATE POLICY "Owner manages profiles" ON profiles FOR ALL USING (is_owner());

-- --- Tool Types -------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read tool types" ON tool_types;
CREATE POLICY "Anyone can read tool types" ON tool_types FOR SELECT USING (true);

DROP POLICY IF EXISTS "Owner manages tool types" ON tool_types;
CREATE POLICY "Owner manages tool types" ON tool_types FOR ALL USING (is_owner());

-- --- Tool Versions ----------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read tool versions" ON tool_versions;
CREATE POLICY "Anyone can read tool versions" ON tool_versions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Owner manages tool versions" ON tool_versions;
CREATE POLICY "Owner manages tool versions" ON tool_versions FOR ALL USING (is_owner());

-- --- Duration Presets -------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read duration presets" ON duration_presets;
CREATE POLICY "Anyone can read duration presets" ON duration_presets FOR SELECT USING (true);

DROP POLICY IF EXISTS "Owner manages duration presets" ON duration_presets;
CREATE POLICY "Owner manages duration presets" ON duration_presets FOR ALL USING (is_owner());

-- --- Keys -------------------------------------------------------------------
-- Owner lihat & kelola semua key.
DROP POLICY IF EXISTS "Owner sees all keys" ON keys;
CREATE POLICY "Owner sees all keys" ON keys FOR ALL USING (is_owner());

-- Reseller hanya bisa SELECT key milik sendiri.
-- Semua INSERT/UPDATE/DELETE key oleh Reseller HARUS lewat API route (service role)
-- setelah cek role, kepemilikan, dan credit. Reseller tidak boleh menulis langsung
-- ke tabel keys lewat Supabase client karena bisa mengubah expired_at/status atau
-- membuat key tanpa bayar credit.
DROP POLICY IF EXISTS "Reseller sees own keys" ON keys;
CREATE POLICY "Reseller sees own keys" ON keys FOR SELECT USING (created_by = auth.uid());

-- --- Device Logs ------------------------------------------------------------
DROP POLICY IF EXISTS "Owner sees all device logs" ON device_logs;
CREATE POLICY "Owner sees all device logs" ON device_logs FOR ALL USING (is_owner());

DROP POLICY IF EXISTS "Reseller sees own device logs" ON device_logs;
CREATE POLICY "Reseller sees own device logs" ON device_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM keys WHERE keys.id = device_logs.key_id AND keys.created_by = auth.uid())
);
-- Reset HWID oleh Reseller juga lewat API route (service role), bukan policy DELETE langsung.

-- --- Credit Logs ------------------------------------------------------------
DROP POLICY IF EXISTS "Owner sees all credit logs" ON credit_logs;
CREATE POLICY "Owner sees all credit logs" ON credit_logs FOR ALL USING (is_owner());

DROP POLICY IF EXISTS "Reseller sees own credit logs" ON credit_logs;
CREATE POLICY "Reseller sees own credit logs" ON credit_logs FOR SELECT USING (user_id = auth.uid());

-- --- Audit Logs -------------------------------------------------------------
-- Audit log adalah alat Owner untuk cek jejak saat ada sengketa dengan reseller,
-- jadi hanya Owner yang bisa membacanya. Reseller tidak diberi policy (RLS aktif
-- tanpa policy untuk role tersebut = tidak bisa baca). Semua penulisan lewat
-- service role (API route) setelah cek session + role + kepemilikan.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner sees all audit logs" ON audit_logs;
CREATE POLICY "Owner sees all audit logs" ON audit_logs FOR ALL USING (is_owner());

-- --- Login Logs -------------------------------------------------------------
-- User boleh membaca riwayat loginnya sendiri; Owner semua. Penulisan hanya
-- lewat service role (tidak ada policy INSERT untuk authenticated).
ALTER TABLE login_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own login logs" ON login_logs;
CREATE POLICY "Users see own login logs" ON login_logs FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owner sees all login logs" ON login_logs;
CREATE POLICY "Owner sees all login logs" ON login_logs FOR SELECT USING (is_owner());

-- ============================================================================
-- 6. GRANT
-- RLS tetap yang menentukan baris mana yang boleh dibaca/ditulis.
-- Semua operasi tulis panel memakai service_role (bypass RLS) lewat API route.
-- ============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON profiles, tool_types, tool_versions, duration_presets, keys, device_logs, credit_logs
  TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Pastikan tabel baru di schema public otomatis mendapat grant yang sama.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;

-- tool_secrets & validation_attempts sengaja TIDAK diberi policy:
-- hanya service_role (API routes) yang bisa mengaksesnya.
