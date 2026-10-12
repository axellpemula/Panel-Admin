import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyInBackground } from "@/lib/api/notify";
import type { RuntimeSettings } from "@/lib/api/settings";
import type { Database } from "@/lib/types/database";

/**
 * Notifikasi "saldo tipis" untuk reseller.
 *
 * Dikirim HANYA saat saldo **melewati** ambang dari atas ke bawah
 * (`before >= threshold > after`) supaya tidak spam setiap kali ada pemotongan.
 * Anti-spam tambahan: `dedupe_key = low_credit:<user_id>` per window dedupe.
 */
export function notifyLowCredit(
  admin: SupabaseClient<Database>,
  input: {
    userId: string;
    username: string | null;
    balanceBefore: number;
    balanceAfter: number;
    reason: string;
    runtime: RuntimeSettings;
  },
): void {
  const { runtime } = input;
  if (!runtime.notify.enabled || !runtime.notify.events.lowCredit) return;

  const threshold = runtime.notify.lowCreditThreshold;
  if (threshold <= 0) return;

  const crossed = input.balanceBefore >= threshold && input.balanceAfter < threshold;
  if (!crossed) return;

  notifyInBackground(admin, {
    event: "low_credit",
    title: "Saldo reseller menipis",
    lines: [
      `Reseller ${input.username ?? input.userId} tersisa ${input.balanceAfter} credit (ambang ${threshold}).`,
      `Sebelumnya ${input.balanceBefore} credit. Penyebab: ${input.reason}.`,
      "Ingatkan reseller untuk topup sebelum key berikutnya gagal dibuat.",
    ],
    dedupeKey: `low_credit:${input.userId}`,
    notifyUserIds: [input.userId],
    detail: {
      user_id: input.userId,
      username: input.username,
      balance_before: input.balanceBefore,
      balance_after: input.balanceAfter,
      threshold,
      reason: input.reason,
    },
  });
}
