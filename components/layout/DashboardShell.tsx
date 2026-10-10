"use client";

import { useEffect, useRef, useState } from "react";

import { CommandPalette } from "@/components/layout/CommandPalette";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar, type TopbarUser } from "@/components/layout/Topbar";
import { cn } from "@/lib/utils/cn";

/**
 * Kerangka dashboard (client) yang menyimpan status buka/tutup sidebar.
 *
 * Sidebar & area konten tidak pernah dilepas dari pohon React — hanya kelas
 * transform/`padding-left`-nya yang berubah. Jadi isi halaman tidak di-remount,
 * state (mis. filter tabel) aman, dan transisinya cukup 150ms sesuai spesifikasi.
 *
 * Kenapa di client, bukan di server layout: kalau layout me-`redirect()` saat
 * cookie toggle berubah, setiap klik toggle akan memicu perjalanan server dan
 * bisa membatalkan navigasi yang sedang berjalan.
 */
export function DashboardShell({
  user,
  role,
  initialCollapsed,
  children,
}: {
  user: TopbarUser;
  role: "owner" | "reseller";
  /** Dibaca dari cookie di server supaya render pertama sudah sesuai pilihan user. */
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const openToggleRef = useRef<HTMLButtonElement>(null);
  const wasCollapsed = useRef(initialCollapsed);

  /**
   * Setelah sidebar ditutup, tombol X-nya ikut tersembunyi — jadi fokus
   * dipindahkan ke tombol X di topbar yang baru muncul, supaya pengguna keyboard
   * tidak "kehilangan" posisinya. Tidak dijalankan saat render pertama
   * (cookie/status awal), hanya saat transisi buka → tutup.
   */
  useEffect(() => {
    if (!wasCollapsed.current && collapsed) openToggleRef.current?.focus();
    wasCollapsed.current = collapsed;
  }, [collapsed]);

  const hideSidebar = () => setCollapsed(true);
  const showSidebar = () => setCollapsed(false);

  // --- Command palette (Ctrl/⌘ + K) ---
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [logoutRequested, setLogoutRequested] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar role={role} collapsed={collapsed} onHide={hideSidebar} />

      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-150 ease-out",
          // Ruang untuk sidebar: rail 56px di layar kecil, 224px di ≥ lg.
          // Saat disembunyikan, padding-nya nol supaya konten memakai lebar penuh.
          collapsed ? "pl-0" : "pl-14 lg:pl-56",
        )}
      >
        <Topbar
          user={user}
          sidebarCollapsed={collapsed}
          onShowSidebar={showSidebar}
          sidebarToggleRef={openToggleRef}
          onOpenPalette={() => setPaletteOpen(true)}
          logoutRequested={logoutRequested}
          onLogoutRequestHandled={() => setLogoutRequested(false)}
        />

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          role={role}
          onLogout={() => setLogoutRequested(true)}
        />

        <main className="flex-1 px-4 py-6 lg:px-6">
          <div className="mx-auto w-full max-w-content">{children}</div>
        </main>

        <footer className="border-t border-border px-4 py-4 lg:px-6">
          <p className="mx-auto max-w-content text-label text-muted">
            XLOOP PANEL · {role === "owner" ? "Owner" : "Reseller"}
          </p>
        </footer>
      </div>
    </div>
  );
}
