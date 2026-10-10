# Catatan Verifikasi

Dokumen ini mencatat apa yang benar-benar **dijalankan dan diuji** di repo ini, plus apa yang
butuh Supabase asli untuk diverifikasi. Semua perintah di bawah bisa kamu ulangi sendiri.

Tanggal verifikasi: 2026-10-04 · Diperbarui: 2026-10-07 (logo X 3D, regresi fokus, toggle sidebar, mode SQLite)
· Diperbarui: 2026-10-08 (audit log + alasan ban terstruktur + unban auto-ban khusus Owner)
· Diperbarui: 2026-10-08 (audit menyeluruh seluruh codebase — 14 bug/potensi diperbaiki, lihat §9.8)
· Diperbarui: 2026-10-10 (palet tambahan, warna permukaan, radius, audit UI/UX, lihat §9.9)
Node.js v22.22.3 (verifikasi 2026-10-10; sebelumnya v20.20.2) · Next.js 14.2.15

---

## 1. Build & pemeriksaan statis

| Perintah | Hasil |
|---|---|
| `npm install` | ✅ tanpa error (termasuk paket native `better-sqlite3` untuk mode SQLite) |
| `npx tsc --noEmit` | ✅ 0 error TypeScript |
| `npx next lint` | ✅ `No ESLint warnings or errors` |
| `npx next build` | ✅ semua route terkompilasi (10 halaman + 23 API route + middleware) |
| build mode SQLite (`XLOOP_DB=sqlite`) | ✅ sama-sama terkompilasi; `better-sqlite3` tetap di luar bundle server (`serverComponentsExternalPackages`) |

Ringkasan build (production):

```
Route (app)                              Size     First Load JS
├ ○ /                                    147 B          87.6 kB
├ ƒ /api/auth/login, logout, session                     0 B
├ ƒ /api/keys, /api/keys/[id], ban, unban, devices, generate
├ ƒ /api/tools, /api/tools/[id], secret, versions, versions/[vid]
├ ƒ /api/durations, /api/durations/[id]
├ ƒ /api/resellers, /api/resellers/[id]
├ ƒ /api/credits
├ ƒ /api/audit
├ ƒ /api/validate
├ ƒ /api/cron/cleanup
├ ƒ /audit, /credits, /dashboard, /durations, /generate, /keys, /login, /resellers, /tools
+ First Load JS shared                     87.5 kB
ƒ Middleware                              56.8 kB
```

Recharts hanya muncul di chunk halaman dashboard (di-load `next/dynamic({ ssr: false })`),
sehingga bundle awal halaman lain tetap ~87 kB.

---

## 2. SQL migration

`migration.sql` di-parse dengan parser PostgreSQL (libpg_query via `pglast`):

```
PARSE OK — 120 statements
```

(Diperbarui 2026-10-08: +12 statement dari fitur audit log — kolom `ban_reason/ban_note/banned_by/
banned_at` di `keys` + blok `DO $$` idempotent, tabel `audit_logs` + 5 index, RLS + policy
"Owner sees all audit logs". PARSE OK — 120 statements.)

Yang diperiksa: seluruh DDL (`CREATE TABLE/INDEX/FUNCTION/TRIGGER/POLICY`, `DO $$ … $$`,
`GRANT`, `ALTER DEFAULT PRIVILEGES`) valid secara sintaks. Body PL/pgSQL ada di dalam string
literal, jadi **wajib dijalankan sekali di Supabase SQL Editor** untuk verifikasi penuh
(lihat langkah di README bagian 4).

---

## 3. Endpoint validasi — uji end-to-end di mode SQLite

```bash
npm run verify:validate
```

> Catatan: skrip ini menjalankan `next dev`, yang memakai folder `.next` yang sama dengan hasil
> `next build`. Kalau kamu sedang menjalankan server produksi (`npm start`), jalankan
> `npm run build` lagi setelah test selesai.

Cara kerja: Next.js dijalankan dalam **mode SQLite** dengan file database sementara
(`XLOOP_SQLITE_PATH=<tmp>/xloop.sqlite`) dan keypair Ed25519 yang digenerate saat test. Data uji
(tool `perkakas-pro` 1.8.0, empat key dengan skenario berbeda) dimasukkan langsung ke file SQLite
yang sama, jadi `register_device`, rate limit, dan auto-ban diuji terhadap database sungguhan —
bukan stub lagi.

Hasil (28/28 lulus):

```
[3/7] Validasi input
  [PASS] key format salah → 400 invalid_request
  [PASS] nonce tidak valid → 400 invalid_request
  [PASS] body > 2 KB → 400 invalid_request

[4/7] Happy path + signature + payload
  [PASS] response sukses berisi payload + signature
  [PASS] signature Ed25519 valid
  [PASS] payload.valid === true
  [PASS] payload.nonce sama dengan request
  [PASS] payload.hardware_id sama dengan request
  [PASS] payload.tool & version sesuai
  [PASS] payload.current_devices = 1
  [PASS] secret_payload dikirim dari tool_secrets
  [PASS] TTL token = LICENSE_TOKEN_TTL_SECONDS (900s)
  [PASS] signature yang dirusak tidak valid
  [PASS] HWID sama → tetap ok & tidak menambah slot
  [PASS] HWID baru & slot tersedia → current_devices = 2
  [PASS] slot penuh → device_limit_exceeded
  [PASS] last_used ikut ter-update di tabel keys
  [PASS] percobaan validasi tercatat di validation_attempts
  [PASS] device_logs berisi 2 HWID untuk key uji
  [PASS] aplikasi berjalan di mode SQLite

[5/7] Kombinasi salah & status key
  [PASS] tool_slug salah → wrong_tool
  [PASS] tool_version salah → wrong_version
  [PASS] key banned → key_banned
  [PASS] key expired → key_expired
  [PASS] key tidak ada → invalid_key

[6/7] Anti-bruteforce & auto-ban
  [PASS] setelah ≥5 invalid_key, reason disamarkan jadi invalid_key
  [PASS] auto-ban setelah 5 HWID berbeda ditolak (note: "Auto-ban: terlalu banyak device berbeda")

[7/7] Rate limit
  [PASS] request berlebih → HTTP 429 rate_limited
```

