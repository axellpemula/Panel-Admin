/**
 * Koneksi SQLite (mode lokal/demo).
 *
 * - Satu koneksi per proses, disimpan di cache modul (SQLite file-based, aman
 *   untuk single-process Next.js: dev server, `next start`, atau `vercel dev`).
 * - Lokasi file: env `XLOOP_SQLITE_PATH`, default `<project>/data/xloop.sqlite`.
 * - Skema dibuat otomatis (idempotent). Data contoh hanya diisi saat tabel
 *   `profiles` masih kosong, jadi datamu tidak pernah tertimpa.
 * - `PRAGMA foreign_keys = ON` supaya perilakunya sama seperti Postgres
 *   (ON DELETE CASCADE pada device_logs & tool_versions).
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { sqliteDriver, type SqliteDatabase } from "@/lib/db/sqlite/driver";
import { migrateSqliteSchema, SQLITE_SCHEMA_SQL } from "@/lib/db/sqlite/schema";
import { seedDatabase } from "@/lib/db/sqlite/seed";

let dbPromise: Promise<SqliteDatabase> | null = null;

function resolvePath(): string {
  const configured = process.env.XLOOP_SQLITE_PATH?.trim();
  if (configured) {
    // Path relatif dihitung dari root project (cwd proses Next).
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(process.cwd(), "data", "xloop.sqlite");
}

export function sqliteFilePath(): string {
  return resolvePath();
}

async function open(): Promise<SqliteDatabase> {
  const file = resolvePath();
  mkdirSync(path.dirname(file), { recursive: true });

  const Database = await sqliteDriver();
  const db = new Database(file);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SQLITE_SCHEMA_SQL);

  // Database lama (mis. dibuat sebelum aksi credit 'extend' ada) diperbarui di sini.
  try {
    const changes = migrateSqliteSchema(db);
    if (changes.length > 0) {
      // Kalau tabel dibangun ulang, index-nya ikut hilang → dibuat lagi di sini.
      db.exec(SQLITE_SCHEMA_SQL);
      changes.forEach((change) => console.info(`[sqlite] skema diperbarui: ${change}`));
    }
  } catch (error) {
    console.warn("[sqlite] migrasi skema gagal:", (error as Error).message);
  }

  try {
    seedDatabase(db);
  } catch (error) {
    // Seed gagal (mis. data setengah jadi) tidak boleh membuat panel mati.
    console.warn("[sqlite] seed data contoh dilewati:", (error as Error).message);
  }

  return db;
}

/** Ambil koneksi SQLite (dibuka sekali per proses). */
export function getDb(): Promise<SqliteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

/** Tutup koneksi (dipakai skrip/CLI & saat reset DB). */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = null;
  db.close();
}
