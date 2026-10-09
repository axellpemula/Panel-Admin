/**
 * Adapter SQLite yang meniru permukaan API `supabase-js` yang dipakai panel ini.
 *
 * Tujuannya: seluruh API route, helper stats/keys/generate, dan endpoint
 * /api/validate tetap memakai kode yang sama (`admin.from("keys").select(...)`,
 * `admin.rpc("register_device", {...})`, `admin.auth.admin.createUser(...)`) —
 * hanya backend-nya yang berganti dari Supabase ke SQLite lokal.
 *
 * Yang didukung (sesuai pemakaian nyata di repo ini):
 * - `from(table).select(cols, { count, head })` termasuk relasi embedded
 *   (`tool_types(...)`, `profiles!keys_created_by_fkey(...)`, `creator:profiles!...(...)`)
 * - filter: eq, neq, gt, gte, lt, lte, in, ilike, is, not(..., "is", null)
 * - `order`, `limit`, `range`, `single`, `maybeSingle`, `returns`
 * - `insert`, `upsert(..., { onConflict })`, `update`, `delete` (+ `select` sebagai RETURNING)
 * - `rpc(...)` untuk semua function di migration.sql
 *
 * Catatan penting: tidak ada RLS di SQLite — semua akses lewat API route panel
 * yang sudah memeriksa sesi, role, dan kepemilikan data (sama seperti service role).
 */

import type { SqliteDatabase, SqliteStatement } from "@/lib/db/sqlite/driver";
import { getDb } from "@/lib/db/sqlite/client";
import {
  BOOLEAN_COLUMNS,
  FK_COLUMNS,
  RELATIONS,
  TABLES_WITH_UPDATED_AT,
} from "@/lib/db/sqlite/schema";
import { RPC_HANDLERS } from "@/lib/db/sqlite/rpc";
import {
  AUTH_ERROR_MESSAGES,
  clearLegacyDemoCookie,
  createAccount,
  currentUser,
  deleteAccount,
  destroySession,
  revokeSessions,
  signIn,
  updateAccount,
} from "@/lib/db/sqlite/auth";

export interface DbError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export interface DbResult<T = unknown> {
  data: T;
  error: DbError | null;
  count: number | null;
  status: number;
  statusText: string;
}

type Row = Record<string, unknown>;

type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "ilike"
  | "isnull"
  | "notnull"
  | "neq-null";

interface Filter {
  op: FilterOp;
  column: string;
  value?: unknown;
}

/** Satu kondisi di dalam `.or("a.is.null,a.neq.b")`. */
interface OrCondition {
  column: string;
  op: FilterOp;
  value?: unknown;
}

interface Embed {
  alias: string;
  table: string;
  column: string;
  columns: string[];
}

type QueryMode = "select" | "insert" | "upsert" | "update" | "delete";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

function err(message: string, code = "PGRST100"): DbError {
  return { message, code, details: null, hint: null };
}

function ok<T>(data: T, count: number | null = null): DbResult<T> {
  return { data, error: null, count, status: 200, statusText: "OK" };
}

function bad<T>(error: DbError, status = 400): DbResult<T> {
  return { data: null as unknown as T, error, count: null, status, statusText: "Bad Request" };
}

/**
 * Urai satu kondisi PostgREST: `reason.is.null`, `status.neq.banned`,
 * `credit.gte.10`. Nilai selalu string (PostgREST juga begitu) kecuali null/true/false.
 */
function parseOrCondition(part: string): OrCondition {
  const [column, operator, ...rest] = part.split(".");
  const rawValue = rest.join(".");

  if (!column || !operator) {
    throw new Error(`Kondisi .or() tidak dikenal: "${part}"`);
  }

  const decode = (value: string): unknown => {
    if (value === "null") return null;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  };

  switch (operator) {
    case "is":
      return { column, op: decode(rawValue) === null ? "isnull" : "eq", value: decode(rawValue) };
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "ilike": {
      const value = decode(rawValue);
      if (operator === "neq" && value === null) return { column, op: "neq-null" };
      return { column, op: operator, value };
    }
    case "in": {
      const values = rawValue.replace(/^[()]|[()]$/g, "").split(",");
      return { column, op: "in", value: values.map(decode) };
    }
    default:
      throw new Error(`Operator .or() "${operator}" belum didukung`);
  }
}

