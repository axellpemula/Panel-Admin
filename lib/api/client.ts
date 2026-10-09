"use client";

/**
 * Helper fetch untuk semua pemanggilan API panel dari browser.
 * Semua operasi tulis HARUS lewat /api/*, bukan langsung ke Supabase.
 */

export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  details?: Record<string, unknown>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  let payload: ApiEnvelope<T> | null = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      payload = null;
    }
  }

  if (response.status === 401) {
    // Sesi habis → kembali ke login.
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login?error=session";
    }
    throw new ApiClientError("Sesi berakhir. Silakan login lagi.", 401, "unauthorized");
  }

  if (!response.ok || !payload || payload.ok !== true) {
    const message = payload?.error ?? `Request gagal (${response.status})`;
    throw new ApiClientError(message, response.status, payload?.code ?? "server_error", payload?.details);
  }

  return payload.data as T;
}

export const apiGet = <T>(url: string): Promise<T> => request<T>(url, { method: "GET" });

export const apiPost = <T>(url: string, body?: unknown): Promise<T> =>
  request<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) });

export const apiPut = <T>(url: string, body?: unknown): Promise<T> =>
  request<T>(url, { method: "PUT", body: JSON.stringify(body ?? {}) });

export const apiDelete = <T>(url: string, body?: unknown): Promise<T> =>
  request<T>(url, { method: "DELETE", body: body === undefined ? undefined : JSON.stringify(body) });

/** Bangun query string dari object, membuang nilai kosong. */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const text = String(value);
    if (text.trim().length === 0) return;
    search.set(key, text);
  });
  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
}
