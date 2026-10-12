"use client";

import { RefreshCw, Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HwidModal } from "@/components/dashboard/HwidModal";
import { KeyEditModal } from "@/components/dashboard/KeyEditModal";
import { KeyTable } from "@/components/dashboard/KeyTable";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { ConfirmDialog } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { ToolTypeItem } from "@/app/api/tools/route";
import type { SortColumn } from "@/lib/api/keys";
import { apiDelete, apiGet, apiPut, buildQuery } from "@/lib/api/client";
import type { BanReason, KeyListItem } from "@/lib/types/database";
import { BAN_REASON_LABEL, STATUS_LABEL, formatNumber } from "@/lib/utils/format";
import { isKeyRefundableOnDelete, refundAmount } from "@/lib/utils/refund";

interface KeysResponse {
  items: KeyListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

interface ToolsResponse {
  tools: ToolTypeItem[];
}

interface ResellersResponse {
  resellers: { id: string; username: string; email: string }[];
}

interface DeleteResponse {
  deleted: boolean;
  key_value: string;
  refund?: {
    amount: number;
    user_id: string;
    username: string | null;
    balance_after: number | null;
    error?: string;
  } | null;
}

export function KeysView({
  isOwner,
  currentUserId,
  initialQuery = "",
  initialCreatedBy = "",
  initialStatus = "",
}: {
  isOwner: boolean;
  currentUserId: string;
  initialQuery?: string;
  initialCreatedBy?: string;
  initialStatus?: string;
}) {
  const toast = useToast();

  const [filters, setFilters] = useState({
    q: initialQuery,
    status: ["active", "expired", "banned"].includes(initialStatus) ? initialStatus : "",
    toolTypeId: "",
    versionId: "",
    createdBy: isOwner ? initialCreatedBy : "",
  });
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [sort, setSort] = useState<SortColumn>("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);

  const [data, setData] = useState<KeysResponse>({
    items: [],
    total: 0,
    page: 1,
    perPage: 20,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);

  const [tools, setTools] = useState<ToolTypeItem[]>([]);
  const [resellers, setResellers] = useState<{ id: string; username: string }[]>([]);

  const [detailKeyId, setDetailKeyId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<KeyListItem | null>(null);
  const [banTarget, setBanTarget] = useState<KeyListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KeyListItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [banReason, setBanReason] = useState<BanReason>("manual");
  const [banNote, setBanNote] = useState("");

  const firstLoad = useRef(true);

  const deleteTargetRefundable = deleteTarget
    ? isKeyRefundableOnDelete(deleteTarget, { userId: currentUserId, isOwner })
    : false;

  const deleteNote = (() => {
    if (!deleteTarget) return null;
    const target = deleteTarget;
    const chargeable = refundAmount(target) > 0;

    if (deleteTargetRefundable) {
      return (
        <span className="mt-1 inline-block text-text">
          Key ini masih <span className="text-active">aktif dan belum expired</span>, jadi{" "}
          {formatNumber(refundAmount(target))} credit yang dipakai untuk key ini dikembalikan ke{" "}
          {target.created_by_username ?? "reseller"}.
        </span>
      );
    }

    if (isOwner && target.created_by !== currentUserId) {
      if (target.status === "expired") {
        return (
          <span className="mt-1 inline-block text-muted">
            Tidak ada pengembalian credit karena key-nya sudah <span className="text-expired">expired</span>.
          </span>
        );
      }
      if (target.status === "banned") {
        return (
          <span className="mt-1 inline-block text-muted">
            Tidak ada pengembalian credit karena key-nya sedang <span className="text-banned">banned</span>.
          </span>
        );
      }
      if (!chargeable) {
        return (
          <span className="mt-1 inline-block text-muted">
            Tidak ada credit yang perlu dikembalikan untuk key ini.
          </span>
        );
      }
    }

    return null;
  })();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((previous) =>
        previous.q === searchInput ? previous : { ...previous, q: searchInput },
      );
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadKeys = useCallback(async () => {
    if (firstLoad.current) setLoading(true);
    else setReloading(true);

    try {
      const query = buildQuery({
        q: filters.q,
        status: filters.status,
        tool_type_id: filters.toolTypeId,
        version_id: filters.versionId,
        created_by: filters.createdBy,
        sort,
        order,
        page,
        per_page: perPage,
      });
      const response = await apiGet<KeysResponse>(`/api/keys${query}`);
      setData(response);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat daftar key");
    } finally {
      firstLoad.current = false;
      setLoading(false);
      setReloading(false);
    }
  }, [filters, sort, order, page, perPage, toast]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      try {
        const toolsResponse = await apiGet<ToolsResponse>("/api/tools");
        if (!cancelled) setTools(toolsResponse.tools);
      } catch {
        // Filter tool tidak wajib — abaikan kegagalan.
      }
      if (isOwner) {
        try {
          const resellerResponse = await apiGet<ResellersResponse>("/api/resellers");
          if (!cancelled) setResellers(resellerResponse.resellers);
        } catch {
          // Abaikan.
        }
      }
    };
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  const versionOptions = useMemo(() => {
    if (!filters.toolTypeId) {
      return tools.flatMap((tool) =>
        tool.versions.map((version) => ({
          value: version.id,
          label: `${tool.name} · ${version.name}`,
        })),
      );
    }
    const tool = tools.find((item) => item.id === filters.toolTypeId);
    return (tool?.versions ?? []).map((version) => ({ value: version.id, label: version.name }));
  }, [filters.toolTypeId, tools]);

  const hasActiveFilter =
    filters.q.length > 0 ||
    filters.status.length > 0 ||
    filters.toolTypeId.length > 0 ||
    filters.versionId.length > 0 ||
    filters.createdBy.length > 0;

  const resetFilters = () => {
    setSearchInput("");
    setFilters({ q: "", status: "", toolTypeId: "", versionId: "", createdBy: "" });
    setPage(1);
  };

  const onSortChange = (column: SortColumn) => {
    if (column === sort) {
      setOrder((previous) => (previous === "asc" ? "desc" : "asc"));
    } else {
      setSort(column);
      setOrder("desc");
    }
    setPage(1);
  };

  const openBanDialog = (item: KeyListItem) => {
    if (item.status === "banned" && item.ban_reason === "auto_hwid" && !isOwner) {
      toast.error(
        "Key ini kena auto-ban terlalu banyak HWID berbeda. Unban auto-ban hanya bisa oleh Owner.",
      );
      return;
    }
    setBanReason("manual");
    setBanNote("");
    setBanTarget(item);
  };

  const toggleBan = async () => {
    if (!banTarget) return;
    setActionLoading(true);
    try {
      const isBanned = banTarget.status === "banned";
      if (isBanned) {
        await apiPut(`/api/keys/${banTarget.id}/unban`);
        toast.success("Key di-unban");
      } else {
        const note = banNote.trim();
        await apiPut(`/api/keys/${banTarget.id}/ban`, {
          reason: banReason,
          note: note.length > 0 ? note : undefined,
        });
        toast.success("Key dibanned");
      }
      setBanTarget(null);
      await loadKeys();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengubah status key");
    } finally {
      setActionLoading(false);
    }
  };

  const deleteKey = async () => {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      const response = await apiDelete<DeleteResponse>(`/api/keys/${deleteTarget.id}`);
      const refund = response?.refund;

      if (refund && refund.amount > 0) {
        if (refund.error) {
          toast.error(
            `Key dihapus, tapi pengembalian ${formatNumber(refund.amount)} credit gagal: ${refund.error}`,
          );
        } else {
          toast.success(
            `Key dihapus · ${formatNumber(refund.amount)} credit dikembalikan ke ${
              refund.username ?? "reseller"
            } (sisa ${formatNumber(refund.balance_after ?? 0)})`,
          );
        }
      } else {
        toast.success("Key dihapus permanen");
      }

      setDeleteTarget(null);
      await loadKeys();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus key");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-medium">Key List</h1>
          <p className="mt-1 text-body text-muted">
            {isOwner
              ? "Semua key yang ada di sistem."
              : "Key yang kamu buat sendiri. Perpanjang memakai preset Owner dan memotong credit."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => void loadKeys()}
            loading={reloading}
            icon={<RefreshCw size={16} strokeWidth={1.5} />}
          >
          </Button>
          <Link
            href="/generate"
            className="inline-flex h-8 items-center rounded-control border border-accent bg-accent px-2.5 text-label font-medium text-accent-fg transition-colors duration-150 hover:bg-accent/90"
          >
            Buat Key
          </Link>
        </div>
      </header>

      {/* Filter bar */}
      <section className="card p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(200px,1.4fr)_repeat(4,minmax(140px,1fr))]">
          <div className="relative">
            <Search
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              className="field pl-9"
              placeholder="Cari key…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value.toUpperCase())}
              aria-label="Cari key"
              spellCheck={false}
            />
          </div>

          <Select
            ariaLabel="Filter status"
            value={filters.status || null}
            placeholder="Semua status"
            onChange={(value) => {
              setFilters((previous) => ({ ...previous, status: value }));
              setPage(1);
            }}
            options={[
              { value: "", label: "Semua status" },
              { value: "active", label: STATUS_LABEL.active },
              { value: "expired", label: STATUS_LABEL.expired },
              { value: "banned", label: STATUS_LABEL.banned },
            ]}
          />

          <Select
            ariaLabel="Filter tool"
            value={filters.toolTypeId || null}
            placeholder="Semua tool"
            onChange={(value) => {
              setFilters((previous) => ({ ...previous, toolTypeId: value, versionId: "" }));
              setPage(1);
            }}
            options={[
              { value: "", label: "Semua tool" },
              ...tools.map((tool) => ({ value: tool.id, label: tool.name })),
            ]}
          />

          <Select
            ariaLabel="Filter version"
            value={filters.versionId || null}
            placeholder="Semua version"
            options={[{ value: "", label: "Semua version" }, ...versionOptions]}
            onChange={(value) => {
              setFilters((previous) => ({ ...previous, versionId: value }));
              setPage(1);
            }}
          />

          {isOwner ? (
            <Select
              ariaLabel="Filter reseller"
              value={filters.createdBy || null}
              placeholder="Semua pembuat"
              onChange={(value) => {
                setFilters((previous) => ({
                  ...previous,
                  createdBy: value,
                }));
                setPage(1);
              }}
              options={[
                { value: "", label: "Semua pembuat" },
                { value: currentUserId, label: "Milik saya (Owner)" },
                ...resellers.map((reseller) => ({
                  value: reseller.id,
                  label: reseller.username,
                })),
              ]}
            />
          ) : null}
        </div>

        {hasActiveFilter ? (
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              onClick={resetFilters}
              icon={<X size={14} strokeWidth={1.5} />}
            >
              Reset filter
            </Button>
            <p className="text-label text-muted tabular-nums">{data.total} hasil</p>
          </div>
        ) : null}
      </section>

      {/* Tabel */}
      <section className="card overflow-hidden">
        <KeyTable
          items={data.items}
          loading={loading}
          isOwner={isOwner}
          sort={sort}
          order={order}
          onSortChange={onSortChange}
          onOpenDetail={(item) => setDetailKeyId(item.id)}
          onEdit={(item) => setEditTarget(item)}
          onToggleBan={openBanDialog}
          onDelete={(item) => setDeleteTarget(item)}
          emptyMessage={
            hasActiveFilter
              ? "Tidak ada key yang cocok dengan filter"
              : "Belum ada key. Buat key pertama dari halaman Generate Key."
          }
        />

        {data.total > 0 ? (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            perPage={data.perPage}
            onChange={setPage}
          />
        ) : null}
      </section>

      {/* Modals */}
      <HwidModal
        keyId={detailKeyId}
        open={detailKeyId !== null}
        onClose={() => setDetailKeyId(null)}
        onChanged={() => void loadKeys()}
      />

      <KeyEditModal
        target={editTarget}
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        onSaved={() => void loadKeys()}
        isOwner={isOwner}
      />

      <ConfirmDialog
        open={banTarget !== null}
        title={banTarget?.status === "banned" ? "Unban key ini?" : "Ban key ini?"}
        message={
          banTarget?.status === "banned" ? (
            <div className="space-y-1.5">
              <span>
                Key <span className="font-mono text-text">{banTarget?.key_value}</span> akan kembali
                aktif (atau expired kalau sudah lewat tanggal expired).
              </span>
              {banTarget?.ban_reason ? (
                <span className="block text-label text-muted">
                  Alasan ban:{" "}
                  <span className="text-text">
                    {BAN_REASON_LABEL[banTarget.ban_reason] ?? banTarget.ban_reason}
                  </span>
                  {banTarget?.ban_note ? ` — ${banTarget.ban_note}` : ""}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <span>
                Key <span className="font-mono text-text">{banTarget?.key_value}</span> tidak bisa
                dipakai lagi meski belum expired.
              </span>
              <Field label="Alasan ban">
                <Select
                  ariaLabel="Alasan ban"
                  value={banReason}
                  onChange={(value) => setBanReason(value as BanReason)}
                  options={[
                    { value: "manual", label: "Manual" },
                    { value: "refund", label: "Refund" },
                    { value: "other", label: "Lainnya" },
                  ]}
                />
              </Field>
              <Field label="Catatan (opsional)">
                <Input
                  value={banNote}
                  onChange={(event) => setBanNote(event.target.value)}
                  placeholder="mis. sengketa dengan customer"
                  maxLength={500}
                />
              </Field>
              <p className="text-label text-muted">
                Siapa yang ban, kapan, dan alasannya tercatat di Audit Log.
              </p>
            </div>
          )
        }
        confirmLabel={banTarget?.status === "banned" ? "Unban" : "Ban"}
        danger={banTarget?.status !== "banned"}
        loading={actionLoading}
        onConfirm={toggleBan}
        onClose={() => setBanTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Hapus key permanen?"
        message={
          <span>
            Key <span className="font-mono text-text">{deleteTarget?.key_value}</span> beserta{" "}
            {deleteTarget?.devices_used ?? 0} HWID terdaftar akan dihapus dan tidak bisa dikembalikan.
            {deleteNote ? (
              <>
                <br />
                {deleteNote}
              </>
            ) : null}
          </span>
        }
        confirmLabel="Hapus"
        danger
        loading={actionLoading}
        onConfirm={deleteKey}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
