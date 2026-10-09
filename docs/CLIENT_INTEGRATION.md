# Integrasi Sisi Tool — `/api/validate`

Dokumen ini untuk developer yang menanam validasi lisensi XLOOP PANEL di dalam tool/mod.
Endpoint-nya publik, tapi **client tidak pernah dipercaya**: semua keputusan diambil server,
dan setiap response sukses ditandatangani digital (Ed25519) serta terikat ke `nonce` + `hardware_id`
milik request itu.

- [1. Ringkas alur](#1-ringkas-alur)
- [2. Request](#2-request)
- [3. Response](#3-response)
- [4. Alur verifikasi yang benar (8 langkah)](#4-alur-verifikasi-yang-benar-8-langkah)
- [5. Contoh kode](#5-contoh-kode)
- [6. Daftar alasan gagal](#6-daftar-alasan-gagal)
- [7. Rate limit, anti-bruteforce, dan auto-ban](#7-rate-limit-anti-bruteforce-dan-auto-ban)
- [8. Catatan jujur soal anti-bypass](#8-catatan-jujur-soal-anti-bypass)

---

## 1. Ringkas alur

```
tool                              server (XLOOP PANEL)
 │  POST /api/validate                          │
 │  { key, tool_slug, tool_version,             │
 │    hardware_id, nonce }  ──────────────────► │  rate limit → cek key → status → tool
 │                                              │  → version → expired → slot HWID (atomic)
 │                                              │  → last_used → tanda tangani payload
 │  ◄────── { payload: base64, signature: base64 }
 │
 ├─ verifikasi signature dengan public key yang ditanam di tool
 ├─ decode payload, cek nonce + hardware_id + tool + version
 ├─ hitung ttl, jadwalkan validasi ulang (timer lokal)
 └─ pakai secret_payload untuk menjalankan tool (di memori saja)
```

Kalau langkah verifikasi mana pun gagal → **anggap gagal**. Tidak ada "mode offline" atau
"coba lagi tanpa signature".

---

## 2. Request

```
POST {PANEL_URL}/api/validate
Content-Type: application/json
```

```json
{
  "key": "XLVP-AB12-CD34",
  "tool_slug": "perkakas-pro",
  "tool_version": "1.8.0",
  "hardware_id": "sha256_hash_of_device_info",
  "nonce": "random_string_baru_tiap_request"
}
```

| Field | Aturan |
|---|---|
| `key` | Regex `^XLVP-[A-Z0-9]{4}-[A-Z0-9]{4}$` (huruf besar) |
| `tool_slug` | Maks 64 karakter, huruf kecil/angka/tanda hubung. Harus sama dengan slug tool di panel |
| `tool_version` | Maks 64 karakter. Harus sama persis dengan nama version di panel |
| `hardware_id` | 16–128 karakter, tanpa spasi. Sebaiknya `sha256` dari info device |
| `nonce` | 16–64 karakter, `[A-Za-z0-9_-]`. **Wajib baru di setiap request** |

Body maksimal **2 KB**. Field yang tidak valid → `HTTP 400 {"valid": false, "reason": "invalid_request"}`.
Tidak ada header CORS wildcard di endpoint ini — kalau tool kamu berbasis browser, panggil lewat
backend/proxy milikmu sendiri.

Contoh pembuatan nonce & HWID:

```python
# Python
import hashlib, platform, secrets, os, uuid

def compute_hardware_id() -> str:
    raw = "|".join([platform.node(), platform.machine(), platform.processor(), str(uuid.getnode())])
    return hashlib.sha256(raw.encode()).hexdigest()

def new_nonce() -> str:
    return secrets.token_urlsafe(24)[:43]   # 43 karakter, cocok dengan ^[A-Za-z0-9_-]{16,64}$
```

```js
// JavaScript (Node)
import { createHash, randomBytes } from "node:crypto";
import { hostname, platform, arch } from "node:os";

export const computeHardwareId = () =>
  createHash("sha256").update([hostname(), platform(), arch()].join("|")).digest("hex");

export const newNonce = () => randomBytes(18).toString("base64url");
```

---

## 3. Response

### Sukses (ditandatangani)

```json
{
  "payload": "<base64 dari JSON payload>",
  "signature": "<base64 signature Ed25519 atas byte JSON payload>"
}
```

Isi `payload` setelah di-decode:

```json
{
  "valid": true,
  "tool": "perkakas-pro",
  "version": "1.8.0",
  "expired_at": "2026-12-31T00:00:00.000Z",
  "max_device": 1,
  "current_devices": 1,
  "hardware_id": "<sama persis dengan request>",
  "nonce": "<sama persis dengan request>",
  "server_time": "2026-10-04T03:00:00.000Z",
  "token_expires_at": "2026-10-04T03:15:00.000Z",
  "secret_payload": "<isi tabel tool_secrets, atau null>"
}
```

- Signature dihitung **atas byte JSON payload sebelum di-encode base64**:
  `signature = Ed25519_sign(JSON.stringify(payload))`.
- `token_expires_at` = `server_time` + `LICENSE_TOKEN_TTL_SECONDS` (default 900 detik).
- `secret_payload` adalah data rahasia milik tool (config, kunci dekripsi, potongan data yang
  dibutuhkan tool supaya bisa jalan). Server hanya mengirimnya setelah semua validasi lolos.

### Gagal (TIDAK ditandatangani)

```json
{ "valid": false, "reason": "key_expired" }
```

Semua response yang bukan sukses-bertanda-tangan-valid **wajib** dianggap gagal.

---

## 4. Alur verifikasi yang benar (8 langkah)

1. **Buat nonce random baru setiap request.** Jangan simpan atau pakai ulang nonce.
2. **Kirim request** ke `/api/validate` dengan `key`, `tool_slug`, `tool_version`, `hardware_id`, `nonce`.
3. **Verifikasi `signature`** pakai public key yang ditanam di tool. Kalau signature tidak valid →
   anggap gagal, jangan decode payload untuk "dipakai".
4. **Decode `payload`**, lalu cek: `valid == true`, `nonce` sama dengan yang dikirim,
   `hardware_id` sama dengan yang dikirim, `tool` dan `version` sesuai dengan tool yang berjalan.
5. **Hitung `ttl = token_expires_at - server_time`**, lalu pakai timer lokal untuk menentukan kapan
   harus validasi ulang. Jangan bergantung pada jam sistem device (user bisa mengubah jam).
   Kalau validasi ulang gagal → tool berhenti.
6. **Pakai `secret_payload`** sebagai bagian yang dibutuhkan tool untuk jalan. Simpan di memori saja,
   jangan ditulis ke disk, jangan di-log.
7. **Sebar pengecekan di beberapa titik kode** — jangan hanya satu fungsi `isValid()` yang gampang
   di-patch. Minimal: sebelum membuka fitur, sebelum mengambil data rahasia, dan tepat sebelum
   data rahasia dipakai.
8. **Sadari batasnya** — lihat [bagian 8](#8-catatan-jujur-soal-anti-bypass).

---

## 5. Contoh kode

Contoh lengkap yang **siap dijalankan** ada di folder ini:

| File | Isi |
|---|---|
| [`examples/verify_example.py`](examples/verify_example.py) | Client Python lengkap (nonce, request, verifikasi signature, timer refresh, secret di memori) |
| [`examples/verify_example.js`](examples/verify_example.js) | Versi JavaScript/Node dengan `node:crypto` |
| [`examples/sample-response.json`](examples/sample-response.json) | Response contoh yang benar-benar ditandatangani, untuk menguji verifier tanpa server |

Uji kode verifier tanpa menunggu deploy:

```bash
# di root project
node scripts/make-sample-response.mjs          # regenerasi sample + dev keypair

cd docs/examples
pip install requests cryptography
python verify_example.py --sample sample-response.json
node verify_example.js --sample sample-response.json
```

Keduanya akan mencetak `Signature: VALID`, lalu mencoba memalsukan signature dan memastikan
pemalsuan itu **ditolak**.

Setelah panel dideploy, arahkan ke endpoint asli:

```bash
python verify_example.py \
  --url https://panel-kamu.vercel.app \
  --key XLVP-AB12-CD34 \
  --tool perkakas-pro \
  --version 1.8.0 \
  --public-key-file ./public_key.pem
```

### Cuplikan verifikasi signature

```python
# Python — signature = Ed25519 atas byte JSON payload (sebelum base64)
from cryptography.hazmat.primitives.serialization import load_pem_public_key
import base64, json

payload_bytes = base64.b64decode(data["payload"])
signature = base64.b64decode(data["signature"])

public_key.verify(signature, payload_bytes)      # raise InvalidSignature kalau palsu
payload = json.loads(payload_bytes.decode("utf-8"))
assert payload["nonce"] == nonce
assert payload["hardware_id"] == hardware_id
```

```js
// JavaScript — node:crypto
import { createPublicKey, verify } from "node:crypto";

const payloadBytes = Buffer.from(data.payload, "base64");
const ok = verify(null, payloadBytes, createPublicKey(publicKeyPem), Buffer.from(data.signature, "base64"));
if (!ok) throw new Error("signature tidak valid");

const payload = JSON.parse(payloadBytes.toString("utf8"));
if (payload.nonce !== nonce || payload.hardware_id !== hardwareId) throw new Error("payload tidak cocok");
```

### Cara menanam public key di tool

1. Jalankan `npm run generate-keypair` di project panel (atau ambil dari
   Tool Management → kotak **Public key verifikasi**).
2. Simpan sebagai file `public_key.pem` di samping binary tool kamu, atau tempel sebagai string
   di kode. Public key **boleh** dibaca siapa pun — yang tidak boleh beredar hanya private key.
3. Public key dipakai hanya untuk verifikasi; ia tidak bisa dipakai membuat signature baru.

---

## 6. Daftar alasan gagal

| `reason` | HTTP | Arti |
|---|---|---|
| `invalid_request` | 400 | Body/format tidak valid (panjang, regex, JSON rusak, body > 2 KB) |
| `invalid_key` | 200 | Key tidak ditemukan di database |
| `key_expired` | 200 | Sudah melewati tanggal expired |
| `key_banned` | 200 | Key dibanned (manual oleh Owner, atau auto-ban device berbeda) |
| `wrong_tool` | 200 | `tool_slug` tidak cocok, atau tool sedang nonaktif |
| `wrong_version` | 200 | `tool_version` tidak cocok, atau version sedang nonaktif |
| `device_limit_exceeded` | 200 | Slot device penuh dan HWID ini belum terdaftar |
| `rate_limited` | 429 | Terlalu banyak request (lihat bagian 7) |

Kalau server sedang bermasalah (mis. key tanda tangan tidak siap), response-nya
`{"valid": false, "reason": "server_error"}` dengan HTTP 500 — perlakukan sebagai gagal, lalu coba lagi
nanti dengan jeda (jangan spam).

---

## 7. Rate limit, anti-bruteforce, dan auto-ban

- Semua request dicatat di tabel `validation_attempts` (ip, key, hwid, sukses/gagal, reason) dan
  otomatis dihapus setelah 7 hari lewat cron harian.
- **30 request/menit per IP** dan **15 request/menit per key**. Lewat batas → `HTTP 429 rate_limited`.
- **Anti-bruteforce:** kalau satu IP mengirim 5 `invalid_key` dalam 10 menit, semua kegagalan
  berikutnya dari IP itu dikembalikan sebagai `invalid_key` saja (agar pelaku tidak bisa memetakan
  mana key valid, mana tool/version yang salah).
- **Auto-ban:** kalau satu key ditolak `device_limit_exceeded` oleh 5 HWID berbeda dalam 1 jam,
  key otomatis dibanned dengan catatan "Auto-ban: terlalu banyak device berbeda" dan
  `ban_reason = auto_hwid`. Auto-ban tercatat di Audit Log sebagai aksi `system` (lengkap dengan
  IP pemicu), dan **unban-nya hanya bisa oleh Owner** — reseller akan menerima `403` kalau mencoba
  unban dari panel.

Konsekuensinya untuk tool kamu: jangan validasi ulang lebih sering dari ttl yang diberikan
(default 15 menit), dan tangani `429` dengan backoff.

---

## 8. Catatan jujur soal anti-bypass

Kode yang berjalan di device user **tidak bisa 100% anti-bypass**. User selalu bisa mem-patch binary,
meng-hook fungsi verifikasi, atau mem-bypass HTTP client-nya.

Tujuan desain ini bukan membuat bypass mustahil, tapi membuatnya **sulit dan mahal**:

- Server adalah satu-satunya sumber kebenaran; semua keputusan ada di sana.
- Response sukses ditandatangani Ed25519 — patch `false` → `true` di client tidak menghasilkan
  signature yang valid, dan memalsukan signature tanpa private key tidak mungkin.
- Signature terikat ke `nonce` + `hardware_id` request, jadi response valid dari device lain tidak
  bisa dipakai ulang (replay).
- Token punya masa berlaku singkat, jadi hasil patch harus dipertahankan terus-menerus.
- `secret_payload` hanya dikirim saat validasi lolos; tanpa data itu tool tidak bisa jalan penuh —
  jadi "meloloskan validasi" saja tidak cukup.
- Pengecekan disebar di beberapa titik, sehingga satu patch tidak membuka semuanya.

Yang tetap harus kamu lakukan: rotasi keypair kalau private key bocor, pantau `validation_attempts`,
dan jangan pernah menaruh private key di sisi client.
