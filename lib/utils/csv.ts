/**
 * Helper CSV sederhana (RFC 4180) + BOM supaya rapi dibuka di Excel.
 */

/**
 * Karakter awal yang membuat Excel/LibreOffice menafsirkan sel sebagai FORMULA
 * (CSV injection): =, +, -, @, tab, CR. Dikutip saja tidak cukup — Excel tetap
 * menjalankan isi sel yang diawali `=`.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Angka apa adanya — kolom numerik harus tetap terbaca sebagai angka.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  // Awalan ' (apostrof) = penanda teks di Excel, sehingga formula tidak dijalankan.
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  if (/[",\n\r;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  rows.forEach((row) => {
    lines.push(row.map(csvEscape).join(","));
  });
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