---

## 4. Kode verifikasi sisi client (Python & JavaScript)

Response sukses ditandatangani dengan konstruksi yang sama seperti server
(`signature = Ed25519(JSON.stringify(payload))`, payload dikirim base64):

```bash
node scripts/make-sample-response.mjs
cd docs/examples
python verify_example.py --sample sample-response.json
node verify_example.js  --sample sample-response.json
```

Hasil:

```
Signature: VALID
secret_payload diterima: true
Signature dirusak: DITOLAK (benar)
```

Artinya: kode Python dan JavaScript di `docs/examples/` benar-benar bisa memverifikasi
response bertanda tangan, dan menolak response yang dipalsukan.

---

## 5. UI — pratinjau mode SQLite

```bash
npm run demo        # http://localhost:3010, database lokal data/xloop.sqlite, tanpa Supabase
```

Build lokal dipakai untuk pratinjau (`.next/local-build.json` sebagai penanda). Setelah `next build`
manual (untuk deployment Supabase), jalankan runner lokal lagi — ia akan membangun ulang sendiri.

Halaman yang dicek render-nya (HTTP 200, HTML berisi konten yang diharapkan):

| Halaman | Owner | Reseller |
|---|---|---|
| `/login` | 200 | 200 |
| `/dashboard` | 200 (12 key, 8 active, 3 expired, 1 banned, 2 reseller aktif, grafik, Top Reseller, Aktivitas) | 200 (statistik milik `andi`) |
| `/keys` | 200 | 200 |
| `/tools` | 200 | 307 → `/dashboard` (ditolak, benar) |
| `/durations` | 200 | 307 → `/dashboard` |
| `/resellers` | 200 | 307 → `/dashboard` |
| `/credits` | 200 | 200 |
| `/audit` | 200 (tabel + filter + export CSV) | 307 → `/dashboard` (ditolak, benar) |
| `/generate` | 200 | 200 |

---

## 6. Logo X 3D

- Dipakai di **sidebar** (28px), **halaman login** (32px), dan **favicon** `app/icon.svg`.
- Blade lama (badge kotak ber-border dengan teks "XL") sudah tidak ada lagi — dicek dengan
  `grep '>XL<'` pada HTML hasil render: tidak ditemukan.
- Markup hasil render diperiksa: `<svg width="28" height="28" viewBox="0 0 24 24">` berisi
  **3 lapisan path** identik dengan offset `translate(1 1)` / `translate(0.5 0.5)` / tanpa offset,
  `fill` memakai token `rgb(var(--c-accent) / 0.42 | 0.66 | 1)` — tanpa background, border, filter,
  atau gradient.
- Semua ukuran (14–190px) di-rasterisasi dengan Sharp untuk memastikan bentuknya tetap terbaca dan
  tidak ada artefak (notch/lengan tidak terpisah) sebelum dipasang.
- `npm run lint`, `npx tsc --noEmit`, dan `next build` tetap hijau setelah perubahan.

## 7. Uji fokus input — regresi "keyboard mobile ketutup setelah 1 huruf"

**Gejala (dilaporkan):** di HP, begitu mengetik 1 huruf di form modal, keyboard langsung tertutup.

**Reproduksi:** `npm run test:focus` (Playwright, emulasi iPhone 13) — klik input, ketik karakter
satu per satu, dan periksa `document.activeElement` setelah setiap karakter.

Hasil **sebelum perbaikan** — 10/17 lulus, 7 input gagal, semuanya di modal yang state form-nya
disimpan di komponen halaman:

```
[FAIL] modal tool: nama (auto-slug)      — fokus hilang setelah karakter ke-1 → <button "Tambah Tool">
[FAIL] modal tool: slug                  — fokus hilang setelah karakter ke-1 → <button "Tambah Tool">
[FAIL] modal tool: payload rahasia       — fokus hilang setelah karakter ke-1 → <button "Tambah Tool">
[FAIL] modal preset: nama durasi         — fokus hilang setelah karakter ke-1 → <button "Tambah Preset">
[FAIL] modal reseller: username          — fokus hilang setelah karakter ke-1 → <button "Tambah Reseller">
[FAIL] modal reseller: email             — fokus hilang setelah karakter ke-1 → <button "Tambah Reseller">
[FAIL] modal reseller: password          — fokus hilang setelah karakter ke-1 → <button "Tambah Reseller">
```

Modal dengan state internal (Edit Key, Generate, dialog konfirmasi) lulus — ini yang mempersempit
penyebabnya.

**Akar masalah:** di `components/ui/Modal.tsx`, effect yang mengunci scroll `body` + memasang
listener `Escape` bergantung pada `handleClose` (`useCallback` dengan dependency `onClose`).
Karena `onClose` selalu ditulis inline di pemanggilnya (`onClose={() => setX(null)}`), identitasnya
berubah setiap komponen halaman re-render — dan komponen halaman re-render **setiap kali user
mengetik** (state form ada di sana). Saat dependency effect berubah, React menjalankan
**cleanup**-nya, dan cleanup itu berisi `lastFocused.current.focus()` — jadi fokus ditarik kembali
ke tombol pemicu di belakang modal, walaupun modal masih terbuka. Di desktop efeknya: input tidak
bisa diketik lebih dari 1 huruf. Di mobile: OSK tertutup.

