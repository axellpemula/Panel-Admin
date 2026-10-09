#!/usr/bin/env node
/**
 * dev/sqlite-cli.mjs — utilitas kecil untuk database mode SQLite.
 *
 * Pakai:
 *   node dev/sqlite-cli.mjs info     # lokasi file + jumlah baris tiap tabel
 *   node dev/sqlite-cli.mjs reset    # hapus file lalu buat ulang + isi data contoh
 *   node dev/sqlite-cli.mjs accounts # daftar akun (email + role), tanpa hash
 *
 * Pakai `XLOOP_SQLITE_PATH=...` untuk menunjuk file lain.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const dbPath = process.env.XLOOP_SQLITE_PATH ?? "data/xloop.sqlite";
const file = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
const command = process.argv[2] ?? "info";

const TABLES = [
  "profiles",
  "tool_types",
  "tool_versions",
  "duration_presets",
  "keys",
  "device_logs",
  "credit_logs",
  "tool_secrets",
  "validation_attempts",
  "audit_logs",
  "auth_accounts",
  "auth_sessions",
];

function open() {
  if (!existsSync(file)) {
    console.log(`Database belum ada di ${file}`);
    console.log("Jalankan panel sekali (mode SQLite) supaya skema + data contoh dibuat otomatis,");
    console.log("atau `node dev/sqlite-cli.mjs reset` untuk membuat sekarang.");
    process.exit(1);
  }
  return new Database(file, { fileMustExist: true });
}

if (command === "reset") {
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${file}${suffix}`;
    if (existsSync(target)) rmSync(target);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  console.log(`File database dihapus: ${file}`);
  console.log("Skema + data contoh akan dibuat lagi otomatis saat panel dijalankan.");
  console.log(
    "Kalau panel sedang berjalan, restart dulu (`npm run demo`) — prosesnya masih memegang file lama.",
  );
  process.exit(0);
}

const db = open();

if (command === "info") {
  console.log(`\nDatabase: ${file}\n`);
  TABLES.forEach((table) => {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get();
      console.log(`  ${table.padEnd(20)} ${String(row.total).padStart(6)} baris`);
    } catch {
      console.log(`  ${table.padEnd(20)}      -  (tabel belum ada)`);
    }
  });
  console.log("");
} else if (command === "accounts") {
  const rows = db
    .prepare(
      "SELECT a.email, p.username, p.role, p.is_active, p.credit " +
        "FROM auth_accounts a LEFT JOIN profiles p ON p.id = a.id ORDER BY p.role DESC, p.username",
    )
    .all();
  console.log(`\nAkun di ${file}\n`);
  rows.forEach((row) => {
    console.log(
      `  ${String(row.email).padEnd(24)} ${String(row.username ?? "-").padEnd(10)} ` +
        `${String(row.role ?? "-").padEnd(9)} ${row.is_active ? "aktif" : "nonaktif"}  credit: ${row.credit}`,
    );
  });
  console.log("\nPassword tidak ditampilkan (hanya hash scrypt yang tersimpan).");
  console.log("Akun bawaan: owner@gmail.com / Axell123 · reseller: Reseller123\n");
} else {
  console.log("Perintah tidak dikenal. Pakai: info | reset | accounts");
  process.exit(1);
}
