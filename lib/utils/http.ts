import { NextResponse, type NextRequest } from "next/server";

import type { ValidationReason } from "@/lib/constants";

/**
 * Helper response API yang konsisten.
 * Semua response JSON memakai bentuk { ok, data } atau { ok: false, error, code }.
 */

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "insufficient_credit"
  | "rate_limited"
  | "hwid_reset_cooldown"
  | "server_error";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: string;
  code: ApiErrorCode;
  details?: Record<string, unknown>;
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true as const, data }, init);
}

export function jsonError(
  message: string,
  code: ApiErrorCode = "server_error",
  status = 400,
  details?: Record<string, unknown>,
): NextResponse<ApiFailure> {
  return NextResponse.json(
    { ok: false as const, error: message, code, ...(details ? { details } : {}) },
    { status },
  );
}

/** Response khusus /api/validate — bentuknya berbeda dari API panel. */
export function validateFailure(reason: ValidationReason, status = 200): NextResponse {
  return NextResponse.json({ valid: false, reason }, { status });
}

export function validateBadRequest(reason: ValidationReason = "invalid_request"): NextResponse {
  return NextResponse.json({ valid: false, reason }, { status: 400 });
}

export function validateRateLimited(): NextResponse {
  return NextResponse.json({ valid: false, reason: "rate_limited" }, { status: 429 });
}

/** IP klien: elemen pertama header x-forwarded-for. */
export function clientIp(request: NextRequest | Request): string {
  const header = request.headers.get("x-forwarded-for");
  if (header) {
    const first = header.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim().slice(0, 128);
  return "unknown";
}

/**
 * Baca body JSON dengan batas ukuran (byte). Dipakai /api/validate
 * supaya request besar ditolak sebelum query apa pun.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; value: unknown } | { ok: false; tooLarge: boolean }> {
  const declared = request.headers.get("content-length");
  if (declared && Number.parseInt(declared, 10) > maxBytes) {
    return { ok: false, tooLarge: true };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, tooLarge: false };
  }

  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    return { ok: false, tooLarge: true };
  }

  if (!text.trim()) return { ok: false, tooLarge: false };

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

/** Ambil pesan error yang aman ditampilkan ke user. */
export function errorMessage(error: unknown, fallback = "Terjadi kesalahan di server"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return fallback;
}

/** Ubah error Supabase jadi pesan Bahasa Indonesia yang ramah. */
export function supabaseErrorMessage(error: { message?: string; code?: string } | null): string {
  if (!error) return "Terjadi kesalahan di server";
  const code = error.code ?? "";
  if (code === "23505" || code === "23514" || code === "23503" || code === "23502" || code === "22P02") {
    return "Data yang dikirim tidak valid";
  }
  return error.message ?? "Terjadi kesalahan di server";
}
