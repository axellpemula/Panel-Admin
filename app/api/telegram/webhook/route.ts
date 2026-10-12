import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { loadTelegram } from "@/lib/api/settings";
import { handleTelegramUpdate } from "@/lib/api/telegram-bot";
import { createAdminClient } from "@/lib/supabase/admin";
import { readJsonBody } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BODY_MAX = 16 * 1024;

export async function POST(request: NextRequest) {
  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    console.error("[telegram] admin client tidak siap:", (error as Error)?.message);
    return NextResponse.json({ ok: true, ignored: true });
  }

  const telegram = await loadTelegram(admin);
  if (!telegram.botToken || !telegram.webhookSecret) {
    return NextResponse.json({ ok: true, ignored: "bot belum dikonfigurasi" });
  }

  const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expected = telegram.webhookSecret;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  const authorized =
    expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = await readJsonBody(request, BODY_MAX);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
    return NextResponse.json({ ok: true });
  }

  try {
    await handleTelegramUpdate(admin, parsed.value as Parameters<typeof handleTelegramUpdate>[1]);
  } catch (error) {
    console.error("[telegram] gagal memproses update:", (error as Error)?.message ?? error);
  }

  return NextResponse.json({ ok: true });
}