/** Terjemahkan error SQLite ke kode error ala Postgres (dipakai kode panel). */
function mapSqliteError(error: unknown): DbError {
  const message = (error as Error)?.message ?? "SQLite error";
  const raw = (error as { code?: string })?.code ?? "";

  if (raw.startsWith("SQLITE_CONSTRAINT_UNIQUE") || raw.startsWith("SQLITE_CONSTRAINT_PRIMARYKEY")) {
    return { message, code: "23505", details: null, hint: null };
  }
  if (raw.startsWith("SQLITE_CONSTRAINT_FOREIGNKEY")) {
    return { message, code: "23503", details: null, hint: null };
  }
  if (raw.startsWith("SQLITE_CONSTRAINT_NOTNULL")) {
    return { message, code: "23502", details: null, hint: null };
  }
  if (raw.startsWith("SQLITE_CONSTRAINT_CHECK")) {
    return { message, code: "23514", details: null, hint: null };
  }
  return { message, code: "42601", details: null, hint: null };
}

// ---------------------------------------------------------------------------
// Metadata tabel & relasi
// ---------------------------------------------------------------------------

const columnCache = new Map<string, Set<string>>();

function columnsOf(db: SqliteDatabase, table: string): Set<string> {
  const cached = columnCache.get(table);
  if (cached) return cached;

  if (!IDENTIFIER.test(table)) throw new Error(`Nama tabel tidak valid: ${table}`);

  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  if (rows.length === 0) {
    throw new Error(`relation "public.${table}" does not exist`);
  }

  const set = new Set(rows.map((row) => row.name));
  columnCache.set(table, set);
  return set;
}

function assertColumn(db: SqliteDatabase, table: string, column: string): void {
  const columns = columnsOf(db, table);
  if (!columns.has(column)) {
    throw new Error(`column ${table}.${column} does not exist`);
  }
}