**Perbaikan** (`components/ui/Modal.tsx`):

1. `onClose` & `busy` disimpan di `ref`, sehingga effect hanya bergantung pada `open`.
2. Pengembalian fokus hanya terjadi saat cleanup benar-benar berarti "modal ditutup/unmount",
   plus dicek `document.contains(trigger)` supaya tidak menargetkan elemen yang sudah hilang.
3. Effect fokus-otomatis tidak merebut fokus kalau user sudah memilih field di dalam modal.

**Hasil sesudah perbaikan** (dijalankan pada build produksi, emulasi iPhone 13) — **20/20 lulus**,
termasuk dua pemeriksaan perilaku yang harus tetap benar:

```
[PASS] login: email / password
[PASS] key list: search (debounce + refetch)          [PASS] modal edit key: tambah hari, catatan
[PASS] generate: note, max device / quantity          [PASS] modal tool: nama, slug, payload rahasia
[PASS] modal preset: nama durasi, jumlah hari         [PASS] modal reseller: username, email, password
[PASS] modal topup: jumlah credit                     [PASS] modal reset password
[PASS] dialog hapus reseller: konfirmasi username     [PASS] credit log: filter tanggal
[PASS] fokus kembali ke tombol pemicu setelah modal ditutup
```

## 8. Sidebar bisa disembunyikan (klik logo X 3D)

Perintah: `npm run test:sidebar` (`dev/sidebar-test.mjs`, Playwright, server demo di port 3010).
Diuji di dua viewport: **desktop 1280×800** dan **mobile iPhone 13 (390×844)** — 22 pemeriksaan
per viewport, **44/44 lolos**:

```
── Desktop 1280×800 ─────────────────────────────────
  [PASS] sidebar tampil di posisi awal — x=0
  [PASS] konten punya ruang 224px saat sidebar tampil — padding-left=224px
  [PASS] tombol X topbar tidak muncul saat sidebar tampil
  [PASS] tombol X di header sidebar tersedia
  [PASS] isi form tidak hilang setelah sidebar disembunyikan (tidak remount) — nilai="XLVP-AB"
  [PASS] panel keluar layar sepenuhnya — x=-224, width=224
  [PASS] ruang konten jadi 0 — padding-left=0px
  [PASS] panel ditandai aria-hidden untuk screen reader
  [PASS] tombol X muncul di topbar — aria-label=Tampilkan sidebar
  [PASS] fokus berpindah ke tombol X di topbar — fokus="Tampilkan sidebar"
  [PASS] cookie preferensi tersimpan
  [PASS] panel tersembunyi tidak menutupi/klik-able di tepi kiri — elemen di (20,320): main
  [PASS] refresh: HTML pertama sudah tersembunyi (tanpa kedipan) — x=-224 saat domcontentloaded
  [PASS] markup server memuat kelas tersembunyi (-translate-x-full) & padding konten nol
  [PASS] klik X di topbar: sidebar kembali — x=0  ·  cookie jadi 'open'  ·  aria-hidden dilepas
  [PASS] tombol bisa dipakai dengan keyboard (Enter)

── Mobile (iPhone 13) ───────────────────────────────
  (22 pemeriksaan sama; lebar rail 56px ⇒ x=-56 saat disembunyikan, padding-left 0px)
```

Dua bug ditemukan lewat uji ini dan sudah diperbaiki:

1. Tombol X di sidebar memanggil handler "tampilkan" (bukan "sembunyikan"), jadi cookie tertulis
   `hidden` sementara panel tetap terbuka. Sekarang `Sidebar` menerima prop `onHide`.
2. Di layar kecil, ruang konten sempat hilang saat sidebar tampil (`pl-0 lg:pl-56`) sehingga rail
   menimpa konten. Sekarang `pl-14 lg:pl-56` saat tampil dan `pl-0` saat disembunyikan.

Uji regresi keyboard (§7) dijalankan ulang setelah perubahan ini: **20/20 lolos** (tidak ada
regresi fokus), dan `POST /api/validate` dengan body tidak valid tetap menjawab
`400 {"valid":false,"reason":"invalid_request"}`.

## 9. Mode SQLite — uji end-to-end panel penuh

```bash
npm run verify:sqlite
```

Menjalankan server sendiri (`next dev` port 3022) dengan database sementara, lalu menguji seluruh
alur panel lewat HTTP seperti yang dilakukan browser — **tanpa Supabase sama sekali**.

Hasil (**80/80 lulus** — 53 lama + 27 baru untuk audit log & auto-ban):

