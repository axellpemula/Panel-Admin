#!/usr/bin/env node
/**
 * dev/sqlite-e2e-test.mjs
 *
 * Uji end-to-end PANEL dalam mode SQLite (tanpa Supabase sama sekali):
 * login sungguhan (password diverifikasi scrypt), CRUD lewat API route,
 * generate key + potong credit (1 unit = 1 key x 1 device), perpanjang key pakai preset,
 * ban/unban (alasan terstruktur + audit log), reset HWID (audit log),
 * pengembalian credit saat Owner menghapus key reseller yang masih aktif,
 * audit log (/api/audit: filter, CSV, jejak tetap ada setelah key dihapus),
 * validation attempts (/api/validation-attempts: ringkasan, IP mencurigakan,
 * key paling sering gagal, tren per jam, filter, CSV — hanya Owner),
 * auto-ban (ban_reason auto_hwid + audit sistem) & unban auto-ban khusus Owner,
 * topup, nonaktifkan akun,
 * sampai validasi key di /api/validate — semuanya menulis ke file SQLite.
 *
 * Menjalankan server sendiri (`next dev` di port 3022) dengan database
 * sementara di folder tmp; file database dihapus lagi setelah selesai.
 *
 * Jalankan: npm run verify:sqlite
 *
 * CATATAN: skrip ini menjalankan `next dev`, yang memakai folder `.next` yang
 * sama dengan `next build`. Jalankan `npm run build` lagi setelahnya kalau
 * ingin memakai hasil build produksi.
 */

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const BetterSqlite = require("better-sqlite3");

const APP_PORT = 3022;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const OWNER = { email: "owner@gmail.com", password: "Axell123" };
const RESELLER = { email: "andi@example.com", password: "Reseller123" };

const results = [];
let failures = 0;

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Klien HTTP kecil yang menyimpan cookie sesi seperti browser. */
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
    request,
    /** Cookie sesi mentah — untuk fetch manual (mis. redirect: "manual"). */
    getCookie: () => cookie,
    reset: () => {
      cookie = "";
    },
  };
}

