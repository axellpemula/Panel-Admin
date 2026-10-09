/**
 * Implementasi SQLite untuk semua RPC yang di `migration.sql` dibuat sebagai
 * function Postgres. Semantiknya sengaja dibuat identik — termasuk nilai balik
 * (array of rows, seperti PostgREST `setof`) dan atomisitasnya (transaksi).
 */

import type { SqliteDatabase } from "@/lib/db/sqlite/driver";

export interface RpcError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export interface RpcResult {
  data: Record<string, unknown>[] | null;
  error: RpcError | null;
  count: number | null;
  status: number;
  statusText: string;
}

type Args = Record<string, unknown>;

const ok = (data: Record<string, unknown>[]): RpcResult => ({
  data,
  error: null,
  count: null,
  status: 200,
  statusText: "OK",
});

const fail = (message: string, code = "P0001"): RpcResult => ({
  data: null,
  error: { message, code, details: null, hint: null },
  count: null,
  status: 400,
  statusText: "Bad Request",
});

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** register_device(p_key_id, p_hwid) — atomic, seperti versi plpgsql-nya. */
export function registerDevice(db: SqliteDatabase, args: Args): RpcResult {
  const keyId = asString(args.p_key_id);
  const hwid = asString(args.p_hwid);
  if (!keyId || !hwid) return fail("p_key_id dan p_hwid wajib diisi");

  const run = db.transaction((): Record<string, unknown>[] => {
    const key = db.prepare("SELECT max_device FROM keys WHERE id = ?").get(keyId) as
      | { max_device: number | null }
      | undefined;
    const maxDevice = Math.max(1, asNumber(key?.max_device, 1));

    const existing = db
      .prepare("SELECT id FROM device_logs WHERE key_id = ? AND hardware_id = ?")
      .get(keyId, hwid) as { id: string } | undefined;

    if (existing) {
      db.prepare("UPDATE device_logs SET last_seen = ? WHERE id = ?").run(
        new Date().toISOString(),
        existing.id,
      );
      const row = db
        .prepare("SELECT COUNT(*) AS total FROM device_logs WHERE key_id = ?")
        .get(keyId) as { total: number };
      return [{ result: "ok", current_devices: asNumber(row?.total) }];
    }

    const counted = db
      .prepare("SELECT COUNT(*) AS total FROM device_logs WHERE key_id = ?")
      .get(keyId) as { total: number };
    const current = asNumber(counted?.total);

    if (current >= maxDevice) return [{ result: "limit", current_devices: current }];

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO device_logs (id, key_id, hardware_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)",
    ).run(crypto.randomUUID(), keyId, hwid, now, now);

    return [{ result: "ok", current_devices: current + 1 }];
  });

  return ok(run());
}

/** update_expired_keys() — sinkronkan status key yang sudah lewat tanggal. */
export function updateExpiredKeys(db: SqliteDatabase): RpcResult {
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE keys SET status = 'expired', updated_at = ? " +
      "WHERE status = 'active' AND expired_at IS NOT NULL AND expired_at < ?",
  ).run(now, now);
  return ok([]);
}

/** cleanup_validation_attempts() — hapus log validasi lebih dari 7 hari. */
export function cleanupValidationAttempts(db: SqliteDatabase): RpcResult {
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  db.prepare("DELETE FROM validation_attempts WHERE created_at < ?").run(cutoff);
  return ok([]);
}

