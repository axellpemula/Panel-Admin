#!/usr/bin/env node
/**
 * dev/validate-e2e-test.mjs
 *
 * Uji end-to-end endpoint /api/validate memakai database SQLite lokal:
 *   - Next.js dijalankan dalam mode SQLite (XLOOP_SQLITE_PATH=<file sementara>)
 *   - keypair Ed25519 digenerate saat test (env LICENSE_SIGNING_PRIVATE_KEY)
 *   - data uji dimasukkan langsung ke file SQLite yang sama
 *
 * Yang diuji:
 *   1. Validasi input (400 invalid_request)
 *   2. Happy path + verifikasi signature Ed25519 + isi payload + secret_payload + TTL
 *   3. HWID idempotent, slot bertambah, dan device_limit_exceeded saat penuh
 *   4. wrong_tool, wrong_version, key_banned, key_expired, invalid_key
 *   5. Anti-bruteforce (kegagalan disamarkan jadi invalid_key)
 *   6. Auto-ban setelah 5 HWID berbeda ditolak
 *   7. Rate limit per key → HTTP 429 rate_limited
 *
 * Jalankan: npm run verify:validate
 *
 * CATATAN: skrip ini menjalankan `next dev`, yang memakai folder `.next` yang sama
 * dengan hasil `next build`. Jangan dijalankan bersamaan dengan server produksi
 * (`next start`) dari build sebelumnya — jalankan `npm run build` lagi setelahnya.
 */

import { generateKeyPairSync, randomBytes, verify as cryptoVerify, createPublicKey } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const BetterSqlite = require("better-sqlite3");

const APP_PORT = 3021;
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const SECRET_PAYLOAD = JSON.stringify({ modul: "core", kunci_dekripsi: "rahasia-uji" });

const results = [];
let failures = 0;

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  const mark = passed ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function base64(pem) {
  return Buffer.from(pem, "utf8").toString("base64");
}

