"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

/** Label + kontrol + hint/error, dipakai di semua form. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  required = false,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-label text-muted">
        {label}
        {required ? <span className="ml-1 text-accent">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-label text-banned">{error}</p>
      ) : hint ? (
        <p className="text-label text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function Input({ invalid = false, mono = false, className, ...props }: InputProps) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cn("field", mono && "font-mono", invalid && "border-banned/70", className)}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function Textarea({ invalid = false, mono = false, className, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={cn("field min-h-[80px] resize-y", mono && "font-mono", invalid && "border-banned/70", className)}
    />
  );
}

/** Toggle on/off sederhana (dipakai untuk status aktif tool/version/preset). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 ease-out",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "border-accent/60 bg-accent/30" : "border-border bg-surface",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all duration-150 ease-out",
            checked ? "left-[18px] bg-accent" : "left-0.5 bg-muted",
          )}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer text-label text-muted">
        {label}
      </label>
    </div>
  );
}