```
[2/6] Mode database & login
  [PASS] session endpoint melaporkan mode sqlite
  [PASS] belum login → session null
  [PASS] password salah ditolak (401)
  [PASS] login owner berhasil
  [PASS] cookie sesi SQLite berlaku (profil terbaca)
  [PASS] tanpa cookie → middleware melempar /dashboard ke /login

[3/6] Data contoh & CRUD
  [PASS] 12 key data contoh terbaca dari SQLite
  [PASS] relasi tool & reseller ikut terisi (embedded)
  [PASS] GET /api/tools memuat tool + version + statistik key
  [PASS] GET /api/durations memuat preset dari SQLite
  [PASS] GET /api/resellers memuat reseller + jumlah key (RPC reseller_summary)
  [PASS] tambah preset durasi (INSERT)
  [PASS] hapus preset tanpa sesi ditolak (401)

[4/6] Generate key, credit, ban/unban, HWID
  [PASS] owner generate 2 key (durasi custom)
  [PASS] key tersimpan permanen di SQLite
  [PASS] key baru bisa divalidasi lewat /api/validate (register_device di SQLite)
  [PASS] HWID yang dipakai tercatat di device_logs
  [PASS] akses tanpa sesi ditolak (401)
  [PASS] reset HWID lewat API mengosongkan slot device
  [PASS] reset HWID tercatat di audit_logs (aktor + HWID yang direset)
  [PASS] ban key lewat API
  [PASS] status banned tersimpan di SQLite
  [PASS] ban menyimpan metadata: alasan default manual + pelaku + waktu
  [PASS] ban tercatat di audit_logs (aktor owner, alasan manual, pemilik key)
  [PASS] key banned ditolak validasi (key_banned)
  [PASS] unban mengembalikan status active
  [PASS] unban mengosongkan metadata ban (jejak tetap ada di audit_logs)
  [PASS] unban tercatat di audit_logs (alasan ban sebelumnya ikut)
  [PASS] owner perpanjang key (mode extend) gratis — cost=0

[5/6] Reseller: credit, preset, nonaktif
  [PASS] login reseller (password scrypt) berhasil
  [PASS] reseller hanya melihat key miliknya (scoping di API, bukan RLS)
  [PASS] reseller ditolak saat pakai durasi custom (400)
  [PASS] reseller generate pakai preset berhasil
  [PASS] biaya generate = harga preset x quantity x max device — credit 145 → 130 (1 key x 1 device)
  [PASS] max device ikut dikenakan credit seperti quantity — 2 key x 3 device = 90 credit
  [PASS] generate di atas saldo ditolak 402 tanpa mengubah credit
  [PASS] credit log mencatat pemotongan 90 credit (2 key x 3 device)
  [PASS] reseller ditolak saat perpanjang manual (403)
  [PASS] tambah max device tanpa preset ditolak (400)
  [PASS] reseller perpanjang pakai preset + tambah device: biaya = preset x max device — 40 → 10 (30 credit)
  [PASS] perpanjang menambah durasi & menyimpan max device baru — duration 30 → 60 hari
  [PASS] credit log mencatat aksi perpanjang (action extend)
  [PASS] perpanjang di atas saldo ditolak 402 dan key tidak berubah
  [PASS] export CSV credit log jalan dari API
  [PASS] topup owner menambah credit (add_credit)
  [PASS] akun nonaktif tidak bisa login (Akun kamu dinonaktifkan)

[5b/6] Pengembalian credit saat key dihapus
  [PASS] API key list mengirim credit_cost (dipakai dialog hapus)
  [PASS] Owner hapus key aktif milik reseller → credit dikembalikan — amount 45, saldo andi 10 → 55
  [PASS] credit reseller bertambah tepat sejumlah credit_cost key
  [PASS] key benar-benar terhapus dari SQLite
  [PASS] credit log mencatat aksi pengembalian (action refund)
  [PASS] key expired dihapus Owner → TIDAK ada pengembalian
  [PASS] key banned dihapus Owner → TIDAK ada pengembalian
  [PASS] reseller hapus key sendiri → TIDAK ada pengembalian
  [PASS] Owner hapus key buatan Owner sendiri → TIDAK ada pengembalian

[5c/6] Audit log: alasan ban, auto-ban, unban auto-ban khusus Owner
  [PASS] generate key baru untuk uji audit log
  [PASS] reseller ditolak membuka audit log (403)
  [PASS] audit log memuat jejak ban/unban/reset HWID/hapus key
  [PASS] audit log: ban oleh owner tercatat dengan alasan terstruktur
  [PASS] audit log: hapus key tercatat lengkap (refund 45) & jejaknya tetap ada setelah key hilang
  [PASS] filter aksi (key_ban) hanya mengembalikan aksi itu
  [PASS] cari audit log berdasarkan key_value
  [PASS] export CSV audit log jalan dari API
  [PASS] ban dengan alasan refund + catatan tersimpan terstruktur
  [PASS] audit log mencatat alasan refund + catatan
  [PASS] alasan auto_hwid ditolak untuk ban manual (400)
  [PASS] auto-ban: status banned + alasan auto_hwid (banned_by NULL = oleh sistem)
  [PASS] auto-ban tercatat di audit_logs sebagai aksi sistem (IP pemicu ikut)
  [PASS] reseller TIDAK bisa unban key auto-ban (403)
  [PASS] key tetap banned setelah upaya unban reseller
  [PASS] Owner bisa unban key auto-ban
  [PASS] unban auto-ban oleh Owner tercatat (alasan ban sebelumnya: auto_hwid)
  [PASS] reseller bisa ban manual key miliknya (alasan + catatan + pelaku tercatat)
  [PASS] reseller bisa unban ban manual miliknya sendiri (hanya auto-ban yang dikunci Owner)
  [PASS] validasi ulang menyiapkan 1 device untuk uji reset semua
  [PASS] reset semua HWID mengembalikan jumlah device yang dihapus
  [PASS] reset semua HWID tercatat di audit_logs (jumlah device dihapus)

[6/6] Logout & persistensi
  [PASS] logout menghapus sesi di SQLite
  [PASS] setelah logout, API panel menolak (401)
  [PASS] semua tulisan benar-benar tersimpan di file SQLite
```

### 9.1 Aturan biaya credit (1 unit = 1 key × 1 device)

Diuji lewat API di mode SQLite, dengan angka yang pasti (saldo Andi dari data contoh = 145):

