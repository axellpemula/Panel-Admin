import type { SupabaseClient } from "@supabase/supabase-js";

import { startOfJakartaDay, toJakartaDateKey, formatShortDay, formatWeekday } from "@/lib/utils/format";
import type { CreditAction, Database, KeyStatus, ProfileRow } from "@/lib/types/database";

/**
 * Query statistik dashboard (owner & reseller) dan feed aktivitas terakhir.
 */

export interface ChartPoint {
  date: string;
  label: string;
  weekday: string;
  count: number;
}

export interface ActivityItem {
  id: string;
  /** Semua aksi credit_logs — extend (perpanjang) & refund (pengembalian) juga ikut. */
  action: CreditAction;
  amount: number;
  balance_after: number;
  note: string | null;
  created_at: string;
  user_id: string;
  username: string | null;
}

export interface KeyTotals {
  all: number;
  active: number;
  expired: number;
  banned: number;
}

export interface OwnerStats {
  totals: KeyTotals & {
    resellers: number;
    resellers_active: number;
    created_today: number;
    created_week: number;
  };
  chart: ChartPoint[];
  topResellers: TopReseller[];
  recentActivity: ActivityItem[];
}

export interface ResellerStats {
  totals: KeyTotals & {
    credit: number;
    created_today: number;
    created_week: number;
  };
  chart: ChartPoint[];
  recentActivity: ActivityItem[];
}

export interface TopReseller {
  id: string;
  username: string;
  email: string;
  credit: number;
  key_count: number;
  is_active: boolean;
}

async function countKeys(
  admin: SupabaseClient<Database>,
  filters: { status?: KeyStatus; userId?: string; since?: string } = {},
): Promise<number> {
  let query = admin.from("keys").select("id", { count: "exact", head: true });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.userId) query = query.eq("created_by", filters.userId);
  if (filters.since) query = query.gte("created_at", filters.since);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Ambil 7 hari terakhir (termasuk hari ini) sebagai titik chart. */
function buildChartSkeleton(): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const start = startOfJakartaDay(i);
    const dateKey = toJakartaDateKey(start);
    points.push({
      date: dateKey,
      label: formatShortDay(start),
      weekday: formatWeekday(start),
      count: 0,
    });
  }
  return points;
}

/** Chart key per hari (7 hari terakhir) — dihitung per tanggal Jakarta. */
export async function keyChart(
  admin: SupabaseClient<Database>,
  userId?: string,
): Promise<ChartPoint[]> {
  const points = buildChartSkeleton();
  const since = startOfJakartaDay(6).toISOString();

  let query = admin.from("keys").select("created_at").gte("created_at", since);
  if (userId) query = query.eq("created_by", userId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const index = new Map(points.map((point) => [point.date, point]));
  (data ?? []).forEach((row) => {
    const key = toJakartaDateKey(row.created_at as string);
    const point = index.get(key);
    if (point) point.count += 1;
  });

  return points;
}

/** Feed aktivitas terakhir dari credit_logs (semua aksi: topup, generate, extend, refund). */
export async function recentActivity(
  admin: SupabaseClient<Database>,
  options: { limit?: number; userId?: string } = {},
): Promise<ActivityItem[]> {
  const limit = options.limit ?? 10;
  let query = admin
    .from("credit_logs")
    .select("id, action, amount, balance_after, note, created_at, user_id, profiles!credit_logs_user_id_fkey(username)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options.userId) query = query.eq("user_id", options.userId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const record = row as unknown as Record<string, unknown> & {
      profiles?: { username?: string } | null;
    };
    return {
      id: String(record.id),
      action: record.action as CreditAction,
      amount: Number(record.amount) || 0,
      balance_after: Number(record.balance_after) || 0,
      note: (record.note as string | null) ?? null,
      created_at: String(record.created_at),
      user_id: String(record.user_id),
      username: record.profiles?.username ?? null,
    };
  });
}

/** Ringkasan reseller (dipakai Top Reseller & halaman Reseller). */
export async function resellerSummary(admin: SupabaseClient<Database>): Promise<TopReseller[]> {
  const { data, error } = await admin.rpc("reseller_summary");
  if (error || !data) {
    // Fallback kalau function belum ada (mis. migrasi lama).
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, username, email, credit, is_active")
      .eq("role", "reseller")
      .returns<Pick<ProfileRow, "id" | "username" | "email" | "credit" | "is_active">[]>();

    const rows = profiles ?? [];
    const results = await Promise.all(
      rows.map(async (profile) => ({
        id: profile.id,
        username: profile.username,
        email: profile.email,
        credit: profile.credit,
        is_active: profile.is_active,
        key_count: await countKeys(admin, { userId: profile.id }),
      })),
    );
    return results.sort((a, b) => b.key_count - a.key_count);
  }

  return (data as unknown as Record<string, unknown>[]).map((row) => ({
    id: String(row.user_id ?? row.id),
    username: String(row.username ?? "-"),
    email: String(row.email ?? "-"),
    credit: Number(row.credit) || 0,
    is_active: Boolean(row.is_active),
    key_count: Number(row.key_count) || 0,
  }));
}

export async function ownerStats(admin: SupabaseClient<Database>): Promise<OwnerStats> {
  const todayStart = startOfJakartaDay(0).toISOString();
  const weekStart = startOfJakartaDay(6).toISOString();

  const [all, active, expired, banned, today, week, resellers, chart, activity] = await Promise.all([
    countKeys(admin),
    countKeys(admin, { status: "active" }),
    countKeys(admin, { status: "expired" }),
    countKeys(admin, { status: "banned" }),
    countKeys(admin, { since: todayStart }),
    countKeys(admin, { since: weekStart }),
    resellerSummary(admin),
    keyChart(admin),
    recentActivity(admin, { limit: 10 }),
  ]);

  return {
    totals: {
      all,
      active,
      expired,
      banned,
      resellers: resellers.length,
      resellers_active: resellers.filter((item) => item.is_active).length,
      created_today: today,
      created_week: week,
    },
    chart,
    topResellers: [...resellers].sort((a, b) => b.key_count - a.key_count).slice(0, 5),
    recentActivity: activity,
  };
}

export async function resellerStats(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<ResellerStats> {
  const todayStart = startOfJakartaDay(0).toISOString();
  const weekStart = startOfJakartaDay(6).toISOString();

  const [profile, all, active, expired, banned, today, week, chart, activity] = await Promise.all([
    admin.from("profiles").select("credit").eq("id", userId).maybeSingle(),
    countKeys(admin, { userId }),
    countKeys(admin, { userId, status: "active" }),
    countKeys(admin, { userId, status: "expired" }),
    countKeys(admin, { userId, status: "banned" }),
    countKeys(admin, { userId, since: todayStart }),
    countKeys(admin, { userId, since: weekStart }),
    keyChart(admin, userId),
    recentActivity(admin, { limit: 10, userId }),
  ]);

  return {
    totals: {
      all,
      active,
      expired,
      banned,
      credit: Number(profile.data?.credit ?? 0),
      created_today: today,
      created_week: week,
    },
    chart,
    recentActivity: activity,
  };
}
