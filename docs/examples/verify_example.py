#!/usr/bin/env python3
"""
XLOOP PANEL — contoh verifikasi lisensi sisi client (Python).

Alur yang benar:
  1. Buat nonce random BARU di setiap request.
  2. Kirim request ke /api/validate.
  3. Verifikasi `signature` pakai public key yang ditanam di tool.
     Kalau signature tidak valid -> anggap gagal (jangan lanjut).
  4. Decode `payload`, cek valid == True, nonce & hardware_id sama dengan yang
     dikirim, serta tool & version sesuai.
  5. Hitung ttl = token_expires_at - server_time, lalu pakai timer lokal untuk
     menentukan kapan validasi ulang. Jangan bergantung pada jam device.
  6. Pakai `secret_payload` sebagai bagian yang dibutuhkan tool untuk jalan.
     Simpan di memori saja, jangan ditulis ke disk.

Pemakaian:
  # Menguji verifier dengan response contoh (tanpa server):
  python verify_example.py --sample ../examples/sample-response.json

  # Memanggil panel yang sudah dideploy:
  python verify_example.py \
      --url https://panel-kamu.vercel.app/api/validate \
      --key XLVP-AB12-CD34 \
      --tool perkakas-pro \
      --version 1.8.0 \
      --public-key-file ./public_key.pem

Dependensi: pip install requests cryptography
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import secrets
import sys
import threading
import time
import uuid
from dataclasses import dataclass

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.serialization import load_pem_public_key
except ImportError:  # pragma: no cover
    print("Butuh paket 'cryptography': pip install cryptography", file=sys.stderr)
    raise SystemExit(2)

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None


# ---------------------------------------------------------------------------
# 1. HWID: hash dari info device (jangan kirim info mentah ke server)
# ---------------------------------------------------------------------------
def compute_hardware_id() -> str:
    """sha256 dari info perangkat — stabil, 64 karakter heksadesimal."""
    raw = "|".join(
        [
            platform.node(),
            platform.machine(),
            platform.processor(),
            str(uuid.getnode()),  # MAC address
            os.environ.get("COMPUTERNAME", ""),
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_nonce() -> str:
    """Nonce baru setiap request: 16–64 karakter [A-Za-z0-9_-]."""
    return secrets.token_urlsafe(24)[:43]


# ---------------------------------------------------------------------------
# 2. Verifier: signature, payload, masa berlaku
# ---------------------------------------------------------------------------
@dataclass
class LicenseState:
    valid: bool = False
    secret_payload: str | None = None
    token_expires_at: float = 0.0
    reason: str | None = None


class XloopLicense:
    def __init__(self, base_url: str, public_key_pem: str, key: str, tool_slug: str, tool_version: str):
        self.base_url = base_url.rstrip("/")
        self.public_key: Ed25519PublicKey = load_pem_public_key(public_key_pem.encode("utf-8"))  # type: ignore[assignment]
        self.key = key
        self.tool_slug = tool_slug
        self.tool_version = tool_version
        self.hardware_id = compute_hardware_id()
        self.state = LicenseState()
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None

    # -- verifikasi tanda tangan -------------------------------------------
    def verify_signature(self, payload_b64: str, signature_b64: str) -> bytes:
        """Raises ValueError kalau signature tidak valid."""
        # Terima base64 standar maupun base64url.
        payload = base64.b64decode(payload_b64.replace("-", "+").replace("_", "/") + "===")
        signature = base64.b64decode(signature_b64.replace("-", "+").replace("_", "/") + "===")
        try:
            self.public_key.verify(signature, payload)  # type: ignore[arg-type]
        except Exception as exc:  # InvalidSignature
            raise ValueError("signature tidak valid") from exc
        return payload

    # -- satu siklus validasi ----------------------------------------------
    def validate_once(self, nonce: str | None = None) -> LicenseState:
        if requests is None:
            raise RuntimeError("Paket 'requests' belum terpasang: pip install requests")

        nonce = nonce or new_nonce()
        body = {
            "key": self.key,
            "tool_slug": self.tool_slug,
            "tool_version": self.tool_version,
            "hardware_id": self.hardware_id,
            "nonce": nonce,
        }

        response = requests.post(f"{self.base_url}/api/validate", json=body, timeout=15)
        data = response.json()

        if not data.get("valid"):
            # Semua response yang bukan sukses-bertanda-tangan-valid = gagal.
            return LicenseState(valid=False, reason=str(data.get("reason", "unknown")))

        payload_bytes = self.verify_signature(data["payload"], data["signature"])
        payload = json.loads(payload_bytes.decode("utf-8"))

        # Cek isi payload benar-benar milik request ini.
        if payload.get("valid") is not True:
            return LicenseState(valid=False, reason="payload_not_valid")
        if payload.get("nonce") != nonce:
            return LicenseState(valid=False, reason="nonce_mismatch")
        if payload.get("hardware_id") != self.hardware_id:
            return LicenseState(valid=False, reason="hwid_mismatch")
        if payload.get("tool") != self.tool_slug or payload.get("version") != self.tool_version:
            return LicenseState(valid=False, reason="tool_version_mismatch")

        # 5. ttl dihitung dari server_time, bukan jam lokal device.
        try:
            server_time = _parse_iso(payload["server_time"])
            token_expires_at = _parse_iso(payload["token_expires_at"])
        except Exception:
            return LicenseState(valid=False, reason="invalid_time")

        ttl = token_expires_at - server_time
        if ttl <= 0:
            return LicenseState(valid=False, reason="token_ttl_invalid")

        # secret_payload hanya disimpan di memori proses ini.
        with self._lock:
            self.state = LicenseState(
                valid=True,
                secret_payload=payload.get("secret_payload"),
                token_expires_at=time.time() + ttl,
                reason=None,
            )
            self._schedule_refresh(ttl)

        return self.state

    def _schedule_refresh(self, ttl: float) -> None:
        """Jadwalkan validasi ulang sebelum token habis (pakai timer lokal)."""
        if self._timer is not None:
            self._timer.cancel()
        interval = max(30.0, ttl * 0.75)
        self._timer = threading.Timer(interval, self._refresh)
        self._timer.daemon = True
        self._timer.start()

    def _refresh(self) -> None:
        try:
            state = self.validate_once()
            if not state.valid:
                # Validasi ulang gagal -> tool berhenti.
                with self._lock:
                    self.state = LicenseState(valid=False, reason=state.reason)
                print(f"[license] validasi ulang gagal: {state.reason}", file=sys.stderr)
        except Exception as exc:  # jaringan mati / server error
            with self._lock:
                self.state = LicenseState(valid=False, reason=f"refresh_error: {exc}")

    # -- 7. Pengecekan disebar di beberapa titik kode ----------------------
    def _check(self) -> LicenseState:
        with self._lock:
            state = self.state
        if not state.valid:
            raise PermissionError(f"Lisensi tidak valid ({state.reason})")
        if time.time() > state.token_expires_at:
            with self._lock:
                self.state = LicenseState(valid=False, reason="token_expired")
            raise PermissionError("Token validasi sudah kedaluwarsa, jalankan validasi ulang")
        return state

    def is_feature_enabled(self, feature: str) -> bool:
        """Pemeriksaan #1: sebelum membuka fitur."""
        state = self._check()
        if not state.secret_payload:
            return False
        return feature in state.secret_payload

    def get_secret_payload(self) -> str:
        """Pemeriksaan #2: sebelum mengambil data rahasia yang dibutuhkan tool."""
        return self._check().secret_payload or ""

    def get_decryption_key(self, name: str) -> str:
        """Pemeriksaan #3: tepat sebelum data rahasia dipakai."""
        payload = self._check().secret_payload or "{}"
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            return ""
        return str(parsed.get(name, ""))


