/**
 * Data contoh untuk mode SQLite — isinya sama dengan yang dulu ada di mode demo
 * (2 tool, 5 preset durasi, 3 reseller, 12 key, 15 baris credit log), tapi
 * sekarang disimpan permanen di file SQLite.
 *
 * Seed hanya dijalankan kalau tabel `profiles` masih KOSONG. Jadi:
 * - pertama kali dijalankan → panel langsung terisi data contoh;
 * - setelah kamu hapus/tambah data → seed tidak pernah menimpa lagi.
 * Ingin mulai dari nol? Hapus `data/xloop.sqlite` (atau `npm run db:reset`).
 */

import type { SqliteDatabase, SqliteStatement } from "@/lib/db/sqlite/driver";
import { hashPassword } from "@/lib/db/sqlite/password";

export const OWNER_ID = "00000000-0000-4000-8000-000000000001";

export const RESELLER_IDS = [
  "d1111111-0000-4000-8000-000000000001",
  "d2222222-0000-4000-8000-000000000002",
  "d3333333-0000-4000-8000-000000000003",
] as const;

/** Kredensial akun bawaan mode SQLite (dokumentasi: README bagian 13). */
export const SEED_ACCOUNTS = {
  owner: { email: "owner@gmail.com", password: "Axell123" },
  reseller: { password: "Reseller123" },
} as const;

const TOOL_A = "a1111111-0000-4000-8000-000000000001";
const TOOL_B = "a2222222-0000-4000-8000-000000000002";
const VER_A1 = "c1111111-0000-4000-8000-000000000001";
const VER_A2 = "c1111111-0000-4000-8000-000000000002";
const VER_B1 = "c2222222-0000-4000-8000-000000000003";

const [RESELLER_1, RESELLER_2, RESELLER_3] = RESELLER_IDS;

/** ISO string untuk "N hari lalu (negatif = ke depan), jam WIB". */
function iso(daysAgo: number, hour = 9): string {
  const base = new Date(Date.now() - daysAgo * 86_400_000);
  // WIB = UTC+7, jadi jam 09:00 WIB = 02:00 UTC.
  // Entri "hari ini" tidak boleh jatuh di masa depan: kalau jam contohnya belum
  // lewat, pakai jam sekarang (jam WIB saat seed dijalankan).
  const nowHourWib = (base.getUTCHours() + 7) % 24;
  const targetHour = daysAgo === 0 ? Math.min(hour, nowHourWib) : hour;
  base.setUTCHours(targetHour - 7, 0, 0, 0);
  return base.toISOString();
}

