/**
 * Model harga credit XLOOP PANEL.
 *
 * **1 unit harga = 1 key × 1 device.**
 *
 * Dari situ turunannya:
 * - **Generate key**   : `harga_preset × quantity × max_device`
 * - **Perpanjang key** : `harga_preset × max_device` — semua device yang terdaftar di key itu
 *   ikut menikmati periode baru, jadi dihitung sebagai satu unit per device.
 * - **Tambah max device** lewat Edit Key: device baru dihitung unit baru, jadi biayanya naik
 *   (`harga_preset × max_device baru`, sekalian memperpanjang durasi).
 *
 * Owner tidak pernah dipotong credit: semua aksi Owner gratis tanpa memandang jumlah device.
 *
 * File ini murni (tanpa import Node/server) supaya bisa dipakai di server (API route) maupun
 * di browser (estimasi biaya di form).
 */

/** Kalimat singkat yang ditampilkan di UI supaya aturan harga tidak perlu dihafal. */
export const CREDIT_UNIT_RULE = "1 unit harga = 1 key × 1 device";

/** Biaya pembuatan key: harga preset × jumlah key × jumlah device per key. */
export function generateCreditCost(unitPrice: number, quantity: number, maxDevice: number): number {
  return safeUnits(unitPrice) * safeCount(quantity) * safeCount(maxDevice);
}

/** Biaya perpanjangan sebuah key (device yang terdaftar ikut diperpanjang). */
export function extendCreditCost(unitPrice: number, maxDevice: number): number {
  return safeUnits(unitPrice) * safeCount(maxDevice);
}

/**
 * Rincian biaya dalam bentuk teks, mis. `2 key × 3 device × 15 credit = 90 credit`.
 * Dipakai di modal edit key, form generate, dan pesan error `insufficient_credit`.
 */
export function creditCostBreakdown(
  unitPrice: number,
  quantity: number,
  maxDevice: number,
  perKeyLabel = "key",
): string {
  const total = generateCreditCost(unitPrice, quantity, maxDevice);
  const deviceFactor = safeCount(maxDevice) > 1 ? ` × ${safeCount(maxDevice)} device` : "";
  return `${safeCount(quantity)} ${perKeyLabel}${deviceFactor} × ${safeUnits(unitPrice)} credit = ${total} credit`;
}

/** Jumlah unit tidak boleh negatif / pecahan (harga & device selalu bilangan bulat). */
function safeUnits(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.trunc(value);
}

function safeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.trunc(value);
}