/** Kirim request ke /api/validate, ulangi sekali kalau kena rate limit. */
async function postValidate(body, { tolerateRateLimit = false } = {}) {
  const response = await fetch(`${APP_URL}/api/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!tolerateRateLimit && response.status === 429) {
    console.log("  …kena rate limit saat setup, menunggu 62 detik");
    await sleep(62_000);
    return postValidate(body, { tolerateRateLimit });
  }

  return { status: response.status, body: parsed };
}

function nonce() {
  return randomBytes(18).toString("base64url");
}

function hwid(seed) {
  return `hwid-uji-${seed}-${"a".repeat(20)}`.slice(0, 40);
}

/** Buka koneksi ke file SQLite yang dipakai server (WAL → aman untuk baca/tulis bersama). */
function openDatabase(file) {
  const db = new BetterSqlite(file);
  db.pragma("busy_timeout = 5000");
  return db;
}

/** Masukkan data uji: tool/version + 4 key dengan skenario berbeda. */
function seedFixtures(db) {
  const tool = db.prepare("SELECT id FROM tool_types WHERE slug = ?").get("perkakas-pro");
  const version = db
    .prepare("SELECT id FROM tool_versions WHERE tool_type_id = ? AND name = ?")
    .get(tool.id, "1.8.0");

  if (!tool?.id || !version?.id) throw new Error("data contoh (tool/version) tidak ditemukan di DB uji");

  const now = new Date().toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();

  db.prepare(
    "INSERT INTO tool_secrets (tool_type_id, secret_payload, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT (tool_type_id) DO UPDATE SET secret_payload = excluded.secret_payload",
  ).run(tool.id, SECRET_PAYLOAD, now);

  const insertKey = db.prepare(
    "INSERT INTO keys (id, key_value, tool_type_id, tool_version_id, created_by, status, duration_days, " +
      "expired_at, max_device, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  const fixtures = [
    { id: "b0aaaaaaaa-0000-4000-8000-000000000001", value: "XLVP-AB12-CD34", status: "active", expired: future, max: 2 },
    { id: "b0aaaaaaaa-0000-4000-8000-000000000002", value: "XLVP-EE55-FF66", status: "banned", expired: future, max: 1 },
    { id: "b0aaaaaaaa-0000-4000-8000-000000000003", value: "XLVP-GG77-HH88", status: "expired", expired: past, max: 1 },
    { id: "b0aaaaaaaa-0000-4000-8000-000000000004", value: "XLVP-ZZ99-YY88", status: "active", expired: future, max: 1 },
  ];

  fixtures.forEach((fixture) => {
    insertKey.run(
      fixture.id,
      fixture.value,
      tool.id,
      version.id,
      OWNER_ID,
      fixture.status,
      30,
      fixture.expired,
      fixture.max,
      "fixture uji",
      now,
      now,
    );
  });

  return { toolId: tool.id, versionId: version.id };
}

/**
 * Tunggu sampai server siap SEKALIGUS skema SQLite sudah dibuat.
 * Kita menembak /api/validate dengan body berformat benar: pemeriksaan rate
 * limit membaca tabel `validation_attempts`, dan itulah yang membuka koneksi
 * SQLite → skema + data contoh dibuat. Balasannya `invalid_key` (200) karena
 * key uji belum dimasukkan.
 */
async function waitForApp(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${APP_URL}/api/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "XLVP-AAAA-AAAA",
          tool_slug: "perkakas-pro",
          tool_version: "1.8.0",
          hardware_id: "hwid-warmup-aaaaaaaaaaaaaaaaaaaa",
          nonce: "warmupnonce1234567890",
        }),
      });
      if (response.status === 200 || response.status === 429) return true;
    } catch {
      // server belum siap
    }
    await sleep(1000);
  }
  return false;
}

async function main() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const workDir = mkdtempSync(path.join(tmpdir(), "xloop-validate-"));
  const dbFile = path.join(workDir, "xloop.sqlite");
  console.log(`\n[1/7] Database SQLite uji: ${dbFile}`);

  const env = { ...process.env };
  // Paksa mode SQLite: tanpa env Supabase, tanpa flag mock.
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  delete env.NEXT_PUBLIC_MOCK_MODE;
  Object.assign(env, {
    XLOOP_DB: "sqlite",
    XLOOP_SQLITE_PATH: dbFile,
    LICENSE_SIGNING_PRIVATE_KEY: base64(privateKey),
    LICENSE_SIGNING_PUBLIC_KEY: base64(publicKey),
    LICENSE_TOKEN_TTL_SECONDS: "900",
    CRON_SECRET: "cron-uji",
  });

  const app = spawn("node", ["./node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  app.stdout.on("data", () => {});
  app.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.includes("Error") || text.includes("error")) process.stderr.write(`[next] ${text}`);
  });

  let db = null;
  let fixtures = null;

  const stop = () => {
    app.kill("SIGTERM");
    if (db) {
      try {
        db.close();
      } catch {
        // sudah tertutup
      }
    }
    rmSync(workDir, { recursive: true, force: true });
  };

  try {
    console.log(`[2/7] Menyalakan Next.js dev di port ${APP_PORT} …`);
    console.log("      (next dev memakai folder .next — build produksi perlu dijalankan ulang setelah test ini)\n");
    if (!(await waitForApp())) throw new Error("Aplikasi tidak siap dalam batas waktu");
    console.log("[2/7] Aplikasi siap");

    // Server membuat skema + data contoh saat pertama kali membuka DB; kita
    // menyambung ke file yang sama lalu memasukkan data uji khusus.
    db = openDatabase(dbFile);
    fixtures = seedFixtures(db);
    check("aplikasi berjalan di mode SQLite", Boolean(fixtures?.toolId) === true, dbFile);
    console.log("");

    // ---------------------------------------------------------------------
    console.log("[3/7] Validasi input");
    const bad = await postValidate({
      key: "ABC-123",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: hwid(1),
      nonce: nonce(),
    });
    check("key format salah → 400 invalid_request", bad.status === 400 && bad.body.reason === "invalid_request", JSON.stringify(bad.body));

    const badNonce = await postValidate({
      key: "XLVP-AB12-CD34",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: hwid(1),
      nonce: "pendek",
    });
    check("nonce tidak valid → 400 invalid_request", badNonce.status === 400 && badNonce.body.reason === "invalid_request");

    const huge = await postValidate({ ...{}, padding: "x".repeat(3000) });
    check("body > 2 KB → 400 invalid_request", huge.status === 400 && huge.body.reason === "invalid_request");

    // ---------------------------------------------------------------------
    console.log("\n[4/7] Happy path + signature + payload");
    const deviceA = hwid("A");
    const okNonce = nonce();
    const success = await postValidate({
      key: "XLVP-AB12-CD34",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: deviceA,
      nonce: okNonce,
    });

    check("response sukses berisi payload + signature", typeof success.body.payload === "string" && typeof success.body.signature === "string");

    const payloadBytes = Buffer.from(success.body.payload ?? "", "base64");
    const signatureOk = cryptoVerify(
      null,
      payloadBytes,
      createPublicKey(publicKey),
      Buffer.from(success.body.signature ?? "", "base64"),
    );
    check("signature Ed25519 valid", signatureOk);

    const payload = JSON.parse(payloadBytes.toString("utf8"));
    check("payload.valid === true", payload.valid === true);
    check("payload.nonce sama dengan request", payload.nonce === okNonce);
    check("payload.hardware_id sama dengan request", payload.hardware_id === deviceA);
    check("payload.tool & version sesuai", payload.tool === "perkakas-pro" && payload.version === "1.8.0");
    check("payload.current_devices = 1", payload.current_devices === 1, `nilai: ${payload.current_devices}`);
    check("secret_payload dikirim dari tool_secrets", payload.secret_payload === SECRET_PAYLOAD);

    const ttl = (new Date(payload.token_expires_at) - new Date(payload.server_time)) / 1000;
    check("TTL token = LICENSE_TOKEN_TTL_SECONDS (900s)", ttl === 900, `ttl: ${ttl}s`);

    const tampered = Buffer.from(success.body.signature, "base64");
    tampered[0] ^= 0xff;
    check(
      "signature yang dirusak tidak valid",
      cryptoVerify(null, payloadBytes, createPublicKey(publicKey), tampered) === false,
    );

    const again = await postValidate({
      key: "XLVP-AB12-CD34",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: deviceA,
      nonce: nonce(),
    });
    const againPayload = JSON.parse(Buffer.from(again.body.payload ?? "", "base64").toString("utf8"));
    check("HWID sama → tetap ok & tidak menambah slot", againPayload.current_devices === 1, `current: ${againPayload.current_devices}`);

    const deviceB = hwid("B");
    const second = await postValidate({
      key: "XLVP-AB12-CD34",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: deviceB,
      nonce: nonce(),
    });
    const secondPayload = JSON.parse(Buffer.from(second.body.payload ?? "", "base64").toString("utf8"));
    check("HWID baru & slot tersedia → current_devices = 2", secondPayload.current_devices === 2);

    const third = await postValidate({
      key: "XLVP-AB12-CD34",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: hwid("C"),
      nonce: nonce(),
    });
    check("slot penuh → device_limit_exceeded", third.body.reason === "device_limit_exceeded", JSON.stringify(third.body));

    const usedRow = db
      .prepare("SELECT last_used FROM keys WHERE key_value = ?")
      .get("XLVP-AB12-CD34");
    check("last_used ikut ter-update di tabel keys", Boolean(usedRow?.last_used), `last_used=${usedRow?.last_used ?? "-"}`);

    const attempts = db.prepare("SELECT COUNT(*) AS total FROM validation_attempts").get();
    check(
      "percobaan validasi tercatat di validation_attempts",
      Number(attempts.total) > 0,
      `${attempts.total} baris`,
    );

    const deviceCount = db
      .prepare("SELECT COUNT(*) AS total FROM device_logs WHERE key_id = ?")
      .get("b0aaaaaaaa-0000-4000-8000-000000000001");
    check("device_logs berisi 2 HWID untuk key uji", Number(deviceCount.total) === 2, `${deviceCount.total} baris`);

    // ---------------------------------------------------------------------
    console.log("\n[5/7] Kombinasi salah & status key");
    const wrongTool = await postValidate({
      key: "XLVP-AB12-CD34",
      tool_slug: "tool-lain",
      tool_version: "1.8.0",
      hardware_id: deviceA,
      nonce: nonce(),
    });
    check("tool_slug salah → wrong_tool", wrongTool.body.reason === "wrong_tool", JSON.stringify(wrongTool.body));

    const wrongVersion = await postValidate({
      key: "XLVP-AB12-CD34",
      tool_slug: "perkakas-pro",
      tool_version: "9.9.9",
      hardware_id: deviceA,
      nonce: nonce(),
    });
    check("tool_version salah → wrong_version", wrongVersion.body.reason === "wrong_version");

    const banned = await postValidate({
      key: "XLVP-EE55-FF66",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: deviceA,
      nonce: nonce(),
    });
    check("key banned → key_banned", banned.body.reason === "key_banned");

    const expired = await postValidate({
      key: "XLVP-GG77-HH88",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: deviceA,
      nonce: nonce(),
    });
    check("key expired → key_expired", expired.body.reason === "key_expired");

    const unknown = await postValidate({
      key: "XLVP-QQ11-QQ22",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: deviceA,
      nonce: nonce(),
    });
    check("key tidak ada → invalid_key", unknown.body.reason === "invalid_key");

    // ---------------------------------------------------------------------
    console.log("\n[6/7] Anti-bruteforce & auto-ban");
    // 4 kali tambahan invalid_key supaya total ≥ 5 dalam 10 menit.
    for (let i = 0; i < 4; i += 1) {
      await postValidate({
        key: `XLVP-QQ${i}${i}-QQ${i}${i}`,
        tool_slug: "perkakas-pro",
        tool_version: "1.8.0",
        hardware_id: deviceA,
        nonce: nonce(),
      });
    }
    const masked = await postValidate({
      key: "XLVP-EE55-FF66",
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: deviceA,
      nonce: nonce(),
    });
    check(
      "setelah ≥5 invalid_key, reason disamarkan jadi invalid_key",
      masked.body.reason === "invalid_key",
      `reason: ${masked.body.reason}`,
    );

    const autoBanKey = "XLVP-ZZ99-YY88";
    await postValidate({
      key: autoBanKey,
      tool_slug: "perkakas-pro",
      tool_version: "1.8.0",
      hardware_id: hwid("ban-0"),
      nonce: nonce(),
    });
    for (let i = 1; i <= 6; i += 1) {
      await postValidate({
        key: autoBanKey,
        tool_slug: "perkakas-pro",
        tool_version: "1.8.0",
        hardware_id: hwid(`ban-${i}`),
        nonce: nonce(),
      });
    }
    const bannedRow = db.prepare("SELECT status, note FROM keys WHERE key_value = ?").get(autoBanKey);
    check(
      "auto-ban setelah 5 HWID berbeda ditolak",
      bannedRow?.status === "banned",
      `status: ${bannedRow?.status}, note: ${bannedRow?.note ?? "-"}`,
    );

    // ---------------------------------------------------------------------
    console.log("\n[7/7] Rate limit");
    let hitRateLimit = false;
    let rateLimitBody = null;
    for (let i = 0; i < 20 && !hitRateLimit; i += 1) {
      const response = await fetch(`${APP_URL}/api/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "XLVP-AB12-CD34",
          tool_slug: "perkakas-pro",
          tool_version: "1.8.0",
          hardware_id: deviceB,
          nonce: nonce(),
        }),
      });
      if (response.status === 429) {
        hitRateLimit = true;
        rateLimitBody = await response.json();
      }
    }
    check(
      "request berlebih → HTTP 429 rate_limited",
      hitRateLimit && rateLimitBody?.reason === "rate_limited",
      JSON.stringify(rateLimitBody),
    );
  } catch (error) {
    console.error("\nTerjadi error saat test:", error);
    failures += 1;
  } finally {
    stop();
  }

  const passed = results.filter((item) => item.passed).length;
  console.log("\n─────────────────────────────────────────────");
  console.log(`Hasil: ${passed}/${results.length} pemeriksaan lulus`);
  if (failures > 0) console.log(`GAGAL: ${failures} pemeriksaan`);
  console.log("─────────────────────────────────────────────\n");

  process.exit(failures > 0 ? 1 : 0);
}

void main();
