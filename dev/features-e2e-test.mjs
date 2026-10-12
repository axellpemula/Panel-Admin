#!/usr/bin/env node
/**
 * dev/features-e2e-test.mjs
 *
 * Uji end-to-end TUJUH FITUR BARU dalam mode SQLite (tanpa Supabase):
 *
 *  #1  Ganti password sendiri + putus sesi lain (/api/auth/password, /api/auth/sessions)
 *  #2  Notifikasi keluar: webhook + Telegram (brute-force, auto-ban, saldo tipis, digest)
 *  #4  Penyesuaian credit reseller oleh Owner (tambah/kurang + alasan wajib)
 *  #12 Konfigurasi runtime dari Pengaturan (limit, TTL token, retensi, API publik)
 *  #14 API key reseller + API publik /api/v1 (auth, rate limit, kuota, audit)
 *  #15 Bot Telegram (webhook: secret, penautan chat, perintah)
 *  #16 Analitik anti-abuse (satu HWID banyak key & satu key banyak IP)
 *
 * Menjalankan server sendiri (`next dev` port 3023) dengan database sementara di
 * folder tmp, plus satu server webhook lokal untuk menangkap notifikasi keluar.
 * Semuanya dibersihkan lagi setelah selesai.
 *
 * Jalankan: npm run verify:features
 *
 * CATATAN: sama seperti verify:sqlite, skrip ini memakai folder `.next` yang sama
 * dengan `next build` — jalankan `npm run build` lagi setelahnya.
 */

import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const BetterSqlite = require("better-sqlite3");

const APP_PORT = 3023;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const WEBHOOK_PORT = 3024;
const WEBHOOK_PATH = "/notify-hook";
const CRON_SECRET = "cron-uji";

const OWNER = { email: "owner@gmail.com", password: "Axell123" };
const ANDI = { email: "andi@example.com", password: "Reseller123" };
const BUDI = { email: "budi@example.com", password: "Reseller123" };

const results = [];
let failures = 0;

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Klien HTTP yang menyimpan cookie sesi seperti browser. */
function createClient() {
  let cookie = "";

  async function request(method, url, body) {
    const response = await fetch(`${APP_URL}${url}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });

    const setCookies = response.headers.getSetCookie?.() ?? [];
    setCookies.forEach((value) => {
      const pair = value.split(";")[0];
      if (pair.startsWith("xloop_session=")) {
        cookie = pair.endsWith("=") ? "" : pair;
      }
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }

    return { status: response.status, body: parsed, text };
  }

  return {
    get: (url) => request("GET", url),
    post: (url, body) => request("POST", url, body),
    put: (url, body) => request("PUT", url, body),
    delete: (url, body) => request("DELETE", url, body),
    getCookie: () => cookie,
  };
}

async function waitForApp(timeoutMs = 150_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${APP_URL}/api/auth/session`);
      if (response.ok) return true;
    } catch {
      // belum siap
    }
    await sleep(1000);
  }
  return false;
}

/** Server webhook lokal untuk menangkap notifikasi keluar. */
function startWebhookReceiver() {
  const received = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        received.push(JSON.parse(body));
      } catch {
        received.push({ raw: body.slice(0, 200) });
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    });
  });
  server.listen(WEBHOOK_PORT, "127.0.0.1");
  return { server, received };
}

/** Tunggu sampai notifikasi dengan event tertentu muncul (polling ringan). */
async function waitForEvent(received, event, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (received.some((item) => item.event === event)) return true;
    await sleep(250);
  }
  return false;
}

