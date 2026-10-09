/**
 * Driver SQLite (better-sqlite3) — dimuat secara lazy.
 *
 * Alasan lazy: kalau panel berjalan di mode Supabase, paket native ini tidak
 * pernah di-import sama sekali (`better-sqlite3` tetap terdaftar sebagai
 * dependency supaya mode SQLite bisa langsung dipakai tanpa install tambahan).
 *
 * `better-sqlite3` sudah ditandai sebagai external di next.config.mjs
 * (`experimental.serverComponentsExternalPackages`) supaya tidak ikut di-bundle webpack.
 */

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(statement: string): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  close(): void;
}

/**
 * better-sqlite3 tidak menyertakan tipe sendiri. Daripada menambah
 * `@types/better-sqlite3` (dependensi dev tambahan), kita deklarasikan tipe
 * minimum yang dipakai — lihat `types/better-sqlite3.d.ts`.
 */
interface BetterSqliteConstructor {
  new (path: string): SqliteDatabase;
}

let cached: BetterSqliteConstructor | null = null;

/** Ambil constructor better-sqlite3, dengan pesan error yang jelas kalau belum terpasang. */
export async function sqliteDriver(): Promise<BetterSqliteConstructor> {
  if (cached) return cached;

  try {
    const mod = (await import("better-sqlite3")) as unknown as {
      default?: BetterSqliteConstructor;
    } & BetterSqliteConstructor;
    cached = mod.default ?? mod;
    return cached;
  } catch (error) {
    throw new Error(
      "Mode SQLite butuh paket `better-sqlite3`, tapi paket itu gagal dimuat " +
        `(${(error as Error).message}). Jalankan \`npm install\` di folder project, ` +
        "atau isi environment Supabase kalau ingin memakai mode Supabase.",
    );
  }
}
