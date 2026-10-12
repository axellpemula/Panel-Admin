import type { Metadata } from "next";
import { cookies } from "next/headers";

import { SettingsView, type AppInfo } from "@/components/dashboard/SettingsView";
import { loadRuntime, publicSettings } from "@/lib/api/settings";
import { requireSession } from "@/lib/api/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbMode, licensePublicKey, sqliteDatabasePath } from "@/lib/env";
import { DENSITY_COOKIE, parseDensity } from "@/lib/density";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

import nextPackage from "next/package.json";
import appPackage from "@/package.json";

export const metadata: Metadata = {
  title: "Pengaturan · XLOOP PANEL",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession("/settings");
  const mode = dbMode();

  const admin = createAdminClient();
  const runtime = await loadRuntime(admin);
  const limited = publicSettings(runtime);

  const resellers =
    session.isOwner
      ? ((
          await admin
            .from("profiles")
            .select("id, username")
            .eq("role", "reseller")
            .order("username", { ascending: true })
        ).data ?? [])
      : [];

  const appInfo: AppInfo = {
    name: "XLOOP PANEL",
    version: appPackage.version,
    nextVersion: nextPackage.version,
    nodeVersion: process.version,
    dbMode: mode,
    sqlitePath: mode === "sqlite" ? sqliteDatabasePath() : null,
    signingKeyReady: Boolean(licensePublicKey()),
    tokenTtlSeconds: runtime.validate.tokenTtlSeconds,
    timezone: "Asia/Jakarta",
    keyFormat: "XLVP-XXXX-XXXX",
    limits: {
      maxDeviceMin: limited.limits.maxDeviceMin,
      maxDeviceMax: limited.limits.maxDeviceMax,
      quantityOwnerMax: limited.limits.quantityOwnerMax,
      quantityResellerMax: limited.limits.quantityResellerMax,
      hwidResetLimit: limited.hwid.resetLimit,
      hwidResetWindowHours: limited.hwid.resetWindowHours,
      attemptsRetentionDays: limited.retention.attemptsDays,
    },
  };

  return (
    <SettingsView
      account={{
        id: session.userId,
        username: session.profile.username,
        email: session.profile.email,
        role: session.profile.role,
        credit: session.profile.credit,
        createdAt: session.profile.created_at,
      }}
      appInfo={appInfo}
      resellers={resellers as { id: string; username: string }[]}
      initialTheme={parseTheme(cookies().get(THEME_COOKIE.name)?.value)}
      initialDensity={parseDensity(cookies().get(DENSITY_COOKIE.name)?.value)}
    />
  );
}
