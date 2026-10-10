/**
 * Parser User-Agent sederhana → label perangkat yang mudah dibaca
 * ("Chrome · Android", "Safari · iPhone"). Tanpa dependency; cukup untuk
 * riwayat login (bukan analytics presisi). Murni, aman dipakai di client & server.
 */

export interface DeviceInfo {
  browser: string;
  os: string;
  /** Jenis perangkat kasar untuk ikon. */
  kind: "mobile" | "tablet" | "desktop" | "unknown";
  /** Label gabungan: "Chrome · Android". */
  label: string;
}

export function parseUserAgent(ua: string | null | undefined): DeviceInfo {
  const text = (ua ?? "").trim();
  if (!text) return { browser: "Tidak diketahui", os: "", kind: "unknown", label: "Tidak diketahui" };

  // --- OS ---
  let os = "";
  let kind: DeviceInfo["kind"] = "desktop";
  if (/iphone/i.test(text)) {
    os = "iPhone";
    kind = "mobile";
  } else if (/ipad/i.test(text)) {
    os = "iPad";
    kind = "tablet";
  } else if (/android/i.test(text)) {
    os = "Android";
    kind = /mobile/i.test(text) ? "mobile" : "tablet";
  } else if (/windows/i.test(text)) os = "Windows";
  else if (/mac os x|macintosh/i.test(text)) os = "macOS";
  else if (/cros/i.test(text)) os = "ChromeOS";
  else if (/linux/i.test(text)) os = "Linux";

  // --- Browser (urutan penting: Edge/Opera/Samsung memuat kata "Chrome") ---
  let browser = "Browser";
  if (/edg\//i.test(text)) browser = "Edge";
  else if (/opr\/|opera/i.test(text)) browser = "Opera";
  else if (/samsungbrowser/i.test(text)) browser = "Samsung Internet";
  else if (/brave/i.test(text)) browser = "Brave";
  else if (/firefox|fxios/i.test(text)) browser = "Firefox";
  else if (/chrome|crios/i.test(text)) browser = "Chrome";
  else if (/safari/i.test(text)) browser = "Safari";
  else if (/curl|wget|python|node|axios|postman/i.test(text)) {
    browser = "Skrip/API client";
    kind = "unknown";
  }

  const label = os ? `${browser} · ${os}` : browser;
  return { browser, os, kind, label };
}
