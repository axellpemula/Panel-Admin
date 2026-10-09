/**
 * dev/sidebar-test.mjs — uji tombol buka/tutup sidebar (klik logo X 3D).
 *
 * Yang diverifikasi, di viewport desktop (1280×800) dan mobile (iPhone 13):
 *   1. Sidebar tampil ⇒ konten punya ruang (padding-left 224px / 56px).
 *   2. Klik X di header sidebar ⇒ panel keluar layar penuh, ruang konten nol,
 *      tombol X di topbar muncul, fokus pindah ke tombol itu (bukan tertinggal
 *      di dalam panel yang tersembunyi), cookie preferensi tersimpan.
 *   3. Refresh ⇒ HTML pertama sudah tersembunyi (dibaca dari cookie di server,
 *      jadi tidak ada kedipan "muncul lalu hilang").
 *   4. Klik X di topbar ⇒ sidebar kembali dan tetap di posisi semula.
 *   5. Toggle tidak me-remount halaman: isi form yang sedang diketik tidak hilang.
 *   6. Tombol bisa dioperasikan dengan keyboard (Enter) dan punya aria-label.
 *
 * Jalankan (butuh server lokal SQLite di port 3010 — `npm run demo`):
 *   node dev/sidebar-test.mjs
 *   BASE_URL=http://localhost:3000 node dev/sidebar-test.mjs
 *
 * Butuh: npm i -D playwright && npx playwright install chromium
 */

import { chromium, devices } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3010";
const OWNER = { email: "owner@gmail.com", password: "Axell123" };

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

const results = [];
let failures = 0;

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  if (!passed) failures += 1;
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Ambil semua ukuran/atribut yang kita butuhkan dari halaman. */
async function snapshot(page) {
  return page.evaluate(() => {
    const aside = document.getElementById("app-sidebar");
    const toggle = document.querySelector('header button[aria-controls="app-sidebar"]');
    const content = aside?.nextElementSibling ?? null;
    const active = document.activeElement;
    const box = aside?.getBoundingClientRect();
    const inside = (selector) => Boolean(aside?.querySelector(selector));

    return {
      asideExists: Boolean(aside),
      asideX: box ? Math.round(box.x) : null,
      asideWidth: box ? Math.round(box.width) : null,
      ariaHidden: aside?.getAttribute("aria-hidden") ?? null,
      contentPaddingLeft: content ? getComputedStyle(content).paddingLeft : null,
      toggleInAside: inside('button[aria-label="Sembunyikan sidebar"]'),
      topbarToggleLabel: toggle?.getAttribute("aria-label") ?? null,
      activeLabel: active?.getAttribute?.("aria-label") ?? null,
      activeTag: active?.tagName ?? null,
      cookie: document.cookie,
      // Elemen apa yang benar-benar berada di titik ini (uji "tidak menutupi konten").
      hitAtLeftEdge: (() => {
        const el = document.elementFromPoint(20, 320);
        if (!el) return "none";
        return aside?.contains(el) ? "sidebar" : el.tagName.toLowerCase();
      })(),
    };
  });
}