/** spend_credit(p_user_id, p_amount) → [{ success, balance, message }]. */
export function spendCredit(db: SqliteDatabase, args: Args): RpcResult {
  const userId = asString(args.p_user_id);
  const amount = asNumber(args.p_amount);
  if (!userId) return fail("p_user_id wajib diisi");

  const run = db.transaction((): Record<string, unknown>[] => {
    if (amount <= 0) {
      const row = db.prepare("SELECT credit FROM profiles WHERE id = ?").get(userId) as
        | { credit: number }
        | undefined;
      return [{ success: true, balance: asNumber(row?.credit), message: "noop" }];
    }

    const updated = db
      .prepare(
        "UPDATE profiles SET credit = credit - ?, updated_at = ? " +
          "WHERE id = ? AND credit >= ? RETURNING credit",
      )
      .get(amount, new Date().toISOString(), userId, amount) as { credit: number } | undefined;

    if (!updated) {
      const row = db.prepare("SELECT credit FROM profiles WHERE id = ?").get(userId) as
        | { credit: number }
        | undefined;
      return [
        { success: false, balance: asNumber(row?.credit), message: "insufficient_credit" },
      ];
    }

    return [{ success: true, balance: asNumber(updated.credit), message: "ok" }];
  });

  return ok(run());
}

/** add_credit(p_user_id, p_amount) → [{ success, balance }]. */
export function addCredit(db: SqliteDatabase, args: Args): RpcResult {
  const userId = asString(args.p_user_id);
  const amount = asNumber(args.p_amount);
  if (!userId) return fail("p_user_id wajib diisi");

  const run = db.transaction((): Record<string, unknown>[] => {
    if (amount <= 0) {
      const row = db.prepare("SELECT credit FROM profiles WHERE id = ?").get(userId) as
        | { credit: number }
        | undefined;
      return [{ success: true, balance: asNumber(row?.credit) }];
    }

    const updated = db
      .prepare(
        "UPDATE profiles SET credit = credit + ?, updated_at = ? WHERE id = ? RETURNING credit",
      )
      .get(amount, new Date().toISOString(), userId) as { credit: number } | undefined;

    if (!updated) return [{ success: false, balance: 0 }];
    return [{ success: true, balance: asNumber(updated.credit) }];
  });

  return ok(run());
}