/** Kalau identifier tidak valid → lempar; kalau valid → dipakai sebagai SQL literal. */
function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Identifier tidak valid: ${name}`);
  return `"${name}"`;
}

// ---------------------------------------------------------------------------
// Konversi nilai (boolean 0/1, Date → ISO, objek → JSON)
// ---------------------------------------------------------------------------

function toSqlValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function fromSqlRow(table: string, row: Row): Row {
  const booleans = BOOLEAN_COLUMNS[table];
  if (!booleans) return row;

  const copy: Row = { ...row };
  booleans.forEach((column) => {
    if (copy[column] === 0 || copy[column] === 1) copy[column] = copy[column] === 1;
  });
  return copy;
}

// ---------------------------------------------------------------------------
// Parsing string select (`*, tool_types(id,name), creator:profiles!fk(username)`)
// ---------------------------------------------------------------------------

interface ParsedSelect {
  columns: string[];
  embeds: Embed[];
}

function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) parts.push(current);

  return parts.map((part) => part.trim()).filter(Boolean);
}

function resolveRelation(table: string, alias: string, fk?: string): Embed {
  const relations = RELATIONS[table] ?? {};
  const relation = relations[alias];

  const column = fk ? (FK_COLUMNS[fk] ?? relation?.column) : relation?.column;
  if (!column) {
    throw new Error(
      `relasi "${alias}" dari tabel ${table} belum didukung adapter SQLite (fk: ${fk ?? "-"})`,
    );
  }

  return { alias, table: relation?.table ?? alias, column, columns: [] };
}

function parseSelect(db: SqliteDatabase, table: string, select: string): ParsedSelect {
  const raw = select.trim() || "*";
  const columns: string[] = [];
  const embeds: Embed[] = [];

  splitTopLevel(raw).forEach((token) => {
    const open = token.indexOf("(");
    if (open === -1) {
      columns.push(token);
      return;
    }

    const head = token.slice(0, open).trim();
    const inner = token.slice(open + 1, token.lastIndexOf(")")).trim();

    const [aliasPart, tablePart] = head.includes(":")
      ? (head.split(":") as [string, string])
      : ([null as unknown as string, head]);
    const [targetTable, fk] = tablePart.includes("!")
      ? (tablePart.split("!") as [string, string])
      : ([tablePart, undefined as unknown as string]);

    const alias = aliasPart ?? targetTable;
    const embed = resolveRelation(table, alias, fk);
    embed.table = targetTable;
    embed.columns = embedTargetColumns(db, embed.table, inner);
    embeds.push(embed);
  });

  const hasStar = columns.includes("*");
  const resolved = hasStar ? [] : columns;

  resolved.forEach((column) => assertColumn(db, table, column));

  const allColumns = [...columnsOf(db, table)].filter((column) => hasStar || resolved.includes(column));

  return { columns: hasStar ? allColumns : resolved, embeds };
}

function embedTargetColumns(db: SqliteDatabase, table: string, inner: string): string[] {
  const requested = splitTopLevel(inner.length > 0 ? inner : "*").filter(
    (token) => !token.includes("("),
  );
  const all = [...columnsOf(db, table)];

  if (requested.includes("*") || requested.length === 0) return all;
  requested.forEach((column) => assertColumn(db, table, column));
  return requested;
}

function attachEmbeds(db: SqliteDatabase, table: string, rows: Row[], embeds: Embed[]): void {
  embeds.forEach((embed) => {
    const ids = [
      ...new Set(
        rows
          .map((row) => row[embed.column])
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    ];

    if (ids.length === 0) {
      rows.forEach((row) => {
        row[embed.alias] = null;
      });
      return;
    }

    const placeholders = ids.map(() => "?").join(", ");
    const selected = embed.columns.map(identifier).join(", ");
    const found = db
      .prepare(`SELECT ${selected}, "id" FROM ${identifier(embed.table)} WHERE "id" IN (${placeholders})`)
      .all(...ids) as Row[];

    const map = new Map<string, Row>();
    found.forEach((row) => {
      const record = fromSqlRow(embed.table, row);
      const key = String(record.id);
      delete record.id;
      map.set(key, record);
    });

    rows.forEach((row) => {
      const key = row[embed.column];
      row[embed.alias] = typeof key === "string" ? map.get(key) ?? null : null;
    });
  });
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

class SqliteQuery implements PromiseLike<DbResult> {
  private mode: QueryMode = "select";
  private selectColumns: string | null = null;
  private selectOptions: { count?: "exact"; head?: boolean } = {};
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private limitCount: number | null = null;
  private offsetCount = 0;
  private singleMode: "none" | "single" | "maybe" = "none";
  private values: Row[] | null = null;
  private conflictTarget: string | null = null;
  private orGroups: OrCondition[][] = [];

  constructor(
    private readonly table: string,
    private readonly load: () => Promise<SqliteDatabase>,
  ) {}

  // --- mode & returning ----------------------------------------------------
  select(columns = "*", options?: { count?: "exact"; head?: boolean }): this {
    if (this.mode === "select") {
      this.selectColumns = columns;
    } else {
      // insert/update/delete + select → RETURNING
      this.selectColumns = columns;
    }
    if (options) this.selectOptions = options;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.mode = "insert";
    this.values = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: Row | Row[], options?: { onConflict?: string }): this {
    this.mode = "upsert";
    this.values = Array.isArray(values) ? values : [values];
    this.conflictTarget = options?.onConflict ?? "id";
    return this;
  }

  update(values: Row): this {
    this.mode = "update";
    this.values = [values];
    return this;
  }

  delete(options?: { count?: "exact" }): this {
    this.mode = "delete";
    if (options?.count) this.selectOptions = { count: options.count };
    return this;
  }

  // --- filter --------------------------------------------------------------
  eq(column: string, value: unknown): this {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push({ op: value === null ? "neq-null" : "neq", column, value });
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push({ op: "gt", column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ op: "gte", column, value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ op: "lt", column, value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ op: "lte", column, value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ op: "in", column, value: values });
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.filters.push({ op: "ilike", column, value: pattern });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ op: value === null ? "isnull" : "eq", column, value });
    return this;
  }

  /**
   * Filter OR, sintaks PostgREST: `.or("reason.is.null,reason.neq.rate_limited")`.
   * Dipakai supaya kondisi null-safe (mis. "semua percobaan KECUALI yang sudah
   * kena rate limit") berperilaku sama di Postgres maupun SQLite.
   */
  or(expression: string): this {
    const group = expression
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => parseOrCondition(part));
    if (group.length > 0) this.orGroups.push(group);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === "is" && value === null) {
      this.filters.push({ op: "notnull", column });
      return this;
    }
    if (operator === "eq") {
      this.filters.push({ op: value === null ? "neq-null" : "neq", column, value });
      return this;
    }
    if (operator === "in" && Array.isArray(value)) {
      // NOT IN — sederhana: pakai nilai negatif dari in
      this.filters.push({ op: "in", column, value: (value as unknown[]).map((item) => item) });
      return this;
    }
    throw new Error(`Operator not(${operator}) belum didukung adapter SQLite`);
  }

  // --- urutan & batas ------------------------------------------------------
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.orders.push({
      column,
      ascending: options?.ascending !== false,
      nullsFirst: options?.nullsFirst === true,
    });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number): this {
    this.limitCount = Math.max(0, to - from + 1);
    this.offsetCount = Math.max(0, from);
    return this;
  }

  single<T = Row>(): Promise<DbResult<T | null>> {
    this.singleMode = "single";
    return this as unknown as Promise<DbResult<T | null>>;
  }

  maybeSingle<T = Row>(): Promise<DbResult<T | null>> {
    this.singleMode = "maybe";
    return this as unknown as Promise<DbResult<T | null>>;
  }

  /** Hanya penanda tipe di supabase-js — di sini tidak berpengaruh. */
  returns<T>(): SqliteQuery & { returnsType?: T } {
    return this;
  }

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  // --- eksekusi ------------------------------------------------------------
  private async execute(): Promise<DbResult> {
    try {
      const db = await this.load();

      switch (this.mode) {
        case "insert":
          return this.runInsert(db, false);
        case "upsert":
          return this.runInsert(db, true);
        case "update":
          return this.runUpdate(db);
        case "delete":
          return this.runDelete(db);
        default:
          return this.runSelect(db);
      }
    } catch (error) {
      const mapped = mapSqliteError(error);
      const status = mapped.code === "23505" ? 409 : 400;
      return bad(mapped, status);
    }
  }

  /**
   * Ubah satu kondisi jadi potongan SQL + parameter. Dipakai filter AND biasa
   * maupun kondisi di dalam grup `.or(...)`.
   */
  private conditionSql(db: SqliteDatabase, filter: Filter, params: unknown[]): string {
    assertColumn(db, this.table, filter.column);
    const column = identifier(filter.column);

    switch (filter.op) {
      case "eq":
        if (filter.value === null) return `${column} IS NULL`;
        params.push(toSqlValue(filter.value));
        return `${column} = ?`;
      case "neq":
        params.push(toSqlValue(filter.value));
        return `${column} <> ?`;
      case "neq-null":
        return `${column} IS NOT NULL`;
      case "gt":
        params.push(toSqlValue(filter.value));
        return `${column} > ?`;
      case "gte":
        params.push(toSqlValue(filter.value));
        return `${column} >= ?`;
      case "lt":
        params.push(toSqlValue(filter.value));
        return `${column} < ?`;
      case "lte":
        params.push(toSqlValue(filter.value));
        return `${column} <= ?`;
      case "ilike":
        params.push(toSqlValue(filter.value));
        return `${column} LIKE ?`;
      case "isnull":
        return `${column} IS NULL`;
      case "notnull":
        return `${column} IS NOT NULL`;
      case "in": {
        const values = (Array.isArray(filter.value) ? filter.value : []).filter(
          (value) => value !== null && value !== undefined,
        );
        if (values.length === 0) return "0 = 1";
        values.forEach((value) => params.push(toSqlValue(value)));
        return `${column} IN (${values.map(() => "?").join(", ")})`;
      }
      default:
        throw new Error(`Filter ${filter.op} belum didukung`);
    }
  }

  private where(db: SqliteDatabase, params: unknown[]): string {
    if (this.filters.length === 0 && this.orGroups.length === 0) return "";

    const clauses = this.filters.map((filter) => this.conditionSql(db, filter, params));

    this.orGroups.forEach((group) => {
      const parts = group.map((condition) => this.conditionSql(db, condition, params));
      clauses.push(`(${parts.join(" OR ")})`);
    });

    return ` WHERE ${clauses.join(" AND ")}`;
  }

  private orderBy(db: SqliteDatabase): string {
    if (this.orders.length === 0) return "";
    const parts = this.orders.map((order) => {
      assertColumn(db, this.table, order.column);
      const direction = order.ascending ? "ASC" : "DESC";
      const nulls = order.nullsFirst ? "NULLS FIRST" : "NULLS LAST";
      return `${identifier(order.column)} ${direction} ${nulls}`;
    });
    return ` ORDER BY ${parts.join(", ")}`;
  }

  private applyLimit(): string {
    let sql = "";
    if (this.limitCount !== null) sql += ` LIMIT ${this.limitCount}`;
    if (this.offsetCount > 0) sql += ` OFFSET ${this.offsetCount}`;
    return sql;
  }

  private async countRows(db: SqliteDatabase): Promise<number> {
    const params: unknown[] = [];
    const where = this.where(db, params);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM ${identifier(this.table)}${where}`)
      .get(...params) as { total: number } | undefined;
    return Number(row?.total ?? 0);
  }

  private async runSelect(db: SqliteDatabase): Promise<DbResult> {
    const parsed = parseSelect(db, this.table, this.selectColumns ?? "*");
    const params: unknown[] = [];
    const where = this.where(db, params);
    const order = this.orderBy(db);
    const limit = this.applyLimit();

    const sql = `SELECT ${parsed.columns.map(identifier).join(", ")} FROM ${identifier(this.table)}${where}${order}${limit}`;
    const rawRows = db.prepare(sql).all(...params) as Row[];
    let rows: Row[] = rawRows.map((row) => fromSqlRow(this.table, row));

    if (parsed.embeds.length > 0) attachEmbeds(db, this.table, rows, parsed.embeds);

    let count: number | null = null;
    if (this.selectOptions.count === "exact") count = await this.countRows(db);

    if (this.selectOptions.head) rows = [];

    if (this.singleMode !== "none") {
      if (rows.length > 1 || (rows.length === 0 && this.singleMode === "single")) {
        return {
          data: null,
          error: err(
            "JSON object requested, multiple (or no) rows returned",
            "PGRST116",
          ),
          count,
          status: 406,
          statusText: "Not Acceptable",
        };
      }
      return ok(rows[0] ?? null, count);
    }

    return ok(rows, count);
  }

  private async runInsert(db: SqliteDatabase, upsert: boolean): Promise<DbResult> {
    const rows = (this.values ?? []).filter((row) => row && typeof row === "object");
    if (rows.length === 0) return ok(null);

    const now = new Date().toISOString();
    const columns = columnsOf(db, this.table);
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];

    keys.forEach((key) => assertColumn(db, this.table, key));

    // Isi default seperti Postgres: id & timestamp.
    const prepared = rows.map((row) => {
      const copy: Row = { ...row };
      if (columns.has("id") && (copy.id === undefined || copy.id === null)) copy.id = crypto.randomUUID();
      if (columns.has("created_at") && (copy.created_at === undefined || copy.created_at === null)) {
        copy.created_at = now;
      }
      if (columns.has("updated_at") && (copy.updated_at === undefined || copy.updated_at === null)) {
        copy.updated_at = now;
      }
      return copy;
    });

    const allKeys = [...new Set([...keys, ...prepared.flatMap((row) => Object.keys(row))])];

    let conflictClause = "";
    if (upsert) {
      const target = this.conflictTarget ?? "id";
      assertColumn(db, this.table, target);
      const updatable = allKeys.filter((key) => key !== target);
      conflictClause =
        updatable.length > 0
          ? ` ON CONFLICT (${identifier(target)}) DO UPDATE SET ${updatable
              .map((key) => `${identifier(key)} = excluded.${identifier(key)}`)
              .join(", ")}`
          : ` ON CONFLICT (${identifier(target)}) DO NOTHING`;
    }

    const returning = this.selectColumns
      ? ` RETURNING ${parseSelect(db, this.table, this.selectColumns).columns.map(identifier).join(", ")}`
      : "";
    const returningColumns = this.selectColumns
      ? parseSelect(db, this.table, this.selectColumns).columns.map(identifier).join(", ")
      : null;

    // Satu statement untuk SATU baris; better-sqlite3 harus menerima semua
    // parameter dalam satu panggilan, jadi baris banyak dijalankan berulang
    // (dibungkus transaksi supaya tetap all-or-nothing).
    const statement = db.prepare(
      `INSERT INTO ${identifier(this.table)} (${allKeys.map(identifier).join(", ")}) ` +
        `VALUES (${allKeys.map(() => "?").join(", ")})${conflictClause}${returning}`,
    );

    const inserted: Row[] = [];

    const insertRow = (row: Row): void => {
      const params = allKeys.map((key) => toSqlValue(row[key] ?? null));
      const result = statement.run(...params);
      if (!returningColumns) return;

      // rowid dipakai untuk mengambil kembali baris yang baru dimasukkan.
      const fetched = db
        .prepare(
          `SELECT ${returningColumns} FROM ${identifier(this.table)} WHERE rowid = ?`,
        )
        .get(result.lastInsertRowid) as Row | undefined;
      if (fetched) inserted.push(fromSqlRow(this.table, fetched));
    };

    if (prepared.length === 1) {
      insertRow(prepared[0]);
    } else {
      const tx = db.transaction(() => prepared.forEach(insertRow));
      tx();
    }

    if (this.selectColumns) {
      if (this.singleMode === "single") {
        if (inserted.length !== 1) {
          return bad(err("JSON object requested, multiple (or no) rows returned", "PGRST116"), 406);
        }
        return ok(inserted[0]);
      }
      if (this.singleMode === "maybe") return ok(inserted[0] ?? null);
      return ok(inserted);
    }

    return ok(null);
  }

  private async runUpdate(db: SqliteDatabase): Promise<DbResult> {
    const changes = (this.values?.[0] ?? {}) as Row;
    const columns = columnsOf(db, this.table);
    const keys = Object.keys(changes);
    if (keys.length === 0) return ok(null);

    keys.forEach((key) => assertColumn(db, this.table, key));

    const set: string[] = keys.map((key) => `${identifier(key)} = ?`);
    const params: unknown[] = keys.map((key) => toSqlValue(changes[key]));

    if (TABLES_WITH_UPDATED_AT.has(this.table) && columns.has("updated_at")) {
      set.push(`${identifier("updated_at")} = ?`);
      params.push(new Date().toISOString());
    }

    const where = this.where(db, params);
    const returning = this.selectColumns
      ? ` RETURNING ${parseSelect(db, this.table, this.selectColumns).columns.map(identifier).join(", ")}`
      : "";

    const sql = `UPDATE ${identifier(this.table)} SET ${set.join(", ")}${where}${returning}`;

    let rows: Row[] = [];
    if (returning) {
      rows = (db.prepare(sql).all(...params) as Row[]).map((row) => fromSqlRow(this.table, row));
    } else {
      db.prepare(sql).run(...params);
    }

    if (!this.selectColumns) return ok(null);
    if (this.singleMode === "none") return ok(rows);
    if (this.singleMode === "maybe") return ok(rows[0] ?? null);
    if (rows.length !== 1) {
      return bad(err("JSON object requested, multiple (or no) rows returned", "PGRST116"), 406);
    }
    return ok(rows[0]);
  }

  private async runDelete(db: SqliteDatabase): Promise<DbResult> {
    const params: unknown[] = [];
    const where = this.where(db, params);
    const count = this.selectOptions.count === "exact" ? await this.countRows(db) : null;

    const returning = this.selectColumns
      ? ` RETURNING ${parseSelect(db, this.table, this.selectColumns).columns.map(identifier).join(", ")}`
      : "";

    const sql = `DELETE FROM ${identifier(this.table)}${where}${returning}`;
    const rows = returning
      ? (db.prepare(sql).all(...params) as Row[]).map((row) => fromSqlRow(this.table, row))
      : (db.prepare(sql).run(...params), []);

    if (!this.selectColumns) return ok(null, count);
    if (this.singleMode === "none") return ok(rows, count);
    if (this.singleMode === "maybe") return ok(rows[0] ?? null, count);
    return ok(rows[0] ?? null, count);
  }
}

