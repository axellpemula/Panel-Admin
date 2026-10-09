/**
 * Rate limit percobaan login — proteksi brute-force password.
 *
 * Kenapa perlu: di mode Supabase, Supabase Auth sudah membatasi percobaan login
 * di level platform. Di mode SQLite tidak ada itu, dan /api/auth/login membuka
 * verifikasi password scrypt ke publik — tanpa batas, password bisa ditebak
 * unlimited dari satu IP.
 *
 * Desain:
 * - Limit per IP (bukan per akun) supaya satu akun tidak bisa dikunci oleh
 *   orang lain, dan satu IP tidak bisa menebak banyak akun.
 * - Yang dihitung hanya percobaan GAGAL; login sukses menghapus riwayat IP itu.
 * - Window geser 10 menit, maksimal 10 gagal. Melewati itu → 429.
 * - In-memory per proses: di mode SQLite panel jalan sebagai satu proses
 *   (dev/`next start`), jadi efektif. Di serverless (mode Supabase) bersifat
 *   best-effort per instance — Supabase Auth tetap jadi pengaman utama.
 */

/** Maksimal percobaan gagal sebelum IP diblokir sementara. */
const MAX_FAILURES = 10;
/** Window blokir dalam milidetik (10 menit). */
const WINDOW_MS = 10 * 60 * 1000;
/** Batas ukuran map sebelum dibersihkan paksa (anti memory-leak). */
const PRUNE_THRESHOLD = 1_000;

interface FailureWindow {
  failures: number;
  resetAt: number;
}

const failuresByIp = new Map<string, FailureWindow>();
let pruneCounter = 0;

/**
 * Hapus entri kedaluwarsa (dipanggil saat ada percobaan baru).
 *
 * Kita selalu iterasi kalau ukuran map kecil (< PRUNE_THRESHOLD) untuk mencegah
 * memory leak pada proses yang berjalan lama (next start). Di atas threshold,
 * iterasi penuh memang wajib supaya map tidak tumbuh tak terbatas.
 */
function prune(now: number): void {
  pruneCounter += 1;
  if (failuresByIp.size < PRUNE_THRESHOLD && pruneCounter % 100 !== 0) return;
  for (const [ip, window] of failuresByIp) {
    if (window.resetAt <= now) failuresByIp.delete(ip);
  }
}

export interface LoginGuardResult {
  allowed: boolean;
  /** Sisa waktu blokir dalam detik (0 kalau diizinkan). */
  retryAfterSeconds: number;
}

/** Cek sebelum memproses login: apakah IP ini sedang diblokir? */
export function checkLoginAttempt(ip: string): LoginGuardResult {
  const now = Date.now();
  prune(now);

  const window = failuresByIp.get(ip);
  if (!window || window.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
  if (window.failures < MAX_FAILURES) return { allowed: true, retryAfterSeconds: 0 };

  return { allowed: false, retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000) };
}

/** Catat satu percobaan login GAGAL dari IP. */
export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  prune(now);

  const window = failuresByIp.get(ip);
  if (!window || window.resetAt <= now) {
    failuresByIp.set(ip, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }
  window.failures += 1;
}

/** Login sukses → riwayat gagal IP ini direset. */
export function clearLoginFailures(ip: string): void {
  failuresByIp.delete(ip);
}
