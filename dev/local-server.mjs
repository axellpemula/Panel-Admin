#!/usr/bin/env node
/**
 * dev/local-server.mjs
 *
 * Menjalankan panel memakai database SQLite lokal (`data/xloop.sqlite`) —
 * tanpa Supabase, tanpa env apa pun. Dipakai untuk pratinjau UI, pengembangan
 * harian, dan uji otomatis.
 *
 * Pakai:
 *   node dev/local-server.mjs              # next dev (default, http://localhost:3010)
 *   node dev/local-server.mjs --prod       # build (sekalian kalau perlu) + next start
 *   PORT=4000 node dev/local-server.mjs    # ganti port
 *   XLOOP_SQLITE_PATH=/tmp/db.sqlite node dev/local-server.mjs
 *
 * Catatan build: `--prod` memakai ulang hasil `.next` hanya kalau build itu
 * memang dibuat untuk mode lokal (penanda `.next/local-build.json`). Hasil
 * `next build` biasa (untuk deploy Supabase) akan dibangun ulang di sini.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";

const useProd = process.argv.includes("--prod");
const port = process.env.PORT ?? "3010";
const dbPath = process.env.XLOOP_SQLITE_PATH ?? "data/xloop.sqlite";

/**
 * Kunci tanda tangan lisensi: pakai env kalau ada, kalau tidak buat sekali dan
 * simpan di `data/local-signing-key.json` supaya /api/validate bisa dipakai
 * sungguhan saat development (client di tool tinggal pakai public key-nya).
 */
function loadSigningKeys() {
  if (process.env.LICENSE_SIGNING_PRIVATE_KEY && process.env.LICENSE_SIGNING_PUBLIC_KEY) {
    return process.env.LICENSE_SIGNING_PUBLIC_KEY;
  }

  const keyFile = path.join(process.cwd(), "data", "local-signing-key.json");
  if (existsSync(keyFile)) {
    const saved = JSON.parse(readFileSync(keyFile, "utf8"));
    process.env.LICENSE_SIGNING_PRIVATE_KEY = saved.privateKey;
    return saved.publicKey;
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const encodedPrivate = Buffer.from(privateKey, "utf8").toString("base64");
  const encodedPublic = Buffer.from(publicKey, "utf8").toString("base64");

  mkdirSync(path.dirname(keyFile), { recursive: true });
  writeFileSync(
    keyFile,
    JSON.stringify({ privateKey: encodedPrivate, publicKey: encodedPublic }, null, 2),
  );

  process.env.LICENSE_SIGNING_PRIVATE_KEY = encodedPrivate;
  return encodedPublic;
}

const publicKey = loadSigningKeys();
process.env.LICENSE_SIGNING_PUBLIC_KEY = publicKey;

const env = {
  ...process.env,
  // Mode SQLite (fungsi dbMode() juga jatuh ke SQLite otomatis kalau env
  // Supabase kosong — ini cuma memastikan tidak ambigu).
  XLOOP_DB: "sqlite",
  NEXT_PUBLIC_MOCK_MODE: "1",
  XLOOP_SQLITE_PATH: dbPath,
  LICENSE_TOKEN_TTL_SECONDS: process.env.LICENSE_TOKEN_TTL_SECONDS ?? "900",
  CRON_SECRET: process.env.CRON_SECRET ?? "cron-lokal",
};

console.log("");
console.log("  XLOOP PANEL — MODE SQLITE (LOKAL)");
console.log("  ─────────────────────────────────────────────");
console.log(`  Database : ${path.resolve(dbPath)}`);
console.log(`  Buka     : http://localhost:${port}`);
console.log("  Login    : owner@gmail.com / Axell123   (owner)");
console.log("             andi@example.com / Reseller123 (reseller)");
console.log(`  Public key lisensi: ${publicKey.slice(0, 32)}…`);
console.log("");

function run(command, args) {
  const child = spawn(command, args, { env, stdio: "inherit", shell: false });
  child.on("exit", (code) => process.exit(code ?? 0));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  return child;
}

const buildMarker = new URL("../.next/local-build.json", import.meta.url);
const buildId = new URL("../.next/BUILD_ID", import.meta.url);

function hasLocalBuild() {
  if (!existsSync(buildId)) return false;
  try {
    return JSON.parse(readFileSync(buildMarker, "utf8")).mode === "sqlite";
  } catch {
    return false;
  }
}

if (useProd) {
  if (hasLocalBuild()) {
    console.log("  Memakai hasil build mode lokal yang sudah ada.");
    run("node", ["./node_modules/next/dist/bin/next", "start", "-p", port]);
  } else {
    console.log("  Belum ada hasil build mode lokal. Menjalankan `next build` dulu…");
    const build = spawn("node", ["./node_modules/next/dist/bin/next", "build"], {
      env,
      stdio: "inherit",
      shell: false,
    });
    build.on("exit", (code) => {
      if (code === 0) {
        writeFileSync(
          buildMarker,
          JSON.stringify({ mode: "sqlite", builtAt: new Date().toISOString() }, null, 2),
        );
        run("node", ["./node_modules/next/dist/bin/next", "start", "-p", port]);
      } else {
        process.exit(code ?? 1);
      }
    });
  }
} else {
  run("node", ["./node_modules/next/dist/bin/next", "dev", "-p", port]);
}