function hashId(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function keyValue(index: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let block = "";
  for (let i = 0; i < 4; i += 1) block += alphabet[(index * 7 + i * 3) % alphabet.length];
  let block2 = "";
  for (let i = 0; i < 4; i += 1) block2 += alphabet[(index * 11 + i * 5 + 3) % alphabet.length];
  return `XLVP-${block}-${block2}`;
}

type KeyStatus = "active" | "expired" | "banned";

interface SeedKey {
  index: number;
  toolTypeId: string;
  toolVersionId: string;
  createdBy: string;
  status: KeyStatus;
  durationDays: number | null;
  expiredAt: string | null;
  maxDevice: number;
  /** Credit yang dipakai untuk key ini (0 untuk key Owner — tidak pernah dipotong). */
  creditCost: number;
  note: string | null;
  /** Metadata ban (hanya untuk key berstatus banned). */
  banReason?: "manual" | "auto_hwid" | "refund" | "other";
  banNote?: string | null;
  bannedAt?: string | null;
  lastUsed: string | null;
  createdAt: string;
  devicesUsed: number;
}

const KEYS: SeedKey[] = [
  { index: 1, toolTypeId: TOOL_A, toolVersionId: VER_A1, createdBy: RESELLER_1, status: "active", durationDays: 30, expiredAt: iso(-24), maxDevice: 1, creditCost: 15, note: "Pesanan Andi", lastUsed: iso(0, 8), createdAt: iso(6, 9), devicesUsed: 1 },
  { index: 2, toolTypeId: TOOL_A, toolVersionId: VER_A1, createdBy: OWNER_ID, status: "active", durationDays: 30, expiredAt: iso(-3), maxDevice: 2, creditCost: 0, note: null, lastUsed: null, createdAt: iso(2, 11), devicesUsed: 0 },
  { index: 3, toolTypeId: TOOL_A, toolVersionId: VER_A2, createdBy: RESELLER_2, status: "expired", durationDays: 7, expiredAt: iso(2), maxDevice: 1, creditCost: 5, note: "Batch lama", lastUsed: null, createdAt: iso(9, 14), devicesUsed: 1 },
  { index: 4, toolTypeId: TOOL_A, toolVersionId: VER_A2, createdBy: RESELLER_1, status: "banned", durationDays: 30, expiredAt: iso(-45), maxDevice: 1, creditCost: 45, note: "Pesanan Andi (batch lama)", banReason: "auto_hwid", banNote: "Auto-ban: terlalu banyak device berbeda", bannedAt: iso(4, 16), lastUsed: null, createdAt: iso(4, 16), devicesUsed: 1 },
  { index: 5, toolTypeId: TOOL_B, toolVersionId: VER_B1, createdBy: OWNER_ID, status: "active", durationDays: null, expiredAt: null, maxDevice: 3, creditCost: 0, note: "Lifetime, tim internal", lastUsed: null, createdAt: iso(1, 13), devicesUsed: 2 },
  { index: 6, toolTypeId: TOOL_B, toolVersionId: VER_B1, createdBy: RESELLER_3, status: "expired", durationDays: 7, expiredAt: iso(5), maxDevice: 1, creditCost: 5, note: null, lastUsed: null, createdAt: iso(12, 10), devicesUsed: 1 },
  { index: 7, toolTypeId: TOOL_A, toolVersionId: VER_A1, createdBy: RESELLER_2, status: "active", durationDays: 15, expiredAt: iso(-12), maxDevice: 1, creditCost: 15, note: null, lastUsed: null, createdAt: iso(0, 9), devicesUsed: 1 },
  { index: 8, toolTypeId: TOOL_A, toolVersionId: VER_A2, createdBy: RESELLER_1, status: "active", durationDays: 30, expiredAt: iso(-60), maxDevice: 1, creditCost: 15, note: null, lastUsed: null, createdAt: iso(0, 15), devicesUsed: 0 },
  { index: 9, toolTypeId: TOOL_B, toolVersionId: VER_B1, createdBy: RESELLER_3, status: "active", durationDays: 10, expiredAt: iso(-7), maxDevice: 2, creditCost: 15, note: null, lastUsed: null, createdAt: iso(3, 12), devicesUsed: 1 },
  { index: 10, toolTypeId: TOOL_A, toolVersionId: VER_A1, createdBy: OWNER_ID, status: "expired", durationDays: 30, expiredAt: iso(9), maxDevice: 2, creditCost: 0, note: null, lastUsed: null, createdAt: iso(20, 8), devicesUsed: 2 },
  { index: 11, toolTypeId: TOOL_A, toolVersionId: VER_A2, createdBy: RESELLER_2, status: "active", durationDays: 30, expiredAt: iso(-18), maxDevice: 1, creditCost: 15, note: null, lastUsed: null, createdAt: iso(5, 17), devicesUsed: 1 },
  { index: 12, toolTypeId: TOOL_B, toolVersionId: VER_B1, createdBy: RESELLER_1, status: "active", durationDays: 90, expiredAt: iso(-90), maxDevice: 1, creditCost: 40, note: null, lastUsed: null, createdAt: iso(6, 10), devicesUsed: 0 },
];

export function seedKeyId(index: number): string {
  return hashId("b1111111", index);
}

export function seedKeyValue(index: number): string {
  return keyValue(index);
}

interface SeedCreditLog {
  index: number;
  userId: string;
  action: "topup" | "generate" | "extend";
  amount: number;
  balanceAfter: number;
  note: string;
  createdBy: string | null;
  daysAgo: number;
  hour: number;
}

const CREDIT_LOGS: SeedCreditLog[] = [
  { index: 1, userId: RESELLER_1, action: "topup", amount: 200, balanceAfter: 200, note: "Transfer BCA 250k", createdBy: OWNER_ID, daysAgo: 30, hour: 9 },
  { index: 2, userId: RESELLER_1, action: "generate", amount: -15, balanceAfter: 185, note: "Perkakas Pro 1.8.0 / 1 Bulan / 1 key x 1 device", createdBy: RESELLER_1, daysAgo: 29, hour: 10 },
  { index: 3, userId: RESELLER_2, action: "topup", amount: 100, balanceAfter: 100, note: "Credit awal saat pembuatan akun", createdBy: OWNER_ID, daysAgo: 18, hour: 11 },
  { index: 4, userId: RESELLER_1, action: "generate", amount: -45, balanceAfter: 140, note: "Perkakas Pro 1.9.0 / 3 Bulan / 1 key x 1 device", createdBy: RESELLER_1, daysAgo: 12, hour: 14 },
  { index: 5, userId: RESELLER_2, action: "generate", amount: -5, balanceAfter: 95, note: "Perkakas Pro 1.9.0 / 1 Minggu / 1 key x 1 device", createdBy: RESELLER_2, daysAgo: 9, hour: 9 },
  { index: 6, userId: RESELLER_3, action: "topup", amount: 60, balanceAfter: 60, note: "Transfer Mandiri", createdBy: OWNER_ID, daysAgo: 9, hour: 15 },
  { index: 7, userId: RESELLER_3, action: "generate", amount: -5, balanceAfter: 55, note: "Studio Kit 2.1.0 / 1 Minggu / 1 key x 1 device", createdBy: RESELLER_3, daysAgo: 8, hour: 10 },
  { index: 8, userId: RESELLER_1, action: "topup", amount: 50, balanceAfter: 190, note: "Bonus reseller", createdBy: OWNER_ID, daysAgo: 6, hour: 16 },
  { index: 9, userId: RESELLER_2, action: "topup", amount: 10, balanceAfter: 105, note: "Topup kecil", createdBy: OWNER_ID, daysAgo: 5, hour: 10 },
  { index: 10, userId: OWNER_ID, action: "generate", amount: 0, balanceAfter: 0, note: "Studio Kit 2.1.0 / Lifetime / 1 key x 3 device", createdBy: OWNER_ID, daysAgo: 4, hour: 13 },
  { index: 11, userId: RESELLER_1, action: "generate", amount: -15, balanceAfter: 175, note: "Perkakas Pro 1.9.0 / 1 Bulan / 1 key x 1 device", createdBy: RESELLER_1, daysAgo: 3, hour: 11 },
  { index: 12, userId: RESELLER_2, action: "generate", amount: -15, balanceAfter: 90, note: "Perkakas Pro 1.9.0 / 1 Bulan / 1 key x 1 device", createdBy: RESELLER_2, daysAgo: 2, hour: 12 },
  { index: 13, userId: OWNER_ID, action: "generate", amount: 0, balanceAfter: 0, note: "Perkakas Pro 1.8.0 / 15 hari / 1 key x 2 device", createdBy: OWNER_ID, daysAgo: 0, hour: 9 },
  { index: 14, userId: RESELLER_1, action: "generate", amount: -15, balanceAfter: 160, note: "Perkakas Pro 1.9.0 / 1 Bulan / 1 key x 1 device", createdBy: RESELLER_1, daysAgo: 0, hour: 15 },
  { index: 15, userId: RESELLER_1, action: "extend", amount: -15, balanceAfter: 145, note: "Perpanjang 1 Bulan / XLVP-258B-5AFL / 1 device", createdBy: RESELLER_1, daysAgo: 0, hour: 16 },
];

/** true kalau database masih kosong (belum ada profil). */
function isEmpty(db: SqliteDatabase): boolean {
  const row = db.prepare("SELECT COUNT(*) AS total FROM profiles").get() as { total: number };
  return Number(row?.total ?? 0) === 0;
}

/** Isi data contoh kalau database masih kosong. */
export function seedDatabase(db: SqliteDatabase): void {
  if (!isEmpty(db)) return;

  const now = new Date().toISOString();

  const insertProfile = db.prepare(
    "INSERT INTO profiles (id, username, email, role, credit, is_active, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertAccount = db.prepare(
    "INSERT INTO auth_accounts (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertTool = db.prepare(
    "INSERT INTO tool_types (id, name, slug, is_active, created_by, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertVersion = db.prepare(
    "INSERT INTO tool_versions (id, tool_type_id, name, is_active, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertSecret = db.prepare(
    "INSERT INTO tool_secrets (tool_type_id, secret_payload, updated_at) VALUES (?, ?, ?)",
  );
  const insertPreset = db.prepare(
    "INSERT INTO duration_presets (id, name, days, credit_cost, is_active, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertKey = db.prepare(
    "INSERT INTO keys (id, key_value, tool_type_id, tool_version_id, created_by, status, duration_days, " +
      "expired_at, max_device, credit_cost, note, ban_reason, ban_note, banned_by, banned_at, " +
      "last_used, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDevice = db.prepare(
    "INSERT INTO device_logs (id, key_id, hardware_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)",
  );
  const insertCredit = db.prepare(
    "INSERT INTO credit_logs (id, user_id, action, amount, balance_after, note, created_by, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );

  const statements: (() => void)[] = [];

  // --- Akun & profil -------------------------------------------------------
  statements.push(() => {
    insertProfile.run(OWNER_ID, "owner", SEED_ACCOUNTS.owner.email, "owner", 0, 1, iso(45), now);
    insertAccount.run(
      OWNER_ID,
      SEED_ACCOUNTS.owner.email,
      hashPassword(SEED_ACCOUNTS.owner.password),
      iso(45),
      now,
    );
  });

  const resellers = [
    { id: RESELLER_1, username: "andi", email: "andi@example.com", credit: 145, active: 1, createdAt: iso(30) },
    { id: RESELLER_2, username: "budi", email: "budi@example.com", credit: 90, active: 1, createdAt: iso(18) },
    { id: RESELLER_3, username: "citra", email: "citra@example.com", credit: 55, active: 0, createdAt: iso(9) },
  ];

  resellers.forEach((reseller) => {
    statements.push(() => {
      insertProfile.run(
        reseller.id,
        reseller.username,
        reseller.email,
        "reseller",
        reseller.credit,
        reseller.active,
        reseller.createdAt,
        now,
      );
      insertAccount.run(
        reseller.id,
        reseller.email,
        hashPassword(SEED_ACCOUNTS.reseller.password),
        reseller.createdAt,
        now,
      );
    });
  });

  // --- Tool types, versions, secret ---------------------------------------
  statements.push(() => {
    insertTool.run(TOOL_A, "Perkakas Pro", "perkakas-pro", 1, OWNER_ID, iso(40), iso(3));
    insertTool.run(TOOL_B, "Studio Kit", "studio-kit", 1, OWNER_ID, iso(21), iso(5));
    insertVersion.run(VER_A1, TOOL_A, "1.8.0", 1, iso(38), iso(38));
    insertVersion.run(VER_A2, TOOL_A, "1.9.0", 1, iso(12), iso(12));
    insertVersion.run(VER_B1, TOOL_B, "2.1.0", 1, iso(20), iso(20));
    insertSecret.run(
      TOOL_A,
      JSON.stringify({ modul: "core", kunci_dekripsi: "contoh-lokal" }),
      iso(3),
    );
  });

  // --- Preset durasi -------------------------------------------------------
  const presets: [string, string, number, number, number, string][] = [
    ["e1111111-0000-4000-8000-000000000001", "1 Hari", 1, 1, 1, iso(40)],
    ["e1111111-0000-4000-8000-000000000002", "1 Minggu", 7, 5, 1, iso(40)],
    ["e1111111-0000-4000-8000-000000000003", "1 Bulan", 30, 15, 1, iso(40)],
    ["e1111111-0000-4000-8000-000000000004", "3 Bulan", 90, 40, 1, iso(40)],
    ["e1111111-0000-4000-8000-000000000005", "1 Tahun", 365, 120, 0, iso(40)],
  ];
  presets.forEach(([id, name, days, cost, active, createdAt]) => {
    statements.push(() => insertPreset.run(id, name, days, cost, active, createdAt, iso(6)));
  });

  // --- Keys + device logs ---------------------------------------------------
  KEYS.forEach((key) => {
    statements.push(() => {
      insertKey.run(
        seedKeyId(key.index),
        keyValue(key.index),
        key.toolTypeId,
        key.toolVersionId,
        key.createdBy,
        key.status,
        key.durationDays,
        key.expiredAt,
        key.maxDevice,
        key.creditCost,
        key.note,
        key.banReason ?? null,
        key.banNote ?? null,
        // banned_by hanya terisi saat key memang di-ban: auto-ban oleh sistem →
        // NULL (sama seperti perilaku nyata), ban manual → OWNER_ID.
        key.banReason ? (key.banReason === "auto_hwid" ? null : OWNER_ID) : null,
        key.bannedAt ?? null,
        key.lastUsed,
        key.createdAt,
        key.createdAt,
      );

      for (let slot = 0; slot < key.devicesUsed; slot += 1) {
        const index = key.index - 1;
        const hardwareId = `${(index + slot + 11).toString(16).repeat(4)}${"ab12cd34ef56".repeat(2)}`.slice(
          0,
          64,
        );
        insertDevice.run(
          hashId("f1111111", index * 10 + slot),
          seedKeyId(key.index),
          hardwareId,
          iso(Math.min(20, index + 1), 9 + slot),
          iso(index % 3, 10 + slot),
        );
      }
    });
  });

  // --- Credit logs ---------------------------------------------------------
  CREDIT_LOGS.forEach((log) => {
    statements.push(() =>
      insertCredit.run(
        hashId("abcd1234", log.index),
        log.userId,
        log.action,
        log.amount,
        log.balanceAfter,
        log.note,
        log.createdBy,
        iso(log.daysAgo, log.hour),
      ),
    );
  });

  const tx = db.transaction(() => statements.forEach((run) => run()));
  tx();
}

/** Dipakai skrip CLI (`npm run db:reset`) & uji e2e untuk mengecek isi database. */
export function countRows(db: SqliteDatabase, table: string): number {
  const safeTable = /^[a-z_]+$/.test(table) ? table : "profiles";
  const stmt: SqliteStatement = db.prepare(`SELECT COUNT(*) AS total FROM ${safeTable}`);
  const row = stmt.get() as { total: number } | undefined;
  return Number(row?.total ?? 0);
}
