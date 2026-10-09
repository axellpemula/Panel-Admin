import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthContext } from "@/lib/api/auth";
import { recordCreditLog, spendCredit } from "@/lib/api/credit";
import { LIMITS } from "@/lib/constants";
import type { Database, DurationPresetRow, ToolTypeRow, ToolVersionRow } from "@/lib/types/database";
import { generateUniqueKeys } from "@/lib/utils/crypto";
import { creditCostBreakdown, generateCreditCost } from "@/lib/utils/pricing";

/**
 * Logika inti generate key. Semua validasi bisnis ada di sini supaya
 * /api/keys/generate tetap tipis dan mudah diaudit.
 */

export interface GenerateInput {
  toolTypeId: string;
  toolVersionId: string;
  durationMode: "preset" | "custom";
  durationPresetId?: string | null;
  customDays?: number | null;
  maxDevice: number;
  quantity: number;
  note?: string | null;
}

export interface GenerateSummary {
  tool_name: string;
  tool_slug: string;
  version_name: string;
  duration_label: string;
  duration_days: number | null;
  max_device: number;
  quantity: number;
  expired_at: string | null;
  /** Harga 1 unit (1 key × 1 device) dari preset; 0 untuk Owner. */
  unit_price: number;
  credit_cost: number;
  credit_balance_after: number;
}

export interface GeneratedKey {
  id: string;
  key_value: string;
  expired_at: string | null;
  max_device: number;
  /** Credit yang dipakai untuk key ini (0 untuk Owner). */
  credit_cost: number;
  status: string;
  tool_name: string;
  version_name: string;
  created_at: string;
}

export interface GenerateResult {
  keys: GeneratedKey[];
  summary: GenerateSummary;
}

export class GenerateError extends Error {
  code:
    | "validation_error"
    | "not_found"
    | "insufficient_credit"
    | "conflict"
    | "server_error";

  details?: Record<string, unknown>;

  constructor(
    message: string,
    code: GenerateError["code"] = "validation_error",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GenerateError";
    this.code = code;
    this.details = details;
  }
}

