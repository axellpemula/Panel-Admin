import type { SupabaseClient } from "@supabase/supabase-js";

import type { CreditAction, Database } from "@/lib/types/database";

/**
 * Operasi credit yang dipakai bersama oleh generate key, edit key (perpanjang),
 * dan manajemen reseller. Semua pemotongan/penambahan lewat function SQL
 * (`spend_credit` / `add_credit`) supaya atomik dan aman dari race.
 */

/** Tambah credit secara atomic (topup) lewat function SQL `add_credit`. */
export async function addCredit(
  admin: SupabaseClient<Database>,
  userId: string,
  amount: number,
): Promise<number> {
  const { data, error } = await admin.rpc("add_credit", {
    p_user_id: userId,
    p_amount: amount,
  });

  if (error || !data) {
    throw new Error("Gagal menambah credit: " + (error?.message ?? "unknown"));
  }

  const row = Array.isArray(data) ? (data[0] as { success: boolean; balance: number }) : null;
  if (!row) throw new Error("Gagal menambah credit");
  return Number(row.balance) || 0;
}

/**
 * Potong credit secara atomic lewat function SQL `spend_credit`.
 * Return saldo baru, atau -1 kalau saldo tidak cukup / gagal.
 */
export async function spendCredit(
  admin: SupabaseClient<Database>,
  userId: string,
  amount: number,
): Promise<number> {
  if (amount <= 0) {
    const { data } = await admin.from("profiles").select("credit").eq("id", userId).maybeSingle();
    return Number(data?.credit ?? 0);
  }

  const { data, error } = await admin.rpc("spend_credit", {
    p_user_id: userId,
    p_amount: amount,
  });

  if (error || !data) {
    console.error("[credit] spend_credit gagal:", error?.message);
    return -1;
  }

  const row = Array.isArray(data) ? (data[0] as { success: boolean; balance: number }) : null;
  if (!row || row.success !== true) return -1;
  return Number(row.balance) || 0;
}

/**
 * Catat perubahan credit ke `credit_logs`.
 * Kegagalan menulis log tidak boleh membatalkan aksi utama (hanya di-warn),
 * supaya panel tetap jalan walau log bermasalah — sama seperti perilaku sebelumnya.
 */
export async function recordCreditLog(
  admin: SupabaseClient<Database>,
  entry: {
    userId: string;
    action: CreditAction;
    amount: number;
    balanceAfter: number;
    note: string;
    createdBy: string;
  },
): Promise<void> {
  const { error } = await admin.from("credit_logs").insert({
    user_id: entry.userId,
    action: entry.action,
    amount: entry.amount,
    balance_after: entry.balanceAfter,
    note: entry.note,
    created_by: entry.createdBy,
  });

  if (error) {
    console.warn("[credit] credit_logs insert gagal:", error.message);
  }
}
