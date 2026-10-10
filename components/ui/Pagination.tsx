"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { formatNumber } from "@/lib/utils/format";

/** Pagination sederhana: info rentang + tombol prev/next. */
export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onChange: (page: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <p className="text-label text-muted tabular-nums">
        {formatNumber(from)}–{formatNumber(to)} dari {formatNumber(total)}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Halaman sebelumnya"
          title="Halaman sebelumnya"
          icon={<ChevronLeft size={16} strokeWidth={1.5} />}
        >
        </Button>
        <span className="text-label text-muted tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          size="sm"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Halaman berikutnya"
          title="Halaman berikutnya"
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}