| Skenario | Hasil |
|---|---|
| Reseller generate 1 key × 1 device, preset "1 Bulan" (15) | terpotong 15 → saldo 130 |
| Reseller generate 2 key × 3 device | terpotong 90 (2 × 3 × 15) → saldo 40 |
| Reseller generate 5 key × 3 device (butuh 225) | `402 insufficient_credit`, saldo tetap 40, tidak ada key dibuat |
| Reseller perpanjang manual (`mode: extend`) | `403` "Reseller hanya bisa memperpanjang pakai preset durasi dari Owner" |
| Reseller naikkan max device tanpa preset (`mode: none`) | `400` — device baru wajib lewat preset |
| Reseller perpanjang 1 key (2 device) dengan preset "1 Bulan" | terpotong 30 → saldo 10, durasi 30 → 60 hari, `max_device` 1 → 2 |
| Reseller perpanjang dengan preset "3 Bulan" × 2 device (butuh 80) | `402`, key tidak berubah (`max_device` tetap 2), saldo tetap 10 |
| Owner perpanjang manual (`mode: extend`) | `200`, `credit.cost = 0` (Owner tidak dipotong) |

UI-nya juga diuji di browser sungguhan (Playwright, port 3010) sebagai **reseller**:
modal Edit Key hanya menampilkan dropdown preset (tanpa opsi "Tambah hari"/"Set tanggal"/"Lifetime"),
ringkasan biaya ikut berubah saat max device dinaikkan (`2 device × 15 credit = 30 credit`), dialog
konfirmasi menampilkan biaya, toast hasil `"Key diperbarui · 30 credit terpakai (sisa 115)"`, dan baris
Key List berubah dari `0/1 · 30 hari` jadi `0/2 · 60 hari`. Di Credit Log muncul aksi **Perpanjang**.

### 9.2 Pengembalian credit saat key dihapus

Aturan lengkapnya ada di `lib/utils/refund.ts` (dipakai server **dan** modal konfirmasi di browser,
jadi teks dialog selalu sama dengan yang benar-benar dieksekusi). Diuji lewat API:

| Skenario | Hasil |
|---|---|
| Owner hapus key **andi** (aktif, belum expired, `credit_cost` 45 hasil generate 2 key × 3 device + perpanjang) | `refund.amount = 45`, saldo andi 10 → 55, log `refund +45` |
| Owner hapus key **budi** yang `expired` (`credit_cost` 5) | `refund = null`, saldo budi tetap 90 |
| Owner hapus key **andi** yang `banned` (`credit_cost` 45) | `refund = null`, saldo andi tetap 55 |
| Reseller hapus key miliknya sendiri (aktif, `credit_cost` 45) | `refund = null` — reseller tidak bisa "mencairkan" credit sendiri |
| Owner hapus key buatannya sendiri | `refund = null` |

Di browser (Playwright, port 3010) dialog hapus untuk key reseller aktif menampilkan
"Key ini masih aktif dan belum expired, jadi 15 credit yang dipakai untuk key ini dikembalikan ke andi",
lalu toast hasilnya menyebut jumlah credit + sisa saldo, dan Credit Log menampilkan baris
`Pengembalian +15`. Untuk key yang `expired`, dialognya berbunyi "Tidak ada pengembalian credit karena
key-nya sudah expired" — jadi Owner tahu konsekuensinya sebelum menekan Hapus.

### 9.3 Migrasi skema SQLite untuk database lama

Aksi credit `extend`/`refund` menambah nilai baru di `CHECK (action IN (…))` dan fitur pengembalian
menambah kolom `keys.credit_cost`. SQLite tidak bisa mengubah CHECK maupun menambah kolom dalam satu
`CREATE TABLE IF NOT EXISTS`, jadi `migrateSqliteSchema()` di `lib/db/sqlite/schema.ts` menangani
duanya sekaligus (idempotent): `ALTER TABLE keys ADD COLUMN credit_cost` + isi perkiraan, lalu bangun
ulang tabel `credit_logs` (rename → create → copy → drop) di dalam transaksi dan buat ulang indexnya.

Diuji dengan **database nyata dari versi sebelumnya** (12 key, 15 baris credit log, skema tanpa
`credit_cost`, CHECK masih `extend` saja):

```
[sqlite] skema diperbarui: keys.credit_cost ditambahkan + diisi perkiraan dari preset
[sqlite] skema diperbarui: CHECK credit_logs dibangun ulang (aksi extend & refund)
```

Estimasi untuk data lama diuji terpisah pada database sintetis (semua benar):

| Durasi key lama | Preset yang dipakai | `credit_cost` (max device 1) |
|---|---|---|
| 7 hari | sama persis (1 Minggu = 5) | 5 |
| 15 hari (custom) | terdekat di atasnya (1 Bulan = 15) | 15 |
| 30 hari, max device 2 | sama persis (1 Bulan = 15) × 2 | 30 |
| 400 hari | terpanjang (1 Tahun = 120) | 120 |
| Lifetime (NULL) | — | 0 |

Setelah migrasi, perpanjang reseller lewat API tetap berhasil (`cost=30`, saldo 160 → 130), baris lama
utuh, dan index `idx_credit_logs_user_id` + `idx_credit_logs_created_at` kembali ada. Key yang dibuat
setelah migrasi selalu menyimpan angka persisnya, jadi estimasi ini hanya menyentuh data lama.

Di sisi Supabase hal yang sama dilakukan blok `DO $$ … $$` di `migration.sql` (drop + add constraint
`credit_logs_action_check`, plus `ALTER TABLE keys ADD COLUMN credit_cost`) — idempotent.

Fitur audit log (2026-10-08) menambah hal yang sama untuk kolom metadata ban: `migrateSqliteSchema()`
menambah `keys.ban_reason / ban_note / banned_by / banned_at` (idempotent, hanya kalau belum ada),
sedangkan tabel `audit_logs` dibuat oleh `SQLITE_SCHEMA_SQL` (`CREATE TABLE IF NOT EXISTS`).
Diuji dengan database sintetis versi lama (tanpa kolom ban, tanpa `audit_logs`): migrasi menambah
kolom, data lama utuh, insert audit_logs jalan, dan `ON DELETE SET NULL` terbukti — setelah key
 dihapus, `key_id` di audit menjadi NULL sementara `key_value` tetap tersimpan (jejak tidak hilang).
