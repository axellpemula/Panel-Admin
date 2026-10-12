"use client";

import { ArrowRight, CornerDownLeft, KeyRound, LogOut, Plus, Search, Settings } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { StatusBadge } from "@/components/ui/Badge";
import { navItemsFor, SETTINGS_NAV_ITEM, type NavItem } from "@/components/layout/nav";
import { apiGet, buildQuery } from "@/lib/api/client";
import type { KeyListItem } from "@/lib/types/database";
import { cn } from "@/lib/utils/cn";

interface PaletteItem {
  id: string;
  group: "Menu" | "Aksi cepat" | "Key";
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
  /** Konten tambahan di kanan (mis. status key). */
  trailing?: ReactNode;
}

const KEY_LIKE = /^[A-Z0-9-]{3,}$/i;

export function CommandPalette({
  open,
  onClose,
  role,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  role: "owner" | "reseller";
  onLogout: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [keyResults, setKeyResults] = useState<KeyListItem[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = (document.activeElement as HTMLElement | null) ?? null;
    setQuery("");
    setActive(0);
    setKeyResults([]);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      const trigger = lastFocused.current;
      if (trigger && document.contains(trigger)) trigger.focus?.();
      lastFocused.current = null;
    };
  }, [open]);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  useEffect(() => {
    const term = query.trim();
    if (!open || term.length < 3 || !KEY_LIKE.test(term)) {
      setKeyResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = { cancelled: false };
    const timer = window.setTimeout(async () => {
      try {
        const data = await apiGet<{ items: KeyListItem[] }>(
          `/api/keys${buildQuery({ q: term, per_page: 6, page: 1 })}`,
        );
        if (!controller.cancelled) setKeyResults(data.items ?? []);
      } catch {
        if (!controller.cancelled) setKeyResults([]);
      } finally {
        if (!controller.cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      controller.cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  const items = useMemo<PaletteItem[]>(() => {
    const nav: NavItem[] = [...navItemsFor(role), SETTINGS_NAV_ITEM];
    const menu: PaletteItem[] = nav
      .filter((item) => item.href !== pathname)
      .map((item) => ({
        id: `nav:${item.href}`,
        group: "Menu",
        label: item.label,
        hint: item.href,
        icon: <item.icon size={16} strokeWidth={1.5} />,
        run: () => go(item.href),
      }));

    const quick: PaletteItem[] = [
      {
        id: "act:generate",
        group: "Aksi cepat",
        label: "Generate key baru",
        keywords: "buat tambah create",
        icon: <Plus size={16} strokeWidth={1.5} />,
        run: () => go("/generate"),
      },
      {
        id: "act:active-keys",
        group: "Aksi cepat",
        label: "Lihat key aktif",
        keywords: "active status",
        icon: <KeyRound size={16} strokeWidth={1.5} />,
        run: () => go("/keys?status=active"),
      },
      {
        id: "act:theme",
        group: "Aksi cepat",
        label: "Ganti tema warna",
        keywords: "theme warna aksen pengaturan",
        icon: <Settings size={16} strokeWidth={1.5} />,
        run: () => go("/settings"),
      },
      {
        id: "act:logout",
        group: "Aksi cepat",
        label: "Logout",
        keywords: "keluar sign out",
        icon: <LogOut size={16} strokeWidth={1.5} />,
        run: () => {
          onClose();
          onLogout();
        },
      },
    ];

    const keys: PaletteItem[] = keyResults.map((key) => ({
      id: `key:${key.id}`,
      group: "Key",
      label: key.key_value,
      hint: `${key.tool_name} · ${key.version_name}`,
      icon: <KeyRound size={16} strokeWidth={1.5} />,
      trailing: <StatusBadge status={key.status} />,
      run: () => go(`/keys?q=${encodeURIComponent(key.key_value)}`),
    }));

    const term = query.trim().toLowerCase();
    const matches = (item: PaletteItem) =>
      term.length === 0 ||
      item.label.toLowerCase().includes(term) ||
      (item.keywords ?? "").toLowerCase().includes(term) ||
      (item.hint ?? "").toLowerCase().includes(term);

    const list = [...keys, ...menu.filter(matches), ...quick.filter(matches)];

    if (term.length >= 3 && KEY_LIKE.test(query.trim()) && keys.length === 0) {
      list.unshift({
        id: "key:search",
        group: "Key",
        label: `Cari "${query.trim().toUpperCase()}" di Key List`,
        icon: <Search size={16} strokeWidth={1.5} />,
        run: () => go(`/keys?q=${encodeURIComponent(query.trim())}`),
      });
    }
    return list;
  }, [go, keyResults, onClose, onLogout, pathname, query, role]);

  useEffect(() => {
    setActive(0);
  }, [query, keyResults.length]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (items.length === 0 ? 0 : (index + 1) % items.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (items.length === 0 ? 0 : (index - 1 + items.length) % items.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      items[active]?.run();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      event.preventDefault();
      inputRef.current?.focus();
    }
  };

  if (!mounted || !open) return null;

  let lastGroup: string | null = null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="card w-full max-w-xl overflow-hidden shadow-pop"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={16} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ketik menu, aksi, atau key (XLVP-…)"
            role="combobox"
            aria-label="Cari menu, aksi, atau key"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={items.length > 0}
            aria-controls={items.length > 0 ? "command-palette-results" : undefined}
            aria-activedescendant={items[active] ? `command-palette-option-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full bg-transparent text-body text-text outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded-control border border-border px-1.5 py-0.5 text-[11px] text-muted sm:inline">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <p role="status" aria-live="polite" className="px-4 py-8 text-center text-body text-muted">
              {searching ? "Mencari key…" : "Tidak ada yang cocok."}
            </p>
          ) : (
            <div id="command-palette-results" role="listbox" aria-label="Hasil pencarian">
              {items.map((item, index) => {
                const showHeader = item.group !== lastGroup;
                lastGroup = item.group;
                const selected = index === active;
                return (
                  <div key={item.id} role="presentation">
                    {showHeader ? (
                      <p
                        aria-hidden="true"
                        className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted"
                      >
                        {item.group}
                        {item.group === "Key" && searching ? " · mencari…" : ""}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      id={`command-palette-option-${index}`}
                      role="option"
                      aria-selected={selected}
                      data-index={index}
                      onMouseEnter={() => setActive(index)}
                      onClick={item.run}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2 text-left text-body transition-colors duration-100",
                        selected ? "bg-surface-raised text-text" : "text-muted hover:text-text",
                      )}
                    >
                      <span className={cn("shrink-0", selected ? "text-accent" : "text-muted")}>{item.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate", item.group === "Key" && "font-mono text-[13px]")}>
                          {item.label}
                        </span>
                        {item.hint ? <span className="block truncate text-label text-muted">{item.hint}</span> : null}
                      </span>
                      {item.trailing}
                      {selected ? (
                        <CornerDownLeft size={14} strokeWidth={1.5} className="shrink-0 text-muted" aria-hidden="true" />
                      ) : (
                        <ArrowRight size={14} strokeWidth={1.5} className="shrink-0 opacity-0" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted">
          <span>
            <kbd className="rounded-control border border-border px-1">↑</kbd>{" "}
            <kbd className="rounded-control border border-border px-1">↓</kbd> pilih
          </span>
          <span>
            <kbd className="rounded-control border border-border px-1">Enter</kbd> buka
          </span>
          <span className="ml-auto hidden sm:inline">Ctrl / ⌘ + K untuk membuka kapan saja</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
