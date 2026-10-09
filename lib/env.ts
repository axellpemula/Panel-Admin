/**
 * Pembacaan environment variables di satu tempat.
 *
 * Aturan:
 * - Jangan pernah import file ini dari Client Component.
 * - Error env hanya dilempar saat variable benar-benar dipakai (lazy), supaya
 *   halaman publik (mis. /login) tidak ikut error hanya karena CRON_SECRET belum diisi.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function required(name: string): string {
  const value = read(name);
  if (!value) {
    throw new Error(
      `Environment variable ${name} belum diisi. Lihat .env.example dan README.md bagian "Environment Variables".`,
    );
  }
  return value;
}

/** URL project Supabase. Diverifikasi di README: tersedia juga ke client (anon). */
export const supabaseUrl = (): string =>
  read("NEXT_PUBLIC_SUPABASE_URL") ?? required("NEXT_PUBLIC_SUPABASE_URL");

/** Anon key Supabase — aman untuk browser (dibatasi RLS). */
export const supabaseAnonKey = (): string =>
  read("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? required("NEXT_PUBLIC_SUPABASE_ANON_KEY");

/** Service role key — server only. */
export const supabaseServiceRoleKey = (): string => required("SUPABASE_SERVICE_ROLE_KEY");

/**
 * Private key Ed25519 (PKCS8 PEM ter-encode base64, satu baris).
 * Hanya dibaca oleh /api/validate. Tidak pernah dipakai di client.
 */
export const licensePrivateKey = (): string => required("LICENSE_SIGNING_PRIVATE_KEY");

/** Public key Ed25519 yang ditanam di sisi tool. */
export const licensePublicKey = (): string | undefined => {
  const raw = read("LICENSE_SIGNING_PUBLIC_KEY");
  if (!raw) return undefined;
  if (raw.includes("BEGIN PUBLIC KEY")) return raw;
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return raw;
  }
};

/** TTL token lisensi dalam detik. Default 900 (15 menit). */
export const licenseTokenTtlSeconds = (): number => {
  const raw = read("LICENSE_TOKEN_TTL_SECONDS");
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 900;
  return Math.min(parsed, 86_400);
};

/** Secret untuk header `Authorization: Bearer <CRON_SECRET>` pada /api/cron/cleanup. */
export const cronSecret = (): string | undefined => read("CRON_SECRET");

/**
 * Supabase dianggap terkonfigurasi kalau ketiga variable intinya terisi.
 * Service role key ikut dihitung karena seluruh operasi tulis panel lewat
 * service role — tanpa itu panel tidak bisa dipakai.
 */
export const isSupabaseConfigured = (): boolean =>
  Boolean(
    read("NEXT_PUBLIC_SUPABASE_URL") && read("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
      read("SUPABASE_SERVICE_ROLE_KEY"),
  );

/**
 * Mode database panel:
 * - "supabase" → Postgres + Auth Supabase (produksi).
 * - "sqlite"   → database lokal di `data/xloop.sqlite` (dev/preview/demo).
 *
 * Urutan penentuan:
 *   1. `XLOOP_DB=supabase|sqlite` → paksa salah satu.
 *   2. `NEXT_PUBLIC_MOCK_MODE=1`  → mode SQLite (flag lama, tetap didukung).
 *   3. Env Supabase tidak lengkap → otomatis mode SQLite.
 *   4. Selain itu → Supabase.
 */
export type DbMode = "supabase" | "sqlite";

export const dbMode = (): DbMode => {
  const forced = read("XLOOP_DB")?.toLowerCase();
  if (forced === "sqlite" || forced === "supabase") return forced;
  if (read("NEXT_PUBLIC_MOCK_MODE") === "1") return "sqlite";
  return isSupabaseConfigured() ? "supabase" : "sqlite";
};

export const isSqliteMode = (): boolean => dbMode() === "sqlite";

/** Path file database SQLite (default: `<project>/data/xloop.sqlite`). */
export const sqliteDatabasePath = (): string => read("XLOOP_SQLITE_PATH") ?? "data/xloop.sqlite";
