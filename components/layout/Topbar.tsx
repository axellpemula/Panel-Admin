"use client";

import { LogOut } from "lucide-react";
import type { RefObject } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Modal";
import { RoleBadge } from "@/components/ui/Badge";
import { SidebarToggle } from "@/components/layout/SidebarToggle";
import { useToast } from "@/components/ui/Toast";
import { apiPost } from "@/lib/api/client";

export interface TopbarUser {
  username: string;
  email: string;
  role: "owner" | "reseller";
  credit: number;
}

/**
 * Top bar: tombol tampilkan sidebar (muncul hanya saat sidebar disembunyikan),
 * nama user, role badge, tombol logout.
 */
export function Topbar({
  user,
  sidebarCollapsed,
  onShowSidebar,
  sidebarToggleRef,
}: {
  user: TopbarUser;
  sidebarCollapsed: boolean;
  onShowSidebar: () => void;
  /** Target fokus setelah sidebar disembunyikan (lihat DashboardShell). */
  sidebarToggleRef?: RefObject<HTMLButtonElement>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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
      {
        sidebarCollapsed && (
          <SidebarToggle
            ref={sidebarToggleRef}
            collapsed
            onToggle={onShowSidebar}
            size={26}
          />
        )
      }

      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-medium">{user.username}</p>
        <p className="hidden truncate text-label text-muted sm:block">{user.email}</p>
      </div>

      <div className="flex items-center gap-3">
        <RoleBadge role={user.role} />
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
