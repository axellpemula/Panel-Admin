#!/usr/bin/env node
/**
 * scripts/generate-keypair.mjs
 *
 * Membuat pasangan key Ed25519 untuk menandatangani response /api/validate.
 * Output berupa base64 satu baris, siap ditempel ke environment variables.
 *
 * Pakai:
 *   node scripts/generate-keypair.mjs           # tampilkan ke terminal
 *   node scripts/generate-keypair.mjs --write   # tulis langsung ke .env.local
 *   node scripts/generate-keypair.mjs --env     # format siap tempel (dotenv)
 *
 * PENTING:
 * - Private key HANYA untuk server (Vercel env, bukan NEXT_PUBLIC_*).
 * - Public key ditanam di sisi tool/mod (lihat docs/CLIENT_INTEGRATION.md).
 * - Kalau private key bocor, tool yang memakai public key lama tetap aman;
 *   cukup generate keypair baru dan update public key di tool + env server.
 */

import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const writeToFile = args.has("--write");
const dotenvFormat = args.has("--env") || writeToFile;

function toBase64(pem) {
  return Buffer.from(pem, "utf8").toString("base64");
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const privateB64 = toBase64(privateKey);
const publicB64 = toBase64(publicKey);

console.log("");
console.log("=== XLOOP PANEL — Ed25519 keypair ===");
console.log("");
console.log("Salin ke environment variables (Vercel / .env.local):");
console.log("");
console.log(`LICENSE_SIGNING_PRIVATE_KEY=${privateB64}`);
console.log("");
console.log(`LICENSE_SIGNING_PUBLIC_KEY=${publicB64}`);
console.log("");
console.log("LICENSE_TOKEN_TTL_SECONDS=900   # opsional, default 900 detik");
console.log("");
console.log("--- Public key (PEM) untuk ditanam di sisi tool ---");
console.log(publicKey.trim());
console.log("");

if (writeToFile) {
  const envPath = path.join(process.cwd(), ".env.local");
  const block = [
    "",
    "# --- Ed25519 signing (digenerate oleh scripts/generate-keypair.mjs) ---",
    `LICENSE_SIGNING_PRIVATE_KEY=${privateB64}`,
    `LICENSE_SIGNING_PUBLIC_KEY=${publicB64}`,
    "LICENSE_TOKEN_TTL_SECONDS=900",
    "",
  ].join("\n");

  if (existsSync(envPath)) {
    const existing = readFileSync(envPath, "utf8");
    if (existing.includes("LICENSE_SIGNING_PRIVATE_KEY")) {
      console.log(
        ".env.local sudah punya LICENSE_SIGNING_PRIVATE_KEY — tidak ditimpa. Ganti manual kalau perlu rotasi key.",
      );
    } else {
      appendFileSync(envPath, block);
      console.log(`Ditambahkan ke ${envPath} (nilai lama tidak diubah).`);
    }
  } else {
    writeFileSync(envPath, `# XLOOP PANEL — environment lokal${block}`);
    console.log(`Dibuat file baru: ${envPath}`);
  }
} else if (dotenvFormat) {
  console.log("(pakai --write untuk menyimpan ke .env.local)");
}
