# API Publik Reseller (`/api/v1`)

Dokumentasi ini untuk **API key reseller** — dipakai bot, skrip, atau integrasi lain
untuk membuat key, cek saldo, dan reset HWID tanpa membuka panel.

Lihat juga [`CLIENT_INTEGRATION.md`](./CLIENT_INTEGRATION.md) untuk endpoint
**validasi lisensi** (`/api/validate`) yang dipanggil dari sisi tool/mod.

---

## 1. Membuat API key

1. Login ke panel sebagai reseller (atau Owner, untuk membuatkan milik reseller).
2. Buka **Pengaturan → API Key → Buat API key**.
   * Owner bisa memilih akun tujuan lewat field **Untuk akun**; reseller selalu
     membuat untuk dirinya sendiri.
3. Token ditampilkan **sekali saja** — simpan di password manager / secret manager.

Format token:

```
xlp_<12 hex karakter prefix>_<64 hex karakter rahasia>
```

Yang disimpan di database hanya **hash SHA-256** token, jadi token asli tidak bisa
dilihat lagi. Kalau token bocor: **Cabut** key-nya (langsung tidak berlaku), lalu
buat yang baru.

Batas: **5 API key aktif** per akun. Setiap key punya penghitung pemakaian
(`last_used_at`, `requests_count`) dan tercatat di activity log panel
(`api_key_create`, `api_key_revoke`).

## 2. Autentikasi & konvensi

Semua request memakai header berikut:

```http
Authorization: Bearer xlp_xxxxxxxxxxxx_xxxxxxxx…
Content-Type: application/json
```

`X-API-Key: <token>` juga diterima sebagai alternatif.

Semua respons JSON memakai amplop yang sama seperti panel:

```json
{ "ok": true,  "data": { } }
{ "ok": false, "error": "Pesan untuk manusia", "code": "validation_error", "details": {} }
```

| HTTP | `code` | Arti |
| --- | --- | --- |
| 400 | `validation_error` | Body/parameter tidak valid (lihat `error`) |
| 401 | `unauthorized` | Header tidak ada, token salah, atau key sudah dicabut |
| 403 | `forbidden` | Key/key-value bukan milik akun ini |
| 403 | `api_disabled` | Owner mematikan API publik di Pengaturan |
| 404 | `not_found` | Key atau endpoint tidak ditemukan |
| 409 | `insufficient_credit` | Saldo tidak cukup untuk generate |
| 429 | `rate_limited` | Melebihi `api.rateLimitPerMinute` (default 60/menit per key) |
| 429 | `hwid_reset_cooldown` | Kuota reset HWID habis (lihat `details.retry_after_seconds`) |
| 500 | `server_error` | Gangguan di sisi panel |

Setiap request dicatat di `api_request_logs` (metode, path, status, durasi, IP).
Rate limit dihitung per API key dari tabel itu.

## 3. Endpoint

### `GET /api/v1/me`

Profil pemilik key + batas yang berlaku (dari Pengaturan panel).

```json
{
  "ok": true,
  "data": {
    "user": { "id": "…", "username": "andi", "email": "…", "role": "reseller", "credit": 149, "is_active": true },
    "api_key": { "name": "Integrasi Discord", "token_prefix": "xlp_dafd226fe11b…", "created_at": "…", "last_used_at": null, "requests_count": 0 },
    "limits": {
      "rate_limit_per_minute": 60,
      "max_device_min": 1, "max_device_max": 10, "quantity_max": 50,
      "hwid_reset_limit": 3, "hwid_reset_window_hours": 24
    }
  }
}
```

### `GET /api/v1/tools`

Daftar tool aktif + versinya (versi aktif saja). Dipakai untuk mengisi
`tool_type_id` / `tool_version_id` saat generate.

```json
{ "ok": true, "data": { "tools": [ { "id": "…", "name": "Perkakas Pro", "slug": "perkakas-pro",
  "versions": [ { "id": "…", "name": "1.9.0" } ] } ] } }
```

### `GET /api/v1/presets`

Daftar preset durasi aktif. `days: null` berarti **Lifetime**.

```json
{ "ok": true, "data": { "presets": [ { "id": "…", "name": "1 Bulan", "days": 30, "label": "30 hari", "credit_cost": 20 } ] } }
```

### `GET /api/v1/keys`

Query: `status=active|expired|banned` (opsional), `page`, `per_page` (maks 100).

```json
{ "ok": true, "data": {
  "items": [ { "id": "…", "key_value": "XLVP-9FBP-248B", "status": "active", "tool_name": "Perkakas Pro",
               "version_name": "1.9.0", "expired_at": "2026-10-19T07:59:00.000Z", "max_device": 1,
               "devices": 1, "created_at": "…", "note": null } ],
  "total": 12, "page": 1, "per_page": 25, "total_pages": 1 } }
```

### `POST /api/v1/keys`

Generate key baru. Biaya = `credit_cost` preset × `quantity` × `max_device`.

```json
{
  "tool_type_id": "a1111111-0000-4000-8000-000000000001",
  "tool_version_id": "c1111111-0000-4000-8000-000000000002",
  "duration_preset_id": "e1111111-0000-4000-8000-000000000004",
  "quantity": 3,
  "max_device": 2,
  "note": "pesanan #123",
  "custom_days": 45
}
```

* `quantity` maks `50` (reseller) / `1000` (Owner) — lihat `limits.quantity_max`.
* `max_device` antara `limits.max_device_min` dan `limits.max_device_max`.
* `custom_days` **hanya untuk Owner** (durasi bebas, bukan preset).

