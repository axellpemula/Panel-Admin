#!/usr/bin/env node
/**
 * scripts/make-sample-response.mjs
 *
 * Utilitas development: membuat SATU response sukses /api/validate palsu
 * (payload + signature Ed25519) persis seperti yang dikirim server.
 *
 * Gunanya: menguji kode verifikasi di sisi client (Python / JavaScript)
 * tanpa perlu deploy panel dulu.
 *
 * Pakai:
 *   node scripts/make-sample-response.mjs
 *   node scripts/make-sample-response.mjs --hwid <hwid> --nonce <nonce>
 *
 * Output:
 *   docs/examples/sample-response.json   (payload + signature)
 *   docs/examples/dev-public-key.pem     (public key untuk verifikasi)
 *
 * PENTING: jangan pakai keypair contoh ini di production.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const hardwareId = arg("hwid", "a3f1b7c9d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5061728394a5b6c7d8e9");
const nonce = arg("nonce", "n0nce_rahasia_32_karakter_abc123");

// Keypair contoh — HANYA untuk menguji verifier di sisi client.
const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const serverTime = new Date();
const payloadObject = {
  valid: true,
  tool: "perkakas-pro",
  version: "1.8.0",
  expired_at: new Date(serverTime.getTime() + 30 * 86_400_000).toISOString(),
  max_device: 1,
  current_devices: 1,
  hardware_id: hardwareId,
  nonce,
  server_time: serverTime.toISOString(),
  token_expires_at: new Date(serverTime.getTime() + 900 * 1000).toISOString(),
  secret_payload: JSON.stringify({ modul: "core", kunci_dekripsi: "contoh-saja-jangan-dipakai" }),
};

// Signature dihitung atas byte JSON payload SEBELUM di-encode base64.
const payloadJson = JSON.stringify(payloadObject);
const signature = sign(null, Buffer.from(payloadJson, "utf8"), privateKey);

const responseBody = {
  payload: Buffer.from(payloadJson, "utf8").toString("base64"),
  signature: signature.toString("base64"),
};

const outDir = path.join(process.cwd(), "docs", "examples");
mkdirSync(outDir, { recursive: true });

writeFileSync(
  path.join(outDir, "sample-response.json"),
  `${JSON.stringify(
    {
      _catatan:
        "Contoh response sukses /api/validate yang ditandatangani keypair contoh. Dipakai untuk menguji kode verifikasi client. Jangan pakai di production.",
      public_key_pem: publicKey.trim(),
      request: {
        key: "XLVP-AB12-CD34",
        tool_slug: "perkakas-pro",
        tool_version: "1.8.0",
        hardware_id: hardwareId,
        nonce,
      },
      response: responseBody,
    },
    null,
    2,
  )}\n`,
);

writeFileSync(path.join(outDir, "dev-public-key.pem"), `${publicKey.trim()}\n`);

console.log("Sample response dibuat:");
console.log(` - ${path.join("docs/examples", "sample-response.json")}`);
console.log(` - ${path.join("docs/examples", "dev-public-key.pem")}`);
console.log("");
console.log(`nonce      : ${nonce}`);
console.log(`hardware_id: ${hardwareId}`);
