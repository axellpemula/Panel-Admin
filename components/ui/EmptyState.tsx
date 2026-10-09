import type { ReactNode } from "react";

/**
 * Empty state: satu kalimat singkat + satu tombol aksi. Tanpa ilustrasi.
 */
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <p className="text-body text-muted">{message}</p>
      {action}
    </div>
  );
}