Di Supabase, blok `DO $$` yang sama ada di `migration.sql` (idempotent).

### 9.4 Dua bug yang ketemu lewat uji ini (dan sudah diperbaiki)

1. **INSERT banyak baris** di adapter SQLite menyiapkan satu statement dengan beberapa tuple nilai,
   padahal `better-sqlite3` meminta semua parameter dalam satu panggilan → generate key gagal.
   Sekarang satu statement dijalankan per baris di dalam satu transaksi.
2. **Rate limit tidak pernah kena** karena filter `neq("reason", "rate_limited")` membuang baris dengan
   `reason` NULL (perilaku Postgres/SQLite), padahal maksudnya semua percobaan dihitung. Filter
   diganti bentuk null-safe `.or("reason.is.null,reason.neq.rate_limited")` (didukung adapter SQLite
   maupun PostgREST).

Selain itu matcher middleware dipersempit ke halaman saja (`api/` dikecualikan), supaya permintaan API
yang belum login menjawab `401 {ok:false}` — bukan redirect 307 ke halaman login.

### 9.5 Pemilihan mode database (`lib/env.ts`)

Diuji dengan `next dev` di folder terpisah (port 3033), membaca `mode` dari `GET /api/auth/session`:

| Env | Hasil | Keterangan |
|---|---|---|
| tanpa env Supabase, tanpa `XLOOP_DB` | `mode: "sqlite"` | database dibuat otomatis di `XLOOP_SQLITE_PATH`; login `owner@gmail.com` berhasil → `/dashboard` 200 |
| env Supabase terisi (`URL` + anon + service role, nilai dummy) | `mode: "supabase"` | panel mengambil jalur Supabase, SQLite tidak disentuh |
| `NEXT_PUBLIC_MOCK_MODE=1` | `mode: "sqlite"` | nama lama, tetap didukung |
| `XLOOP_DB=supabase` | `mode: "supabase"` | memaksa walau env Supabase belum diisi |

Alur pengguna di mode SQLite juga diuji di browser sungguhan (Playwright, port 3010):
`POST /api/auth/login` → cookie `xloop_session` → `/dashboard`, `/keys`, `/tools`, `/durations` = 200
tanpa sesi ketiganya 307 ke `/login`.

### 9.6 Audit log & alasan ban terstruktur (2026-10-08)

Fitur baru: tabel `audit_logs` (jejak ban/unban/hapus key/reset HWID/auto-ban), kolom metadata ban
 di `keys` (`ban_reason`, `ban_note`, `banned_by`, `banned_at`), halaman **Audit Log** (Owner only)
+ `GET /api/audit` (filter tanggal/aksi/aktor/key + export CSV), dialog ban dengan pilihan alasan
terstruktur (manual/refund/other + catatan), badge alasan ban di Key List, dan **unban auto-ban
hanya untuk Owner**.

Diverifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run verify:sqlite` (80/80, lihat blok `[5c/6]` di atas) | ✅ termasuk auto-ban via `/api/validate` sungguhan, reseller unban auto-ban ditolak 403, Owner unban 200 |
| `npm run verify:validate` (28/28) | ✅ tidak ada regresi endpoint validasi |
| `npx tsc --noEmit` / `npx next lint` / `npx next build` | ✅ 0 error, route `/audit` + `/api/audit` terdaftar |
| `migration.sql` di-parse `pglast` (libpg_query) | ✅ PARSE OK — 120 statements |
| Migrasi SQLite dari skema lama (tanpa kolom ban & `audit_logs`) | ✅ kolom ditambah, data utuh, `ON DELETE SET NULL` jalan |
| UI smoke (curl, mode SQLite): `/audit` owner 200 + sidebar memuat "Audit Log"; reseller 307 → `/dashboard`, `/api/audit` 403, sidebar tanpa "Audit Log" | ✅ |
| Alur API: ban `{reason:"refund",note}` → `ban_reason/ban_note/banned_by/banned_at` tersimpan + audit row; unban → metadata ban NULL + audit row; CSV export | ✅ |

Satu bug ketemu & diperbaiki selama pengerjaan: ban dengan body kosong (`{}`) sempat ditolak `400`
karena `asOptionalString(undefined)` mengembalikan `undefined` yang disalahartikan sebagai note
tidak valid — sekarang note hanya divalidasi kalau memang dikirim (pola sama dengan route edit key).

### 9.7 Validation Attempts (2026-10-08)

Fitur baru: halaman **Validation Attempts** (Owner only) + `GET /api/validation-attempts` untuk
membaca tabel `validation_attempts` yang sudah dikumpulkan `/api/validate` (sebelumnya tidak bisa
dilihat di panel). Satu response memuat: ringkasan (total/sukses/gagal/success rate/IP & key unik),
**tren per jam** (grafik stacked bar WIB; rentang > 48 jam otomatis menjadi per hari), **IP
mencurigakan** (top 10 gagal terbanyak, lengkap invalid_key/key dicoba/terakhir terlihat, badge
`mencurigakan` kalau ≥ 10 gagal atau ≥ 5 `invalid_key` — ambang bruteforce `RATE_LIMIT`), **key
yang paling sering gagal** (top 10 dengan breakdown alasan & jumlah IP), serta daftar percobaan
(filter tanggal/hasil/alasan/IP/key + pagination + export CSV). Rentang diapit ke retention
(7 hari, sama dengan cron cleanup). Agregasi dihitung dari baris terfilter di JS (pola sama
seperti `keyChart` di `lib/api/stats.ts`) supaya jalan identik di Supabase maupun SQLite.

Diverifikasi:

| Pemeriksaan | Hasil |
|---|---|
| `npm run verify:sqlite` (90/90, blok `[5d/6]` baru: 403 reseller, ringkasan/tren/IP mencurigakan/key gagal konsisten dengan tabel, filter, CSV, halaman Owner 200 + reseller 307 → `/dashboard` + anon 307 → `/login`) | ✅ |
| `npm run verify:validate` (28/28) | ✅ tidak ada regresi endpoint validasi |
| `npx tsc --noEmit` / `npx next lint` / `npx next build` | ✅ 0 error, route `/validation-attempts` + `/api/validation-attempts` terdaftar |
| UI smoke (curl, mode SQLite): `/validation-attempts` owner 200 + sidebar memuat "Validation Attempts"; reseller 307 → `/dashboard`, `/api/validation-attempts` 403, sidebar tanpa menu tsb; data uji (invalid_key dari beberapa IP, wrong_tool, wrong_version, sukses) → ringkasan 22/2/20, IP 203.0.113.7 `suspect`, tren 16 bucket jam, CSV berlabel Indonesia | ✅ |

### 9.8 Audit menyeluruh codebase (2026-10-08)

Seluruh struktur, fitur, API route, komponen UI, dan helper dibaca end-to-end; setiap temuan
(dari yang kecil sampai yang berpotensi jadi insiden) diperbaiki. Verifikasi: `tsc` 0 error,
`next lint` clean, `next build` sukses, `verify:sqlite` 90/90, `verify:validate` 28/28, plus probe
runtime (curl) untuk setiap perbaikan.

**Keamanan & integritas data:**

| # | Temuan | Perbaikan |
|---|---|---|
| 1 | Auto-ban di `/api/validate` **menimpa `note` milik key** dengan teks auto-ban (kehilangan data; ban manual tidak melakukan ini) | `note` tidak lagi disentuh; alasan tetap tercatat di `ban_note` + audit log |
| 2 | **CSV injection**: export Credit Log / Audit Log / Validation Attempts bisa memuat formula (`=HYPERLINK(...)`, `=cmd\|...`) di note, email, HWID, IP — dieksekusi saat file dibuka di Excel | `csvEscape` men-prefix `'` pada sel string yang diawali `= + - @ tab CR`; angka tetap numerik |
| 3 | **Brute-force login tanpa batas** di mode SQLite (tidak ada rate limit sama sekali; 12 percobaan gagal beruntun semuanya diproses) | Rate limit per IP: 10 gagal / 10 menit → 429 (`lib/api/login-guard.ts`); login sukses mereset; Supabase Auth tetap pengaman utama di mode Supabase |
| 4 | **Open redirect** via `/login?next=//evil.com` (lolos cek `startsWith("/")` karena protocol-relative) | `LoginForm` juga menolak path yang diawali `//` |
| 5 | Perbandingan `CRON_SECRET` di `/api/cron/cleanup` tidak konstan-waktu | `crypto.timingSafeEqual` (cek panjang dulu) |
| 6 | Pencarian `key` (Audit Log) dan `ip`/`key` (Validation Attempts) meneruskan wildcard LIKE (`%`, `_`) dari input — tidak konsisten dengan pencarian Key List | Wildcard dibuang (sama seperti `sanitizeSearch` di `listKeys`) |
| 7 | `POST /api/resellers`: kalau `addCredit` gagal setelah akun dibuat, reseller tertinggal tanpa saldo (owner lihat 500 tapi akun sudah ada); error insert `credit_logs` diabaikan diam-diam | Rollback: hapus profil + akun auth; error log insert di-`console.warn` seperti route lain |

**Validasi input & robustness API:**

| # | Temuan | Perbaikan |
|---|---|---|
| 8 | `asDateOnlyToIso`/`asIsoDate` menerima tanggal tidak nyata — `Date.UTC` menggulung `2026-02-30` menjadi 2 Maret, dan tahun 0–99 menjadi 19xx (terbukti via `PUT /api/keys/[id]` mode=set) | Roundtrip check `getUTCFullYear/Month/Date` (juga menolak 2026-02-29, menerima 2028-02-29) |
| 9 | `parseJakartaDayStart` (`/api/validation-attempts`) menerima `2026-02-30` (bulan 13 kebetulan tertolak belakangan oleh cek rentang) | Tanggal dicek kalender-nya dulu sebelum dipakai |
| 10 | Mode `set` pada `PUT /api/keys/[id]`: input date-only (`YYYY-MM-DD`) diparsing sebagai **00:00 UTC (07:00 WIB)**, bukan "akhir hari WIB" seperti yang dijanjikan hint UI — `asDateOnlyToIso` jadi kode mati | Date-only → `asDateOnlyToIso` (akhir hari WIB, 23:59:59.999); format lain tetap dipakai apa adanya |
| 11 | `page=99999999999999999999` (1e20) → **HTTP 500** ("datatype mismatch": offset melewati batas integer SQLite) di `/api/keys`, `/api/credits`, `/api/audit`, `/api/validation-attempts` | Page di-clamp ke maksimal 1.000.000 di semua route + `listKeys` |

**UI/UX:**

| # | Temuan | Perbaikan |
|---|---|---|
| 12 | Filter reseller **"Milik saya (Owner)"** di Key List mengosongkan filter (menampilkan SEMUA key, bukan key milik sendiri) | `createdBy` diisi value yang dipilih, bukan `""` |
| 13 | Aktivitas "Perpanjang" (extend) & "Pengembalian" (refund) **salah label menjadi "Generate key"** (dengan tanda +/− terbalik) di dashboard "Aktivitas Terakhir" & halaman Reseller | `ActivityItem.action` diubah ke `CreditAction`; label memakai `CREDIT_ACTION_LABEL`; tanda/warna mengikuti arah saldo |
| 14 | Id toast memakai `Date.now() + Math.random()` — bisa tabrakan (dua toast sama ms) | Counter monoton module-level |
| 15 | Komentar di `DELETE /api/resellers/[id]` menyebut "null-kan dulu" padahal kode tidak melakukan itu; seed key contoh yang banned menyimpan teks auto-ban di kolom `note` (kebalikan dari perilaku baru) | Komentar diperbaiki; seed key banned memakai `ban_reason`/`ban_note`/`banned_at` (banned_by NULL untuk auto-ban) |

