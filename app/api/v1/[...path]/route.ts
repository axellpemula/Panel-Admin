import type { NextRequest } from "next/server";

import { readApiToken } from "@/lib/api/api-keys";
import { jsonError } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Catch-all `/api/v1/*` — endpoint yang tidak dikenal dijawab dengan JSON 404
 * (bukan halaman HTML 404 Next.js), supaya client API selalu bisa mem-parse
 * respons dan tahu daftar endpoint yang tersedia.
 */
const AVAILABLE = [
  "GET /api/v1/me",
  "GET /api/v1/tools",
  "GET /api/v1/presets",
  "GET /api/v1/keys",
  "POST /api/v1/keys",
  "GET /api/v1/keys/{id|key_value}",
  "POST /api/v1/keys/{id|key_value}/hwid-reset",
  "GET /api/v1/credits",
];

function notFound(request: NextRequest): Response {
  const token = readApiToken(request);
  return jsonError(
    token
      ? "Endpoint tidak ditemukan. Lihat daftar endpoint di docs/RESELLER_API.md."
      : "Endpoint tidak ditemukan. Sertakan header `Authorization: Bearer <API key>` untuk memakai API ini.",
    "not_found",
    404,
    { available: AVAILABLE },
  );
}

export async function GET(request: NextRequest) {
  return notFound(request);
}
export async function POST(request: NextRequest) {
  return notFound(request);
}
export async function PUT(request: NextRequest) {
  return notFound(request);
}
export async function PATCH(request: NextRequest) {
  return notFound(request);
}
export async function DELETE(request: NextRequest) {
  return notFound(request);
}
