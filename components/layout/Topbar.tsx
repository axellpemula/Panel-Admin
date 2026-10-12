"use client";

import { Coins, LogOut, Search } from "lucide-react";
import type { RefObject } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { RoleBadge } from "@/components/ui/Badge";
import { SidebarToggle } from "@/components/layout/SidebarToggle";
import { NAV_ITEMS, SETTINGS_NAV_ITEM } from "@/components/layout/nav";
import { useToast } from "@/components/ui/Toast";
import { apiPost } from "@/lib/api/client";
import { formatNumber } from "@/lib/utils/format";

export interface TopbarUser {
  username: string;
  email: string;
  role: "owner" | "reseller";
  credit: number;
}

/** Judul halaman dari pathname — termasuk halaman turunan (detail reseller). */
export function pageTitleFor(pathname: string): { title: string; parent?: { label: string; href: string } } {
  const all = [...NAV_ITEMS, SETTINGS_NAV_ITEM];
  const exact = all.find((item) => item.href === pathname);
  if (exact) return { title: exact.label };

  if (pathname.startsWith("/resellers/")) {
    return { title: "Detail Reseller", parent: { label: "Reseller", href: "/resellers" } };
  }
  const parent = all.find((item) => pathname.startsWith(`${item.href}/`));
  if (parent) return { title: "Detail", parent: { label: parent.label, href: parent.href } };
  return { title: "XLOOP PANEL" };
}

/**
 * Top bar: tombol tampilkan sidebar (saat sidebar disembunyikan), judul
 * halaman aktif, tombol pencarian (Ctrl/⌘ K), chip credit (Reseller),
 * role badge, logout.
 */
export function Topbar({
  user,
  sidebarCollapsed,
  onShowSidebar,
  sidebarToggleRef,
  onOpenPalette,
  logoutRequested,
  onLogoutRequestHandled,
}: {
  user: TopbarUser;
  sidebarCollapsed: boolean;
  onShowSidebar: () => void;
  /** Target fokus setelah sidebar disembunyikan (lihat DashboardShell). */
  sidebarToggleRef?: RefObject<HTMLButtonElement>;
  onOpenPalette: () => void;
  /** Dipicu command palette ("Logout") — membuka dialog konfirmasi yang sama. */
  logoutRequested?: boolean;
  onLogoutRequestHandled?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Permintaan logout dari palette → buka dialog konfirmasi sekali.
  useEffect(() => {
    if (!logoutRequested) return;
    setConfirmOpen(true);
    onLogoutRequestHandled?.();
  }, [logoutRequested, onLogoutRequestHandled]);

  const { title, parent } = pageTitleFor(pathname);

  const logout = async () => {
    setLoading(true);
    try {
      await apiPost("/api/auth/logout");
      router.replace("/login");
    } catch {
      toast.error("Gagal logout. Coba lagi.");
      setLoading(false);
      setConfirmOpen(false);
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/95 px-4 lg:px-6">
      {sidebarCollapsed && (
        <SidebarToggle ref={sidebarToggleRef} collapsed onToggle={onShowSidebar} size={26} />
      )}

      <div className="min-w-0 flex-1">
        <nav aria-label="Lokasi halaman" className="flex min-w-0 items-center gap-1.5 text-body">
          {parent ? (
            <>
              <button
                type="button"
                onClick={() => router.push(parent.href)}
                className="truncate text-muted transition-colors duration-150 hover:text-text"
              >
                {parent.label}
              </button>
              <span className="text-muted" aria-hidden="true">
                /
              </span>
            </>
          ) : null}
          {/* Bukan <h1>: judul halaman sudah dimiliki konten (lihat h1 di tiap view),
              di sini hanya breadcrumb — supaya satu halaman tetap satu judul utama. */}
          <span className="truncate font-medium text-text" title={title}>
            {title}
          </span>
        </nav>
        <p className="hidden truncate text-label text-muted sm:block">
          {user.username} · {user.email}
        </p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Cari menu atau key (Ctrl K)"
          title="Cari menu atau key (Ctrl / ⌘ K)"
          className="flex h-8 items-center gap-2 rounded-control border border-border bg-surface px-2.5 text-label text-muted transition-colors duration-150 hover:bg-surface-raised hover:text-text"
        >
          <Search size={15} strokeWidth={1.5} />
          <span className="hidden md:inline">Cari…</span>
          <kbd className="hidden rounded-control border border-border px-1 font-sans text-[10px] md:inline">Ctrl K</kbd>
        </button>

        {user.role === "reseller" ? (
          <button
            type="button"
            onClick={() => router.push("/credits")}
            title="Sisa credit — klik untuk riwayat"
            className="flex h-8 items-center gap-1.5 rounded-control border border-accent/40 bg-accent/10 px-2.5 text-label font-medium tabular-nums text-accent transition-colors duration-150 hover:bg-accent/20"
          >
            <Coins size={14} strokeWidth={1.5} />
            {formatNumber(user.credit)}
            <span className="hidden sm:inline">credit</span>
          </button>
        ) : null}

        <span className="hidden sm:inline-flex">
          <RoleBadge role={user.role} />
        </span>

        <Button
          size="sm"
          onClick={() => setConfirmOpen(true)}
          icon={<LogOut size={16} strokeWidth={1.5} />}
          aria-label="Logout"
        >
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Logout dari panel?"
        message="Kamu akan keluar dari sesi ini dan kembali ke halaman login."
        confirmLabel="Logout"
        loading={loading}
        onConfirm={logout}
        onClose={() => setConfirmOpen(false)}
      />
    </header>
  );
}
