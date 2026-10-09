import { randomInt } from "node:crypto";
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

import { KEY_ALPHABET, KEY_REGEX } from "@/lib/constants";

/**
 * Utilitas kriptografi untuk signing lisensi & pembuatan key.
 * Server-only (import dari API route saja).
 */

/** Base64 standar (RFC 4648) — dipakai untuk `payload` & `signature` di response. */
export function base64Encode(data: Buffer | string): string {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return buffer.toString("base64");
}

/** Base64 decode — menerima base64 standar maupun base64url. */
export function base64Decode(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

/** Base64url encode (utilitas tambahan, aman dipakai di URL). */
export function base64UrlEncode(data: Buffer | string): string {
  return base64Encode(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Base64url decode. */
export function base64UrlDecode(value: string): Buffer {
  return base64Decode(value);
}

/** Baca PEM dari env: boleh PEM mentah atau PEM yang di-encode base64 satu baris. */
export function pemFromEnv(raw: string): string {
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN")) {
    throw new Error("Format key tidak dikenal: bukan PEM dan bukan base64 dari PEM.");
  }
  return decoded;
}

/**
 * Bangun KeyObject Ed25519 dari env. privateKey true → PKCS8 PRIVATE KEY,
 * false → PUBLIC KEY (SubjectPublicKeyInfo).
 */
export function loadSigningKey(envValue: string, kind: "private" | "public"): KeyObject {
  const pem = pemFromEnv(envValue);
  return kind === "private"
    ? createPrivateKey({ key: pem, format: "pem" })
    : createPublicKey({ key: pem, format: "pem" });
}

/**
 * Tanda tangani payload JSON. Signature dihitung atas byte JSON payload
 * SEBELUM di-encode base64 (lihat docs/CLIENT_INTEGRATION.md).
 */
export function signJsonPayload(payloadJson: string, privateKey: KeyObject): Buffer {
  return sign(null, Buffer.from(payloadJson, "utf8"), privateKey);
}

/** Verifikasi signature Ed25519 — dipakai oleh test lokal, bukan oleh server. */
export function verifyJsonPayload(
  payloadJson: string,
  signature: Buffer,
  publicKey: KeyObject,
): boolean {
  return verify(null, Buffer.from(payloadJson, "utf8"), publicKey, signature);
}

/**
 * Generate key unik format XLVP-XXXX-XXXX memakai CSPRNG Node.js
 * (`crypto.randomInt`), bukan Math.random.
 */
export function generateKeyValue(): string {
  const block = (): string => {
    let out = "";
    for (let i = 0; i < 4; i += 1) {
      out += KEY_ALPHABET[randomInt(0, KEY_ALPHABET.length)];
    }
    return out;
  };
  return `XLVP-${block()}-${block()}`;
}

/**
 * Generate sekumpulan key unik. Duplikat terhadap `existing` (Set dari DB)
 * akan di-generate ulang, dan duplikat di dalam batch ini juga dibuang.
 */
export function generateUniqueKeys(count: number, existing: Set<string>): string[] {
  const result = new Set<string>();
  let guard = 0;
  const maxAttempts = count * 50 + 1000;

  while (result.size < count) {
    guard += 1;
    if (guard > maxAttempts) {
      throw new Error("Gagal membuat key unik: ruang key terlalu penuh. Coba lagi.");
    }
    const candidate = generateKeyValue();
    if (!KEY_REGEX.test(candidate)) continue;
    if (existing.has(candidate)) continue;
    result.add(candidate);
  }

  return Array.from(result);
}

/** Nonce random untuk kebutuhan server-side (test, seeding). */
export function randomNonce(length = 24): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let out = "";
  for (let i = 0; i < length; i += 1) out += chars[randomInt(0, chars.length)];
  return out;
}
