"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils/cn";
import { SIDEBAR_COOKIE, SIDEBAR_ID } from "@/lib/constants";
import { writeCookie } from "@/lib/utils/cookie";
import { XloopMark } from "@/components/ui/XloopMark";

/**
 * Tombol buka/tutup sidebar.
 *
 * Ikonnya adalah logo X 3D yang sama dengan identitas panel — kalau sidebar
 * sedang tampil, klik X untuk menyembunyikannya; kalau tersembunyi, X di topbar
 * mengembalikannya. Tooltip + `aria-label` selalu menyebut aksi berikutnya
 * ("Sembunyikan"/"Tampilkan") supaya jelas untuk keyboard & screen reader.
 *
 * Status disimpan sebagai cookie (`SIDEBAR_COOKIE`) agar pilihan pengguna
 * bertahan setelah refresh tanpa membuat sidebar berkedip.
 */
export interface SidebarToggleProps {
  /** true = sidebar sedang tersembunyi. */
  collapsed: boolean;
  onToggle: () => void;
  size?: number;
  className?: string;
  /** Dipakai sidebar: tombolnya di-skip dari urutan Tab saat panel tersembunyi. */
  tabIndex?: number;
}

export const SidebarToggle = forwardRef<HTMLButtonElement, SidebarToggleProps>(
  function SidebarToggle({ collapsed, onToggle, size = 28, className, tabIndex }, ref) {
    const label = collapsed ? "Tampilkan sidebar" : "Sembunyikan sidebar";

    const handleClick = () => {
      writeCookie(
        SIDEBAR_COOKIE.name,
        collapsed ? SIDEBAR_COOKIE.open : SIDEBAR_COOKIE.hidden,
        SIDEBAR_COOKIE.maxAgeSeconds,
      );
      onToggle();
    };

    return (
      <button
        ref={ref}
        type="button"
        onClick={handleClick}
        title={label}
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls={SIDEBAR_ID}
        tabIndex={tabIndex}
        className={cn(
          "inline-flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center",
          "rounded-control border border-transparent text-text transition-colors duration-150 ease-out",
          "hover:border-border hover:bg-surface-raised",
          className,
        )}
      >
        <XloopMark size={size} title={label} />
      </button>
    );
  },
);
