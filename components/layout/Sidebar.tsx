"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { navItemsFor, SETTINGS_NAV_ITEM, type NavItem } from "@/components/layout/nav";
import { SidebarToggle } from "@/components/layout/SidebarToggle";
import { cn } from "@/lib/utils/cn";
import { SIDEBAR_ID } from "@/lib/constants";

/**
 * Sidebar kiri fixed.
 * - ≥ lg: lebar 224px dengan label teks.
 * - < lg: collapse jadi icon-only (rail 56px), tetap bisa di-tap (target 40px+).
 *
 * Bisa disembunyikan sepenuhnya lewat tombol logo X 3D di header-nya
 * (`SidebarToggle`); saat tersembunyi, tombol X di topbar mengembalikannya.
 *
 * Susunan: header → menu kerja (scroll) → menu Pengaturan (selalu di paling
 * bawah, dipisah garis) → footer versi.
 */
export function Sidebar({
  role,
  collapsed,
  onHide,
}: {
  role: "owner" | "reseller";
  collapsed: boolean;
  /** Dipanggil tombol X di header: sembunyikan panel. */
  onHide: () => void;
}) {
  const pathname = usePathname();
  const items = navItemsFor(role);

  // Jangan pasang `translate-x` dan utility `inset-*` bersamaan: pada elemen
  // ber-transform, inset membuat containing block sendiri dan menekan lebar
  // konten. Jadi posisinya selalu `left-0`; yang berubah hanya transform-nya.
  return (
    <aside
      id={SIDEBAR_ID}
      aria-hidden={collapsed}
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex w-14 flex-col border-r border-border bg-surface",
        "transition-transform duration-150 ease-out lg:w-56",
        collapsed ? "-translate-x-full" : "translate-x-0",
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-border px-2 lg:px-3">
        <SidebarToggle
          collapsed={collapsed}
          onToggle={onHide}
          size={28}
          tabIndex={collapsed ? -1 : undefined}
          className="-ml-1"
        />
        <span className="hidden text-body font-medium tracking-tight lg:inline">XLOOP PANEL</span>
      </div>

      <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto py-2">
        <ul className="space-y-0.5 px-1.5 lg:px-2">
          {items.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} collapsed={collapsed} />
            </li>
          ))}
        </ul>
      </nav>

      {/* Menu Pengaturan — selalu di paling bawah, terpisah dari menu kerja. */}
      <nav aria-label="Pengaturan" className="border-t border-border py-2">
        <ul className="px-1.5 lg:px-2">
          <li>
            <NavLink item={SETTINGS_NAV_ITEM} pathname={pathname} collapsed={collapsed} />
          </li>
        </ul>
      </nav>

      <div className="hidden border-t border-border px-4 py-3 lg:block">
        <p className="text-label text-muted">XLOOP PANEL v1.0</p>
      </div>
    </aside>
  );
}

/** Satu tautan menu — tampilan sama untuk menu kerja maupun Pengaturan. */
function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.label}
      tabIndex={collapsed ? -1 : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-[40px] items-center gap-3 rounded-control px-2.5 text-body transition-colors duration-150 ease-out",
        "justify-center lg:justify-start",
        active ? "bg-surface-raised text-accent" : "text-muted hover:bg-surface-raised hover:text-text",
      )}
    >
      <Icon size={18} strokeWidth={1.5} className="shrink-0" />
      <span className="hidden truncate lg:inline">{item.label}</span>
    </Link>
  );
}