/** key_device_counts(p_key_ids) → [{ key_id, device_count }]. */
export function keyDeviceCounts(db: SqliteDatabase, args: Args): RpcResult {
  const ids = Array.isArray(args.p_key_ids) ? args.p_key_ids.map(asString).filter(Boolean) : [];
  if (ids.length === 0) return ok([]);

  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT key_id, COUNT(*) AS device_count FROM device_logs WHERE key_id IN (${placeholders}) GROUP BY key_id`,
    )
    .all(...ids) as { key_id: string; device_count: number }[];

  return ok(rows.map((row) => ({ key_id: row.key_id, device_count: asNumber(row.device_count) })));
}

/** key_counts_by_version() → [{ tool_type_id, tool_version_id, total_keys, active_keys }]. */
export function keyCountsByVersion(db: SqliteDatabase): RpcResult {
  const rows = db
    .prepare(
      "SELECT tool_type_id, tool_version_id, COUNT(*) AS total_keys, " +
        "SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_keys " +
        "FROM keys GROUP BY tool_type_id, tool_version_id",
    )
    .all() as { tool_type_id: string; tool_version_id: string; total_keys: number; active_keys: number }[];

  return ok(
    rows.map((row) => ({
      tool_type_id: row.tool_type_id,
      tool_version_id: row.tool_version_id,
      total_keys: asNumber(row.total_keys),
      active_keys: asNumber(row.active_keys),
    })),
  );
}

/** reseller_summary() → [{ user_id, username, email, credit, is_active, key_count, created_at }]. */
export function resellerSummary(db: SqliteDatabase): RpcResult {
  const rows = db
    .prepare(
      "SELECT p.id AS user_id, p.username, p.email, p.credit, p.is_active, " +
        "COUNT(k.id) AS key_count, p.created_at " +
        "FROM profiles p LEFT JOIN keys k ON k.created_by = p.id " +
        "WHERE p.role = 'reseller' GROUP BY p.id",
    )
    .all() as {
    user_id: string;
    username: string;
    email: string;
    credit: number;
    is_active: number;
    key_count: number;
    created_at: string;
  }[];

  return ok(
    rows.map((row) => ({
      user_id: row.user_id,
      username: row.username,
      email: row.email,
      credit: asNumber(row.credit),
      is_active: Number(row.is_active) === 1,
      key_count: asNumber(row.key_count),
      created_at: row.created_at,
    })),
  );
}

/** cleanup_auth_sessions() — hapus sesi yang sudah kedaluwarsa dari tabel auth_sessions. */
export function cleanupAuthSessions(db: SqliteDatabase): RpcResult {
  const now = new Date().toISOString();
  const result = db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(now);
  return ok([{ deleted: (result.changes ?? 0) as number }]);
}

/**
 * check_auto_ban() — versi SQLite dari fungsi Postgres yang sama.
 * Karena SQLite adalah single-writer dan RPC ini dijalankan dalam satu eksekusi,
 * race condition burst paralel secara alami diserialkan (tidak perlu advisory lock).
 */
export function checkAutoBan(db: SqliteDatabase, args: Args): RpcResult {
  const keyId = asString(args.p_key_id);
  const hwid = asString(args.p_hwid);
  const ip = asString(args.p_ip);
  const limit = asNumber(args.p_distinct_limit, 5);
  const windowMin = asNumber(args.p_window_minutes, 60);
  const note = (() => {
    const raw = asString(args.p_note).trim();
    return (raw.length > 0 ? raw : "Auto-ban: terlalu banyak device berbeda").slice(0, 500);
  })();

  if (!keyId) return fail("p_key_id wajib diisi");

  const key = db
    .prepare("SELECT id, key_value, created_by, status FROM keys WHERE id = ?")
    .get(keyId) as
    | { id: string; key_value: string; created_by: string; status: string }
    | undefined;
  if (!key) return ok([{ result: "ok" }]);
  if (key.status === "banned") return ok([{ result: "already" }]);

  const cutoff = new Date(Date.now() - windowMin * 60_000).toISOString();
  const distinct = db
    .prepare(
      `SELECT COUNT(DISTINCT hardware_id) AS total FROM validation_attempts
         WHERE key_value = ? AND reason = 'device_limit_exceeded'
           AND hardware_id IS NOT NULL AND created_at >= ?`,
    )
    .get(key.key_value, cutoff) as { total: number } | undefined;
  const count = asNumber(distinct?.total);

  if (count < limit) return ok([{ result: "ok", distinct_hwids: count }]);

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE keys SET status = 'banned', ban_reason = 'auto_hwid', ban_note = ?, banned_by = NULL, banned_at = ?
       WHERE id = ? AND status <> 'banned'`,
  ).run(note, now, keyId);

  const owner = db
    .prepare("SELECT username FROM profiles WHERE id = ?")
    .get(key.created_by) as { username: string } | undefined;

  db.prepare(
    `INSERT INTO audit_logs (id, created_at, actor_id, actor_username, actor_role, action,
       key_id, key_value, key_owner_id, key_owner_username, ban_reason, note, detail)
       VALUES (?, ?, NULL, NULL, 'system', 'key_auto_ban', ?, ?, ?, ?, 'auto_hwid', ?, ?)`,
  ).run(
    crypto.randomUUID(),
    now,
    keyId,
    key.key_value,
    key.created_by,
    owner?.username ?? null,
    note,
    JSON.stringify({
      source_ip: ip || "unknown",
      trigger_hwid: hwid,
      distinct_hwids: count,
      window_minutes: windowMin,
    }),
  );

  return ok([{ result: "banned", distinct_hwids: count }]);
}

/** Peta nama function → implementasi. */
export const RPC_HANDLERS: Record<string, (db: SqliteDatabase, args: Args) => RpcResult> = {
  register_device: registerDevice,
  update_expired_keys: (db) => updateExpiredKeys(db),
  cleanup_validation_attempts: (db) => cleanupValidationAttempts(db),
  cleanup_auth_sessions: (db) => cleanupAuthSessions(db),
  check_auto_ban: checkAutoBan,
  spend_credit: spendCredit,
  add_credit: addCredit,
  key_device_counts: keyDeviceCounts,
  key_counts_by_version: (db) => keyCountsByVersion(db),
  reseller_summary: (db) => resellerSummary(db),
};
