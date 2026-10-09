/**
 * Autentikasi mode SQLite.
 *
 * Di Supabase, sesi & password ditangani Supabase Auth (cookie `sb-*` + GoTrue).
 * Di mode lokal kita menyediakan padanannya sendiri:
 * - tabel `auth_accounts` (email + hash scrypt) dan `auth_sessions` (token),
 * - cookie sesi `xloop_session` (HttpOnly, SameSite=Lax, umur 7 hari),
 * - API yang bentuknya sama dengan Supabase Auth supaya kode panel tidak perlu bercabang.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import { getDb } from "@/lib/db/sqlite/client";
import { hashPassword, verifyPassword } from "@/lib/db/sqlite/password";
import { SESSION_COOKIE_NAME } from "@/lib/constants";

export const SESSION_COOKIE = SESSION_COOKIE_NAME;

/** Cookie lama dari mode demo in-memory — dibersihkan supaya tidak membingungkan. */
const LEGACY_DEMO_COOKIE = "xloop_demo_role";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface LocalUser {
  id: string;
  email: string;
  created_at: string;
}

export interface AuthError {
  name: string;
  message: string;
  status?: number;
}

export interface AuthResult<T> {
  data: T;
  error: AuthError | null;
}

interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

/** Nama-nama error yang ditiru dari supabase-js supaya pemetaan pesan di route tetap jalan. */
export const AUTH_ERROR_MESSAGES = {
  invalidCredentials: "Invalid login credentials",
  emailTaken: "A user with this email address has already been registered",
  sessionMissing: "Auth session missing!",
  userNotFound: "User not found",
} as const;

function cookieStore() {
  try {
    return cookies();
  } catch {
    // Dipanggil di luar request scope (mis. skrip) — tidak apa-apa.
    return null;
  }
}

function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  const store = cookieStore();
  if (!store) return;
  try {
    store.set({
      name,
      value,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      // Cookie hanya dikirim lewat HTTPS di production (mencegah MITM / downgrade).
      // Di development (http://localhost) Secure dimatikan supaya cookie tetap terkirim.
      secure: process.env.NODE_ENV === "production",
      maxAge: maxAgeSeconds,
    });
  } catch {
    // Server Component tidak bisa menulis cookie — diabaikan (sama seperti pola @supabase/ssr).
  }
}

function deleteCookie(name: string): void {
  const store = cookieStore();
  if (!store) return;
  try {
    // Atribut cookie HARUS SAMA (path/domain/secure/sameSite) dengan saat di-set,
    // kalau tidak browser tidak akan menghapusnya.
    store.set({
      name,
      value: "",
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    });
  } catch {
    // idem
  }
}

export function clearLegacyDemoCookie(): void {
  deleteCookie(LEGACY_DEMO_COOKIE);
}

/** Buat sesi baru + set cookie. */
export async function createSession(userId: string): Promise<string> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  db.prepare(
    "INSERT INTO auth_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, now.toISOString(), expires.toISOString());

  // Bersihkan sesi kedaluwarsa sekalian (murah, tabelnya kecil).
  db.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").run(now.toISOString());

  setCookie(SESSION_COOKIE, token, SESSION_TTL_SECONDS);
  clearLegacyDemoCookie();
  return token;
}

/** Baca sesi dari cookie → user, atau null kalau tidak ada/kedaluwarsa. */
export async function currentUser(): Promise<LocalUser | null> {
  const store = cookieStore();
  const token = store?.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const session = db
    .prepare("SELECT user_id, expires_at FROM auth_sessions WHERE token = ?")
    .get(token) as { user_id: string; expires_at: string } | undefined;

  if (!session) return null;

  if (session.expires_at <= new Date().toISOString()) {
    db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
    return null;
  }

  const account = db
    .prepare("SELECT id, email, created_at FROM auth_accounts WHERE id = ?")
    .get(session.user_id) as Pick<AccountRow, "id" | "email" | "created_at"> | undefined;

  if (!account) return null;

  return { id: account.id, email: account.email, created_at: account.created_at };
}

