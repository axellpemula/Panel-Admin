/**
 * dev/focus-test.mjs — uji fokus input (regresi "keyboard ketutup setelah 1 huruf").
 *
 * Cara kerja: untuk setiap input teks, klik input lalu ketik beberapa karakter.
 * Setelah SETIAP karakter, diperiksa apakah document.activeElement masih input
 * yang sama. Kalau fokus berpindah (mis. balik ke tombol pemicu), di mobile
 * keyboard akan langsung tertutup — itu bug yang kita cari.
 *
 * Jalankan (butuh server lokal SQLite di port 3010 — `npm run demo`):
 *   node dev/focus-test.mjs
 *   BASE_URL=http://localhost:3000 node dev/focus-test.mjs
 *
 * Butuh: npm i -D playwright && npx playwright install chromium
 */

import { chromium, devices } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3010";
const OWNER = { email: "owner@gmail.com", password: "Axell123" };
const TYPED = "abc"; // huruf saja: aman walau fokus berpindah ke tombol
const STEP_DELAY = 140;

const results = [];
let failures = 0;

function describe(element) {
  if (!element) return "null";
  const tag = element.tagName.toLowerCase();
  const label =
    element.getAttribute("aria-label") ??
    element.getAttribute("placeholder") ??
    element.id ??
    element.textContent?.trim().slice(0, 24) ??
    "";
  return `${tag}${label ? ` "${label}"` : ""}`;
}

/** Klik input, ketik TYPED karakter, cek fokus tiap karakter. */
async function typeAndWatch(page, locator, name, text = TYPED) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await page.waitForTimeout(120);

  const focusTrail = [];
  for (const character of text) {
    await page.keyboard.type(character);
    await page.waitForTimeout(STEP_DELAY);
    const active = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        tag: el?.tagName ?? null,
        isTarget: el === window.__target,
      };
    });
    focusTrail.push(active);
  }

  const lostAt = focusTrail.findIndex((entry) => entry.isTarget !== true);
  const current = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName ?? null, description: null };
  });
  const activeDescription = await page.evaluate((fnBody) => {
    const el = document.activeElement;
    if (!el) return null;
    const label =
      el.getAttribute?.("aria-label") ??
      el.getAttribute?.("placeholder") ??
      el.textContent?.trim().slice(0, 24) ??
      "";
    return `${el.tagName.toLowerCase()}${label ? ` "${label}"` : ""}`;
  });

  const passed = lostAt === -1;
  results.push({ name, passed, lostAt: lostAt === -1 ? null : lostAt + 1, focusNow: activeDescription });
  if (!passed) failures += 1;

  const value = await locator.inputValue();
  console.log(
    `  [${passed ? "PASS" : "FAIL"}] ${name} — isi input: "${value}"` +
      (passed ? "" : ` · fokus hilang setelah karakter ke-${lostAt + 1}, sekarang di <${activeDescription}>`),
  );

  return passed;
}

/** Tandai elemen target di halaman supaya bisa dibandingkan dari dalam browser. */
async function markTarget(page, locator) {
  await locator.evaluate((el) => {
    window.__target = el;
  });
}

/**
 * Login lewat API supaya konteks browser mendapat cookie sesi (mode SQLite
 * memakai cookie `xloop_session`; tidak ada lagi cookie demo).
 * Akun bawaan ada di README bagian 13.
 */