async function waitForApp(timeoutMs = 120_000) {
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

async function main() {
  const workDir = mkdtempSync(path.join(tmpdir(), "xloop-sqlite-"));
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
    CRON_SECRET: "cron-uji",
  });

  console.log(`\n[1/6] Database sementara: ${dbFile}`);

  const app = spawn("node", ["./node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  app.stdout.on("data", () => {});
  app.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (/error|audit/i.test(text)) process.stderr.write(`[next] ${text}`);
  });

  let db = null;
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
    if (!(await waitForApp())) throw new Error("Aplikasi tidak siap dalam batas waktu");
    db = new BetterSqlite(dbFile);
    db.pragma("busy_timeout = 5000");

    // ------------------------------------------------------------------ MODE
    console.log("\n[2/6] Mode database & login");
    const owner = createClient();
    const session0 = await owner.get("/api/auth/session");
    check("session endpoint melaporkan mode sqlite", session0.body?.mode === "sqlite", `mode=${session0.body?.mode}`);
    check("belum login → session null", session0.body?.session === null);

    const badLogin = await owner.post("/api/auth/login", { email: OWNER.email, password: "salah-sekali" });
    check(
      "password salah ditolak (401)",
      badLogin.status === 401 && /email atau password salah/i.test(badLogin.body?.error ?? ""),
      `${badLogin.status} ${badLogin.body?.error ?? ""}`,
    );

    const ownerLogin = await owner.post("/api/auth/login", OWNER);
    check("login owner berhasil", ownerLogin.status === 200 && ownerLogin.body?.data?.user?.role === "owner");

    const ownerSession = await owner.get("/api/auth/session");
    check(
      "cookie sesi SQLite berlaku (profil terbaca)",
      ownerSession.body?.session?.username === "owner" &&
        ownerSession.body?.session?.role === "owner" &&
        ownerSession.body?.session?.is_active === true,
      JSON.stringify(ownerSession.body?.session ?? {}),
    );

    const guard = await fetch(`${APP_URL}/dashboard`, { redirect: "manual" });
    check("tanpa cookie → middleware melempar /dashboard ke /login", guard.status === 307 || guard.status === 302, `status ${guard.status}`);

    // -------------------------------------------------------- DATA CONTOH
    console.log("\n[3/6] Data contoh & CRUD");
    const keysPage = await owner.get("/api/keys?per_page=100");
    check("12 key data contoh terbaca dari SQLite", keysPage.body?.data?.total === 12, `total=${keysPage.body?.data?.total}`);
    check("relasi tool & reseller ikut terisi (embedded), bukan null",
      keysPage.body?.data?.items?.[0]?.tool_name !== "-" && keysPage.body?.data?.items?.[0]?.tool_slug !== "-",
      JSON.stringify({ tool: keysPage.body?.data?.items?.[0]?.tool_name, by: keysPage.body?.data?.items?.[0]?.created_by_username }));

    const tools = await owner.get("/api/tools");
    const tool = tools.body?.data?.tools?.[0];
    check("GET /api/tools memuat tool + version + statistik key", Boolean(tool?.versions?.length), `${tools.body?.data?.tools?.length ?? 0} tool`);

    const presets = await owner.get("/api/durations");
    const allPresets = presets.body?.data?.presets ?? [];
    const preset = allPresets.find((item) => item.name === "1 Bulan");
    const bigPreset = allPresets.find((item) => item.name === "3 Bulan");
    check(
      "GET /api/durations memuat preset dari SQLite",
      Boolean(preset) && Boolean(bigPreset),
      `${allPresets.length} preset`,
    );

    const resellers = await owner.get("/api/resellers");
    const resellerRow = (resellers.body?.data?.resellers ?? []).find((item) => item.username === "andi");
    check("GET /api/resellers memuat reseller + jumlah key (RPC reseller_summary)", resellerRow?.key_count === 4, `key_count=${resellerRow?.key_count}`);

    const newPreset = await owner.post("/api/durations", { name: "Preset Uji", days: 3, credit_cost: 2, is_active: true });
    check("tambah preset durasi (INSERT)", newPreset.status === 200 && newPreset.body?.data?.preset?.name === "Preset Uji");

    const delPreset = await fetch(`${APP_URL}/api/durations/${newPreset.body.data.preset.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", cookie: "" },
    });
    check("hapus preset tanpa sesi ditolak (401)", delPreset.status === 401, `status ${delPreset.status}`);

    // ------------------------------------------------------------ GENERATE
    console.log("\n[4/6] Generate key, credit, ban/unban, HWID");
    const generate = await owner.post("/api/keys/generate", {
      tool_type_id: tool.id,
      tool_version_id: tool.versions[0].id,
      duration_mode: "custom",
      custom_days: 5,
      max_device: 2,
      quantity: 2,
      note: "Uji SQLite",
    });
    const created = generate.body?.data?.keys ?? [];
    check("owner generate 2 key (durasi custom)", generate.status === 200 && created.length === 2, `${created.length} key`);
    check("key tersimpan permanen di SQLite", db.prepare("SELECT COUNT(*) AS total FROM keys").get().total === 14, "14 baris");

    const generatedKey = created[0];
    const validateBody = {
      key: generatedKey.key_value,
      tool_slug: tool.slug,
      tool_version: tool.versions[0].name,
      hardware_id: `hwid-sqlite-${"b".repeat(24)}`,
      nonce: randomBytes(18).toString("base64url"),
    };
    const validated = await fetch(`${APP_URL}/api/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validateBody),
    });
    const validatedBody = await validated.json();
    const payload = validatedBody.payload
      ? JSON.parse(Buffer.from(validatedBody.payload, "base64").toString("utf8"))
      : null;
    check(
      "key baru bisa divalidasi lewat /api/validate (register_device di SQLite)",
      validated.status === 200 && payload?.valid === true && payload?.nonce === validateBody.nonce,
      JSON.stringify({ status: validated.status, reason: validatedBody.reason ?? null, devices: payload?.current_devices }),
    );

    const devices = await owner.get(`/api/keys/${generatedKey.id}/devices`);
    check("HWID yang dipakai tercatat di device_logs", devices.body?.data?.used === 1, `used=${devices.body?.data?.used}`);

    const anonymous = createClient();
    const resetDevice = await anonymous.get(`/api/keys/${generatedKey.id}/devices`);
    check("akses tanpa sesi ditolak (401)", resetDevice.status === 401, `status ${resetDevice.status}`);

    const resetOk = await owner.request("DELETE", `/api/keys/${generatedKey.id}/devices/${encodeURIComponent(validateBody.hardware_id)}`);
    const devicesAfterReset = await owner.get(`/api/keys/${generatedKey.id}/devices`);
    check(
      "reset HWID lewat API mengosongkan slot device",
      resetOk.status === 200 && devicesAfterReset.body?.data?.used === 0,
      `used=${devicesAfterReset.body?.data?.used}`,
    );

    const resetAudit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'hwid_reset' AND key_id = ?")
      .get(generatedKey.id);
    check(
      "reset HWID tercatat di audit_logs (aktor + HWID yang direset)",
      resetAudit?.actor_username === "owner" &&
        resetAudit?.actor_role === "owner" &&
        JSON.parse(resetAudit?.detail ?? "{}")?.hardware_id === validateBody.hardware_id,
      JSON.stringify(resetAudit ?? {}),
    );

    const banned = await owner.put(`/api/keys/${generatedKey.id}/ban`, {});
    check("ban key lewat API", banned.status === 200, JSON.stringify(banned.body?.data ?? banned.body));
    const bannedRow = db.prepare("SELECT status FROM keys WHERE id = ?").get(generatedKey.id);
    check("status banned tersimpan di SQLite", bannedRow.status === "banned", `status=${bannedRow.status}`);

    const bannedMeta = db
      .prepare("SELECT ban_reason, ban_note, banned_by, banned_at FROM keys WHERE id = ?")
      .get(generatedKey.id);
    check(
      "ban menyimpan metadata: alasan default manual + pelaku + waktu",
      bannedMeta.ban_reason === "manual" &&
        bannedMeta.banned_by === "00000000-0000-4000-8000-000000000001" &&
        typeof bannedMeta.banned_at === "string",
      JSON.stringify(bannedMeta),
    );
    const banAudit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'key_ban' AND key_id = ?")
      .get(generatedKey.id);
    check(
      "ban tercatat di audit_logs (aktor owner, alasan manual, pemilik key)",
      banAudit?.actor_username === "owner" &&
        banAudit?.actor_role === "owner" &&
        banAudit?.ban_reason === "manual" &&
        banAudit?.key_owner_username === "owner",
      JSON.stringify(banAudit ?? {}),
    );

    const bannedValidate = await fetch(`${APP_URL}/api/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...validateBody, nonce: randomBytes(18).toString("base64url") }),
    }).then((response) => response.json());
    check("key banned ditolak validasi (key_banned)", bannedValidate.reason === "key_banned", `reason=${bannedValidate.reason}`);

    const unbanned = await owner.put(`/api/keys/${generatedKey.id}/unban`, {});
    const unbannedRow = db.prepare("SELECT status FROM keys WHERE id = ?").get(generatedKey.id);
    check("unban mengembalikan status active", unbanned.status === 200 && unbannedRow.status === "active", `status=${unbannedRow.status}`);

    const unbannedMeta = db
      .prepare("SELECT ban_reason, banned_by, banned_at FROM keys WHERE id = ?")
      .get(generatedKey.id);
    check(
      "unban mengosongkan metadata ban (jejak tetap ada di audit_logs)",
      unbannedMeta.ban_reason === null && unbannedMeta.banned_by === null && unbannedMeta.banned_at === null,
      JSON.stringify(unbannedMeta),
    );
    const unbanAudit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'key_unban' AND key_id = ?")
      .get(generatedKey.id);
    check(
      "unban tercatat di audit_logs (alasan ban sebelumnya ikut)",
      unbanAudit?.actor_username === "owner" &&
        JSON.parse(unbanAudit?.detail ?? "{}")?.previous_ban_reason === "manual",
      JSON.stringify(unbanAudit ?? {}),
    );

    // Owner: perpanjang manual (mode extend) gratis, dan boleh juga pakai preset.
    const ownerExtend = await owner.put(`/api/keys/${generatedKey.id}`, { mode: "extend", add_days: 30 });
    check(
      "owner perpanjang key (mode extend) gratis",
      ownerExtend.status === 200 &&
        ownerExtend.body?.data?.credit?.cost === 0 &&
        new Date(ownerExtend.body?.data?.key?.expired_at) > new Date(generatedKey.expired_at),
      `cost=${ownerExtend.body?.data?.credit?.cost} expired=${ownerExtend.body?.data?.key?.expired_at}`,
    );

    // ------------------------------------------------- RESELLER & CREDIT
    console.log("\n[5/6] Reseller: credit, preset, nonaktif");
    const reseller = createClient();
    const resellerLogin = await reseller.post("/api/auth/login", RESELLER);
    check("login reseller (password scrypt) berhasil", resellerLogin.status === 200 && resellerLogin.body?.data?.user?.role === "reseller");

    const resellerKeys = await reseller.get("/api/keys?per_page=100");
    check(
      "reseller hanya melihat key miliknya (scoping di API, bukan RLS)",
      resellerKeys.body?.data?.isOwner === false && resellerKeys.body?.data?.total === 4,
      `total=${resellerKeys.body?.data?.total}`,
    );

    const customAttempt = await reseller.post("/api/keys/generate", {
      tool_type_id: tool.id,
      tool_version_id: tool.versions[0].id,
      duration_mode: "custom",
      custom_days: 10,
      max_device: 1,
      quantity: 1,
    });
    check("reseller ditolak saat pakai durasi custom (400)", customAttempt.status === 400, `${customAttempt.status} ${customAttempt.body?.error ?? ""}`);

    // Saldo awal Andi = 145 (seed), harga preset "1 Bulan" = 15 credit.
    const resellerGenerate = await reseller.post("/api/keys/generate", {
      tool_type_id: tool.id,
      tool_version_id: tool.versions[0].id,
      duration_mode: "preset",
      duration_preset_id: preset.id,
      max_device: 1,
      quantity: 1,
    });
    check("reseller generate pakai preset berhasil", resellerGenerate.status === 200, JSON.stringify(resellerGenerate.body?.error ?? ""));

    const summary = resellerGenerate.body?.data?.summary ?? {};
    const creditAfter = db.prepare("SELECT credit FROM profiles WHERE username = 'andi'").get();
    check(
      "biaya generate = harga preset x quantity x max device",
      creditAfter.credit === 130 && summary.credit_cost === 15 && summary.unit_price === 15,
      `credit=${creditAfter.credit} cost=${summary.credit_cost} unit=${summary.unit_price}`,
    );

    const resellerKeyId = resellerGenerate.body?.data?.keys?.[0]?.id ?? null;

    // Quantity 2 x max device 3 = 6 unit -> 6 x 15 = 90 credit.
    const multiDevice = await reseller.post("/api/keys/generate", {
      tool_type_id: tool.id,
      tool_version_id: tool.versions[0].id,
      duration_mode: "preset",
      duration_preset_id: preset.id,
      max_device: 3,
      quantity: 2,
    });
    const creditMulti = db.prepare("SELECT credit FROM profiles WHERE username = 'andi'").get().credit;
    check(
      "max device ikut dikenakan credit seperti quantity (2 key x 3 device = 90)",
      multiDevice.status === 200 && multiDevice.body?.data?.summary?.credit_cost === 90 && creditMulti === 40,
      `cost=${multiDevice.body?.data?.summary?.credit_cost} credit=${creditMulti}`,
    );

    const tooExpensive = await reseller.post("/api/keys/generate", {
      tool_type_id: tool.id,
      tool_version_id: tool.versions[0].id,
      duration_mode: "preset",
      duration_preset_id: preset.id,
      max_device: 3,
      quantity: 5,
    });
    check(
      "generate di atas saldo ditolak 402 tanpa mengubah credit",
      tooExpensive.status === 402 &&
        tooExpensive.body?.code === "insufficient_credit" &&
        db.prepare("SELECT credit FROM profiles WHERE username = 'andi'").get().credit === 40,
      `${tooExpensive.status} ${tooExpensive.body?.code ?? ""}`,
    );

    const credits = await reseller.get("/api/credits?per_page=5");
    const newGenerateLog = (credits.body?.data?.items ?? []).find(
      (item) => item.action === "generate" && item.amount === -90,
    );
    check(
      "credit log mencatat pemotongan 90 credit (2 key x 3 device)",
      Boolean(newGenerateLog),
      JSON.stringify(credits.body?.data?.items?.[0] ?? {}),
    );

    // ------------------------------------------------- RESELLER: EDIT / PERPANJANG
    // Reseller hanya boleh memperpanjang pakai preset; mode manual ditolak.
    const resellerCustomExtend = await reseller.put(`/api/keys/${resellerKeyId}`, {
      mode: "extend",
      add_days: 30,
    });
    check(
      "reseller ditolak saat perpanjang manual (403)",
      resellerCustomExtend.status === 403 && /preset/i.test(resellerCustomExtend.body?.error ?? ""),
      `${resellerCustomExtend.status} ${resellerCustomExtend.body?.error ?? ""}`,
    );

    const deviceOnly = await reseller.put(`/api/keys/${resellerKeyId}`, { mode: "none", max_device: 2 });
    check(
      "tambah max device tanpa preset ditolak (device = unit berbayar)",
      deviceOnly.status === 400 && /preset/i.test(deviceOnly.body?.error ?? ""),
      `${deviceOnly.status} ${deviceOnly.body?.error ?? ""}`,
    );

    const keyBefore = db
      .prepare("SELECT expired_at, max_device, duration_days FROM keys WHERE id = ?")
      .get(resellerKeyId);
    const resellerExtend = await reseller.put(`/api/keys/${resellerKeyId}`, {
      mode: "preset",
      duration_preset_id: preset.id,
      max_device: 2,
    });
    const keyAfter = db.prepare("SELECT expired_at, max_device, duration_days FROM keys WHERE id = ?").get(resellerKeyId);
    check(
      "reseller perpanjang pakai preset + tambah device: biaya = preset x max device",
      resellerExtend.status === 200 &&
        resellerExtend.body?.data?.credit?.cost === 30 &&
        resellerExtend.body?.data?.credit?.balance_after === 10,
      `cost=${resellerExtend.body?.data?.credit?.cost} saldo=${resellerExtend.body?.data?.credit?.balance_after}`,
    );
    check(
      "perpanjang menambah durasi & menyimpan max device baru",
      keyAfter.max_device === 2 &&
        keyAfter.duration_days === keyBefore.duration_days + preset.days &&
        new Date(keyAfter.expired_at) > new Date(keyBefore.expired_at),
      `max=${keyAfter.max_device} duration=${keyAfter.duration_days} expired=${keyAfter.expired_at}`,
    );

    const extendLog = await reseller.get("/api/credits?per_page=5&action=extend");
    const newExtendLog = (extendLog.body?.data?.items ?? []).find((item) => item.amount === -30);
    check(
      "credit log mencatat aksi perpanjang (action extend)",
      Boolean(newExtendLog) && extendLog.body?.data?.items?.every((item) => item.action === "extend"),
      JSON.stringify(extendLog.body?.data?.items?.[0] ?? {}),
    );

    const expensiveExtend = await reseller.put(`/api/keys/${resellerKeyId}`, {
      mode: "preset",
      duration_preset_id: bigPreset.id,
      max_device: 2,
    });
    const keyAfterFailed = db.prepare("SELECT max_device FROM keys WHERE id = ?").get(resellerKeyId);
    check(
      "perpanjang di atas saldo ditolak 402 dan key tidak berubah",
      expensiveExtend.status === 402 &&
        keyAfterFailed.max_device === 2 &&
        db.prepare("SELECT credit FROM profiles WHERE username = 'andi'").get().credit === 10,
      `${expensiveExtend.status} ${expensiveExtend.body?.code ?? ""}`,
    );


    // ------------------------------------------- PENGEMBALIAN CREDIT (HAPUS KEY)
    console.log("\n[5b/6] Pengembalian credit saat key dihapus");
    const listWithCost = await owner.get("/api/keys?per_page=100");
    const costField = (listWithCost.body?.data?.items ?? []).find((item) => item.id === resellerKeyId);
    check(
      "API key list mengirim credit_cost (dipakai dialog hapus)",
      typeof costField?.credit_cost === "number" && costField.credit_cost === 45,
      `credit_cost=${costField?.credit_cost}`,
    );

    // a) Owner hapus key reseller yang masih aktif & belum expired → refund penuh.
    const refundDelete = await owner.request("DELETE", `/api/keys/${resellerKeyId}`);
    const refundInfo = refundDelete.body?.data?.refund ?? null;
    check(
      "Owner hapus key aktif milik reseller → credit dikembalikan",
      refundDelete.status === 200 &&
        refundInfo?.amount === 45 &&
        refundInfo?.username === "andi" &&
        refundInfo?.balance_after === 55,
      JSON.stringify(refundInfo ?? {}),
    );
    check(
      "credit reseller bertambah tepat sejumlah credit_cost key (10 → 55)",
      db.prepare("SELECT credit FROM profiles WHERE username = 'andi'").get().credit === 55,
      `credit=${db.prepare("SELECT credit FROM profiles WHERE username = 'andi'").get().credit}`,
    );
    check(
      "key benar-benar terhapus dari SQLite",
      db.prepare("SELECT COUNT(*) AS total FROM keys WHERE id = ?").get(resellerKeyId).total === 0,
    );

    const refundLog = await reseller.get("/api/credits?per_page=3&action=refund");
    const refundRow = (refundLog.body?.data?.items ?? [])[0];
    check(
      "credit log mencatat aksi pengembalian (action refund)",
      refundRow?.action === "refund" && refundRow?.amount === 45 && refundRow?.balance_after === 55,
      JSON.stringify(refundRow ?? {}),
    );

    // b) Key reseller yang sudah EXPIRED → tidak ada pengembalian.
    const budiExpired = db
      .prepare(
        "SELECT k.id, k.credit_cost FROM keys k JOIN profiles p ON p.id = k.created_by " +
          "WHERE p.username = 'budi' AND k.status = 'expired' LIMIT 1",
      )
      .get();
    const deleteExpired = await owner.request("DELETE", `/api/keys/${budiExpired.id}`);
    const budiCredit = db.prepare("SELECT credit FROM profiles WHERE username = 'budi'").get().credit;
    check(
      "key expired dihapus Owner → TIDAK ada pengembalian",
      deleteExpired.status === 200 && deleteExpired.body?.data?.refund === null && budiCredit === 90,
      `refund=${JSON.stringify(deleteExpired.body?.data?.refund)} credit budi=${budiCredit} (key credit_cost=${budiExpired.credit_cost})`,
    );

    // c) Key reseller yang BANNED → tidak ada pengembalian.
    const andiBanned = db
      .prepare(
        "SELECT k.id, k.credit_cost FROM keys k JOIN profiles p ON p.id = k.created_by " +
          "WHERE p.username = 'andi' AND k.status = 'banned' LIMIT 1",
      )
      .get();
    const deleteBanned = await owner.request("DELETE", `/api/keys/${andiBanned.id}`);
    check(
      "key banned dihapus Owner → TIDAK ada pengembalian",
      deleteBanned.status === 200 &&
        deleteBanned.body?.data?.refund === null &&
        db.prepare("SELECT credit FROM profiles WHERE username = 'andi'").get().credit === 55,
      `refund=${JSON.stringify(deleteBanned.body?.data?.refund)} (key credit_cost=${andiBanned.credit_cost})`,
    );

    // d) Reseller menghapus key miliknya sendiri → tidak ada pengembalian.
    const ownKeys = await reseller.get("/api/keys?per_page=100&status=active");
    const ownActive = (ownKeys.body?.data?.items ?? []).find(
      (item) => item.max_device === 3 && Number(item.credit_cost) > 0,
    );
    const selfDelete = await reseller.request("DELETE", `/api/keys/${ownActive.id}`);
    check(
      "reseller hapus key sendiri → TIDAK ada pengembalian",
      selfDelete.status === 200 &&
        selfDelete.body?.data?.refund === null &&
        db.prepare("SELECT credit FROM profiles WHERE username = 'andi'").get().credit === 55,
      `refund=${JSON.stringify(selfDelete.body?.data?.refund)} (key credit_cost=${ownActive?.credit_cost})`,
    );

    // e) Owner menghapus key buatan Owner sendiri → tidak ada pengembalian.
    const ownerKey = await owner.get("/api/keys?per_page=100&status=active");
    const ownerOwn = (ownerKey.body?.data?.items ?? []).find(
      (item) => item.created_by === "00000000-0000-4000-8000-000000000001",
    );
    const deleteOwnKey = await owner.request("DELETE", `/api/keys/${ownerOwn.id}`);
    check(
      "Owner hapus key buatan Owner sendiri → TIDAK ada pengembalian",
      deleteOwnKey.status === 200 && deleteOwnKey.body?.data?.refund === null,
      `refund=${JSON.stringify(deleteOwnKey.body?.data?.refund)}`,
    );

    // ------------------------------------------- AUDIT LOG & AUTO-BAN
    console.log("\n[5c/6] Audit log: alasan ban, auto-ban, unban auto-ban khusus Owner");

    // Key baru khusus untuk bagian ini (generatedKey sudah dihapus di 5b(e)
    // dan jejak auditnya tetap bisa dicek via key_value).
    const auditGen = await owner.post("/api/keys/generate", {
      tool_type_id: tool.id,
      tool_version_id: tool.versions[0].id,
      duration_mode: "custom",
      custom_days: 5,
      max_device: 2,
      quantity: 1,
    });
    const auditKey = auditGen.body?.data?.keys?.[0];
    check("generate key baru untuk uji audit log", auditGen.status === 200 && Boolean(auditKey?.id));

    // a) API audit log hanya untuk Owner.
    const auditForbidden = await reseller.get("/api/audit");
    check("reseller ditolak membuka audit log (403)", auditForbidden.status === 403, `status ${auditForbidden.status}`);

    const auditAll = await owner.get("/api/audit?per_page=100");
    const auditItems = auditAll.body?.data?.items ?? [];
    check(
      "audit log memuat jejak ban/unban/reset HWID/hapus key",
      auditAll.status === 200 && auditItems.length >= 8,
      `total=${auditAll.body?.data?.total}`,
    );

    const auditBanRow = auditItems.find(
      (item) => item.action === "key_ban" && item.key_value === generatedKey.key_value,
    );
    check(
      "audit log: ban oleh owner tercatat dengan alasan terstruktur",
      auditBanRow?.actor_username === "owner" && auditBanRow?.ban_reason === "manual",
      JSON.stringify(auditBanRow ?? {}),
    );

    // Jejak hapus key tetap terbaca walau key-nya sudah tidak ada
    // (key_id di-set NULL, key_value tetap tersimpan).
    const deleteAudit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'key_delete' AND key_value = ?")
      .get(refundDelete.body?.data?.key_value);
    check(
      "audit log: hapus key tercatat lengkap (refund 45) & jejaknya tetap ada setelah key hilang",
      deleteAudit?.actor_username === "owner" &&
        deleteAudit?.key_id === null &&
        deleteAudit?.key_owner_username === "andi" &&
        JSON.parse(deleteAudit?.detail ?? "{}")?.refund?.amount === 45,
      JSON.stringify(deleteAudit ?? {}),
    );

    // b) Filter aksi, pencarian key, export CSV.
    const auditFiltered = await owner.get("/api/audit?action=key_ban");
    check(
      "filter aksi (key_ban) hanya mengembalikan aksi itu",
      (auditFiltered.body?.data?.items?.length ?? 0) > 0 &&
        auditFiltered.body.data.items.every((item) => item.action === "key_ban"),
      `total=${auditFiltered.body?.data?.total}`,
    );

    const auditByKey = await owner.get(`/api/audit?key=${generatedKey.key_value}`);
    check(
      "cari audit log berdasarkan key_value",
      (auditByKey.body?.data?.items?.length ?? 0) >= 3 &&
        auditByKey.body.data.items.every((item) => item.key_value === generatedKey.key_value),
      `total=${auditByKey.body?.data?.total}`,
    );

    const auditCsv = await owner.get("/api/audit?format=csv");
    check(
      "export CSV audit log jalan dari API",
      auditCsv.status === 200 && /aktor/i.test(auditCsv.text.slice(0, 120)),
      `status ${auditCsv.status}, awal: ${JSON.stringify(auditCsv.text.slice(0, 60))}`,
    );

    // c) Alasan ban terstruktur lewat API; auto_hwid ditolak untuk ban manual.
    const reasonBan = await owner.put(`/api/keys/${auditKey.id}/ban`, {
      reason: "refund",
      note: "sengketa dengan customer",
    });
    const reasonMeta = db
      .prepare("SELECT ban_reason, ban_note, banned_by FROM keys WHERE id = ?")
      .get(auditKey.id);
    check(
      "ban dengan alasan refund + catatan tersimpan terstruktur",
      reasonBan.status === 200 &&
        reasonMeta.ban_reason === "refund" &&
        reasonMeta.ban_note === "sengketa dengan customer",
      JSON.stringify(reasonMeta),
    );
    const reasonAudit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'key_ban' AND key_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(auditKey.id);
    check(
      "audit log mencatat alasan refund + catatan",
      reasonAudit?.ban_reason === "refund" && reasonAudit?.note === "sengketa dengan customer",
      JSON.stringify(reasonAudit ?? {}),
    );

    const autoHwidManual = await owner.put(`/api/keys/${auditKey.id}/ban`, { reason: "auto_hwid" });
    check(
      "alasan auto_hwid ditolak untuk ban manual (400)",
      autoHwidManual.status === 400,
      `status ${autoHwidManual.status}`,
    );

    await owner.put(`/api/keys/${auditKey.id}/unban`, {});

    // d) Auto-ban: 5 HWID berbeda ditolak dalam 1 jam → ban_reason auto_hwid + audit sistem.
    const andiAutoKey = db
      .prepare(
        "SELECT k.id, k.key_value, t.slug AS tool_slug, v.name AS tool_version " +
          "FROM keys k JOIN profiles p ON p.id = k.created_by " +
          "JOIN tool_types t ON t.id = k.tool_type_id " +
          "JOIN tool_versions v ON v.id = k.tool_version_id " +
          "WHERE p.username = 'andi' AND k.status = 'active' AND k.max_device = 1 " +
          "AND (SELECT COUNT(*) FROM device_logs d WHERE d.key_id = k.id) = 0 LIMIT 1",
      )
      .get();
    const autoBanHwid = (i) => `hwid-ujian-${i}-${"x".repeat(20)}`;
    const postValidateKey = async (hwid) => {
      const response = await fetch(`${APP_URL}/api/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: andiAutoKey.key_value,
          tool_slug: andiAutoKey.tool_slug,
          tool_version: andiAutoKey.tool_version,
          hardware_id: hwid,
          nonce: randomBytes(18).toString("base64url"),
        }),
      });
      return response.json();
    };

    await postValidateKey(autoBanHwid(0)); // mengisi slot (max_device = 1)
    for (let i = 1; i <= 6; i += 1) await postValidateKey(autoBanHwid(i)); // ditolak → auto-ban

    const autoBanMeta = db
      .prepare("SELECT status, ban_reason, ban_note, banned_by, banned_at FROM keys WHERE id = ?")
      .get(andiAutoKey.id);
    check(
      "auto-ban: status banned + alasan auto_hwid (banned_by NULL = oleh sistem)",
      autoBanMeta.status === "banned" &&
        autoBanMeta.ban_reason === "auto_hwid" &&
        autoBanMeta.banned_by === null &&
        typeof autoBanMeta.banned_at === "string",
      JSON.stringify(autoBanMeta),
    );

    const autoBanAudit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'key_auto_ban' AND key_value = ?")
      .get(andiAutoKey.key_value);
    check(
      "auto-ban tercatat di audit_logs sebagai aksi sistem (IP pemicu ikut)",
      autoBanAudit?.actor_role === "system" &&
        autoBanAudit?.actor_id === null &&
        autoBanAudit?.actor_username === null &&
        autoBanAudit?.ban_reason === "auto_hwid" &&
        autoBanAudit?.key_owner_username === "andi" &&
        typeof JSON.parse(autoBanAudit?.detail ?? "{}")?.source_ip === "string",
      JSON.stringify(autoBanAudit ?? {}),
    );

    // e) Owner-only unban untuk auto-ban.
    const resellerUnban = await reseller.put(`/api/keys/${andiAutoKey.id}/unban`, {});
    check(
      "reseller TIDAK bisa unban key auto-ban (403)",
      resellerUnban.status === 403 && /auto-ban/i.test(resellerUnban.body?.error ?? ""),
      `${resellerUnban.status} ${resellerUnban.body?.error ?? ""}`,
    );
    const stillBanned = db.prepare("SELECT status, ban_reason FROM keys WHERE id = ?").get(andiAutoKey.id);
    check(
      "key tetap banned setelah upaya unban reseller",
      stillBanned.status === "banned" && stillBanned.ban_reason === "auto_hwid",
      JSON.stringify(stillBanned),
    );

    const ownerUnban = await owner.put(`/api/keys/${andiAutoKey.id}/unban`, {});
    const afterOwnerUnban = db
      .prepare("SELECT status, ban_reason, banned_by FROM keys WHERE id = ?")
      .get(andiAutoKey.id);
    check(
      "Owner bisa unban key auto-ban",
      ownerUnban.status === 200 && afterOwnerUnban.status === "active" && afterOwnerUnban.ban_reason === null,
      `status=${ownerUnban.status} key=${JSON.stringify(afterOwnerUnban)}`,
    );
    const unbanAutoAudit = db
      .prepare(
        "SELECT * FROM audit_logs WHERE action = 'key_unban' AND key_value = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(andiAutoKey.key_value);
    check(
      "unban auto-ban oleh Owner tercatat (alasan ban sebelumnya: auto_hwid)",
      unbanAutoAudit?.actor_username === "owner" &&
        JSON.parse(unbanAutoAudit?.detail ?? "{}")?.previous_ban_reason === "auto_hwid",
      JSON.stringify(unbanAutoAudit ?? {}),
    );

    // f) Reseller tetap bisa ban/unban MANUAL pada key miliknya sendiri.
    const manualBan = await reseller.put(`/api/keys/${andiAutoKey.id}/ban`, {
      reason: "manual",
      note: "customer bermasalah",
    });
    const manualMeta = db
      .prepare("SELECT ban_reason, ban_note, banned_by FROM keys WHERE id = ?")
      .get(andiAutoKey.id);
    check(
      "reseller bisa ban manual key miliknya (alasan + catatan + pelaku tercatat)",
      manualBan.status === 200 &&
        manualMeta.ban_reason === "manual" &&
        manualMeta.ban_note === "customer bermasalah" &&
        manualMeta.banned_by === resellerRow.id,
      JSON.stringify(manualMeta),
    );
    const resellerSelfUnban = await reseller.put(`/api/keys/${andiAutoKey.id}/unban`, {});
    check(
      "reseller bisa unban ban manual miliknya sendiri (hanya auto-ban yang dikunci Owner)",
      resellerSelfUnban.status === 200,
      `status ${resellerSelfUnban.status}`,
    );

    // g) Reset semua HWID juga tercatat di audit log.
    const revalidate = await fetch(`${APP_URL}/api/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: auditKey.key_value,
        tool_slug: tool.slug,
        tool_version: tool.versions[0].name,
        hardware_id: `hwid-ujian-reset-${"y".repeat(20)}`,
        nonce: randomBytes(18).toString("base64url"),
      }),
    });
    const revalidateBody = await revalidate.json();
    const rePayload = revalidateBody?.payload
      ? JSON.parse(Buffer.from(revalidateBody.payload, "base64").toString("utf8"))
      : null;
    check(
      "validasi ulang menyiapkan 1 device untuk uji reset semua",
      revalidate.status === 200 && rePayload?.valid === true,
      JSON.stringify({ status: revalidate.status, reason: revalidateBody?.reason ?? null }),
    );

    const resetAll = await owner.request("DELETE", `/api/keys/${auditKey.id}/devices`);
    check(
      "reset semua HWID mengembalikan jumlah device yang dihapus",
      resetAll.status === 200 && resetAll.body?.data?.removed === 1,
      `removed=${resetAll.body?.data?.removed}`,
    );
    const resetAllAudit = db
      .prepare("SELECT * FROM audit_logs WHERE action = 'hwid_reset_all' AND key_id = ?")
      .get(auditKey.id);
    check(
      "reset semua HWID tercatat di audit_logs (jumlah device dihapus)",
      resetAllAudit?.actor_username === "owner" &&
        JSON.parse(resetAllAudit?.detail ?? "{}")?.removed === 1,
      JSON.stringify(resetAllAudit ?? {}),
    );

    const csv = await reseller.get("/api/credits?format=csv");
    check(
      "export CSV credit log jalan dari API (bukan cabang demo di browser)",
      csv.status === 200 && /tanggal/i.test(csv.text.slice(0, 80)),
      `status ${csv.status}, awal: ${JSON.stringify(csv.text.slice(0, 40))}`,
    );

    const topup = await owner.put(`/api/resellers/${resellerRow.id}`, { action: "topup", amount: 50, note: "Uji topup" });
    const creditTopup = db.prepare("SELECT credit FROM profiles WHERE username = 'andi'").get();
    check("topup owner menambah credit (add_credit)", topup.status === 200 && creditTopup.credit === 105, `credit=${creditTopup.credit}`);

    const deactivate = await owner.put(`/api/resellers/${resellerRow.id}`, { action: "set_active", is_active: false });
    const inactiveLogin = await createClient().post("/api/auth/login", RESELLER);
    check(
      "akun nonaktif tidak bisa login (Akun kamu dinonaktifkan)",
      deactivate.status === 200 && inactiveLogin.status === 403 && /dinonaktifkan/i.test(inactiveLogin.body?.error ?? ""),
      `${inactiveLogin.status} ${inactiveLogin.body?.error ?? ""}`,
    );
    await owner.put(`/api/resellers/${resellerRow.id}`, { action: "set_active", is_active: true });

    // ------------------------------------------- VALIDATION ATTEMPTS
    console.log("\n[5d/6] Validation Attempts: log /api/validate — hanya Owner");

    // Akun reseller baru saja dinonaktifkan → sesi lamanya dihapus; login ulang.
    await reseller.post("/api/auth/login", RESELLER);

    // a) Burst invalid_key dari IP uji (x-forwarded-for) → terekam & masuk daftar mencurigakan.
    const burstValidate = async () => {
      const response = await fetch(`${APP_URL}/api/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.66" },
        body: JSON.stringify({
          key: "XLVP-ZZZZ-ZZZZ",
          tool_slug: tool.slug,
          tool_version: tool.versions[0].name,
          hardware_id: `hwid-ujian-va-${randomBytes(8).toString("hex")}`,
          nonce: randomBytes(18).toString("base64url"),
        }),
      });
      return response.json();
    };
    for (let i = 0; i < 6; i += 1) await burstValidate();

    const vaForbidden = await reseller.get("/api/validation-attempts");
    check(
      "reseller ditolak membuka validation attempts (403)",
      vaForbidden.status === 403,
      `status ${vaForbidden.status}`,
    );

    const attemptsInDb = db.prepare("SELECT COUNT(*) AS total FROM validation_attempts").get().total;
    const vaAll = await owner.get("/api/validation-attempts?per_page=100");
    const vaData = vaAll.body?.data;
    check(
      "validation attempts: ringkasan konsisten dengan tabel (total & item)",
      vaAll.status === 200 &&
        vaData?.summary?.total === attemptsInDb &&
        vaData.summary.succeeded + vaData.summary.failed === vaData.summary.total &&
        (vaData.items?.length ?? 0) > 0 &&
        vaData.total === attemptsInDb,
      `total=${vaData?.total} db=${attemptsInDb}`,
    );
    check(
      "validation attempts: tren per jam punya bucket & konsisten dengan total",
      Array.isArray(vaData?.trend) &&
        vaData.trend.length > 0 &&
        vaData.range?.hourly === true &&
        vaData.trend.reduce((sum, point) => sum + point.total, 0) === attemptsInDb,
      `buckets=${vaData?.trend?.length}`,
    );

    const vaSuspect = (vaData?.suspicious_ips ?? []).find((item) => item.ip === "203.0.113.66");
    check(
      "IP mencurigakan: burst invalid_key terdeteksi (suspect, 6 invalid_key)",
      vaSuspect?.suspect === true && vaSuspect?.invalid_key === 6 && vaSuspect?.failed === 6,
      JSON.stringify(vaSuspect ?? {}),
    );

    const vaTopKey = (vaData?.top_failing_keys ?? []).find(
      (item) => item.key_value === "XLVP-ZZZZ-ZZZZ",
    );
    check(
      "key paling sering gagal: XLVP-ZZZZ-ZZZZ tercatat dengan breakdown alasan",
      vaTopKey?.failed === 6 && vaTopKey?.reasons?.invalid_key === 6,
      JSON.stringify(vaTopKey ?? {}),
    );

    // b) Filter hasil & alasan.
    const vaFiltered = await owner.get("/api/validation-attempts?result=failed&reason=invalid_key");
    const vaFilteredData = vaFiltered.body?.data;
    check(
      "filter result=failed & reason=invalid_key konsisten",
      vaFiltered.status === 200 &&
        (vaFilteredData.items?.length ?? 0) >= 6 &&
        vaFilteredData.items.every((item) => item.success === false && item.reason === "invalid_key") &&
        vaFilteredData.summary.failed === vaFilteredData.summary.total,
      `total=${vaFilteredData?.total}`,
    );

    const vaCsv = await owner.get("/api/validation-attempts?format=csv");
    check(
      "export CSV validation attempts jalan dari API",
      vaCsv.status === 200 && /tanggal,ip,key/.test(vaCsv.text.slice(0, 120)),
      `status ${vaCsv.status}, awal: ${JSON.stringify(vaCsv.text.slice(0, 60))}`,
    );

    // c) Halaman hanya untuk Owner (redirect manual supaya 307 terbaca).
    const vaPageOwner = await fetch(`${APP_URL}/validation-attempts`, {
      headers: { cookie: owner.getCookie() },
      redirect: "manual",
    });
    check(
      "halaman /validation-attempts bisa dibuka Owner (200)",
      vaPageOwner.status === 200,
      `status ${vaPageOwner.status}`,
    );

    const vaPageReseller = await fetch(`${APP_URL}/validation-attempts`, {
      headers: { cookie: reseller.getCookie() },
      redirect: "manual",
    });
    check(
      "reseller diarahkan dari halaman /validation-attempts (307 → /dashboard)",
      vaPageReseller.status === 307 &&
        (vaPageReseller.headers.get("location") ?? "").endsWith("/dashboard"),
      `status ${vaPageReseller.status}`,
    );

    const vaPageAnon = await fetch(`${APP_URL}/validation-attempts`, { redirect: "manual" });
    check(
      "tanpa login halaman /validation-attempts diarahkan ke /login (307)",
      vaPageAnon.status === 307 && (vaPageAnon.headers.get("location") ?? "").includes("/login"),
      `status ${vaPageAnon.status}`,
    );

    // ------------------------------------------------------------- LOGOUT
    console.log("\n[6/6] Logout & persistensi");
    const logout = await owner.post("/api/auth/logout", {});
    const afterLogout = await owner.get("/api/auth/session");
    check("logout menghapus sesi di SQLite", logout.status === 200 && afterLogout.body?.session === null);

    const guardAfter = await owner.get("/api/keys");
    check("setelah logout, API panel menolak (401)", guardAfter.status === 401, `status ${guardAfter.status}`);

    const totals = {
      keys: db.prepare("SELECT COUNT(*) AS total FROM keys").get().total,
      devices: db.prepare("SELECT COUNT(*) AS total FROM device_logs").get().total,
      credits: db.prepare("SELECT COUNT(*) AS total FROM credit_logs").get().total,
      tools: db.prepare("SELECT COUNT(*) AS total FROM tool_types").get().total,
      attempts: db.prepare("SELECT COUNT(*) AS total FROM validation_attempts").get().total,
    };
    check(
      "semua tulisan benar-benar tersimpan di file SQLite",
      totals.keys === 13 && totals.tools === 2 && totals.attempts >= 2 && totals.credits > 15 && totals.devices >= 8,
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
  if (failures > 0) console.log(`GAGAL: ${failures} pemeriksaan`);
  console.log("─────────────────────────────────────────────\n");

  process.exit(failures > 0 ? 1 : 0);
}

void main();
