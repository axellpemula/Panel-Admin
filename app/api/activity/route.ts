import { NextResponse, type NextRequest } from "next/server";

import { ACTIVITY_ACTIONS, ACTIVITY_ACTION_LABEL, listActivity, type ActivityAction } from "@/lib/api/activity";
import { withAuth } from "@/lib/api/auth";
import { toCsv } from "@/lib/utils/csv";
import { errorMessage, jsonError, jsonOk } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/activity
 * Jejak aktivitas akun & sistem yang BUKAN aksi pada key: ganti password, putus
 * sesi, buat/cabut API key, ubah pengaturan, topup/penyesuaian credit, dan
 * penyambungan bot Telegram.
 *
 * - Owner: melihat semua aktivitas (filter aktor tersedia).
 * - Reseller: hanya aktivitas miliknya sendiri (filter aktor diabaikan).
 *
 * Query params: from, to, action, actor, page, per_page, format=csv
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (ctx) => {
    const params = request.nextUrl.searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const action = params.get("action");
    const actor = params.get("actor");
    const format = params.get("format");

    const pageRaw = Number.parseInt(params.get("page") ?? "1", 10);
    const page = Math.min(1_000_000, Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1));
    const perPageRaw = Number.parseInt(params.get("per_page") ?? "50", 10);
    const perPage = Math.min(500, Math.max(5, Number.isFinite(perPageRaw) ? perPageRaw : 50));

    // Reseller selalu terkunci ke aktivitasnya sendiri.
    const actorFilter = ctx.isOwner ? (actor === "system" ? undefined : actor ?? undefined) : ctx.userId;

    /** Tanggal `from`/`to` dari form `<input type="date">` → ISO (awal & akhir hari WIB). */
    const dayStart = (value: string): string | null => {
      const date = new Date(`${value}T00:00:00+07:00`);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    const dayEnd = (value: string): string | null => {
      const date = new Date(`${value}T23:59:59.999+07:00`);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };

    try {
      const result = await listActivity(ctx.admin, {
        from: from ? dayStart(from) ?? undefined : undefined,
        to: to ? dayEnd(to) ?? undefined : undefined,
        action: ACTIVITY_ACTIONS.includes(action as ActivityAction) ? (action as string) : undefined,
        actor: actorFilter,
        page: format === "csv" ? 1 : page,
        perPage: format === "csv" ? 500 : perPage,
      });

      if (format === "csv") {
        const csv = toCsv(
          ["Waktu", "Aktor", "Role", "Aksi", "Target", "Detail"],
          result.items.map((item) => [
            item.created_at,
            item.actor_username ?? "-",
            item.actor_role ?? "-",
            ACTIVITY_ACTION_LABEL[item.action] ?? item.action,
            item.target_label ?? item.target_id ?? "-",
            item.detail ? JSON.stringify(item.detail) : "",
          ]),
        );

        return new NextResponse(csv, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="aktivitas-${new Date().toISOString().slice(0, 10)}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }

      return jsonOk(result);
    } catch (error) {
      console.error("[activity] gagal membaca aktivitas:", error);
      return jsonError(errorMessage(error), "server_error", 500);
    }
  });
}