async function loginAs(context, email, password) {
  const response = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { email, password },
  });
  if (!response.ok()) {
    throw new Error(`Login ${email} gagal (${response.status()}): ${await response.text()}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "id-ID",
  });

  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));

  const go = async (path) => {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
  };

  // ---------------------------------------------------------------- LOGIN
  console.log("\n[1] Halaman Login");
  await go("/login");
  const emailInput = page.locator("#email");
  await markTarget(page, emailInput);
  await typeAndWatch(page, emailInput, "login: email");
  const passwordInput = page.locator("#password");
  await markTarget(page, passwordInput);
  await typeAndWatch(page, passwordInput, "login: password");

  // Setelah bagian login selesai, masuk sebagai owner lewat API supaya
  // halaman-halaman panel bisa dibuka (mode SQLite memakai cookie sesi asli).
  await loginAs(context, OWNER.email, OWNER.password);

  // ------------------------------------------------------------- KEY LIST
  console.log("\n[2] Key List");
  await go("/keys");
  const search = page.getByLabel("Cari key");
  await markTarget(page, search);
  await typeAndWatch(page, search, "key list: search (dengan debounce + refetch)");

  // Modal Edit Key
  await page.locator('button[aria-label="Edit key"]').first().click();
  await page.waitForTimeout(500);
  const addDays = page.locator('input[type="number"]').first();
  await markTarget(page, addDays);
  await typeAndWatch(page, addDays, "modal edit key: tambah hari", "365");
  const noteArea = page.locator("textarea").first();
  await markTarget(page, noteArea);
  await typeAndWatch(page, noteArea, "modal edit key: catatan");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // -------------------------------------------------------------- GENERATE
  console.log("\n[3] Generate Key");
  await go("/generate");
  const noteGenerate = page.locator("textarea").first();
  await markTarget(page, noteGenerate);
  await typeAndWatch(page, noteGenerate, "generate: note");
  const customDays = page.locator('input[type="number"]').first();
  await markTarget(page, customDays);
  await typeAndWatch(page, customDays, "generate: max device / quantity", "123");

  // ----------------------------------------------------------------- TOOLS
  console.log("\n[4] Tool Management (modal)");
  await go("/tools");
  await page.getByRole("button", { name: "Tambah Tool" }).first().click();
  await page.waitForTimeout(500);
  const toolName = page.getByPlaceholder("Contoh: Perkakas Pro");
  await markTarget(page, toolName);
  await typeAndWatch(page, toolName, "modal tool: nama (auto-slug)");
  const toolSlug = page.getByPlaceholder("perkakas-pro");
  await markTarget(page, toolSlug);
  await typeAndWatch(page, toolSlug, "modal tool: slug");
  const toolSecret = page.locator("textarea").first();
  await markTarget(page, toolSecret);
  await typeAndWatch(page, toolSecret, "modal tool: payload rahasia");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ------------------------------------------------------------- DURATIONS
  console.log("\n[5] Duration Setting (modal)");
  await go("/durations");
  await page.getByRole("button", { name: "Tambah Preset" }).first().click();
  await page.waitForTimeout(500);
  const presetName = page.getByPlaceholder("1 Bulan");
  await markTarget(page, presetName);
  await typeAndWatch(page, presetName, "modal preset: nama durasi");
  const presetDays = page.locator('input[type="number"]').first();
  await markTarget(page, presetDays);
  await typeAndWatch(page, presetDays, "modal preset: jumlah hari", "123");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ------------------------------------------------------------- RESELLERS
  console.log("\n[6] Reseller (modal)");
  await go("/resellers");
  await page.getByRole("button", { name: "Tambah Reseller" }).first().click();
  await page.waitForTimeout(500);
  const username = page.locator('input[autocomplete="off"]').first();
  await markTarget(page, username);
  await typeAndWatch(page, username, "modal reseller: username");
  const resellerEmail = page.locator('input[type="email"]').first();
  await markTarget(page, resellerEmail);
  await typeAndWatch(page, resellerEmail, "modal reseller: email");
  const resellerPassword = page.locator('input[type="text"]').first();
  await markTarget(page, resellerPassword);
  await typeAndWatch(page, resellerPassword, "modal reseller: password");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Modal topup (state di komponen halaman, bukan di modal)
  await page.getByRole("button", { name: "Topup" }).first().click();
  await page.waitForTimeout(500);
  const topupAmount = page.locator('input[type="number"]').first();
  await markTarget(page, topupAmount);
  await typeAndWatch(page, topupAmount, "modal topup: jumlah credit", "123");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Modal reset password (state di komponen halaman)
  await page.getByRole("button", { name: "Password" }).first().click();
  await page.waitForTimeout(500);
  const newPassword = page.locator('input[type="text"]').first();
  await markTarget(page, newPassword);
  await typeAndWatch(page, newPassword, "modal reset password: password baru");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Dialog konfirmasi hapus reseller (input konfirmasi username, state di ConfirmDialog)
  const deleteButton = page.locator('button[aria-label="Hapus reseller"]').first();
  await deleteButton.click();
  await page.waitForTimeout(500);
  const confirmInput = page.locator('input.font-mono').last();
  await markTarget(page, confirmInput);
  await typeAndWatch(page, confirmInput, "dialog hapus reseller: konfirmasi username");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Setelah modal ditutup, fokus harus kembali ke tombol pemicu (perilaku yang benar)
  const focusBackToTrigger = await deleteButton.evaluate((el) => document.activeElement === el);
  results.push({
    name: "fokus kembali ke tombol pemicu setelah modal ditutup",
    passed: focusBackToTrigger,
    focusNow: null,
  });
  if (!focusBackToTrigger) failures += 1;
  console.log(
    `  [${focusBackToTrigger ? "PASS" : "FAIL"}] fokus kembali ke tombol pemicu setelah modal ditutup`,
  );

  // --------------------------------------------------------------- CREDITS
  console.log("\n[7] Credit Log");
  await go("/credits");
  const dateInputs = page.locator('input[type="date"]');
  if ((await dateInputs.count()) > 0) {
    const fromDate = dateInputs.first();
    await markTarget(page, fromDate);
    // date input tidak diketik manual, tapi pastikan fokus tidak lepas saat nilai berubah
    await fromDate.click();
    await fromDate.fill("2026-10-01");
    await page.waitForTimeout(400);
    const stillFocused = await page.evaluate(() => document.activeElement === window.__target);
    results.push({
      name: "credit log: filter tanggal (fokus setelah nilai berubah)",
      passed: stillFocused,
      focusNow: null,
    });
    if (!stillFocused) failures += 1;
    console.log(`  [${stillFocused ? "PASS" : "FAIL"}] credit log: filter tanggal`);
  }

  await browser.close();

  console.log("\n─────────────────────────────────────────────");
  const passed = results.filter((item) => item.passed).length;
  console.log(`Hasil: ${passed}/${results.length} input menjaga fokus`);
  if (failures > 0) {
    console.log(`GAGAL: ${failures} input kehilangan fokus saat mengetik`);
    results
      .filter((item) => !item.passed)
      .forEach((item) => console.log(`   - ${item.name} (hilang di karakter ke-${item.lostAt})`));
  }
  console.log("─────────────────────────────────────────────\n");

  process.exit(failures > 0 ? 1 : 0);
}

void main();