/** Hapus sesi aktif + cookie. */
export async function destroySession(): Promise<void> {
  const store = cookieStore();
  const token = store?.get(SESSION_COOKIE)?.value;

  if (token) {
    const db = await getDb();
    db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(token);
  }

  deleteCookie(SESSION_COOKIE);
  clearLegacyDemoCookie();
}

/** Login email+password. */
export async function signIn(
  email: string,
  password: string,
): Promise<AuthResult<{ user: LocalUser }>> {
  const db = await getDb();
  const account = db
    .prepare("SELECT * FROM auth_accounts WHERE lower(email) = ?")
    .get(email.trim().toLowerCase()) as AccountRow | undefined;

  if (!account || !verifyPassword(password, account.password_hash)) {
    return { data: { user: null as unknown as LocalUser }, error: { name: "AuthApiError", message: AUTH_ERROR_MESSAGES.invalidCredentials, status: 400 } };
  }

  await createSession(account.id);
  return {
    data: { user: { id: account.id, email: account.email, created_at: account.created_at } },
    error: null,
  };
}

/** Buat akun auth baru (padanan `auth.admin.createUser`). */
export async function createAccount(
  email: string,
  password: string,
): Promise<AuthResult<{ user: LocalUser }>> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();

  const existing = db
    .prepare("SELECT id FROM auth_accounts WHERE lower(email) = ?")
    .get(normalized) as { id: string } | undefined;

  if (existing) {
    return {
      data: { user: null as unknown as LocalUser },
      error: { name: "AuthApiError", message: AUTH_ERROR_MESSAGES.emailTaken, status: 422 },
    };
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO auth_accounts (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, normalized, hashPassword(password), now, now);

  return { data: { user: { id, email: normalized, created_at: now } }, error: null };
}

/** Ubah email/password akun (padanan `auth.admin.updateUserById`). */
export async function updateAccount(
  userId: string,
  attributes: { email?: string; password?: string },
): Promise<AuthResult<{ user: LocalUser }>> {
  const db = await getDb();
  const account = db.prepare("SELECT * FROM auth_accounts WHERE id = ?").get(userId) as
    | AccountRow
    | undefined;

  if (!account) {
    return {
      data: { user: null as unknown as LocalUser },
      error: { name: "AuthApiError", message: AUTH_ERROR_MESSAGES.userNotFound, status: 404 },
    };
  }

  const now = new Date().toISOString();
  let email = account.email;
  let passwordHash = account.password_hash;

  if (attributes.email) {
    const normalized = attributes.email.trim().toLowerCase();
    const duplicate = db
      .prepare("SELECT id FROM auth_accounts WHERE lower(email) = ? AND id <> ?")
      .get(normalized, userId) as { id: string } | undefined;

    if (duplicate) {
      return {
        data: { user: null as unknown as LocalUser },
        error: { name: "AuthApiError", message: AUTH_ERROR_MESSAGES.emailTaken, status: 422 },
      };
    }
    email = normalized;
  }

  if (attributes.password) {
    passwordHash = hashPassword(attributes.password);
    // Password berubah → semua sesi lama diputus.
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
  }

  db.prepare("UPDATE auth_accounts SET email = ?, password_hash = ?, updated_at = ? WHERE id = ?").run(
    email,
    passwordHash,
    now,
    userId,
  );

  return {
    data: { user: { id: userId, email, created_at: account.created_at } },
    error: null,
  };
}

/** Hapus akun + sesinya (padanan `auth.admin.deleteUser`). */
export async function deleteAccount(userId: string): Promise<AuthResult<{ deleted: true }>> {
  const db = await getDb();
  db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM auth_accounts WHERE id = ?").run(userId);
  return { data: { deleted: true }, error: null };
}

/** Putus semua sesi milik satu user (padanan `auth.admin.signOut(id)`). */
export async function revokeSessions(userId: string): Promise<void> {
  const db = await getDb();
  db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
}

/** Jumlah sesi aktif untuk satu user (dipakai uji otomatis). */
export async function countSessions(userId: string): Promise<number> {
  const db = await getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM auth_sessions WHERE user_id = ?")
    .get(userId) as { total: number } | undefined;
  return Number(row?.total ?? 0);
}