Diverifikasi per perbaikan (cuplikan): auto-ban preserving note (note `"CATATAN PENTING…"` tetap utuh
setelah auto-ban, `ban_reason=auto_hwid`, audit `key_auto_ban` tercatat sistem); CSV credit log berisi
`'=HYPERLINK(...)` (literal, tidak dieksekusi Excel); `set 2026-02-30`/`0099-01-01`/`2026-13-01` → 400,
date-only → `…T16:59:59.999Z`; `from=2026-02-30` → 400; 12 login gagal beruntun → 10×401 lalu 429
"Terlalu banyak percobaan login. Coba lagi dalam 10 menit." (IP lain tetap bisa login); `page=1e20` → 200
di semua endpoint; SSR `RecentActivity` menampilkan label Perpanjang/Pengembalian tanpa "Generate key";
unit test `csvEscape`/`asIsoDate`/`asDateOnlyToIso`/`login-guard` 31/31 (1 ekspektasi test awal yang
keliru, perilaku fungsi sudah benar).

### 9.9 Tema & audit UI/UX (2026-10-10)

Pengaturan tema kini menyediakan 7 palet dasar, 8 aksen preset + hex custom, 6 override warna permukaan,
dan 3 bentuk sudut. Cookie `xloop_theme` versi `v2` menyimpan semua pilihan; parser format lama
`<palet>.<hex>` tetap didukung. Token warna/radius diterapkan pada HTML awal dari server dan saat pratinjau
client. Warna foreground tombol utama memilih hitam/putih dengan rasio terbaik, dan peringatan kontras
memeriksa teks utama/sekunder, status, serta teks aksen terhadap permukaan efektif.

Audit UI/UX mencakup:

- Tombol pilihan palet, aksen, radius, dan kepadatan tabel memakai `aria-pressed` dalam grup bernama.
- Tombol muat ulang kini memiliki teks dan label aksesibel; tombol prev/next pagination memiliki nama
  yang jelas untuk screen reader dan tooltip.
- Modal membatasi Tab/Shift+Tab, tetap menangani Escape, dan mengembalikan fokus ke pemicu; command
  palette mempertahankan fokus saat Tab, mengembalikannya ketika ditutup, dan mengumumkan hasil melalui
  combobox/listbox dengan `aria-activedescendant`.
- Radius kontrol/kartu ikut diterapkan pada state fokus, skeleton, tombol tutup toast, dan tooltip grafik;
  perubahan ukuran dan jarak komponen tidak dilakukan.
- Draft warna permukaan dipertahankan saat palet diganti; reset warna permukaan maupun reset semua tema
  menyinkronkan kembali input, sehingga nilai draft lama tidak dapat terpasang tanpa sengaja.

Pemeriksaan yang dijalankan:

| Pemeriksaan | Hasil |
|---|---|
| `npm run typecheck` | lulus |
| `npm run lint` | lulus, tanpa warning |
| `npm run build` | lulus |
| `npm run verify:sqlite` | 90/90 |
| `npm run verify:validate` | 28/28 |
| Helper tema (runner Node sementara) | 7 × 8 kombinasi palet/aksen tanpa isu; kontras custom rendah terdeteksi; rasio WCAG, cookie legacy/v2, round-trip, token CSS, meta-color, dan parsing aman lulus |
| Preview HTTP (`/settings`) | SSR dengan cookie v2 custom menampilkan palet/warna/radius dan `theme-color` yang benar |
| `git diff --check` | lulus |

Tes visual/keyboard lintas browser tidak dijalankan: workspace tidak menyediakan browser lokal atau
Playwright. Focus trap, layout responsif, dan native color picker perlu konfirmasi manual di browser.

---

## 10. Yang butuh Supabase asli untuk diverifikasi

Berjalan penuh hanya setelah `migration.sql` dijalankan di project Supabase kamu:

1. Login/logout Supabase Auth dan proteksi route oleh `middleware.ts`
   (redirect `/login`, akun `is_active = false` ditolak).
2. RLS: reseller hanya bisa membaca key, device log, dan credit log miliknya sendiri.
3. Operasi tulis panel lewat API route dengan service role (generate key, potong credit,
   perpanjang key, pengembalian credit, topup, CRUD tool/duration/reseller, reset HWID). Constraint
   `credit_logs_action_check` harus sudah memuat `'extend'` & `'refund'`, dan kolom `keys.credit_cost`
   harus ada — `migration.sql` menangani keduanya otomatis (idempotent). Jalankan lagi file itu kalau
   database Supabase-mu dibuat sebelum fitur perpanjang / pengembalian credit ada.
4. Fungsi SQL: `register_device` (locking `FOR UPDATE`), `spend_credit`, `add_credit`,
   `update_expired_keys`, `key_counts_by_version`, `reseller_summary`.
5. Cron `/api/cron/cleanup` (butuh `CRON_SECRET` + jadwal Vercel).
6. Seed akun Owner `owner@gmail.com` / `Axell123` — lalu ganti password.

Setelah deploy, uji cepat dengan perintah di README bagian 8 (cron) dan
`docs/CLIENT_INTEGRATION.md` bagian 5 (validasi key dari sisi tool).