// ---------------------------------------------------------------------------
// Auth ala supabase-js (dipakai login/logout/reseller management)
// ---------------------------------------------------------------------------

function createSqliteAuth() {
  return {
    getUser: async () => {
      const user = await currentUser();
      if (!user) {
        return {
          data: { user: null },
          error: { name: "AuthSessionMissingError", message: AUTH_ERROR_MESSAGES.sessionMissing },
        };
      }
      return {
        data: { user: { id: user.id, email: user.email, role: "authenticated", aud: "authenticated" } },
        error: null,
      };
    },

    signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
      const result = await signIn(email, password);
      if (result.error) return { data: { user: null, session: null }, error: result.error };
      return { data: { user: result.data.user, session: { access_token: "local" } }, error: null };
    },

    signOut: async () => {
      await destroySession();
      return { error: null };
    },

    admin: {
      createUser: async ({
        email,
        password,
      }: {
        email: string;
        password?: string;
        email_confirm?: boolean;
        user_metadata?: Record<string, unknown>;
      }) => {
        if (!password) {
          return {
            data: { user: null },
            error: { name: "AuthApiError", message: "Password wajib diisi", status: 400 },
          };
        }
        const result = await createAccount(email, password);
        if (result.error) return { data: { user: null }, error: result.error };
        return { data: { user: result.data.user }, error: null };
      },

      updateUserById: async (
        id: string,
        attributes: { email?: string; password?: string; email_confirm?: boolean },
      ) => {
        const result = await updateAccount(id, attributes);
        if (result.error) return { data: { user: null }, error: result.error };
        return { data: { user: result.data.user }, error: null };
      },

      deleteUser: async (id: string) => {
        const result = await deleteAccount(id);
        if (result.error) return { data: null, error: result.error };
        return { data: { user: null }, error: null };
      },

      /** Dipakai saat akun dinonaktifkan: putus semua sesinya. */
      signOut: async (id: string) => {
        await revokeSessions(id);
        return { error: null };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface SqliteSupabaseClient {
  from(table: string): SqliteQuery;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  auth: ReturnType<typeof createSqliteAuth>;
}

/** Client kompatibel supabase-js yang membaca/menulis SQLite. */
export function createSqliteClient(): SqliteSupabaseClient {
  const load = () => getDb();

  return {
    from: (table: string) => new SqliteQuery(table, load),

    rpc: (name: string, args: Record<string, unknown> = {}) => {
      const handler = RPC_HANDLERS[name];
      if (!handler) {
        const missing = bad(
          err(`function public.${name} does not exist`, "PGRST202"),
          404,
        );
        return Promise.resolve(missing);
      }
      return getDb().then((db) => {
        try {
          return handler(db, args ?? {});
        } catch (error) {
          return bad(mapSqliteError(error), 400);
        }
      });
    },

    auth: createSqliteAuth(),
  };
}

export { clearLegacyDemoCookie };