/** Panggilan /api/validate mentah (endpoint publik, tanpa cookie). */
async function validate(body, ip) {
  const response = await fetch(`${APP_URL}/api/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}) },
    // `nonce` wajib (16–64 karakter) — sama seperti klien tool sungguhan.
    body: JSON.stringify({ nonce: randomBytes(18).toString("base64url"), ...body }),
  });
  return response.json();
}

/** Panggilan /api/v1 dengan API key. */
async function apiV1(token, path, init = {}) {
  const response = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

async function main() {
  const workDir = mkdtempSync(path.join(tmpdir(), "xloop-features-"));
  const dbFile = path.join(workDir, "xloop.sqlite");

  const { privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const env = { ...process.env };
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  Object.assign(env, {
    XLOOP_DB: "sqlite",
    XLOOP_SQLITE_PATH: dbFile,
    LICENSE_SIGNING_PRIVATE_KEY: Buffer.from(privateKey, "utf8").toString("base64"),
    LICENSE_TOKEN_TTL_SECONDS: "900",
    CRON_SECRET,
    XLOOP_NOTIFY_WEBHOOK_URL: `http://127.0.0.1:${WEBHOOK_PORT}${WEBHOOK_PATH}`,
  });

  console.log(`\n[1/9] Database sementara: ${dbFile}`);
  const { server: webhookServer, received } = startWebhookReceiver();

  const app = spawn("node", ["./node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", () => {});
  app.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (/\[validate\]|\[notify\]|\[settings\]|error/i.test(text) && !/favicon/i.test(text)) {
      process.stderr.write(`[next] ${text}`);
    }
  });

  let db = null;
  const stop = () => {
    app.kill("SIGTERM");
    webhookServer.close();
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
    if (!(await waitForApp())) throw new Error("Aplikasi tidak siap dalam batas waktu");
    db = new BetterSqlite(dbFile);
    db.pragma("busy_timeout = 5000");

    const owner = createClient();
    const andi = createClient();
    const budi = createClient();

    // ------------------------------------------------------------- [2/9] LOGIN
    console.log("\n[2/9] Login & konfigurasi runtime (#12)");
    check("login owner", (await owner.post("/api/auth/login", OWNER)).status === 200);
    check("login reseller andi", (await andi.post("/api/auth/login", ANDI)).status === 200);
    check("login reseller budi", (await budi.post("/api/auth/login", BUDI)).status === 200);

    const andiRow = db.prepare("SELECT id, credit, username FROM profiles WHERE username = 'andi'").get();
    const budiRow = db.prepare("SELECT id, username FROM profiles WHERE username = 'budi'").get();
    const tool = db.prepare("SELECT id, slug FROM tool_types WHERE is_active = 1 LIMIT 1").get();
    const version = db
      .prepare("SELECT id, name FROM tool_versions WHERE tool_type_id = ? AND is_active = 1 LIMIT 1")
      .get(tool.id);
    const preset = db.prepare("SELECT id FROM duration_presets ORDER BY days ASC LIMIT 1").get();

    const settingsAsReseller = await andi.get("/api/settings");
    check(
      "reseller ditolak membaca pengaturan sistem (403)",
      settingsAsReseller.status === 403,
      `status=${settingsAsReseller.status}`,
    );

    const settings = await owner.get("/api/settings");
    const runtimeDefaults = settings.body?.data?.runtime;
    check(
      "pengaturan awal = default lib/constants (30/menit IP, HWID 3×/24 jam, API aktif)",
      runtimeDefaults?.validate?.perIpPerMinute === 30 &&
        runtimeDefaults?.hwid?.resetLimit === 3 &&
        runtimeDefaults?.hwid?.resetWindowHours === 24 &&
        runtimeDefaults?.api?.enabled === true,
      JSON.stringify({ validate: runtimeDefaults?.validate, hwid: runtimeDefaults?.hwid, api: runtimeDefaults?.api }),
    );
    check(
      "GET /api/settings menyertakan default & rentang aman",
      Boolean(settings.body?.data?.defaults && settings.body?.data?.bounds?.perIpPerMinute),
    );

    const clampedAttempt = await owner.put("/api/settings", {
      validate: { perIpPerMinute: 99_999, tokenTtlSeconds: 10, bruteForceFailures: 3 },
      hwid: { resetLimit: 1, resetWindowHours: 24 },
      retention: { attemptsDays: 7 },
      api: { enabled: true, rateLimitPerMinute: 60 },
      notify: {
        enabled: true,
        lowCreditThreshold: 0,
        dedupeMinutes: 30,
        notifyReseller: false,
        events: { autoBan: true, validationBurst: true, lowCredit: true, digest: true },
      },
    });
    const clamped = clampedAttempt.body?.data?.runtime;
    check(
      "nilai di luar rentang dijepit (perIpPerMinute → 1000, TTL → 60 detik)",
      clamped?.validate?.perIpPerMinute === 1000 && clamped?.validate?.tokenTtlSeconds === 60,
      `perIp=${clamped?.validate?.perIpPerMinute} ttl=${clamped?.validate?.tokenTtlSeconds}`,
    );
    check(
      "perubahan pengaturan tercatat di activity log (settings_update)",
      Array.isArray(clampedAttempt.body?.data?.changed) &&
        clampedAttempt.body.data.changed.length > 0 &&
        db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'settings_update'").get().n >= 1,
      JSON.stringify(clampedAttempt.body?.data?.changed ?? []),
    );

    // Nilai nyaman untuk uji berikutnya: IP 300/menit (tidak mengganggu), brute-force 3,
    // kuota reset HWID 1x supaya cooldown gampang diuji, TTL token tetap 900 detik.
    await owner.put("/api/settings", {
      validate: { perIpPerMinute: 300, perKeyPerMinute: 60, bruteForceFailures: 3, tokenTtlSeconds: 900 },
    });

    // ------------------------------------------------ [3/9] PASSWORD & SESI
    console.log("\n[3/9] Ganti password + sesi aktif (#1)");
    const andiOtherDevice = createClient();
    check(
      "login kedua andi dari perangkat lain",
      (await andiOtherDevice.post("/api/auth/login", ANDI)).status === 200,
    );

    const badCurrent = await andi.post("/api/auth/password", {
      current_password: "password-salah",
      new_password: "Reseller123baru",
    });
    check(
      "password lama salah ditolak (401)",
      badCurrent.status === 401,
      `${badCurrent.status} ${badCurrent.body?.error ?? ""}`,
    );

    const weakPassword = await andi.post("/api/auth/password", {
      current_password: ANDI.password,
      new_password: "pendek",
    });
    check("password baru terlalu pendek ditolak (400)", weakPassword.status === 400);

    const sessionsBefore = await andi.get("/api/auth/sessions");
    check(
      "daftar sesi aktif terbaca + detail perangkat (ip/user agent)",
      sessionsBefore.status === 200 &&
        Array.isArray(sessionsBefore.body?.data?.items) &&
        sessionsBefore.body.data.items.filter((item) => item.current === true).length === 1 &&
        sessionsBefore.body.data.items.some((item) => item.user_agent !== null),
      `jumlah=${sessionsBefore.body?.data?.items?.length ?? 0}`,
    );

    const changed = await andi.post("/api/auth/password", {
      current_password: ANDI.password,
      new_password: "Reseller123baru",
      logout_others: true,
    });
    check(
      "ganti password sendiri berhasil (sesi token diganti)",
      changed.status === 200 && changed.body?.data?.updated === true,
    );

    const oldPasswordLogin = await createClient().post("/api/auth/login", ANDI);
    check("login dengan password lama ditolak (401)", oldPasswordLogin.status === 401);

    const otherDeviceAfterChange = await andiOtherDevice.get("/api/auth/session");
    check(
      "perangkat lain otomatis logout setelah ganti password",
      otherDeviceAfterChange.body?.session === null,
      JSON.stringify(otherDeviceAfterChange.body?.session ?? null),
    );

    const currentAfterChange = await andi.get("/api/auth/session");
    check("perangkat yang dipakai ganti password tetap login", currentAfterChange.body?.session?.username === "andi");

    check(
      "login dengan password baru berhasil",
      (await createClient().post("/api/auth/login", { email: ANDI.email, password: "Reseller123baru" })).status === 200,
    );
    check(
      "ganti password tercatat di activity log",
      db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'password_change'").get().n >= 1,
    );

    // Putus sesi lain lewat endpoint khusus (sesi kedua masih ada? tidak — sudah mati;
    // buat satu lagi supaya ada yang bisa diputus).
    const andiExtra = createClient();
    await andiExtra.post("/api/auth/login", { email: ANDI.email, password: "Reseller123baru" });
    const revoked = await andi.delete("/api/auth/sessions");
    check(
      "DELETE /api/auth/sessions memutus sesi lain",
      revoked.status === 200 && (revoked.body?.data?.revoked ?? 0) >= 1,
      `revoked=${revoked.body?.data?.revoked}`,
    );
    check("sesi lain benar-benar mati", (await andiExtra.get("/api/auth/session")).body?.session === null);
    check(
      "pemutusan sesi tercatat di activity log",
      db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'sessions_revoke'").get().n >= 1,
    );

    // Kembalikan password awal supaya uji lain memakai kredensial yang sama.
    await andi.post("/api/auth/password", {
      current_password: "Reseller123baru",
      new_password: ANDI.password,
    });

    // ------------------------------------------------- [4/9] PENYESUAIAN CREDIT
    console.log("\n[4/9] Penyesuaian credit oleh Owner (#4)");
    const creditBefore = db.prepare("SELECT credit FROM profiles WHERE id = ?").get(andiRow.id).credit;

    const addCredit = await owner.put(`/api/resellers/${andiRow.id}`, {
      action: "adjust_credit",
      amount: 7,
      reason: "kompensasi key error",
    });
    check(
      "penyesuaian positif menambah saldo",
      addCredit.status === 200 && addCredit.body?.data?.balance === creditBefore + 7,
      `${creditBefore} → ${addCredit.body?.data?.balance}`,
    );

    const subtractCredit = await owner.put(`/api/resellers/${andiRow.id}`, {
      action: "adjust_credit",
      amount: -3,
      reason: "koreksi kelebihan topup",
      note: "selisih transfer",
    });
    check(
      "penyesuaian negatif mengurangi saldo",
      subtractCredit.status === 200 && subtractCredit.body?.data?.balance === creditBefore + 4,
      `balance=${subtractCredit.body?.data?.balance}`,
    );

    const zeroAmount = await owner.put(`/api/resellers/${andiRow.id}`, {
      action: "adjust_credit",
      amount: 0,
      reason: "uji nol",
    });
    check("penyesuaian 0 ditolak (400)", zeroAmount.status === 400);

    const noReason = await owner.put(`/api/resellers/${andiRow.id}`, { action: "adjust_credit", amount: 5 });
    check("penyesuaian tanpa alasan ditolak (400)", noReason.status === 400);

    const overSubtract = await owner.put(`/api/resellers/${andiRow.id}`, {
      action: "adjust_credit",
      amount: -(creditBefore + 50),
      reason: "uji batas",
    });
    check("pengurangan melebihi saldo ditolak (409 conflict)", overSubtract.status === 409);

    const adjustmentLogs = await owner.get("/api/credits?action=adjustment&per_page=5");
    const adjustmentItems = adjustmentLogs.body?.data?.items ?? [];
    check(
      "credit log mencatat aksi `adjustment` + alasannya",
      adjustmentItems.length >= 2 &&
        adjustmentItems.every((item) => item.action === "adjustment") &&
        /kompensasi|koreksi/.test(
          adjustmentItems.map((item) => item.note ?? "").join(" "),
        ),
      JSON.stringify(adjustmentItems[0] ?? null).slice(0, 140),
    );
    check(
      "penyesuaian tercatat di activity log (credit_adjust)",
      db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'credit_adjust'").get().n >= 2,
    );

    // ------------------------------------------------------ [5/9] ANALITIK ABUSE
    console.log("\n[5/9] Analitik anti-abuse (#16)");
    const andiKeys = db
      .prepare("SELECT key_value FROM keys WHERE created_by = ? AND status = 'active' ORDER BY created_at ASC LIMIT 3")
      .all(andiRow.id)
      .map((row) => row.key_value);
    check("punya minimal 2 key aktif untuk diuji", andiKeys.length >= 2, `keys=${andiKeys.join(", ")}`);

    const sharedHwid = "HWID-BERSAMA-ABUSE";
    for (const keyValue of andiKeys.slice(0, 2)) {
      await validate(
        { key: keyValue, tool_slug: tool.slug, tool_version: version.name, hardware_id: sharedHwid },
        "203.0.113.77",
      );
    }
    for (const index of [1, 2, 3]) {
      await validate(
        {
          key: andiKeys[0],
          tool_slug: tool.slug,
          tool_version: version.name,
          hardware_id: `HWID-MULTI-DEVICE-${index}`,
        },
        `198.51.100.${index}`,
      );
    }

    const analytics = await owner.get("/api/validation-attempts?per_page=200");
    const analyticsData = analytics.body?.data;
    const sharedEntry = (analyticsData?.shared_hwids ?? []).find((item) => item.hardware_id === sharedHwid);
    check(
      "deteksi satu HWID dipakai banyak key (distinct_keys + flag suspect)",
      Boolean(sharedEntry) && sharedEntry.distinct_keys >= 2 && sharedEntry.suspect === true,
      JSON.stringify(sharedEntry ?? null).slice(0, 160),
    );

    const multiEntry = (analyticsData?.multi_ip_keys ?? []).find((item) => item.key_value === andiKeys[0]);
    check(
      "deteksi satu key dipakai dari banyak IP (distinct_ips)",
      Boolean(multiEntry) && multiEntry.distinct_ips >= 3,
      JSON.stringify(multiEntry ?? null).slice(0, 160),
    );

    check(
      "ambang analitik & retensi ikut terkirim (bisa diatur di Pengaturan)",
      analyticsData?.thresholds?.multi_ip_keys_min === 3 &&
        analyticsData?.thresholds?.shared_hwid_keys_min === 2 &&
        analyticsData?.thresholds?.retention_days === 7,
      JSON.stringify(analyticsData?.thresholds ?? null),
    );

    const lowered = await owner.put("/api/settings", {
      analytics: { multiIpKeysMin: 2, sharedHwidKeysMin: 2, suspectFailedMin: 10 },
    });
    check(
      "ambang analitik bisa diubah lewat Pengaturan",
      lowered.body?.data?.runtime?.analytics?.multiIpKeysMin === 2,
    );

    // --------------------------------------------------------- [6/9] NOTIFIKASI
    console.log("\n[6/9] Notifikasi keluar (#2)");

    // a) Brute-force key tidak dikenal dari satu IP → event validation_burst.
    for (let index = 0; index < 5; index += 1) {
      await validate(
        {
          key: "XLVP-AAAA-AAAA",
          tool_slug: tool.slug,
          tool_version: version.name,
          hardware_id: `HWID-BRUTE-FORCE-${index}`,
        },
        "198.18.0.9",
      );
    }
    check(
      "notifikasi brute-force validasi terkirim (event validation_burst)",
      await waitForEvent(received, "validation_burst"),
      `event diterima: ${received.map((item) => item.event).join(", ") || "-"}`,
    );

    // b) Auto-ban: key max_device = 1 diisi 1 device, lalu dicoba dari 5 HWID lain
    //    → 5 percobaan device_limit_exceeded → ban otomatis + notifikasi.
    const autoBanCreate = await andi.post("/api/keys/generate", {
      tool_type_id: tool.id,
      tool_version_id: version.id,
      duration_preset_id: preset.id,
      quantity: 1,
      max_device: 1,
      note: "Uji auto-ban",
    });
    const autoBanKey = db
      .prepare("SELECT key_value FROM keys WHERE created_by = ? ORDER BY created_at DESC LIMIT 1")
      .get(andiRow.id).key_value;
    check("key khusus uji auto-ban dibuat (max_device 1)", autoBanCreate.status === 200);

    await validate(
      {
        key: autoBanKey,
        tool_slug: tool.slug,
        tool_version: version.name,
        hardware_id: "HWID-AUTO-BAN-SLOT-1",
      },
      "203.0.113.200",
    );
    for (let index = 2; index <= 6; index += 1) {
      await validate(
        {
          key: autoBanKey,
          tool_slug: tool.slug,
          tool_version: version.name,
          hardware_id: `HWID-AUTO-BAN-DEVICE-${index}`,
        },
        `203.0.113.${200 + index}`,
      );
      await sleep(80);
    }
    const bannedRow = db.prepare("SELECT status, ban_reason FROM keys WHERE key_value = ?").get(autoBanKey);
    check(
      "key di-auto-ban setelah 5 HWID gagal berbeda (ban_reason auto_hwid)",
      bannedRow?.status === "banned" && bannedRow?.ban_reason === "auto_hwid",
      `key=${autoBanKey} status=${bannedRow?.status} reason=${bannedRow?.ban_reason}`,
    );
    check(
      "notifikasi auto-ban terkirim (event key_auto_ban)",
      await waitForEvent(received, "key_auto_ban"),
      `event diterima: ${received.map((item) => item.event).join(", ") || "-"}`,
    );
    check(
      "auto-ban tercatat di audit log sistem",
      db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'key_auto_ban'").get().n >= 1,
    );

    // c) Saldo tipis: ambang di atas saldo sekarang → generate memicu notifikasi.
    const creditNow = db.prepare("SELECT credit FROM profiles WHERE id = ?").get(andiRow.id).credit;
    await owner.put("/api/settings", { notify: { lowCreditThreshold: creditNow } });
    const generate = await andi.post("/api/keys/generate", {
      tool_type_id: tool.id,
      tool_version_id: version.id,
      duration_preset_id: preset.id,
      quantity: 1,
      max_device: 1,
      note: "Uji notifikasi saldo tipis",
    });
    check("generate key berhasil sebelum cek notifikasi saldo", generate.status === 200);
    check(
      "notifikasi saldo tipis terkirim (event low_credit)",
      await waitForEvent(received, "low_credit"),
      `event diterima: ${received.map((item) => item.event).join(", ") || "-"}`,
    );
    await owner.put("/api/settings", { notify: { lowCreditThreshold: 5 } });

    check(
      "semua notifikasi tercatat di notification_logs (target webhook)",
      db.prepare("SELECT COUNT(*) AS n FROM notification_logs WHERE target = 'webhook' AND success = 1").get().n >= 3,
      `rows=${db.prepare("SELECT COUNT(*) AS n FROM notification_logs").get().n}`,
    );

    // d) Digest harian + anti-duplikat.
    const digest = await fetch(`${APP_URL}/api/cron/digest`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    }).then((response) => response.json());
    check(
      "cron digest mengirim ringkasan harian 24 jam (event digest)",
      digest.ok === true && digest.sent === true && digest.stats?.new_keys >= 1,
      JSON.stringify({ sent: digest.sent, skipped: digest.skipped, reason: digest.reason, stats: digest.stats }),
    );
    check("ringkasan harian diterima webhook", await waitForEvent(received, "digest", 10_000));

    const digestAgain = await fetch(`${APP_URL}/api/cron/digest`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    }).then((response) => response.json());
    check(
      "digest kedua di hari yang sama dilewati (dedupe_key per tanggal WIB)",
      digestAgain.ok === true && digestAgain.skipped === "deduped",
      `skipped=${digestAgain.skipped}`,
    );

    check(
      "cron tanpa secret ditolak (401)",
      (await fetch(`${APP_URL}/api/cron/digest`, { headers: { Authorization: "Bearer salah" } })).status === 401,
    );

    const notifyOff = await owner.put("/api/settings", { notify: { enabled: false } });
    check("notifikasi bisa dimatikan Owner", notifyOff.body?.data?.runtime?.notify?.enabled === false);
    const digestOff = await fetch(`${APP_URL}/api/cron/digest`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    }).then((response) => response.json());
    check(
      "saat notifikasi nonaktif, digest dilewati dengan alasan",
      digestOff.ok === true && digestOff.skipped === true && /nonaktif/i.test(digestOff.reason ?? ""),
      `reason=${digestOff.reason}`,
    );
    await owner.put("/api/settings", { notify: { enabled: true } });

    // ------------------------------------------------------------ [7/9] API KEY
    console.log("\n[7/9] API key reseller + API publik /api/v1 (#14)");
    const created = await andi.post("/api/api-keys", { name: "Integrasi Discord" });
    const token = created.body?.data?.token ?? "";
    const apiKeyId = created.body?.data?.api_key?.id;
    check(
      "API key dibuat & token tampil sekali (format xlp_<prefix>_<secret>)",
      created.status === 200 && /^xlp_[0-9a-f]{12}_[0-9a-f]{64}$/.test(token),
      token ? `${token.slice(0, 20)}…` : "tanpa token",
    );
    const storedHash = db.prepare("SELECT token_hash FROM reseller_api_keys WHERE id = ?").get(apiKeyId)?.token_hash;
    check("yang disimpan hanya hash SHA-256 (bukan token asli)", storedHash && storedHash !== token);
    check(
      "daftar API key tidak pernah mengembalikan token",
      !JSON.stringify((await andi.get("/api/api-keys")).body ?? {}).includes(token),
    );
    check(
      "pembuatan API key tercatat di activity log",
      db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'api_key_create'").get().n >= 1,
    );

    check("tanpa API key → 401", (await apiV1("", "/api/v1/me")).status === 401);
    check(
      "API key salah → 401",
      (await apiV1(`xlp_${"0".repeat(12)}_${"a".repeat(64)}`, "/api/v1/me")).status === 401,
    );

    const me = await apiV1(token, "/api/v1/me");
    check(
      "GET /api/v1/me mengembalikan profil + limit dari Pengaturan",
      me.status === 200 && me.body?.data?.user?.username === "andi" && me.body?.data?.limits?.rate_limit_per_minute === 60,
      JSON.stringify(me.body?.data?.limits ?? null),
    );

    const presets = await apiV1(token, "/api/v1/presets");
    check("GET /api/v1/presets berisi preset aktif", (presets.body?.data?.presets ?? []).length >= 3);

    const tools = await apiV1(token, "/api/v1/tools");
    check(
      "GET /api/v1/tools berisi tool + versi aktif",
      (tools.body?.data?.tools ?? []).length >= 1 &&
        Array.isArray(tools.body?.data?.tools?.[0]?.versions) &&
        tools.body.data.tools[0].versions.length >= 1,
    );

    const creditBeforeApi = db.prepare("SELECT credit FROM profiles WHERE id = ?").get(andiRow.id).credit;
    const apiGenerate = await apiV1(token, "/api/v1/keys", {
      method: "POST",
      body: JSON.stringify({
        tool_type_id: tool.id,
        tool_version_id: version.id,
        duration_preset_id: preset.id,
        quantity: 1,
        max_device: 1,
        note: "dibuat via /api/v1",
      }),
    });
    const apiKeyValue = apiGenerate.body?.data?.keys?.[0]?.key_value;
    const creditAfterApi = db.prepare("SELECT credit FROM profiles WHERE id = ?").get(andiRow.id).credit;
    check(
      "POST /api/v1/keys membuat key & memotong credit sesuai credit_cost",
      apiGenerate.status === 200 &&
        Boolean(apiKeyValue) &&
        creditAfterApi === creditBeforeApi - apiGenerate.body.data.summary.credit_cost,
      `key=${apiKeyValue ?? "-"} biaya=${apiGenerate.body?.data?.summary?.credit_cost ?? "-"}`,
    );

    const keyDetail = await apiV1(token, `/api/v1/keys/${apiKeyValue}`);
    check(
      "GET /api/v1/keys/{key_value} → detail + kuota reset HWID",
      keyDetail.status === 200 &&
        keyDetail.body?.data?.key?.key_value === apiKeyValue &&
        keyDetail.body?.data?.cooldown?.limit === 1,
      JSON.stringify(keyDetail.body?.data?.cooldown ?? null),
    );

    const budiKey = db
      .prepare("SELECT key_value FROM keys WHERE created_by = ? AND status = 'active' LIMIT 1")
      .get(budiRow.id);
    if (budiKey) {
      const cross = await apiV1(token, `/api/v1/keys/${budiKey.key_value}`);
      check("key milik reseller lain ditolak (403)", cross.status === 403, `status=${cross.status}`);
    } else {
      check("key milik reseller lain ditolak (403)", true, "dilewati: budi tidak punya key aktif");
    }

    // Reset HWID via API + kuota cooldown (limit 1x/24 jam dari pengaturan).
    const generatedKeyId = db.prepare("SELECT id FROM keys WHERE key_value = ?").get(apiKeyValue).id;
    const nowIso = new Date().toISOString();
    db.prepare(
      "INSERT INTO device_logs (id, key_id, hardware_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), generatedKeyId, "HWID-API-TEST", nowIso, nowIso);

    const resetFirst = await apiV1(token, `/api/v1/keys/${apiKeyValue}/hwid-reset`, {
      method: "POST",
      body: JSON.stringify({ hardware_id: "HWID-API-TEST" }),
    });
    check(
      "reset HWID satu device via API berhasil",
      resetFirst.status === 200 && resetFirst.body?.data?.removed === 1,
      JSON.stringify(resetFirst.body?.data ?? resetFirst.body).slice(0, 140),
    );

    db.prepare(
      "INSERT INTO device_logs (id, key_id, hardware_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), generatedKeyId, "HWID-API-TEST-2", nowIso, nowIso);
    const resetSecond = await apiV1(token, `/api/v1/keys/${apiKeyValue}/hwid-reset`, {
      method: "POST",
      body: JSON.stringify({ all: true }),
    });
    check(
      "kuota cooldown reset berlaku juga di API (429 hwid_reset_cooldown)",
      resetSecond.status === 429 && resetSecond.body?.code === "hwid_reset_cooldown",
      `${resetSecond.status} ${resetSecond.body?.code}`,
    );
    check(
      "reset HWID dari API tercatat di audit log",
      db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('hwid_reset','hwid_reset_all')").get().n >= 1,
    );
    check(
      "pemakaian API tercatat (api_request_logs + requests_count)",
      db.prepare("SELECT COUNT(*) AS n FROM api_request_logs WHERE api_key_id = ?").get(apiKeyId).n >= 6 &&
        db.prepare("SELECT requests_count FROM reseller_api_keys WHERE id = ?").get(apiKeyId).requests_count >= 6,
      `logs=${db.prepare("SELECT COUNT(*) AS n FROM api_request_logs WHERE api_key_id = ?").get(apiKeyId).n}`,
    );

    // Rate limit per API key.
    await owner.put("/api/settings", { api: { rateLimitPerMinute: 5 } });
    let rateLimited = null;
    for (let index = 0; index < 6; index += 1) {
      const response = await apiV1(token, "/api/v1/me");
      if (response.status === 429) {
        rateLimited = response.body;
        break;
      }
      await sleep(40);
    }
    check(
      "rate limit per API key berlaku (429 rate_limited)",
      Boolean(rateLimited) && rateLimited?.code === "rate_limited",
      JSON.stringify(rateLimited ?? null).slice(0, 120),
    );
    await owner.put("/api/settings", { api: { rateLimitPerMinute: 60 } });

    // Saklar API publik.
    await owner.put("/api/settings", { api: { enabled: false } });
    const apiOff = await apiV1(token, "/api/v1/presets");
    check(
      "API publik bisa dimatikan dari Pengaturan (403 api_disabled)",
      apiOff.status === 403 && apiOff.body?.code === "api_disabled",
      `${apiOff.status} ${apiOff.body?.code ?? ""}`,
    );
    await owner.put("/api/settings", { api: { enabled: true } });

    // Cabut API key → token langsung tidak berlaku.
    const revoke = await andi.delete(`/api/api-keys/${apiKeyId}`);
    check(
      "API key dicabut (soft revoke)",
      revoke.status === 200 && revoke.body?.data?.revoked === true,
    );
    check("token yang sudah dicabut ditolak (401)", (await apiV1(token, "/api/v1/me")).status === 401);
    check(
      "pencabutan tercatat di activity log",
      db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'api_key_revoke'").get().n >= 1,
    );

    const unknown = await apiV1(token, "/api/v1/ngawur");
    check(
      "endpoint tak dikenal menjawab JSON 404 + daftar endpoint",
      unknown.status === 404 && Array.isArray(unknown.body?.details?.available),
      `status=${unknown.status}`,
    );

    // --------------------------------------------------------- [8/9] BOT TELEGRAM
    console.log("\n[8/9] Bot Telegram (#15)");
    const linkBeforeBot = await andi.post("/api/telegram/link");
    check(
      "tanpa bot terhubung, kode tautan tidak bisa dibuat (400)",
      linkBeforeBot.status === 400,
      `status=${linkBeforeBot.status}`,
    );

    // Konfigurasi bot "palsu" langsung di database: panggilan api.telegram.org asli
    // tidak mungkin dari lingkungan uji, dan semua kegagalan kirim harus aman.
    const telegramSecret = "rahasia-webhook-uji";
    db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('telegram', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).run(
      JSON.stringify({
        bot_token: `123456789:TOKEN-UJI-${randomUUID()}`,
        bot_username: "xloop_uji_bot",
        webhook_url: `${APP_URL}/api/telegram/webhook`,
        webhook_secret: telegramSecret,
        notifications_enabled: true,
        connected_at: new Date().toISOString(),
      }),
      new Date().toISOString(),
    );

    const linkStatus = await andi.get("/api/telegram/link");
    check(
      "status tautan: bot siap, akun belum tertaut",
      linkStatus.status === 200 &&
        linkStatus.body?.data?.bot_ready === true &&
        linkStatus.body?.data?.linked === null &&
        linkStatus.body?.data?.bot_username === "xloop_uji_bot",
      JSON.stringify(linkStatus.body?.data ?? null).slice(0, 140),
    );

    const linkCode = await andi.post("/api/telegram/link");
    check(
      "kode tautan dibuat (6 karakter + deep link t.me)",
      linkCode.status === 200 &&
        /^[A-Z0-9]{6}$/.test(linkCode.body?.data?.code ?? "") &&
        String(linkCode.body?.data?.deep_link ?? "").includes("t.me/xloop_uji_bot"),
      linkCode.body?.data?.code ?? "-",
    );

    const noSecret = await fetch(`${APP_URL}/api/telegram/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "salah" },
      body: JSON.stringify({ message: { text: "/help", chat: { id: 987654321 }, from: { id: 555 } } }),
    });
    check("webhook dengan secret salah ditolak (401)", noSecret.status === 401, `status=${noSecret.status}`);

    const chatId = 987654321;
    const startResponse = await fetch(`${APP_URL}/api/telegram/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": telegramSecret },
      body: JSON.stringify({
        message: { text: `/start ${linkCode.body?.data?.code}`, chat: { id: chatId }, from: { id: 555 } },
      }),
    });
    check("webhook dengan secret benar diterima (200)", startResponse.status === 200);
    check(
      "perintah /start <kode> menautkan chat ke akun",
      db.prepare("SELECT COUNT(*) AS n FROM telegram_links WHERE user_id = ? AND chat_id = ?").get(andiRow.id, String(chatId)).n === 1,
    );
    const usedCode = db
      .prepare("SELECT used_at FROM telegram_link_codes WHERE code = ?")
      .get(linkCode.body?.data?.code);
    check("kode tautan sekali pakai (used_at terisi)", Boolean(usedCode) && usedCode.used_at !== null);
    check(
      "penautan tercatat di activity log",
      db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'telegram_link'").get().n >= 1,
    );

    // Perintah bot lain: balasan tetap dikirim ke Telegram (gagal di lingkungan uji,
    // tapi TIDAK boleh membuat webhook error) dan efek sampingnya harus jalan.
    const botCommand = async (text) =>
      fetch(`${APP_URL}/api/telegram/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": telegramSecret },
        body: JSON.stringify({ message: { text, chat: { id: chatId }, from: { id: 555 } } }),
      });

    for (const command of ["/help", "/saldo", "/preset", "/keys"]) {
      const response = await botCommand(command);
      check(`perintah bot ${command} diproses (200, kegagalan kirim ditangani)`, response.status === 200);
    }

    const chatBelumTertaut = await fetch(`${APP_URL}/api/telegram/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": telegramSecret },
      body: JSON.stringify({ message: { text: "/saldo", chat: { id: 111222333 }, from: { id: 999 } } }),
    });
    check("chat yang belum tertaut tetap dilayani (tanpa efek samping)", chatBelumTertaut.status === 200);

    const botUnlink = await botCommand("/unlink");
    check(
      "perintah /unlink dari bot melepas tautan chat",
      botUnlink.status === 200 &&
        db.prepare("SELECT COUNT(*) AS n FROM telegram_links WHERE user_id = ?").get(andiRow.id).n === 0,
    );
    check(
      "pelepasan tautan dari bot tercatat di activity log",
      db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'telegram_unlink'").get().n >= 1,
    );

    // Tautkan lagi (lewat perintah bot) supaya tombol "Lepas tautan" di panel teruji.
    const secondCode = await andi.post("/api/telegram/link");
    await fetch(`${APP_URL}/api/telegram/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": telegramSecret },
      body: JSON.stringify({
        message: { text: `/start ${secondCode.body?.data?.code}`, chat: { id: chatId }, from: { id: 555 } },
      }),
    });
    const unlink = await andi.delete("/api/telegram/link");
    check("lepas tautan Telegram dari panel berhasil", unlink.status === 200 && unlink.body?.data?.unlinked === true);
    check(
      "lepas tautan dari panel juga tercatat di activity log",
      db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'telegram_unlink'").get().n >= 2,
    );

    // ------------------------------------------------- [9/9] RETENSI & CLEANUP
    console.log("\n[9/9] Retensi, cleanup & kebersihan");
    const staleIso = new Date(Date.now() - 10 * 86_400_000).toISOString();
    db.prepare("INSERT INTO telegram_link_codes (code, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "LAMA01",
      andiRow.id,
      staleIso,
      staleIso,
      staleIso,
    );
    db.prepare(
      "INSERT INTO notification_logs (id, event, dedupe_key, target, success, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), "test", null, "webhook", 1, "notifikasi lama", new Date(Date.now() - 400 * 86_400_000).toISOString());

    const cleanup = await fetch(`${APP_URL}/api/cron/cleanup`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    }).then((response) => response.json());
    check(
      "cron cleanup menghapus kode tautan Telegram kedaluwarsa/terpakai",
      cleanup.ok === true && cleanup.deleted_link_codes >= 1,
      JSON.stringify({ link_codes: cleanup.deleted_link_codes, notifications: cleanup.deleted_notifications }),
    );
    check(
      "cron cleanup memakai masa retensi dari Pengaturan",
      cleanup.retention?.attemptsDays === 7 && cleanup.retention?.apiLogsDays === 30,
      JSON.stringify(cleanup.retention ?? null),
    );
    check(
      "cron cleanup membersihkan notification_logs lama",
      cleanup.deleted_notifications >= 1,
      `deleted=${cleanup.deleted_notifications}`,
    );

    const finalSettings = await owner.get("/api/settings");
    check(
      "pengaturan akhir konsisten (API aktif, notifikasi aktif)",
      finalSettings.body?.data?.runtime?.api?.enabled === true &&
        finalSettings.body?.data?.runtime?.notify?.enabled === true,
    );

    const totals = {
      activity: db.prepare("SELECT COUNT(*) AS n FROM activity_logs").get().n,
      api_keys: db.prepare("SELECT COUNT(*) AS n FROM reseller_api_keys").get().n,
      api_logs: db.prepare("SELECT COUNT(*) AS n FROM api_request_logs").get().n,
      notifications: db.prepare("SELECT COUNT(*) AS n FROM notification_logs").get().n,
      settings_rows: db.prepare("SELECT COUNT(*) AS n FROM app_settings").get().n,
    };
    check(
      "semua tabel fitur baru terisi di file SQLite",
      totals.activity >= 10 && totals.api_keys >= 1 && totals.api_logs >= 5 && totals.settings_rows >= 2,
      JSON.stringify(totals),
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
  console.log(`Notifikasi keluar yang diterima webhook uji: ${received.length}`);
  if (failures > 0) {
    console.log("GAGAL:");
    results.filter((item) => !item.passed).forEach((item) => console.log(`  - ${item.name} ${item.detail}`));
  }
  console.log("─────────────────────────────────────────────\n");

  process.exit(failures > 0 ? 1 : 0);
}

void main();