async function runViewport(browser, { label, contextOptions }) {
  console.log(`\n── ${label} ─────────────────────────────────`);

  const context = await browser.newContext({ ...contextOptions, locale: "id-ID" });
  await loginAs(context, OWNER.email, OWNER.password);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  [pageerror] ${error.message}`));

  const go = async (path = "/dashboard") => {
    await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
  };

  // ------------------------------------------------------------ 1. TERBUKA
  await go();
  const open = await snapshot(page);
  const wide = contextOptions.viewport.width >= 1024;
  const expectedPadding = wide ? 224 : 56;

  check("sidebar tampil di posisi awal", open.asideX === 0, `x=${open.asideX}`);
  check(
    `konten punya ruang ${expectedPadding}px saat sidebar tampil`,
    open.contentPaddingLeft === `${expectedPadding}px`,
    `padding-left=${open.contentPaddingLeft}`,
  );
  check("tombol X topbar tidak muncul saat sidebar tampil", open.topbarToggleLabel === null);
  check("tombol X di header sidebar tersedia", open.toggleInAside === true);

  // --------------------------------- 2. TOGGLE MEMAKAI STATE HALAMAN LAIN
  // (bukti toggle tidak me-remount konten: isi form tetap ada)
  await go("/keys");
  const search = page.getByLabel("Cari key");
  await search.click();
  await search.fill("XLVP-AB");
  await page.locator('aside button[aria-label="Sembunyikan sidebar"]').click();
  await page.waitForTimeout(400);
  check(
    "isi form tidak hilang setelah sidebar disembunyikan (tidak remount)",
    (await search.inputValue()) === "XLVP-AB",
    `nilai=${JSON.stringify(await search.inputValue())}`,
  );

  // ------------------------------------------------- 3. SETELAH DISEMBUNYIKAN
  const hidden = await snapshot(page);
  check(
    "panel keluar layar sepenuhnya",
    hidden.asideX !== null && hidden.asideX <= -hidden.asideWidth + 1,
    `x=${hidden.asideX}, width=${hidden.asideWidth}`,
  );
  check("ruang konten jadi 0", hidden.contentPaddingLeft === "0px", `padding-left=${hidden.contentPaddingLeft}`);
  check("panel ditandai aria-hidden untuk screen reader", hidden.ariaHidden === "true");
  check(
    "tombol X muncul di topbar",
    hidden.topbarToggleLabel === "Tampilkan sidebar",
    `aria-label=${hidden.topbarToggleLabel}`,
  );
  check(
    "fokus berpindah ke tombol X di topbar",
    hidden.activeLabel === "Tampilkan sidebar",
    `fokus=${hidden.activeTag} "${hidden.activeLabel}"`,
  );
  check("cookie preferensi tersimpan", hidden.cookie.includes("xloop_sidebar=hidden"));
  check(
    "panel yang tersembunyi tidak menutupi/klik-able di tepi kiri",
    hidden.hitAtLeftEdge !== "sidebar",
    `elemen di titik (20,320): ${hidden.hitAtLeftEdge}`,
  );

  // ------------------------------------------------------- 4. SETELAH REFRESH
  await page.reload({ waitUntil: "domcontentloaded" });
  const reloaded = await snapshot(page); // tanpa jeda: cek kondisi paint pertama
  check(
    "refresh: HTML pertama sudah tersembunyi (tanpa kedipan)",
    reloaded.asideX !== null && reloaded.asideX <= -reloaded.asideWidth + 1,
    `x=${reloaded.asideX} saat domcontentloaded`,
  );
  check("refresh: cookie tetap terbaca", reloaded.cookie.includes("xloop_sidebar=hidden"));

  // Markup server juga diperiksa langsung (tanpa JS sama sekali).
  const ssr = await context.request.get(`${BASE_URL}/dashboard`);
  const html = await ssr.text();
  check(
    "markup server memuat kelas tersembunyi (-translate-x-full)",
    html.includes("-translate-x-full"),
  );
  const wrapperClass = html.match(/class="flex min-h-screen flex-col[^"]*"/)?.[0] ?? "";
  check(
    "markup server memuat padding konten nol",
    wrapperClass.includes("pl-0") && !wrapperClass.includes("pl-14") && !wrapperClass.includes("lg:pl-56"),
    wrapperClass.slice(0, 90),
  );

  // ------------------------------------------------------- 5. DITAMPILKAN LAGI
  await page.locator('header button[aria-controls="app-sidebar"]').click();
  await page.waitForTimeout(400);
  const shown = await snapshot(page);
  check("klik X di topbar: sidebar kembali", shown.asideX === 0, `x=${shown.asideX}`);
  check(
    `ruang konten kembali ${expectedPadding}px`,
    shown.contentPaddingLeft === `${expectedPadding}px`,
    `padding-left=${shown.contentPaddingLeft}`,
  );
  check("cookie jadi 'open'", shown.cookie.includes("xloop_sidebar=open"));
  check("aria-hidden dilepas", shown.ariaHidden === null || shown.ariaHidden === "false");

  await page.reload({ waitUntil: "domcontentloaded" });
  const afterReload = await snapshot(page);
  check("refresh: pilihan terbuka juga bertahan", afterReload.asideX === 0, `x=${afterReload.asideX}`);

  // ------------------------------------------------------------ 6. KEYBOARD
  await page.locator('aside button[aria-label="Sembunyikan sidebar"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const keyboardToggle = await snapshot(page);
  check(
    "tombol bisa dipakai dengan keyboard (Enter)",
    keyboardToggle.topbarToggleLabel === "Tampilkan sidebar",
    `aria-label topbar=${keyboardToggle.topbarToggleLabel}`,
  );

  await context.close();
}

async function main() {
  const browser = await chromium.launch();

  await runViewport(browser, {
    label: "Desktop 1280×800",
    contextOptions: { viewport: { width: 1280, height: 800 } },
  });

  await runViewport(browser, {
    label: "Mobile (iPhone 13, 390×844)",
    contextOptions: devices["iPhone 13"],
  });

  await browser.close();

  console.log("\n─────────────────────────────────────────────");
  const passed = results.filter((item) => item.passed).length;
  console.log(`Hasil: ${passed}/${results.length} pemeriksaan lolos`);
  if (failures > 0) {
    console.log(`GAGAL: ${failures} pemeriksaan tidak lolos`);
    results.filter((item) => !item.passed).forEach((item) => console.log(`   - ${item.name}`));
  }
  console.log("─────────────────────────────────────────────\n");

  process.exit(failures > 0 ? 1 : 0);
}

void main();
