# XLOOP PANEL

Key management panel full stack untuk lisensi tool: kelola tool type & version, preset durasi,
generate key, reseller, credit, sampai endpoint validasi publik yang **anti-bypass**
(response sukses ditandatangani Ed25519 dan terikat ke `nonce` + `hardware_id`).

- **Frontend + backend**: Next.js 14 (App Router) + API Routes
- **Database + Auth**: Supabase (PostgreSQL + Supabase Auth)
- **Styling**: Tailwind CSS (dark only, token warna di `app/globals.css`)
- **Deploy**: Vercel (+ Vercel Cron untuk cleanup harian)

---

## Daftar isi

1. [Fitur](#1-fitur)
2. [Tech stack & versi](#2-tech-stack--versi)
3. [Struktur folder](#3-struktur-folder)
4. [Setup Supabase](#4-setup-supabase)
5. [Environment variables](#5-environment-variables)
6. [Generate keypair Ed25519](#6-generate-keypair-ed25519)
7. [Menjalankan di local development](#7-menjalankan-di-local-development)
8. [Deploy ke Vercel](#8-deploy-ke-vercel)
9. [Akun Owner pertama](#9-akun-owner-pertama)
10. [Referensi API](#10-referensi-api)
11. [Endpoint validasi (anti-bypass)](#11-endpoint-validasi-anti-bypass)
12. [Aturan akses & keamanan](#12-aturan-akses--keamanan)
13. [Mode SQLite (lokal & pratinjau tanpa Supabase)](#13-mode-sqlite-lokal--pratinjau-tanpa-supabase)
14. [Script bantuan](#14-script-bantuan)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Fitur

**Role: Owner**

| Menu | Isi |
|---|---|
| Dashboard | Total key (all/active/expired/banned), reseller aktif, key dibuat hari ini & minggu ini, grafik 7 hari, top 5 reseller, 10 aktivitas terakhir |
| Tool Management | CRUD tool type + version, toggle aktif, payload rahasia per tool (`tool_secrets`), kotak public key verifikasi |
| Duration Setting | CRUD preset durasi (nama, hari, harga credit, harga aktif/nonaktif) |
| Key List | Semua key, filter (status/tool/version/reseller), sort, pagination, detail + manajemen HWID, edit (perpanjang pakai preset / tambah hari / set tanggal / lifetime, bebas biaya), ban dengan **alasan terstruktur** (manual/refund/other + catatan), unban, hapus (key reseller aktif & belum expired → credit dikembalikan otomatis) |
| Generate Key | Preset **atau** durasi custom (tanpa potongan credit), generate 1–100 key sekaligus, copy semua, export `.txt` |
| Reseller | Tambah reseller (set password langsung), topup credit, aktif/nonaktif, reset password, edit data, hapus permanen. Klik username/Detail → **halaman detail** `/resellers/[id]`: statistik, grafik 7 hari, key terbaru, riwayat credit lengkap, riwayat login |
| Credit Log | Semua transaksi credit, filter tanggal/aksi/reseller, export CSV |
| Audit Log | **Satu timeline terpadu**: jejak aksi pada key (siapa yang ban/unban/hapus key/reset HWID — Owner, Reseller, atau sistem auto-ban, lengkap alasan ban terstruktur & catatan) **digabung** dengan aktivitas akun & sistem (ganti password, putus sesi, API key dibuat/dicabut, pengaturan diubah, credit, Telegram dihubungkan/ditautkan/dilepas). Filter tanggal/aksi (dikelompokkan: aksi key & aktivitas)/aktor/key, export CSV. **Unban auto-ban hanya bisa oleh Owner** |
| Validation Attempts | Semua percobaan validasi key yang tercatat `/api/validate`: ringkasan sukses/gagal, **IP mencurigakan**, **key paling sering gagal** (breakdown alasan), **tren per jam** (grafik), daftar percobaan (filter tanggal/hasil/alasan/IP/key, pagination, export CSV). Data disimpan 7 hari. **Hanya Owner** |
| Pengaturan | Menu paling bawah sidebar. **Info Akun**, **Info Web** (versi panel, mode database, status signing key, TTL token, runtime, zona waktu, format key, batasan), **Keamanan Akun** (ganti password sendiri + daftar **sesi aktif** dengan perangkat/IP dan tombol “putus semua sesi lain”), **Riwayat Login** (20 percobaan terakhir), **Kepadatan Tabel**, **Tema Warna**, serta **Integrasi**: **Telegram** (hubungkan bot Owner, pasang webhook, uji kirim, tautkan chat) dan **API Key** (token `xlp_…` untuk `/api/v1`, tampil sekali + tombol cabut) |
| Batas & Sistem | Kartu di Pengaturan (Owner): semua ambang runtime — rate limit `/api/validate` per IP/key, brute-force & auto-ban, TTL token lisensi, kuota reset HWID, batas max device & quantity, masa retensi log, ambang analitik anti-abuse, saklar + rate limit API publik, dan notifikasi (nyala/mati, jenis event, ambang saldo tipis, anti-spam). Nilai di luar rentang dijepit otomatis |
| Penyesuaian credit | Di halaman detail reseller: tambah **atau** kurangi saldo dengan **alasan wajib** (tercatat sebagai `adjustment` di credit log + activity log), berguna untuk kompensasi/koreksi salah topup |
| API publik `/api/v1` | API key reseller (hash SHA-256, prefix, `last_used_at`, hitungan request, cabut kapan saja) untuk generate key, cek saldo, lihat/kelola key, dan reset HWID dari bot/skrip. Dokumentasi: [`docs/RESELLER_API.md`](docs/RESELLER_API.md) |
| Notifikasi Telegram | Owner dihubungi otomatis saat: key **auto-ban**, login reseller gagal berulang, brute-force validasi per IP, saldo reseller melewati ambang tipis, plus **ringkasan harian** (cron `/api/cron/digest`). Reseller yang menautkan chat juga menerima notifikasi personal: key-nya **diblokir/di-unban/dihapus** (+refund), **credit masuk/penyesuaian**, dan **pengingat harian key expiring ≤ 3 hari** — semuanya bisa dimatikan lewat saklar *Batas & Sistem → Notifikasi* (`enabled` / `notifyReseller`). Bisa juga diteruskan ke webhook HTTP sendiri (`XLOOP_NOTIFY_WEBHOOK_URL`) |
| Bot Telegram | Reseller (dan Owner) menautkan chat dari Pengaturan, lalu memakai bot lewat **menu tombol** (`/menu`: Saldo, Preset, Key saya, Generate) atau perintah teks: `/saldo`, `/preset`, `/keys` (pagination ‹ ›), `/key`, `/generate` (wizard **pilih tool → version → preset → jumlah → device** dengan konfirmasi biaya), `/reset` HWID (dengan konfirmasi), `/unlink`. Key dibalas dalam blok kode yang bisa di-tap-copy |

**Role: Reseller**

| Menu | Isi |
|---|---|
| Dashboard | Statistik key miliknya sendiri (all/active/expired/banned), sisa credit, key hari ini, grafik 7 hari, aktivitas sendiri |
| Key List | Hanya key miliknya, detail + reset HWID, edit — perpanjang **wajib** pakai preset Owner dan memotong credit (`harga preset × max device`; menambah max device ikut dikenakan) — ban dengan alasan terstruktur, hapus. **Unban auto-ban (HWID) tidak bisa** — hanya Owner yang bisa membukanya |
| Generate Key | Preset durasi saja, biaya `harga preset × quantity × max device` dipotong otomatis, 1–50 key sekaligus |
| Credit Log | Riwayat credit miliknya, export CSV |
| Pengaturan | Info akun (termasuk **sisa credit**), **ganti password sendiri** + daftar sesi aktif, riwayat login, info web ringkas, kepadatan tabel, tema warna, dan **Integrasi**: tautkan Telegram + kelola **API key** (`/api/v1`) miliknya |

**Endpoint publik**

- `POST /api/validate` — validasi key dari sisi tool/mod, response sukses **ditandatangani Ed25519**
  + membawa `secret_payload` milik tool. Dokumentasi lengkap: [`docs/CLIENT_INTEGRATION.md`](docs/CLIENT_INTEGRATION.md).
- `GET /api/cron/cleanup` — dipanggil Vercel Cron: hapus `validation_attempts`,
  `api_request_logs`, `notification_logs`, dan kode tautan Telegram sesuai masa retensi di
  Pengaturan + jalankan `update_expired_keys()` + (mode SQLite) bersihkan `auth_sessions`
  yang sudah kedaluwarsa.
- `GET /api/cron/digest` — ringkasan harian (24 jam terakhir) ke Telegram/webhook Owner.
- `POST /api/telegram/webhook` — penerima update bot Telegram (wajib header
  `X-Telegram-Bot-Api-Secret-Token`).
- `GET/POST /api/v1/...` — API publik reseller memakai API key `xlp_…`
  ([`docs/RESELLER_API.md`](docs/RESELLER_API.md)).

**Dua mode database**

| Mode | Kapan aktif | Data disimpan di |
|---|---|---|
| **Supabase** | Semua env Supabase terisi (produksi/Vercel) | Postgres + Supabase Auth |
| **SQLite** | `XLOOP_DB=sqlite`, atau `NEXT_PUBLIC_MOCK_MODE=1`, atau **env Supabase belum diisi** | file lokal `data/xloop.sqlite` |

Mode SQLite bukan mock: login sungguhan (password di-hash), CRUD penuh, credit, HWID, ban/unban,
bahkan `/api/validate` dengan tanda tangan Ed25519 — semua menulis ke database. Detail di bagian 13.

### Aturan biaya credit

**1 unit harga = 1 key × 1 device.** Semua perhitungan biaya mengikuti aturan ini, jadi menambah
`max device` sama seperti menambah `quantity`: dua-duanya menambah unit berbayar.

| Aksi | Biaya (Reseller) | Biaya (Owner) |
|---|---|---|
| Generate key | `harga preset × quantity × max device` | gratis |
| Perpanjang key di Edit Key (pakai preset) | `harga preset × max device` — semua device yang terdaftar ikut diperpanjang | gratis |
| Menambah `max device` di Edit Key | wajib memilih preset (device baru = unit baru), biaya ikut perpanjangan di atas | gratis |
| Mengubah catatan / mengurangi `max device` | gratis | gratis |

**Pengembalian credit saat key dihapus.** Kalau Owner (teledor) menghapus key milik reseller yang
**masih aktif dan belum expired**, seluruh credit yang dipakai untuk key itu dikembalikan ke reseller
tersebut — dicatat di Credit Log sebagai aksi **Pengembalian** (`refund`).

| Situasi saat key dihapus | Pengembalian credit |
|---|---|
| Owner menghapus key **reseller**, status `active`, belum lewat expired | ✅ seluruh `credit_cost` key (generate + perpanjang) |
| Owner menghapus key reseller yang `expired` | ❌ tidak ada |
| Owner menghapus key reseller yang `banned` | ❌ tidak ada |
| Owner menghapus key buatannya sendiri | ❌ tidak ada (Owner tidak pernah dipotong credit) |
| Reseller menghapus key miliknya sendiri | ❌ tidak ada |

Catatan: menghapus **akun** reseller (Owner → Reseller → Hapus) tidak memicu pengembalian — key,
HWID, dan riwayatnya ikut terhapus bersama akunnya. Pengembalian hanya berlaku untuk penghapusan
**key satu per satu** di Key List lewat Owner.

Dialog konfirmasi hapus selalu menjelaskan situasinya: hijau "credit dikembalikan ke <reseller>",
atau abu-abu alasannya ("Tidak ada pengembalian credit karena key-nya sudah expired").
Nilai yang dikembalikan diambil dari kolom `keys.credit_cost` — angka **persis** yang dipakai saat
key dibuat/diperpanjang, bukan hitungan ulang dari harga preset saat ini.

Yang berlaku untuk Reseller:

- **Durasi hanya boleh dari preset** yang dibuat Owner — `mode: extend/set/lifetime` ditolak `403`
  ("Reseller hanya bisa memperpanjang pakai preset durasi dari Owner"). Owner tetap bebas.
- Menambah `max device` tanpa memilih preset ditolak `400` — biar tidak ada device tambahan yang lolos
  tanpa biaya.
- Saldo tidak cukup → `402 insufficient_credit`, dan **tidak ada yang berubah** (key maupun credit).
  Kalau pemotongan gagal di tengah jalan, perubahan key dikembalikan otomatis.
- Setiap pemotongan tercatat di Credit Log: aksi `Generate` dan `Perpanjang` (action `extend`).

**Kerangka panel**

- **Sidebar bisa disembunyikan**: klik logo X 3D di header sidebar untuk menutupnya, lalu klik X yang
  muncul di topbar untuk membukanya lagi. Pilihan disimpan di cookie `xloop_sidebar`, jadi tetap
  tersembunyi/terbuka setelah refresh maupun pindah halaman — dan karena dibaca di server, sidebar
  tidak berkedip saat halaman dimuat.
- **Tema warna bisa diatur** dari menu Pengaturan: 8 preset/hex custom untuk aksen, 7 palet dasar
  gelap (Hangat, Grafit, Midnight, Hitam pekat, Ocean, Forest, Plum), 6 warna permukaan custom
  (latar, kartu, permukaan terangkat, border, teks utama, teks sekunder), serta bentuk sudut Tajam /
  Standar / Membulat. Palet/aksen/radius diterapkan langsung; override permukaan diterapkan setelah
  menekan **Terapkan warna**. Pratinjau mengikuti hasil akhir; pemeriksaan kontras memperingatkan pasangan
  teks/latar di bawah rasio WCAG AA 4.5:1. Warna UI memakai token CSS, sedangkan kontrol
  dan kartu memakai token radius (`--r-control`, `--r-card`); `lib/theme.ts` menerapkannya lewat
  inline style di `<html>`. Preferensi disimpan di cookie `xloop_theme` selama 1 tahun dan dibaca di server,
  sehingga tema sudah benar pada HTML pertama tanpa kedip. Parser tetap menerima cookie format lama
  (`<palet>.<hex>`); teks tombol utama memilih hitam atau putih dengan rasio kontras terbaik.
- **Topbar** menampilkan judul halaman aktif (dengan breadcrumb di halaman turunan), tombol **Cari…
  (Ctrl/⌘ K)**, dan chip sisa credit untuk Reseller.
- **Command palette** (Ctrl/⌘ K di mana saja): lompat ke menu sesuai role, aksi cepat (Generate key,
  key aktif, tema, logout), dan **cari key** — ketik potongan `XLVP-…`, hasil muncul langsung dan
  Enter membuka Key List dengan filter terisi (`/keys?q=`).
- **Key List** punya kolom *Last used* (relatif, tooltip tanggal lengkap), tooltip waktu relatif di
  kolom Expired, penanda **Segera expired** (≤ 3 hari), dan di layar HP tabelnya berubah menjadi
  daftar kartu. Kepadatan baris (Nyaman 44px / Kompak 36px) diatur dari Pengaturan — cookie
  `xloop_density`, diterapkan via class `density-compact` di `<html>` (`lib/density.ts`).
- **Riwayat login** dicatat tabel `login_logs` oleh `/api/auth/login` untuk percobaan sukses maupun
  gagal (email, IP, user-agent, alasan). User melihat miliknya di Pengaturan; Owner juga melihat milik
  reseller di halaman detail reseller (`GET /api/auth/logins?user_id=`).
- **Loading splash interaktif** saat login sukses sebelum masuk dashboard: latar grid bergerak,
  scan-line HUD, logo X 3D dengan napas/tilt, tiga lapis cincin orbit berputar (luar conic
  multi-segmen + titik cahaya, tengah dashed counter-rotate + titik aktif, dalam statis) dengan
  ripple pulse, 6 partikel cahaya yang terlepas dari orbit, wordmark tampil per-huruf bergantian,
  progress bar yang benar-benar terisi 0→96% dengan shimmer aksen, persentase real-time, dan status
  yang berganti sekuensial (Memverifikasi sesi → Menyiapkan workspace → Memuat data reseller →
  Mengambil statistik → Membuka dashboard). Owner tidak ditampilkan splash di reload karena hanya
  muncul setelah login sukses.
- **Skeleton dashboard yang hidup**: blok abu dengan gradient shimmer yang menyapu (bukan pulse
  polos), kartu statistik dan panel samping masuk dengan fade-up bertahap, batang skeleton chart
  naik-turun dengan wave bergantian, dan status kuota cooldown HWID langsung terlihat di modal
  detail key.
- **Cooldown reset HWID (anti berbagi key)**. Reseller dibatasi maksimal **3× reset HWID per key
  per 24 jam** (rolling window) untuk mengurangi kebiasaan berbagi key lewat reset berulang.
  "Reset Semua HWID" dihitung 1 kuota (bukan per-HWID). Owner **tidak terkena batas** dan reset
  oleh Owner juga **tidak menghabiskan kuota reseller** (supaya bisa bantu support saat darurat).
  Ketika kuota habis:
  - Tombol reset otomatis ter-disable dengan hitung mundur live (detik/menit/jam)
  - Banner merah peringatan tampil di atas daftar HWID dengan waktu tunggu
  - Server mengembalikan `429 hwid_reset_cooldown` + `Retry-After` yang akurat
  - Setelah cooldown selesai, data otomatis di-refresh tanpa perlu reload halaman
  - Setiap reset tetap tercatat di Audit Log dengan HWID yang dihapus dan kuota tersisa
  - Kuota dihitung dari audit log (tidak perlu tabel baru), dengan composite index
    `(key_id, action, created_at DESC)` supaya query tetap cepat saat log membesar.

---

## 2. Tech stack & versi

| Layer | Teknologi |
|---|---|
| Frontend & Backend | Next.js `14.2.15` (App Router, API Routes) |
| Database & Auth | Supabase PostgreSQL + Supabase Auth |
| Supabase client | `@supabase/ssr@0.5.2` + `@supabase/supabase-js@2.45.4` |
| Styling | Tailwind CSS `3.4` |
| Ikon | `lucide-react` (stroke 1.5) |
| Chart | `recharts`, di-load `next/dynamic({ ssr: false })` hanya di halaman dashboard |
| Font | `next/font` — Geist Sans (UI) + Geist Mono (key & HWID) |
| Runtime | Node.js 20.x LTS |
| Deploy | Vercel |

### Logo & identitas

Logo panel adalah huruf **“X” 3D** yang digambar sebagai **SVG custom (inline, tanpa background)**:

| Berkas | Isi |
|---|---|
| `components/ui/XloopMark.tsx` | Komponen logo yang dipakai di sidebar (28px) dan halaman login (32px). Warna memakai token `--c-accent` dengan tiga tingkat opacity, jadi ikut berubah kalau token accent diubah. Ukuran diatur lewat prop `size` |
| `public/xloop-mark.svg` | Versi standalone (warna harfiah) untuk dipakai di luar aplikasi (README, materi promosi, dsb) |
| `app/icon.svg` | Favicon: logo yang sama di atas rounded square (favicon butuh bentuk latar) |

Cara menggambarnya: satu path 12 titik (4 ujung lengan tajam + 4 notch, simetris 45°) yang
digambar **tiga kali** dengan offset diagonal 0.5px / 1px dan tone makin gelap — jadi terbaca
sebagai objek 3D ber-volume tanpa gradient, glow, `filter`, atau shadow. Ujung lengan dirapikan
dengan `stroke-linejoin: round` berukuran kecil supaya tetap mulus di layar ber-DPI rendah.

> **Catatan versi Supabase:** paket `@supabase/supabase-js` di-pin ke `2.45.4` dan `@supabase/ssr`
> ke `0.5.2`. Versi Supabase JS yang lebih baru (2.11x) mensyaratkan **Node.js 22+** (memakai WebSocket
> bawaan Node 22 dan gagal `"native WebSocket not found"` di Node 20). Karena target runtime di sini
> adalah Node 20 LTS, versi di atas adalah kombinasi yang stabil dan sudah diuji di repo ini.
> Kalau kamu naik ke Node 22, silakan bump keduanya bersamaan (`npm i @supabase/ssr@latest @supabase/supabase-js@latest`).

### Mode database: Supabase atau SQLite

`lib/env.ts` menentukan mode lewat `dbMode()`:

1. `XLOOP_DB=supabase|sqlite` → paksa salah satu (paling eksplisit);
2. `NEXT_PUBLIC_MOCK_MODE=1` → mode SQLite (flag lama, tetap didukung);
3. env Supabase (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`)
   belum lengkap → **otomatis mode SQLite**;
4. selain itu → Supabase.

Di mode SQLite, `lib/db/sqlite/adapter.ts` menyediakan permukaan API yang sama dengan `supabase-js`
(`from().select().eq()...`, `rpc()`, `auth.admin.createUser()`), jadi seluruh API route, helper
statistik, dan endpoint validasi tidak perlu ditulis dua kali. Tabel, fungsi (RPC), dan indexnya adalah
cerminan `migration.sql` dalam dialek SQLite; password memakai `scrypt` dan sesi memakai cookie
`xloop_session` (HttpOnly, 7 hari) yang divalidasi ke tabel `auth_sessions`.

**Catatan penting:** file SQLite itu *file lokal*. Di Vercel (serverless, filesystem read-only) mode ini
tidak bisa menyimpan data — pakai Supabase untuk production. Mode SQLite ditujukan untuk development,
pratinjau UI, dan pemakaian di mesin sendiri.

### Layout & sidebar yang bisa disembunyikan

Sidebar kiri (`components/layout/Sidebar.tsx`) menyediakan tombol toggle di headernya: **ikon X 3D
yang sama dengan logo panel**. Klik = sembunyikan; saat tersembunyi, tombol X berukuran sama muncul
di topbar (`components/layout/Topbar.tsx`) untuk mengembalikannya.

| Bagian | Perilaku |
|---|---|
| `components/layout/DashboardShell.tsx` | Menyimpan status buka/tutup (`useState`) dan mengatur ruang konten. Sidebar tidak pernah di-unmount, cuma digeser `translate-x` — isi halaman tidak kehilangan state (mis. kata kunci pencarian yang sedang diketik) |
| `components/layout/SidebarToggle.tsx` | Tombolnya sendiri: menulis cookie lewat `lib/utils/cookie.ts`, punya `aria-label` “Sembunyikan/Tampilkan sidebar”, `aria-expanded`, `aria-controls="app-sidebar"`, target sentuh ≥ 40px |
| `SIDEBAR_COOKIE` (`lib/constants.ts`) | Nama cookie `xloop_sidebar` (`open`/`hidden`, umur 1 tahun). `app/(dashboard)/layout.tsx` membacanya lewat `cookies()` → nilai awal sudah benar di HTML pertama |
| Aksesibilitas | Saat tersembunyi: `aria-hidden="true"`, tautan menu & tombolnya di-skip dari urutan Tab (`tabIndex={-1}`), dan fokus dipindahkan ke tombol X di topbar supaya pengguna keyboard tidak “tersesat” |

Lebar: 224px dengan label di layar ≥ `lg`, rail ikon 56px di layar kecil; konten otomatis memakai
lebar penuh (`pl-0`) saat sidebar disembunyikan. Semua transisi 150 ms `ease-out`.

Dilarang (dan tidak dipakai): Three.js, WebGL, canvas animasi, video background, Lottie, atau library
animasi berat lain. Panel ini sengaja ringan untuk HP kelas menengah — semua animasi hanya transisi
fungsional 150–200 ms `ease-out` dan menghormati `prefers-reduced-motion`.

---

## 3. Struktur folder

```
root/
├── app/
│   ├── (auth)/
│   │   └── login/                 # halaman login (satu-satunya halaman publik)
│   ├── (dashboard)/
│   │   ├── layout.tsx             # shell: baca cookie sidebar + sidebar/topbar + konten (maks 1280px)
│   │   ├── template.tsx           # page transition fade 150ms
│   │   ├── dashboard/             # overview owner & reseller
│   │   ├── tools/                 # Tool Management (owner)
│   │   ├── durations/             # Duration Setting (owner)
│   │   ├── keys/                  # Key List
│   │   ├── generate/              # Generate Key
│   │   ├── resellers/             # Reseller Management (owner) + [id]/ halaman detail reseller
│   │   ├── credits/               # Credit Log
│   │   ├── audit/                 # Audit Log terpadu (owner): aksi key + aktivitas akun & sistem dalam satu timeline
│   │   ├── validation-attempts/   # analitik anti-abuse (owner)
│   │   └── settings/              # Pengaturan: akun, keamanan, tema, Telegram, API key, batas sistem
│   ├── api/
│   │   ├── auth/                  # login, logout, session, logins, password, sessions, logins
│   │   ├── keys/                  # list, generate, edit, ban/unban, devices (HWID)
│   │   ├── tools/                 # tool type, version, secret payload
│   │   ├── durations/             # preset durasi
│   │   ├── resellers/             # reseller management (owner) + topup/set_active/reset_password/adjust_credit
│   │   ├── credits/               # credit log + export CSV
│   │   ├── audit/                 # audit log terpadu: aksi key + aktivitas akun & sistem (owner) + export CSV
│   │   ├── validation-attempts/   # data + analitik percobaan validasi (owner)
│   │   ├── settings/              # konfigurasi runtime + Telegram (owner)
│   │   ├── telegram/              # link (akun ⇄ chat) + webhook bot
│   │   ├── api-keys/              # API key reseller (buat, daftar, cabut)
│   │   ├── v1/                    # API publik reseller (Bearer xlp_…) — lihat docs/RESELLER_API.md
│   │   ├── validate/              # endpoint publik validasi (Ed25519)
│   │   └── cron/                  # cleanup & digest (Bearer CRON_SECRET)
│   ├── globals.css                # token warna + base style
│   ├── icon.svg                   # favicon (logo X 3D)
│   └── layout.tsx                 # root layout (font Geist, ToastProvider)
├── components/
│   ├── dashboard/                 # KeyTable, HwidModal, KeyEditModal, kartu statistik, chart, dsb
│   ├── ui/                        # Button, Modal, ConfirmDialog, Select (custom), Badge, Toast, Skeleton, Form, CopyButton, EmptyState, Pagination, XloopMark (logo)
│   └── layout/                    # DashboardShell, Sidebar (+toggle X 3D), Topbar, CommandPalette, nav.ts
├── lib/
│   ├── api/                       # helper server: auth ctx, keys, stats, generate (GenerateContext),
│   │                              # settings runtime, activity, notify (Telegram/webhook), api-keys, v1, telegram-bot
│   ├── db/sqlite/                 # mode SQLite: skema, seed, adapter supabase-like, auth, RPC
│   ├── supabase/                  # server, admin (service role), middleware — pintu ke DB aktif
│   ├── types/                     # tipe Database + tipe UI
│   ├── env.ts                     # pemilih mode database (Supabase ⇄ SQLite)
│   ├── theme.ts                   # preset aksen/palet, cookie xloop_theme, CSS variable tema
│   ├── density.ts                 # kepadatan tabel (cookie xloop_density, class density-compact)
│   └── utils/                     # crypto (Ed25519 + key generator), format, csv, http (readJsonBody),
│                                  # validate (asSignedInt), pricing, refund, telegram (Bot API), json, cookie, cn
├── docs/
│   ├── CLIENT_INTEGRATION.md      # cara verifikasi di sisi tool
│   ├── RESELLER_API.md            # dokumentasi API publik /api/v1 (API key reseller)
│   ├── VERIFICATION.md            # hasil pemeriksaan (verify:*) & checklist produksi
│   └── examples/                  # contoh Python & JavaScript + sample response
├── data/                          # database SQLite (dibuat otomatis, di-gitignore)
├── public/
│   └── xloop-mark.svg             # logo X 3D standalone (warna harfiah, untuk aset luar aplikasi)
├── scripts/
│   ├── generate-keypair.mjs       # generate keypair Ed25519 untuk signing
│   └── make-sample-response.mjs   # bikin sample response bertanda tangan untuk uji verifier
├── dev/
│   ├── local-server.mjs           # jalankan panel mode SQLite (dev/preview), keypair otomatis
│   ├── sqlite-cli.mjs             # utilitas database: info | accounts | reset
│   ├── sqlite-e2e-test.mjs        # uji end-to-end panel di mode SQLite (90 pemeriksaan, termasuk audit log & auto-ban)
│   ├── validate-e2e-test.mjs      # uji end-to-end endpoint validasi di mode SQLite (28 pemeriksaan)
│   ├── features-e2e-test.mjs      # uji tujuh fitur baru: akun, notifikasi, API key/v1, bot Telegram (94 pemeriksaan)
│   ├── focus-test.mjs             # uji fokus input (regresi "keyboard mobile ketutup")
│   └── sidebar-test.mjs           # uji tombol buka/tutup sidebar (44 pemeriksaan)
├── migration.sql                  # SQL siap run di Supabase SQL Editor
├── vercel.json                    # konfigurasi + jadwal cron (cleanup 03:00, digest 01:00)
├── middleware.ts                  # proteksi route + refresh sesi Supabase
└── .env.example                   # daftar environment variables
```

---

## 4. Setup Supabase

### 4.1 Buat project

1. Masuk ke [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Isi nama project, password database, dan pilih region terdekat (mis. `Southeast Asia (Singapore)`).
3. Tunggu sampai project selesai provisioning.

### 4.2 Jalankan migration

1. Buka **SQL Editor** → **New query**.
2. Copy seluruh isi [`migration.sql`](migration.sql), paste, lalu **Run**.
3. Pastikan muncul `Success. No rows returned`.

`migration.sql` bersifat idempotent (aman dijalankan ulang) dan berisi:

- tabel: `profiles`, `tool_types`, `tool_versions`, `duration_presets`, `keys`, `device_logs`,
  `credit_logs`, `tool_secrets`, `validation_attempts`, `audit_logs`, `login_logs`
- fungsi: `register_device` (atomic slot HWID), `spend_credit`, `add_credit`, `update_expired_keys`,
  `cleanup_validation_attempts`, `key_device_counts`, `key_counts_by_version`, `reseller_summary`,
  `is_owner`, `update_updated_at`
- index untuk performa (status, tool, version, expired, created, HWID, log)
- **Row Level Security** + policy untuk semua tabel
- trigger `updated_at`
- seed: akun Owner + contoh tool/version/preset durasi

### 4.3 Cek RLS

Di **Table Editor → (pilih tabel) → RLS** pastikan statusnya *Enabled* untuk:
`profiles`, `tool_types`, `tool_versions`, `duration_presets`, `keys`, `device_logs`, `credit_logs`,
`tool_secrets`, `validation_attempts`.

Yang perlu dipahami: `tool_secrets` dan `validation_attempts` **tidak punya policy sama sekali** —
artinya hanya `service_role` (API routes) yang bisa mengaksesnya. Ini disengaja.

### 4.4 Ambil kredensial

**Project Settings → API**:

| Yang diambil | Untuk env |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` (**server only!**) |

---

## 5. Environment variables

Copy `.env.example` menjadi `.env.local` untuk local, dan isi variable yang sama di
**Vercel → Project → Settings → Environment Variables** untuk production.

| Variable | Wajib | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅* | Project URL Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅* | Anon key (aman di browser, dibatasi RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅* | Service role key. **Server only**, jangan pakai prefix `NEXT_PUBLIC_`, jangan commit |
| `LICENSE_SIGNING_PRIVATE_KEY` | ✅ | Private key Ed25519 (PKCS8 PEM → base64 satu baris) untuk menandatangani response `/api/validate` |
| `LICENSE_SIGNING_PUBLIC_KEY` | ✅ | Public key Ed25519 (SPKI PEM → base64 satu baris). Ditampilkan di Tool Management untuk ditanam di tool |
| `LICENSE_TOKEN_TTL_SECONDS` | ➖ | Masa berlaku token validasi dalam detik. Default `900` (15 menit) |
| `CRON_SECRET` | ✅ | Secret untuk header `Authorization: Bearer <CRON_SECRET>` di `/api/cron/cleanup` dan `/api/cron/digest` |
| `XLOOP_DB` | ➖ | Paksa mode database: `supabase` atau `sqlite`. Kalau kosong, mode ditentukan otomatis (lihat bagian 13) |
| `XLOOP_SQLITE_PATH` | ➖ | Lokasi file SQLite. Default `data/xloop.sqlite` |
| `NEXT_PUBLIC_MOCK_MODE` | ➖ | `1` = paksa mode SQLite (nama lama, tetap didukung). **Jangan dipakai di production** |
| `XLOOP_NOTIFY_WEBHOOK_URL` | ➖ | URL webhook HTTP untuk meneruskan notifikasi (auto-ban, brute-force, saldo tipis, ringkasan harian). Pengiriman gagal tidak pernah menggagalkan aksi utama |

\* Ketiganya wajib **kalau memakai Supabase**. Kalau salah satu belum diisi, panel otomatis jalan di
mode SQLite — jadi tidak ada lagi pesan “env belum diisi” yang bikin panel tidak bisa dibuka.

Aturan penting:

- Private key, service role key, dan `CRON_SECRET` **tidak boleh** punya prefix `NEXT_PUBLIC_`.
- Private key, `secret_payload`, dan service role key tidak pernah ditulis ke log.
- Kalau memakai Supabase (ketiga variable terisi) tapi `LICENSE_SIGNING_PRIVATE_KEY` belum diisi,
  `/api/validate` gagal dengan pesan yang menyebut nama variable tersebut — panel tetap jalan.

---

## 6. Generate keypair Ed25519

Signature pada `/api/validate` memakai Ed25519. Buat keypair sekali:

```bash
npm run generate-keypair
# atau tulis langsung ke .env.local (nilai lama tidak ditimpa):
node scripts/generate-keypair.mjs --write
```

Output-nya dua baris base64 siap tempel:

```
LICENSE_SIGNING_PRIVATE_KEY=LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0t…
LICENSE_SIGNING_PUBLIC_KEY=LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0t…
```

- **Private key** → isi `LICENSE_SIGNING_PRIVATE_KEY` di server (Vercel env, bukan `NEXT_PUBLIC_*`).
- **Public key** → tempel di tool/mod kamu. Kamu juga bisa menyalinnya dari panel:
  **Tool Management → kotak “Public key verifikasi” → tombol copy**.
- Kalau private key bocor: generate keypair baru, update env server, lalu update public key di semua
  client yang sudah kamu distribusikan. Key lama yang ditandatangani jadi tidak valid — itu memang
  tujuannya.

---

## 7. Menjalankan di local development

Ada dua cara: **mode SQLite** (tanpa setup apa pun) atau **mode Supabase**.

```bash
# 1. Install dependency (Node.js 20.x)
npm install

# --- Cara A: langsung jalan dengan SQLite lokal (tanpa env) ---
npm run demo                    # http://localhost:3010 · owner@gmail.com / Axell123

# --- Cara B: pakai Supabase ---
cp .env.example .env.local      # isi URL + anon key + service role key
npm run generate-keypair        # tambahkan keypair ke .env.local
npm run dev                     # http://localhost:3000
```

Kalau ingin tetap di `npm run dev` tapi memakai SQLite: `XLOOP_DB=sqlite npm run dev`.
Lihat bagian 13 untuk mode SQLite selengkapnya.

Perintah lain:

```bash
npm run build       # build production
npm run start       # jalankan hasil build
npm run typecheck   # cek TypeScript
npm run lint        # eslint
```

Kalau kamu mengubah `migration.sql` (mis. menambah tabel), jalankan ulang file itu di Supabase SQL
Editor — file-nya idempotent.

---

## 8. Deploy ke Vercel

1. Push repository ini ke GitHub/GitLab.
2. Di Vercel: **Add New → Project → Import** repo tersebut.
3. Framework terdeteksi otomatis sebagai **Next.js**. Biarkan Build Command & Output default.
4. **Settings → General → Node.js Version** → pilih **20.x**.
5. **Settings → Environment Variables** → tambahkan semua variable di [bagian 5](#5-environment-variables)
   (pilih scope: *Production*, *Preview*, *Development* sesuai kebutuhan).
6. **Deploy**.
7. Setelah deploy, cek **Deployments → Cron Jobs**: `vercel.json` sudah mendaftarkan
   `/api/cron/cleanup` dengan jadwal `0 3 * * *` (03:00 UTC = 10:00 WIB). Vercel akan mengirim
   `Authorization: Bearer <CRON_SECRET>` otomatis.
8. Uji cron manual:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://panel-kamu.vercel.app/api/cron/cleanup
   # → {"ok":true,"deleted_attempts":0,"expired_keys_updated":true,...}
   ```

> Catatan: Vercel Cron pada paket Hobby hanya bisa berjalan sekali sehari — `0 3 * * *` cocok.
> Kalau butuh lebih sering, naikkan paket atau panggil endpoint ini dari scheduler lain
> (cron-job.org, GitHub Actions) dengan header yang sama.

---

## 9. Akun Owner pertama

Migration sudah membuat akun Owner di dalamnya:

| | |
|---|---|
| Email | `owner@gmail.com` |
| Password | `Axell123` |

> ⚠️ **Ganti password ini setelah login pertama.** Caranya: login ke panel → **Pengaturan →
> Keamanan Akun → Ganti password** (semua role bisa ganti password sendiri; ada juga tombol
> “putus semua sesi lain”). Alternatif: Supabase Dashboard → **Authentication → Users →
> pilih user → Reset password / Update user**.

Sesudah itu:

1. Login ke panel dengan akun Owner tersebut.
2. (Opsional) **Tool Management → Tambah Tool** kalau kamu tidak mau memakai data contoh
   (`Perkakas Pro`, `Studio Kit`).
3. (Opsional) **Duration Setting** untuk mengatur ulang preset durasi & harga credit.
4. **Reseller → Tambah Reseller** untuk membuat akun reseller pertama.
5. Isi **Payload rahasia** tool (Tool Management → Edit) dengan data yang dibutuhkan tool
   supaya bisa jalan. Isinya tersimpan di `tool_secrets`, dan setelah disimpan tidak pernah
   dikirim kembali ke browser (hanya label “Tersimpan” + tombol “Ganti”).

Kalau ingin membuat Owner tambahan: buat user baru di **Supabase → Authentication → Users → Add user**
(centang *Auto Confirm User*), lalu update barisnya di tabel `profiles`:

```sql
UPDATE profiles SET role = 'owner' WHERE email = 'owner-kedua@email.com';
-- kalau barisnya belum ada, buat manual:
-- INSERT INTO profiles (id, username, email, role, credit, is_active)
-- VALUES ('<uuid user dari auth.users>', 'owner2', 'owner-kedua@email.com', 'owner', 0, true);
```

---

## 10. Referensi API

Semua endpoint panel butuh session (cookie Supabase). Response seragam:
`{ ok: true, data }` atau `{ ok: false, error, code }`.

### Auth

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/auth/login` | Login email+password. Akun `is_active = false` → `403 "Akun kamu dinonaktifkan"` |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/session` | Info user yang sedang login (dipakai topbar) |

### Keys

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/keys` | List key. Owner = semua, Reseller = miliknya. Query: `q, status, tool_type_id, version_id, created_by, sort, order, page, per_page` |
| POST | `/api/keys/generate` | Generate key (owner: preset/custom, reseller: preset + potong credit `harga preset × quantity × max device`) |
| GET | `/api/keys/[id]` | Detail satu key |
| PUT | `/api/keys/[id]` | Edit key: `mode: preset` (+`duration_preset_id`, boleh Owner & Reseller — Reseller **wajib** mode ini dan dipotong credit `harga preset × max device`), `mode: extend` (+`add_days`), `mode: set` (+`expired_at`), `mode: lifetime` — tiga mode terakhir Owner saja, plus `note` dan `max_device`. Response memuat `credit: { cost, unit_price, max_device, balance_before, balance_after }` |
| DELETE | `/api/keys/[id]` | Hapus key + semua HWID-nya. Kalau Owner menghapus key reseller yang **aktif & belum expired**, credit yang dipakai otomatis dikembalikan — respons memuat `refund: { amount, user_id, username, balance_after }` (atau `null` / `refund.error` kalau gagal) |
| PUT | `/api/keys/[id]/ban` | Ban key. Body opsional: `reason` (`manual` \| `refund` \| `other`, default `manual`) + `note` — tercatat di audit log. `auto_hwid` khusus auto-ban sistem (ditolak 400) |
| PUT | `/api/keys/[id]/unban` | Unban (→ `active`, atau `expired` kalau sudah lewat). Key auto-ban (`ban_reason = auto_hwid`) **hanya bisa di-unban Owner** — reseller dapat `403` |
| GET | `/api/keys/[id]/devices` | List HWID terdaftar |
| DELETE | `/api/keys/[id]/devices/[deviceId]` | Reset 1 HWID (terima UUID baris atau HWID-nya) — tercatat di audit log |
| DELETE | `/api/keys/[id]/devices` | Reset semua HWID — tercatat di audit log |

### Tools (Owner)

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/tools` | List tool + version + jumlah key aktif, plus `public_key`. Reseller hanya melihat tool/version aktif dan **tanpa** secret |
| POST | `/api/tools` | Tambah tool (`name`, `slug`, opsional `secret_payload`) |
| PUT | `/api/tools/[id]` | Edit tool (`name`, `slug`, `is_active`) |
| DELETE | `/api/tools/[id]` | Hapus tool (ditolak kalau masih ada key) |
| POST | `/api/tools/[id]/versions` | Tambah version |
| PUT | `/api/tools/[id]/versions/[vid]` | Edit version (`name`, `is_active`) |
| DELETE | `/api/tools/[id]/versions/[vid]` | Hapus version (ditolak kalau masih dipakai key) |
| GET | `/api/tools/[id]/secret` | Status payload rahasia (`has_secret`) — isinya tidak pernah dikembalikan |
| PUT | `/api/tools/[id]/secret` | Simpan/ganti payload rahasia (`secret_payload: null` untuk menghapus) |

### Durations (Owner)

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/durations` | List preset (reseller hanya yang aktif) |
| POST | `/api/durations` | Tambah preset (`name`, `days`, `credit_cost`, `is_active`) |
| PUT | `/api/durations/[id]` | Edit preset / toggle aktif |
| DELETE | `/api/durations/[id]` | Hapus preset |

### Resellers (Owner)

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/resellers` | List reseller + credit + jumlah key |
| POST | `/api/resellers` | Tambah reseller (`username`, `email`, `password`, `credit`) |
| GET | `/api/resellers/[id]` | Detail + riwayat credit |
| PUT | `/api/resellers/[id]` | `action: topup` (+`amount`,`note`), `set_active` (+`is_active`), `reset_password` (+`password`), `update` (+`username`,`email`) |
| DELETE | `/api/resellers/[id]` | Hapus permanen (butuh `confirm_username`) — ikut menghapus key, HWID, dan riwayat credit |

### Credits

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/credits` | Credit log (owner: semua + filter `user_id`; reseller: miliknya). Query: `from, to, action` (`topup` \| `generate` \| `extend` \| `refund`), `page, per_page, format=csv` |

### Audit Log (Owner)

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/audit` | Audit log **terpadu** — satu timeline berisi aksi pada key (`key_ban`, `key_unban`, `key_delete`, `hwid_reset`, `hwid_reset_all`, `key_auto_ban`: aktor owner/reseller/sistem, pemilik key, alasan ban, catatan) **dan** aktivitas akun & sistem (`password_change`, `sessions_revoke`, `api_key_create/revoke`, `settings_update`, `credit_topup/adjust`, `telegram_*`, `security`). Query: `from, to, action` (aksi apa pun dari kedua kelompok), `actor` (user_id, atau `system`), `key` (cari `key_value`, hanya menyaring baris aksi key), `page, per_page, format=csv`. Hanya Owner (reseller dapat `403`) |

### Keamanan akun (semua role)

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/auth/password` | Ganti password sendiri (`current_password`, `new_password`, `logout_others`). Mode SQLite otomatis mencabut sesi lain |
| GET | `/api/auth/sessions` | Daftar sesi/perangkat aktif; menandai sesi yang sedang dipakai |
| DELETE | `/api/auth/sessions` | Putus semua sesi lain (sesi sekarang tetap hidup) |

### Pengaturan & integrasi

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/settings` | (Owner) Konfigurasi runtime + nilai default + rentang aman |
| PUT | `/api/settings` | (Owner) Patch sebagian; nilai dijepit ke rentang aman, perubahan tercatat di activity log |
| GET/POST | `/api/settings/telegram` | (Owner) Status bot + live webhook info; aksi `connect`, `set_webhook`, `rotate_webhook`, `remove_webhook`, `disconnect`, `notifications`, `test` |
| GET/POST/DELETE | `/api/telegram/link` | Tautkan/lepas chat Telegram akun ini (kode 6 karakter, berlaku 10 menit, sekali pakai) |
| GET/POST | `/api/api-keys` | Daftar & buat API key reseller (token hanya tampil sekali; Owner boleh membuatkan untuk reseller) |
| DELETE | `/api/api-keys/[id]` | Cabut API key (soft revoke — langsung tidak berlaku) |

### Publik & mesin

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/validate` | Validasi key dari tool (tanpa session, response bertanda tangan) |
| GET | `/api/cron/cleanup` | Cleanup harian (`Authorization: Bearer CRON_SECRET`) |
| GET | `/api/cron/digest` | Ringkasan harian ke Telegram/webhook Owner (`Authorization: Bearer CRON_SECRET`) |
| POST | `/api/telegram/webhook` | Webhook bot Telegram (secret token) |
| GET/POST | `/api/v1/me`, `/api/v1/tools`, `/api/v1/presets`, `/api/v1/keys`, `/api/v1/keys/[id]`, `/api/v1/keys/[id]/hwid-reset`, `/api/v1/credits` | API publik dengan API key `xlp_…` — lihat [`docs/RESELLER_API.md`](docs/RESELLER_API.md) |

---

## 11. Endpoint validasi (anti-bypass)

Ringkas — dokumentasi lengkap ada di [`docs/CLIENT_INTEGRATION.md`](docs/CLIENT_INTEGRATION.md).

**Request** (`POST /api/validate`, body maks 2 KB):

```json
{
  "key": "XLVP-AB12-CD34",
  "tool_slug": "perkakas-pro",
  "tool_version": "1.8.0",
  "hardware_id": "sha256_hash_of_device_info",
  "nonce": "random_string_baru_tiap_request"
}
```

**Urutan validasi server:** rate limit → format input → key ada → status `active` →
`tool_slug` cocok & tool aktif → `tool_version` cocok & version aktif → belum expired →
slot HWID lewat `register_device()` (atomic, aman dari race) → update `last_used` →
ambil `secret_payload` → tanda tangani → catat ke `validation_attempts`.

**Response sukses** (ditandatangani):

```json
{
  "payload": "<base64 JSON payload>",
  "signature": "<base64 signature Ed25519 atas byte JSON payload>"
}
```

**Response gagal** (tidak ditandatangani): `{ "valid": false, "reason": "key_expired" }`

Reason yang mungkin: `invalid_request` (400), `invalid_key`, `key_expired`, `key_banned`,
`wrong_tool`, `wrong_version`, `device_limit_exceeded`, `rate_limited` (429), `server_error` (500).

**Rate limit & proteksi:** 30 req/menit per IP, 15 req/menit per key (dihitung dari tabel
`validation_attempts`, bukan memori — aman untuk serverless). Kalau satu IP sudah 5× `invalid_key`
dalam 10 menit, semua kegagalan berikutnya dikembalikan sebagai `invalid_key` saja. Kalau satu key
ditolak `device_limit_exceeded` oleh 5 HWID berbeda dalam 1 jam → key otomatis dibanned
(“Auto-ban: terlalu banyak device berbeda”) dengan `ban_reason = auto_hwid` — tercatat di Audit Log
sebagai aksi `system`, dan **unban-nya hanya bisa oleh Owner** (reseller dapat `403`). Pemeriksaan
auto-ban dijalankan di **dalam fungsi Postgres `check_auto_ban()`** dengan
`pg_advisory_xact_lock(hashtext('xloop:auto_ban:' || key_id))` supaya burst paralel dari banyak HWID
berbeda tidak bisa lolos karena race condition (request yang masuk bersamaan diserialisasi
per-key, dan double-check dilakukan di dalam kunci tersebut).

---

## 12. Aturan akses & keamanan

1. **Semua operasi tulis lewat API route** (service role) setelah cek session, role, dan kepemilikan
   data. Browser tidak pernah memegang kredensial database dan tidak pernah memanggil Supabase
   langsung: halaman membaca lewat API route juga (di mode Supabase RLS tetap aktif sebagai lapisan
   kedua; reseller tidak bisa menulis langsung ke tabel `keys` walaupun memanggil Supabase dari
   console — policy-nya `SELECT` saja untuk miliknya sendiri). Di **mode SQLite** tidak ada RLS,
   jadi pemeriksaan di API route itulah pengamannya — diuji oleh `npm run verify:sqlite`.
2. **`/api/validate` memakai service role di server** (`SUPABASE_SERVICE_ROLE_KEY`). Jangan pernah
   memberi prefix `NEXT_PUBLIC_` pada variable ini, dan jangan memanggil Supabase dari kode client
   dengan key ini.
3. **Private key Ed25519 tidak ada di kode, log, atau database** — hanya di environment server.
4. **`secret_payload` tidak pernah dibalas ke browser.** Halaman Tool Management hanya menampilkan
   “Tersimpan” + tombol “Ganti”.
5. **Tidak ada CORS wildcard** di `/api/validate`.
6. **IP** diambil dari elemen pertama header `x-forwarded-for` (fallback `x-real-ip`).
7. Key dibuat dengan **`crypto.randomInt`** (CSPRNG Node.js), bukan `Math.random`, dan selalu dicek
   duplikatnya sebelum insert.
8. Akun nonaktif tidak bisa login (dicek di `/api/auth/login` **dan** di `middleware.ts`).
9. Cron dilindungi `Authorization: Bearer <CRON_SECRET>` dengan `timingSafeEqual` (perbandingan
    fixed-length supaya waktu respons tidak membocorkan prefix secret yang cocok).
10. **Audit log** (`audit_logs`) mencatat aksi pada key — ban, unban, hapus key, reset HWID,
    auto-ban — dengan aktor, pemilik key, alasan ban terstruktur, dan catatan. Append-only dan
    hanya bisa dibaca Owner (dipakai saat cek jejak/sengketa dengan reseller). Identitas di-log
    secara denormalized (`actor_username`, `key_owner_username`, `key_value`) dan FK `ON DELETE
    SET NULL`, jadi jejak tetap terbaca walau akun pelakunya atau key-nya sudah dihapus. Unban
    untuk auto-ban (`ban_reason = auto_hwid`) hanya bisa oleh Owner.
11. **Session cookie** (`xloop_session` mode SQLite) memakai `HttpOnly`, `SameSite=Lax`, dan
    `Secure` otomatis saat `NODE_ENV=production` (cookie Supabase `sb-*` dikelola `@supabase/ssr`
    yang sudah menerapkan atribut yang sama). Fungsi penghapusan cookie memakai atribut yang sama
    persis supaya browser benar-benar menghapusnya.
12. **Login brute-force guard** membatasi 10 percobaan gagal per IP per 10 menit (in-memory).
    Map kegagalan secara rutin dibersihkan dari entri kedaluwarsa supaya tidak memory leak pada
    proses `next start` yang berjalan lama.
13. **Cooldown reset HWID** (lihat bagian Fitur) membatasi reseller maksimal 3× reset per key
    per 24 jam rolling window. Owner tidak terkena batas, dan reset oleh Owner tidak menghabiskan
    kuota reseller (filter `actor_role = 'reseller'` di query hitung).
14. **Password** mode SQLite di-hash dengan `scrypt` (N=16384, r=8, p=1, salt 16 byte) dan
    diverifikasi dengan `timingSafeEqual` supaya tidak bocor lewat waktu eksekusi.
15. **API key `/api/v1`** disimpan **hanya sebagai hash SHA-256** (token asli tampil sekali), dicek
    dengan `timingSafeEqual`, dibatasi kuota per key (rate limit + `api_request_logs`), bisa dicabut
    (`is_active = false`) dan mati seketika, serta bisa dimatikan Owner lewat saklar API publik.
    Setiap request tercatat (metode, path, status, IP) dan setiap generate/reset HWID masuk audit log.
16. **Webhook Telegram** wajib membawa header `X-Telegram-Bot-Api-Secret-Token` yang dibandingkan
    konstan-waktu; kalau bot belum dikonfigurasi, request dijawab `200` tanpa efek (supaya Telegram
    berhenti mengirim ulang). **Bot token & webhook secret disimpan sebagai dokumen rahasia** di
    `app_settings` dan tidak pernah dikirim ke browser — panel hanya menerima statusnya.
17. **Ganti password** (semua role) memverifikasi password lama dulu, lalu — kalau `logout_others`
    aktif — mencabut semua sesi lain; di mode Supabase sesi dikelola `supabase.auth`, di mode SQLite
    token sesi diganti dan sesi lain dihapus. Semuanya tercatat di activity log.
18. **Notifikasi keluar** (`notify.ts`) tidak pernah menggagalkan aksi utama: pengiriman dibungkus
    `try/catch`, memakai timeout pendek (≤ 3,5−5 detik), dibatasi anti-spam per `dedupe_key`, dan
    kegagalannya hanya dicatat di `notification_logs` + console server.

---

## 13. Mode SQLite (lokal & pratinjau tanpa Supabase)

Panel bisa jalan **tanpa Supabase sama sekali** memakai database SQLite lokal. Mode ini aktif otomatis
kalau env Supabase belum diisi, atau dipaksa lewat `XLOOP_DB=sqlite` / `NEXT_PUBLIC_MOCK_MODE=1`.

```bash
npm run demo                     # next dev  + SQLite: http://localhost:3010
npm run demo -- --prod           # build (kalau perlu) + next start
PORT=4000 npm run demo           # ganti port
XLOOP_SQLITE_PATH=/tmp/u.db npm run demo
```

Runner (`dev/local-server.mjs`) sekaligus membuat **keypair Ed25519** sekali dan menyimpannya di
`data/local-signing-key.json`, jadi `/api/validate` bisa diuji sungguhan tanpa setting env apa pun.

**Akun bawaan** (di-seed saat database masih kosong):

| Role | Email | Password |
|---|---|---|
| Owner | `owner@gmail.com` | `Axell123` |
| Reseller | `andi@example.com` / `budi@example.com` / `citra@example.com` | `Reseller123` |

`citra` sengaja dinonaktifkan (`is_active = false`) untuk menguji alur "Akun kamu dinonaktifkan".
Ganti password setelah login pertama dari **Pengaturan → Keamanan Akun → Ganti password** (semua role
bisa ganti password sendiri; Owner juga masih bisa reset password reseller dari menu Reseller).

**Isi database contoh**: 2 tool + 3 version, 5 preset durasi, 3 reseller, 12 key (8 active, 3 expired,
1 banned), 11 device log, 15 baris credit log (termasuk satu aksi `Perpanjang`) — sama seperti data pratinjau sebelumnya, tapi sekarang
permanen (bukan lagi hilang saat server restart).

### Mengelola database

```bash
npm run db:info        # lokasi file + jumlah baris tiap tabel
npm run db:accounts    # daftar akun (email, role, credit) tanpa hash password
npm run db:reset       # hapus file DB; skema + data contoh dibuat lagi saat panel dijalankan
```

File database default `data/xloop.sqlite` (folder `data/` di-gitignore). Ingin memakai lokasi lain:

```bash
XLOOP_SQLITE_PATH=/path/ke/xloop.sqlite npm run demo
```

### Apa yang benar-benar jalan di mode ini

Bukan mock: seluruh API route memakai database ini — login (password hash `scrypt`), CRUD tool &
version, preset durasi, generate key + potong credit (`spend_credit`), topup (`add_credit`), ban/unban,
reset HWID (`register_device`), credit log + export CSV, dan `/api/validate` lengkap dengan tanda tangan
Ed25519, rate limit, anti-bruteforce, serta auto-ban. Sesi memakai cookie `xloop_session` (HttpOnly,
7 hari) yang divalidasi ke tabel `auth_sessions`.

Tabel tambahan mengikuti fitur baru (dibuat di **kedua** mode, Postgres lewat `migration.sql`):
`app_settings` (konfigurasi runtime + kredensial bot Telegram), `reseller_api_keys` + `api_request_logs`
(API publik `/api/v1`), `telegram_links` + `telegram_link_codes` (bot & penautan chat),
`notification_logs` (riwayat + anti-spam notifikasi), dan `activity_logs` (aktivitas akun & sistem).
Constraint `credit_logs.action` juga diperluas dengan `adjustment` (penyesuaian credit oleh Owner).

Catatan migrasi: kalau kamu sudah punya `data/xloop.sqlite` dari versi sebelumnya, skemanya diperbarui
otomatis **sekali** saat panel dijalankan — kolom `keys.credit_cost` ditambahkan (diisi perkiraan dari
preset untuk data lama; key baru selalu dicatat persis), CHECK constraint `credit_logs` diperluas
untuk aksi `extend`, `refund`, & `adjustment`, tabel `auth_sessions` mendapat kolom `ip`/`user_agent`,
dan tabel-tabel fitur baru dibuat — data lamamu tidak hilang.

Dua perbedaan yang perlu diketahui:

1. **Tidak ada RLS.** Di Supabase, sebagian pembatasan ada di policy database. Di mode SQLite semua
   akses lewat API route yang memeriksa sesi + role + kepemilikan data (lapisan yang sama yang dipakai
   di mode Supabase untuk operasi tulis). Uji `npm run verify:sqlite` memverifikasi pembatasan ini.
2. **Middleware hanya memeriksa keberadaan cookie** (Edge runtime tidak bisa membuka file SQLite).
   Validasi token yang sebenarnya terjadi di server saat halaman/API dibuka.

`--prod` memakai ulang hasil `.next` hanya kalau build itu memang dibuat untuk mode lokal (penanda
`.next/local-build.json`). Hasil `next build` untuk deploy Supabase akan dibangun ulang di sini.

> **Jangan pakai mode SQLite di Vercel/production:** filesystem-nya read-only & sementara, jadi datanya
> tidak akan tersimpan. Untuk production, isi env Supabase (mode Supabase otomatis aktif).

---

## 14. Script bantuan

| Perintah | Fungsi |
|---|---|
| `npm run generate-keypair` | Buat keypair Ed25519 (output base64 siap tempel ke env) |
| `npm run make-sample` | Buat `docs/examples/sample-response.json` (response bertanda tangan) untuk menguji verifier sisi client |
| `npm run verify:validate` | Uji end-to-end `/api/validate` di mode SQLite (keypair sementara + file DB sementara) — 28 pemeriksaan: signature Ed25519, TTL, HWID/slot, semua `reason`, anti-bruteforce, auto-ban, rate limit |
| `npm run verify:sqlite` | Uji end-to-end panel di mode SQLite — 90 pemeriksaan: login (scrypt), session cookie, CRUD, generate + potong credit (`harga × quantity × max device`), perpanjang key pakai preset + tambah device, batas saldo (402), **pengembalian credit saat hapus key** (aktif vs expired vs banned vs milik sendiri), ban/unban dengan alasan terstruktur, reset HWID, **audit log** (jejak ban/unban/hapus/reset HWID/auto-ban, filter, CSV, jejak tetap ada setelah key dihapus), **unban auto-ban khusus Owner**, topup, akun nonaktif, logout, persistensi DB |
| `npm run verify:features` | Uji end-to-end **tujuh fitur baru** di mode SQLite — 94 pemeriksaan: ganti password + sesi, penyesuaian credit, konfigurasi runtime (penjepitan nilai), analitik anti-abuse, notifikasi keluar (brute-force, auto-ban, saldo tipis, digest + anti-duplikat, webhook uji lokal), API key + `/api/v1` (auth, rate limit, kuota reset HWID, audit), bot Telegram (webhook, penautan, perintah), dan retensi/cleanup |
| `npm run demo` (alias `npm run local`) | Jalankan panel mode SQLite di `http://localhost:3010` |
| `npm run db:info` / `db:accounts` / `db:reset` | Utilitas database SQLite (lihat bagian 13) |
| `npm run test:focus` | Uji fokus semua input di browser sungguhan (mobile emulation): pastikan fokus tidak lepas saat mengetik & kembali ke tombol pemicu saat modal ditutup. Butuh `npm i -D playwright && npx playwright install chromium`, dan server lokal (`npm run demo`) berjalan di port 3010 |
| `npm run test:sidebar` | Uji tombol buka/tutup sidebar di browser sungguhan (desktop + emulasi iPhone 13): posisi panel, ruang konten, cookie, fokus, keyboard, dan HTML server tanpa kedipan — 44 pemeriksaan. Butuh Playwright & server lokal (`npm run demo`) di port 3010 |
| `npm run typecheck` | Cek TypeScript seluruh project |
| `npm run lint` | ESLint (`next lint`) |
| `python docs/examples/verify_example.py --sample docs/examples/sample-response.json` | Uji verifier Python: signature valid diterima, signature yang dirusak ditolak |
| `node docs/examples/verify_example.js --sample docs/examples/sample-response.json` | Versi JavaScript |

Hasil pemeriksaan yang sudah dijalankan ada di [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

---

## 15. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `Environment variable SUPABASE_SERVICE_ROLE_KEY belum diisi` | Env belum lengkap. Isi `.env.local` / Vercel env, lalu restart dev server |
| Login selalu “Email atau password salah” padahal benar | Pastikan akun dibuat lewat Supabase Auth (bukan hanya insert ke `profiles`). Cek **Authentication → Users**. Untuk Owner bawaan: user `owner@gmail.com` dibuat oleh `migration.sql`; kalau gagal, buat manual di Authentication lalu tambahkan baris `profiles` |
| `Akun kamu dinonaktifkan` | `profiles.is_active = false`. Aktifkan lewat **Reseller → Aktifkan** atau `UPDATE profiles SET is_active = true WHERE username = '…'` |
| Redirect bolak-balik ke `/login` | Cookie sesi tidak ter-set. Pastikan `middleware.ts` aktif dan `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` benar |
| `/api/validate` membalas `server_error` | `LICENSE_SIGNING_PRIVATE_KEY` kosong atau bukan PKCS8 PEM base64. Jalankan `npm run generate-keypair --write` |
| Tool menerima `wrong_tool` / `wrong_version` | `tool_slug` di sisi client harus sama dengan slug di Tool Management, dan `tool_version` sama persis dengan nama version (case sensitive) |
| Tool menerima `device_limit_exceeded` | Slot `max_device` penuh untuk HWID baru. Reset HWID dari Key List → Detail, atau naikkan Max Device lewat Edit Key |
| `npm warn EBADENGINE` saat install | Kamu memakai paket yang butuh Node 22 dengan Node 20 (atau sebaliknya). Pastikan memakai versi yang dipin di `package.json` dan Node 20.x LTS |
| Cron tidak jalan | Cek `vercel.json` ikut ter-deploy, `CRON_SECRET` terisi di Vercel, dan lihat **Vercel → Cron Jobs → Logs** |
| Tabel “stuck” di skeleton | Request API gagal (mis. session habis). Cek console/Network tab; panel otomatis melempar ke `/login` kalau sesi berakhir |
| Keyboard HP ketutup setelah 1 huruf | Sudah diperbaiki di `components/ui/Modal.tsx` (penyebab: effect cleanup mengembalikan fokus setiap komponen induk re-render — lihat `docs/VERIFICATION.md` bagian 7). Kalau muncul lagi setelah mengubah komponen, jalankan `npm run test:focus` |
| `Cannot find module 'playwright'` saat `npm run test:focus` | Playwright tidak dipasang default (browser-nya besar): `npm i -D playwright && npx playwright install chromium` |
| Panel minta login terus / data kosong setelah refresh | Pastikan file `data/xloop.sqlite` bisa ditulis (folder `data/` dibuat otomatis). Cek dengan `npm run db:info`. Kalau file terhapus, data contoh akan di-seed ulang saat aplikasi dijalankan |
| Ingin kembali ke data contoh | `npm run db:reset` lalu **restart** panel (`npm run demo`) — proses server masih memegang file database lama sampai di-restart |
| Panel pratinjau jadi tanpa CSS / error `Cannot find module '.next/server/pages/_error.js'` | `npm run verify:*` dan `npm run test:*` menjalankan `next dev` yang memakai folder `.next` yang sama dengan server `npm run demo -- --prod`. Bangun ulang (`npm run demo -- --prod` akan melakukannya sendiri karena penanda build lokal jadi tidak cocok) lalu buka lagi |
| Tiba-tiba jalan di SQLite padahal mau pakai Supabase | Salah satu dari `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, atau `SUPABASE_SERVICE_ROLE_KEY` belum terisi. Isi ketiganya (atau set `XLOOP_DB=supabase`) dan restart server |
| `better-sqlite3` gagal dimuat | Jalankan `npm install` di folder project (paket native, tidak ikut rusak saat `rm -rf .next`), lalu restart. Kalau tidak mau memakai mode SQLite sama sekali, isi env Supabase |
| Sidebar tidak tersembunyi / muncul lagi setelah refresh | Cookie preferensi `xloop_sidebar` diblokir atau dihapus (mode private, setting browser). Fitur tetap jalan selama sesi ini; kalau ingin diary, izinkan cookie pihak pertama untuk domain panel |
