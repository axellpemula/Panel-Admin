"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { cn } from "@/lib/utils/cn";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Ditampilkan di bawah kontrol (mis. pesan error). */
  hint?: string;
  invalid?: boolean;
  id?: string;
  ariaLabel?: string;
  /** Tinggi daftar maksimum sebelum scroll. */
  maxHeight?: number;
}

/**
 * Dropdown custom (bukan <select> bawaan browser).
 * Keyboard: ↑/↓ pindah, Home/End, Enter pilih, Esc tutup.
 * Klik di luar menutup dropdown.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Pilih…",
  disabled = false,
  className,
  hint,
  invalid = false,
  id,
  ariaLabel,
  maxHeight = 260,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );

  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Tutup saat klik di luar.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Saat dibuka, sorot opsi terpilih (atau yang pertama).
  useEffect(() => {
    if (open) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  // Jaga item aktif tetap terlihat.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option || option.disabled) return;
      onChange(option.value);
      setOpen(false);
    },
    [onChange, options],
  );

  const move = useCallback(
    (delta: number) => {
      if (options.length === 0) return;
      let next = activeIndex;
      for (let i = 0; i < options.length; i += 1) {
        next = (next + delta + options.length) % options.length;
        if (!options[next]?.disabled) break;
      }
      setActiveIndex(next);
    },
    [activeIndex, options],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) setOpen(true);
        else move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) setOpen(true);
        else move(-1);
        break;
      case "Home":
        if (open) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (open) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!open) setOpen(true);
        else commit(activeIndex);
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((previous) => !previous)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-control border bg-bg px-3 text-left text-body",
          "transition-colors duration-150 ease-out hover:border-muted/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          invalid ? "border-banned/70" : "border-border",
        )}
      >
        <span className={cn("truncate", selected ? "text-text" : "text-muted")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={1.5}
          className={cn("shrink-0 text-muted transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          style={{ maxHeight }}
          className="absolute z-30 mt-1 w-full overflow-y-auto rounded-control border border-border bg-surface-raised py-1 shadow-pop animate-fade-in"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-label text-muted">Tidak ada pilihan</li>
          ) : (
            options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={option.value}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commit(index)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-body transition-colors duration-150",
                    option.disabled && "cursor-not-allowed opacity-50",
                    isActive && "bg-surface",
                    isSelected ? "text-accent" : "text-text",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="block truncate text-label text-muted">{option.hint}</span>
                    ) : null}
                  </span>
                  {isSelected ? <Check size={16} strokeWidth={1.5} className="shrink-0" /> : null}
                </li>
              );
            })
          )}
        </ul>
      ) : null}

      {hint ? <p className="mt-1 text-label text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * Grup radio sederhana (dipakai untuk pilihan "Preset / Custom" durasi).
 */
export function RadioGroup({
  value,
  onChange,
  options,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  name: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-control border px-3 text-body transition-colors duration-150",
              checked
                ? "border-accent/60 bg-accent/10 text-text"
                : "border-border bg-surface text-muted hover:bg-surface-raised",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="h-3.5 w-3.5 accent-[rgb(var(--c-accent))]"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
