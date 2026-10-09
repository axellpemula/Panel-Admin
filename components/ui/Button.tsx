"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

/**
 * Dua varian dasar: primary (accent) dan ghost/outline.
 * Varian `danger` hanya untuk tombol di dalam dialog konfirmasi.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "ghost", size = "md", icon, loading = false, className, children, disabled, ...props },
  ref,
) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-control border font-medium " +
    "transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 " +
    "whitespace-nowrap select-none";

  const sizes: Record<Size, string> = {
    sm: "h-8 px-2.5 text-label",
    md: "h-10 min-h-[40px] px-3 text-body",
  };

  const variants: Record<Variant, string> = {
    primary:
      "border-accent bg-accent text-[#20140f] hover:bg-accent/90 hover:border-accent/90 active:bg-accent/80",
    ghost: "border-border bg-surface text-text hover:bg-surface-raised hover:border-muted/50",
    danger: "border-banned/60 bg-banned/10 text-banned hover:bg-banned/20",
  };

  return (
    <button
      ref={ref}
      type={props.type ?? "button"}
      className={cn(base, sizes[size], variants[variant], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

/** Indikator loading kecil (tanpa library animasi). */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent",
        className,
      )}
    />
  );
}
