#!/usr/bin/env node
/**
 * XLOOP PANEL — contoh verifikasi lisensi sisi client (JavaScript / Node.js).
 *
 * Alur:
 *  1. Buat nonce random baru setiap request.
 *  2. POST ke /api/validate.
 *  3. Verifikasi signature (Ed25519) dengan public key yang ditanam di tool.
 *  4. Decode payload: cek valid, nonce, hardware_id, tool, dan version.
 *  5. Hitung ttl dari server_time (jangan pakai jam device), lalu jadwalkan
 *     validasi ulang pakai timer lokal.
 *  6. secret_payload disimpan di memori saja.
 *  7. Pengecekan disebar di beberapa fungsi, bukan satu isValid().
 *
 * Pemakaian:
 *   node verify_example.js --sample ../examples/sample-response.json
 *   node verify_example.js --url https://panel.vercel.app --key XLVP-AB12-CD34 \
 *        --tool perkakas-pro --version 1.8.0 --public-key-file ./public_key.pem
 */

import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname, platform, arch } from "node:os";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    out[key] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

/** HWID = sha256 dari info device (stabil, tidak mengirim info mentah). */
export function computeHardwareId() {
  const raw = [hostname(), platform(), arch(), String(process.pid)].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

/** Nonce baru tiap request: 16–64 karakter [A-Za-z0-9_-]. */
export function newNonce() {
  return randomBytes(18).toString("base64url");
}

function decodeBase64(value) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verifikasi response dari /api/validate.
 * @returns payload (object) — melempar Error kalau tidak valid.
 */
export function verifyResponse(data, publicKeyPem, expected) {
  // Response sukses = { payload, signature }. Response gagal = { valid: false, reason }.
  // Semua yang bukan sukses-bertanda-tangan-valid dianggap gagal.
  if (!data || typeof data.payload !== "string" || typeof data.signature !== "string") {
    throw new Error(`gagal: ${data?.reason ?? "format response tidak dikenal"}`);
  }

  // 3. Signature dihitung atas byte JSON payload (sebelum base64).
  const payloadBytes = decodeBase64(data.payload);
  const signature = decodeBase64(data.signature);
  const publicKey = createPublicKey(publicKeyPem);

  const signatureOk = cryptoVerify(null, payloadBytes, publicKey, signature);
  if (!signatureOk) throw new Error("signature tidak valid");

  // 4. Cek isi payload benar-benar cocok dengan request ini.
  const payload = JSON.parse(payloadBytes.toString("utf8"));
  if (payload.valid !== true) throw new Error("payload_not_valid");
  if (payload.nonce !== expected.nonce) throw new Error("nonce_mismatch");
  if (payload.hardware_id !== expected.hardwareId) throw new Error("hwid_mismatch");
  if (payload.tool !== expected.toolSlug || payload.version !== expected.toolVersion) {
    throw new Error("tool_version_mismatch");
  }

  return payload;
}

/** Kelas kecil untuk menyimpan state lisensi + timer refresh. */
export class LicenseClient {
  constructor({ baseUrl, publicKeyPem, key, toolSlug, toolVersion }) {
    this.baseUrl = baseUrl?.replace(/\/$/, "");
    this.publicKeyPem = publicKeyPem;
    this.key = key;
    this.toolSlug = toolSlug;
    this.toolVersion = toolVersion;
    this.hardwareId = computeHardwareId();
    this.state = { valid: false, secretPayload: null, reason: "belum divalidasi", expiresAt: 0 };
    this.refreshTimer = null;
  }

  async validateOnce() {
    const nonce = newNonce();
    const response = await fetch(`${this.baseUrl}/api/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: this.key,
        tool_slug: this.toolSlug,
        tool_version: this.toolVersion,
        hardware_id: this.hardwareId,
        nonce,
      }),
    });

    const data = await response.json();
    if (!data.valid) {
      this.state = { valid: false, secretPayload: null, reason: data.reason, expiresAt: 0 };
      return this.state;
    }

    try {
      const payload = verifyResponse(data, this.publicKeyPem, {
        nonce,
        hardwareId: this.hardwareId,
        toolSlug: this.toolSlug,
        toolVersion: this.toolVersion,
      });

      // 5. ttl dari server_time → jadwalkan refresh lokal.
      const ttlMs = new Date(payload.token_expires_at).getTime() - new Date(payload.server_time).getTime();
      if (!(ttlMs > 0)) throw new Error("token_ttl_invalid");

      this.state = {
        valid: true,
        secretPayload: payload.secret_payload,
        reason: null,
        expiresAt: Date.now() + ttlMs,
      };
      this.#scheduleRefresh(ttlMs);
      return this.state;
    } catch (error) {
      this.state = { valid: false, secretPayload: null, reason: error.message, expiresAt: 0 };
      return this.state;
    }
  }

  #scheduleRefresh(ttlMs) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const interval = Math.max(30_000, ttlMs * 0.75);
    this.refreshTimer = setTimeout(async () => {
      const state = await this.validateOnce();
      if (!state.valid) {
        // Validasi ulang gagal → tool berhenti.
        console.error("[license] validasi ulang gagal:", state.reason);
      }
    }, interval);
    this.refreshTimer.unref?.();
  }

  // 7. Pengecekan disebar di beberapa fungsi.
  #guard() {
    if (!this.state.valid) throw new Error(`lisensi tidak valid (${this.state.reason})`);
    if (Date.now() > this.state.expiresAt) {
      this.state = { ...this.state, valid: false, reason: "token_expired" };
      throw new Error("token validasi kedaluwarsa");
    }
    return this.state;
  }

  isFeatureEnabled(feature) {
    const state = this.#guard();
    return typeof state.secretPayload === "string" && state.secretPayload.includes(feature);
  }

  /** 6. secret hanya di memori — jangan ditulis ke disk. */
  getSecretPayload() {
    return this.#guard().secretPayload ?? "";
  }
}

async function main() {
  if (args.sample) {
    const sample = JSON.parse(readFileSync(args.sample, "utf8"));
    const payload = verifyResponse(sample.response, sample.public_key_pem, {
      nonce: sample.request.nonce,
      hardwareId: sample.request.hardware_id,
      toolSlug: sample.request.tool_slug,
      toolVersion: sample.request.tool_version,
    });
    console.log("Signature: VALID");
    console.log("secret_payload diterima:", Boolean(payload.secret_payload));

    const tampered = Buffer.from(sample.response.signature, "base64");
    tampered[0] ^= 0xff;
    try {
      verifyResponse({ ...sample.response, signature: tampered.toString("base64") }, sample.public_key_pem, {
        nonce: sample.request.nonce,
        hardwareId: sample.request.hardware_id,
        toolSlug: sample.request.tool_slug,
        toolVersion: sample.request.tool_version,
      });
      console.log("GAGAL: signature dirusak tapi tetap diterima");
      process.exitCode = 1;
    } catch {
      console.log("Signature dirusak: DITOLAK (benar)");
    }
    return;
  }

  if (!args.url || !args.key) {
    console.error("Butuh --url dan --key (atau pakai --sample)");
    process.exitCode = 2;
    return;
  }

  const client = new LicenseClient({
    baseUrl: args.url,
    publicKeyPem: readFileSync(args["public-key-file"] ?? "public_key.pem", "utf8"),
    key: args.key,
    toolSlug: args.tool ?? "perkakas-pro",
    toolVersion: args.version ?? "1.8.0",
  });

  const state = await client.validateOnce();
  if (!state.valid) {
    console.error("Lisensi TIDAK valid:", state.reason);
    process.exitCode = 1;
    return;
  }

  console.log("Lisensi valid.");
  console.log("secret tersedia:", client.getSecretPayload().length > 0);
}

if (process.argv[1] && process.argv[1].endsWith("verify_example.js")) {
  await main();
}
