/**
 * Aturan **pengembalian credit saat key dihapus**.
 *
 * Kalau Owner (teledor) menghapus key milik reseller yang **masih aktif dan belum expired**,
 * credit yang sudah dipakai untuk key itu dikembalikan ke reseller tersebut. Supaya adil tanpa
 * membuka celah penyalahgunaan, syaratnya ketat:
 *
 * 1. yang menghapus harus **Owner** (bukan reseller yang menghapus key-nya sendiri);
 * 2. key harus **milik reseller** (key buatan Owner tidak pernah dipotong credit);
 * 3. status key harus **`active`** — key `expired` atau `banned` tidak dikembalikan;
 * 4. **belum lewat** tanggal expired (key Lifetime selalu dianggap belum expired);
 * 5. `credit_cost` key > 0 (memang ada credit yang dibayarkan).
 *
 * Selain kondisi di atas: **tidak ada pengembalian sama sekali**.
 *
 * File ini murni (tanpa import server) supaya server dan modal konfirmasi di browser
 * memakai perhitungan yang sama.
 */

export interface RefundCandidate {
  status: string;
  expired_at: string | null;
  created_by: string;
  credit_cost: number;
}

export interface RefundViewer {
  userId: string;
  isOwner: boolean;
}

/** Apakah key ini akan mendapat pengembalian credit kalau dihapus oleh `viewer`? */
export function isKeyRefundableOnDelete(
  key: RefundCandidate,
  viewer: RefundViewer,
  now: number = Date.now(),
): boolean {
  if (!viewer.isOwner) return false;
  if (!key.created_by || key.created_by === viewer.userId) return false;
  if (key.status !== "active") return false;
  if (key.expired_at && new Date(key.expired_at).getTime() <= now) return false;
  return refundAmount(key) > 0;
}

/** Jumlah credit yang dikembalikan: seluruh credit yang dipakai untuk key ini. */
export function refundAmount(key: Pick<RefundCandidate, "credit_cost">): number {
  const value = Number(key.credit_cost);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}