Respons:

```json
{ "ok": true, "data": {
  "keys": [ { "id": "…", "key_value": "XLVP-TUST-P258", "expired_at": "…", "max_device": 1,
              "credit_cost": 1, "status": "active", "tool_name": "Perkakas Pro", "version_name": "1.9.0",
              "created_at": "…" } ],
  "summary": { "tool_name": "Perkakas Pro", "duration_label": "1 Hari", "duration_days": 1,
               "max_device": 1, "quantity": 1, "unit_price": 1, "credit_cost": 1,
               "credit_balance_after": 149 } } }
```

### `GET /api/v1/keys/{id|key_value}`

`{id}` boleh UUID key **atau** nilai key (`XLVP-XXXX-XXXX`) — lebih praktis untuk bot.

```json
{ "ok": true, "data": {
  "key": { "id": "…", "key_value": "XLVP-9FBP-248B", "status": "active", "expired_at": "…",
           "max_device": 1, "tool_name": "Perkakas Pro", "version_name": "1.9.0", "note": null,
           "ban_reason": null, "last_used_at": "…", "created_at": "…" },
  "devices": [ { "id": "…", "hardware_id": "bbbbab12cd34ef56ab12cd34ef56", "first_seen": "…", "last_seen": "…" } ],
  "cooldown": { "used": 1, "limit": 3, "remaining": 2, "window_hours": 24,
                "window_start": "…", "next_reset_at": null, "retry_after_seconds": null },
  "reset_endpoint": "POST /api/v1/keys/XLVP-9FBP-248B/hwid-reset" } }
```

`cooldown` bernilai `null` untuk Owner (tidak dibatasi kuota). Reseller mengikuti
`hwid_reset_limit` / `hwid_reset_window_hours` dari Pengaturan.

### `POST /api/v1/keys/{id|key_value}/hwid-reset`

Reset device (HWID) sebuah key.

```bash
# reset SEMUA device
curl -X POST https://panel.example.com/api/v1/keys/XLVP-9FBP-248B/hwid-reset \
  -H "Authorization: Bearer $XLOOP_API_KEY" -H "Content-Type: application/json" \
  -d '{"all": true}'

# reset SATU device
curl -X POST https://panel.example.com/api/v1/keys/XLVP-9FBP-248B/hwid-reset \
  -H "Authorization: Bearer $XLOOP_API_KEY" -H "Content-Type: application/json" \
  -d '{"hardware_id": "bbbbab12cd34ef56ab12cd34ef56"}'
```

Body boleh **kosong** — diperlakukan sebagai `{"all": true}`.

Sukses → `{ "ok": true, "data": { "reset": true, "removed": 1, "hardware_id": null, "scope": "all",
"max_device": 1, "cooldown": { … } } }`.

Kuota cooldown berlaku sama seperti di panel; kalau habis → **429**
`hwid_reset_cooldown` dengan `details.retry_after_seconds`. Setiap reset tercatat di
audit log panel (`hwid_reset` / `hwid_reset_all`).

### `GET /api/v1/credits`

Riwayat credit akun pemilik key + saldo terkini. Query: `action`, `from`, `to`,
`page`, `per_page`.

```json
{ "ok": true, "data": { "balance": 149, "items": [
  { "id": "…", "created_at": "…", "action": "generate", "amount": -1, "balance_after": 149, "note": "via API" } ] } }
```

`action`: `topup`, `generate`, `extend`, `refund`, `adjustment`.

## 4. Contoh alur lengkap

```bash
export XLOOP_API_KEY="xlp_xxxxxxxxxxxx_xxxxxxxx…"
BASE="https://panel.example.com"

# 1. cek saldo & limit
curl -s "$BASE/api/v1/me" -H "Authorization: Bearer $XLOOP_API_KEY" | jq .data.user.credit

# 2. pilih tool, versi, dan preset
curl -s "$BASE/api/v1/tools"   -H "Authorization: Bearer $XLOOP_API_KEY" | jq '.data.tools[0]'
curl -s "$BASE/api/v1/presets" -H "Authorization: Bearer $XLOOP_API_KEY" | jq '.data.presets'

# 3. generate 1 key
curl -s -X POST "$BASE/api/v1/keys" -H "Authorization: Bearer $XLOOP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tool_type_id":"…","tool_version_id":"…","duration_preset_id":"…","quantity":1,"max_device":1}' | jq .

# 4. reset HWID kalau user ganti perangkat
curl -s -X POST "$BASE/api/v1/keys/XLVP-9FBP-248B/hwid-reset" \
  -H "Authorization: Bearer $XLOOP_API_KEY" -H "Content-Type: application/json" -d '{"all":true}' | jq .
```

## 5. Catatan operasional

* **Rate limit** dihitung per API key (default 60 request/menit) — Owner bisa
  mengubahnya di **Pengaturan → API publik**. Melebihi batas → 429; tunggu satu menit.
* **Saklar utama**: kalau Owner mematikan API publik, semua endpoint menjawab 403
  `api_disabled`.
* **Audit**: generate & reset HWID lewat API tercatat sama seperti aksi dari panel
  (audit log + activity log), jadi jejaknya tetap bisa diperiksa.
* **Anti-abuse**: percobaan `/api/validate` dari tool tetap tunduk pada rate limit
  per IP/key, masking brute-force, dan auto-ban (lihat `VERIFICATION.md` §9).
* **Rotasi token**: cabut key lama lalu buat baru. Satu akun boleh punya sampai 5 key
  aktif — berguna untuk memisahkan integrasi (bot, skrip laporan, dsb).