def _parse_iso(value: str) -> float:
    """ISO-8601 (…Z) -> epoch seconds, tanpa bergantung jam device."""
    cleaned = value.replace("Z", "+00:00")
    from datetime import datetime

    return datetime.fromisoformat(cleaned).timestamp()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="Contoh verifikasi lisensi XLOOP PANEL")
    parser.add_argument("--url", help="Base URL panel, contoh https://panel.vercel.app")
    parser.add_argument("--key", help="Key lisensi (XLVP-XXXX-XXXX)")
    parser.add_argument("--tool", default="perkakas-pro", help="tool_slug")
    parser.add_argument("--version", dest="tool_version", default="1.8.0", help="tool_version")
    parser.add_argument("--public-key-file", default="public_key.pem", help="File public key PEM")
    parser.add_argument("--sample", help="Uji verifier dengan file sample-response.json")
    parser.add_argument("--hwid", help="Override hardware_id (untuk uji coba)")
    args = parser.parse_args()

    if args.sample:
        sample = json.load(open(args.sample, encoding="utf-8"))
        public_pem = sample["public_key_pem"]
        client = XloopLicense("http://localhost:1", public_pem, "XLVP-AB12-CD34", "perkakas-pro", "1.8.0")
        if args.hwid:
            client.hardware_id = args.hwid
        else:
            client.hardware_id = sample["request"]["hardware_id"]

        payload_bytes = client.verify_signature(
            sample["response"]["payload"], sample["response"]["signature"]
        )
        payload = json.loads(payload_bytes.decode("utf-8"))
        print("Signature: VALID")
        print(json.dumps(payload, indent=2)[:600])
        print("\nUji signature yang dirusak…")
        tampered = bytearray(base64.b64decode(sample["response"]["signature"]))
        tampered[0] ^= 0xFF
        try:
            client.verify_signature(sample["response"]["payload"], base64.b64encode(bytes(tampered)).decode())
            print("GAGAL: signature dirusak tapi tetap dianggap valid!")
            return 1
        except ValueError:
            print("Signature dirusak: DITOLAK (benar)")
        return 0

    if not args.url or not args.key:
        parser.error("butuh --url dan --key (atau pakai --sample)")

    public_pem = open(args.public_key_file, encoding="utf-8").read()
    client = XloopLicense(args.url, public_pem, args.key, args.tool, args.tool_version)
    if args.hwid:
        client.hardware_id = args.hwid

    state = client.validate_once()
    if not state.valid:
        print(f"Lisensi TIDAK valid: {state.reason}")
        return 1

    print("Lisensi valid. Contoh pemakaian secret:")
    print("  is_feature_enabled('core'):", client.is_feature_enabled("core"))
    print("  kunci_dekripsi tersedia   :", bool(client.get_decryption_key("kunci_dekripsi")))

    # Tunggu sedikit supaya timer refresh terlihat jalan.
    time.sleep(1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
