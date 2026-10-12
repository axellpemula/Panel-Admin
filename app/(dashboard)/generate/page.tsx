import type { Metadata } from "next";

import { GenerateForm } from "@/app/(dashboard)/generate/GenerateForm";
import { requireSession } from "@/lib/api/session";

export const metadata: Metadata = {
  title: "Generate Key · XLOOP PANEL",
};

export default async function GeneratePage() {
  const session = await requireSession("/generate");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-title font-medium">Generate Key</h1>
        <p className="mt-1 text-body text-muted">
          Buat key baru untuk tool yang dipilih.
          {session.isOwner
            ? " Owner bisa memakai preset durasi atau durasi custom, tanpa potongan credit."
            : " Durasi memakai preset yang sudah di sediakan — biaya dihitung 1 unit = 1 key × 1 device, jadi quantity dan max device sama-sama menambah biaya."}
        </p>
      </header>

      <GenerateForm isOwner={session.isOwner} initialCredit={session.profile.credit} />
    </div>
  );
}