function computeExpiry(days: number | null): string | null {
  if (days === null) return null; // Lifetime
  if (days <= 0) return null;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Generate key, simpan ke DB, dan (untuk reseller) potong credit.
 *
 * Harga: `harga_preset × quantity × max_device` (1 unit = 1 key × 1 device).
 * Menambah max device sama seperti menambah quantity — dua-duanya menaikkan biaya.
 *
 * Urutan aman untuk credit:
 * 1. Cek saldo cukup (read).
 * 2. Insert key dulu.
 * 3. Potong credit pakai function spend_credit (atomic + re-check).
 * 4. Kalau potong credit gagal (race), key yang baru dibuat dihapus lagi.
 */
export async function generateKeys(
  ctx: AuthContext,
  input: GenerateInput,
): Promise<GenerateResult> {
  const admin = ctx.admin;

  // --- Validasi tool type ---
  const { data: tool, error: toolError } = await admin
    .from("tool_types")
    .select("id, name, slug, is_active")
    .eq("id", input.toolTypeId)
    .maybeSingle<Pick<ToolTypeRow, "id" | "name" | "slug" | "is_active">>();

  if (toolError) throw new GenerateError("Gagal membaca tool type", "server_error");
  if (!tool) throw new GenerateError("Tool type tidak ditemukan", "not_found");
  if (!tool.is_active) throw new GenerateError("Tool type sedang nonaktif", "validation_error");

  // --- Validasi version ---
  const { data: version, error: versionError } = await admin
    .from("tool_versions")
    .select("id, tool_type_id, name, is_active")
    .eq("id", input.toolVersionId)
    .maybeSingle<Pick<ToolVersionRow, "id" | "tool_type_id" | "name" | "is_active">>();

  if (versionError) throw new GenerateError("Gagal membaca version", "server_error");
  if (!version) throw new GenerateError("Version tidak ditemukan", "not_found");
  if (version.tool_type_id !== tool.id) {
    throw new GenerateError("Version bukan milik tool type yang dipilih", "validation_error");
  }
  if (!version.is_active) throw new GenerateError("Version sedang nonaktif", "validation_error");

  // --- Durasi ---
  let durationDays: number | null = null;
  let durationLabel = "";
  let creditCostPerKey = 0;

  if (input.durationMode === "preset") {
    if (!input.durationPresetId) {
      throw new GenerateError("Preset durasi wajib dipilih", "validation_error");
    }
    const { data: preset, error: presetError } = await admin
      .from("duration_presets")
      .select("*")
      .eq("id", input.durationPresetId)
      .maybeSingle<DurationPresetRow>();

    if (presetError) throw new GenerateError("Gagal membaca preset durasi", "server_error");
    if (!preset) throw new GenerateError("Preset durasi tidak ditemukan", "not_found");
    if (!preset.is_active) throw new GenerateError("Preset durasi sedang nonaktif", "validation_error");

    durationDays = preset.days;
    durationLabel = preset.name;
    creditCostPerKey = preset.credit_cost ?? 0;
  } else {
    // Custom hanya untuk Owner.
    if (!ctx.isOwner) {
      throw new GenerateError("Reseller hanya bisa memakai preset durasi", "validation_error");
    }
    if (input.customDays === null || input.customDays === undefined) {
      throw new GenerateError("Jumlah hari wajib diisi", "validation_error");
    }
    if (input.customDays < 0 || input.customDays > 3650) {
      throw new GenerateError("Jumlah hari harus antara 0 (Lifetime) dan 3650", "validation_error");
    }
    durationDays = input.customDays === 0 ? null : input.customDays;
    durationLabel = durationDays === null ? "Lifetime" : `${durationDays} hari (custom)`;
  }

  // --- Kuantitas ---
  const maxQuantity = ctx.isOwner ? LIMITS.quantityOwnerMax : LIMITS.quantityResellerMax;
  if (input.quantity < 1 || input.quantity > maxQuantity) {
    throw new GenerateError(`Quantity harus antara 1 dan ${maxQuantity}`, "validation_error");
  }
  if (input.maxDevice < LIMITS.maxDeviceMin || input.maxDevice > LIMITS.maxDeviceMax) {
    throw new GenerateError(
      `Max device harus antara ${LIMITS.maxDeviceMin} dan ${LIMITS.maxDeviceMax}`,
      "validation_error",
    );
  }

  // --- Credit ---
  // 1 unit = 1 key × 1 device, jadi biaya = harga satuan × quantity × max device.
  const totalCost = generateCreditCost(creditCostPerKey, input.quantity, input.maxDevice);
  const profileCredit = ctx.profile.credit ?? 0;
  const breakdown = creditCostBreakdown(creditCostPerKey, input.quantity, input.maxDevice);

  if (!ctx.isOwner && totalCost > 0 && profileCredit < totalCost) {
    throw new GenerateError(
      `Credit tidak cukup (sisa ${profileCredit}, butuh ${totalCost}) — ${breakdown}`,
      "insufficient_credit",
      {
        credit_needed: totalCost,
        credit_balance: profileCredit,
        unit_price: creditCostPerKey,
        quantity: input.quantity,
        max_device: input.maxDevice,
      },
    );
  }

  // --- Generate key unik (crypto.randomInt) ---
  const expiredAt = computeExpiry(durationDays);
  let inserted: GeneratedKey[] = [];
  let attempts = 0;

  while (inserted.length === 0 && attempts < 3) {
    attempts += 1;

    // Ambil key yang sudah ada untuk kandidat, lalu regenerate kalau bentrok.
    const candidates = generateUniqueKeys(input.quantity, new Set());
    const { data: existing, error: existingError } = await admin
      .from("keys")
      .select("key_value")
      .in("key_value", candidates);

    if (existingError) throw new GenerateError("Gagal mengecek duplikat key", "server_error");

    const taken = new Set((existing ?? []).map((row) => row.key_value as string));
    const fresh = candidates.filter((value) => !taken.has(value));

    if (fresh.length < input.quantity) {
      // Ada collation: ulangi sekali lagi (key space 32^8, praktis tidak pernah).
      continue;
    }

    const payload = fresh.map((keyValue) => ({
      key_value: keyValue,
      tool_type_id: tool.id,
      tool_version_id: version.id,
      created_by: ctx.userId,
      status: "active" as const,
      duration_days: durationDays,
      expired_at: expiredAt,
      max_device: input.maxDevice,
      // Credit yang dipakai key ini (1 unit = 1 key × 1 device). Owner tidak dipotong → 0.
      // Nilainya dipakai untuk mengembalikan credit kalau Owner menghapus key ini.
      credit_cost: ctx.isOwner ? 0 : creditCostPerKey * input.maxDevice,
      note: input.note ?? null,
    }));

    const { data: created, error: insertError } = await admin
      .from("keys")
      .insert(payload)
      .select("id, key_value, expired_at, max_device, credit_cost, status, created_at");

    if (insertError) {
      // Unique violation (race) → coba lagi, error lain → lempar.
      if (insertError.code === "23505") continue;
      throw new GenerateError("Gagal menyimpan key: " + insertError.message, "server_error");
    }

    inserted = (created ?? []).map((row) => ({
      id: row.id as string,
      key_value: row.key_value as string,
      expired_at: (row.expired_at as string | null) ?? null,
      max_device: Number(row.max_device) || 1,
      credit_cost: Number(row.credit_cost) || 0,
      status: String(row.status ?? "active"),
      tool_name: tool.name,
      version_name: version.name,
      created_at: String(row.created_at),
    }));
  }

  if (inserted.length === 0) {
    throw new GenerateError("Gagal membuat key unik, coba lagi", "conflict");
  }

  // --- Potong credit (reseller) / catat aktivitas (owner) ---
  let balanceAfter = profileCredit;

  if (!ctx.isOwner && totalCost > 0) {
    balanceAfter = await spendCredit(admin, ctx.userId, totalCost);
    if (balanceAfter < 0) {
      // Gagal potong (saldo berubah di tengah jalan) → batalkan key yang sudah dibuat.
      await admin.from("keys").delete().in(
        "id",
        inserted.map((key) => key.id),
      );
      throw new GenerateError(
        `Credit tidak cukup (sisa ${profileCredit}, butuh ${totalCost}) — ${breakdown}`,
        "insufficient_credit",
        {
          credit_needed: totalCost,
          credit_balance: profileCredit,
          unit_price: creditCostPerKey,
          quantity: input.quantity,
          max_device: input.maxDevice,
        },
      );
    }
  }

  const noteText =
    input.note && input.note.trim().length > 0
      ? input.note.trim()
      : `${tool.name} ${version.name} / ${durationLabel} / ${inserted.length} key × ${input.maxDevice} device`;

  await recordCreditLog(admin, {
    userId: ctx.userId,
    action: "generate",
    amount: ctx.isOwner ? 0 : -totalCost,
    balanceAfter,
    note: noteText,
    createdBy: ctx.userId,
  });

  return {
    keys: inserted,
    summary: {
      tool_name: tool.name,
      tool_slug: tool.slug,
      version_name: version.name,
      duration_label: durationLabel,
      duration_days: durationDays,
      max_device: input.maxDevice,
      quantity: inserted.length,
      expired_at: expiredAt,
      unit_price: creditCostPerKey,
      credit_cost: ctx.isOwner ? 0 : totalCost,
      credit_balance_after: balanceAfter,
    },
  };
}
