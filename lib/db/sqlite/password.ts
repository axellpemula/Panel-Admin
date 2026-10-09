/**
 * Hash password untuk mode SQLite.
 *
 * Di Supabase, password ditangani Supabase Auth (bcrypt di sisi server mereka).
 * Di mode lokal kita memakai `scrypt` bawaan Node — bukan library tambahan —
 * dengan salt acak 16 byte per akun. Format tersimpan:
 *
 *   scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
 *
 * Verifikasi memakai `timingSafeEqual` supaya tidak bocor lewat waktu eksekusi.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const salt = Buffer.from(saltRaw, "base64");
  const expected = Buffer.from(hashRaw, "base64");

  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, {
      N: Number.parseInt(nRaw, 10),
      r: Number.parseInt(rRaw, 10),
      p: Number.parseInt(pRaw, 10),
    });
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
