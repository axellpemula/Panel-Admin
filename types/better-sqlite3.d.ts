/**
 * Tipe minimum untuk `better-sqlite3` (paket ini tidak mengirim file .d.ts).
 * Hanya yang dipakai panel: prepare/run/get/all/exec/pragma/transaction/close.
 */
declare module "better-sqlite3" {
  interface Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  interface Database {
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(statement: string): unknown;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
    close(): void;
  }

  interface DatabaseConstructor {
    new (path: string, options?: { fileMustExist?: boolean; readonly?: boolean }): Database;
  }

  const Database: DatabaseConstructor;
  export = Database;
}
