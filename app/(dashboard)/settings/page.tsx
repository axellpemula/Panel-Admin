import type { Metadata } from "next";
import { cookies } from "next/headers";

import { SettingsView, type AppInfo } from "@/components/dashboard/SettingsView";
import { HWID_RESET, LIMITS, RATE_LIMIT } from "@/lib/constants";
import { requireSession } from "@/lib/api/session";
import { dbMode, licensePublicKey, licenseTokenTtlSeconds, sqliteDatabasePath } from "@/lib/env";
import { DENSITY_COOKIE, parseDensity } from "@/lib/density";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

import nextPackage from "next/package.json";
import appPackage from "@/package.json";

export const metadata: Metadata = {
  title: "Pengaturan · XLOOP PANEL",
};

export const dynamic = "force-dynamic";

/**
 * Halaman Pengaturan (Owner & Reseller): info akun, info web, dan tema warna.
 * Semua data dibaca di server; tema awal dari cookie supaya pratinjau di
 * halaman sinkron dengan warna yang sedang dipakai.
 */
export default async function SettingsPage() {
  const session = await requireSession("/settings");
  const mode = dbMode();

  const appInfo: AppInfo = {
    name: "XLOOP PANEL",
    version: appPackage.version,
    nextVersion: nextPackage.version,
    nodeVersion: process.version,
    dbMode: mode,
    sqlitePath: mode === "sqlite" ? sqliteDatabasePath() : null,
    signingKeyReady: Boolean(licensePublicKey()),
    tokenTtlSeconds: licenseTokenTtlSeconds(),
    timezone: "Asia/Jakarta (WIB, UTC+7)",
    keyFormat: "XLVP-XXXX-XXXX",
    limits: {
      maxDeviceMin: LIMITS.maxDeviceMin,
      maxDeviceMax: LIMITS.maxDeviceMax,
      quantityOwnerMax: LIMITS.quantityOwnerMax,
      quantityResellerMax: LIMITS.quantityResellerMax,
      hwidResetLimit: HWID_RESET.limit,
      hwidResetWindowHours: HWID_RESET.windowHours,
      attemptsRetentionDays: RATE_LIMIT.retentionDays,
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
      initialTheme={parseTheme(cookies().get(THEME_COOKIE.name)?.value)}
      initialDensity={parseDensity(cookies().get(DENSITY_COOKIE.name)?.value)}
    />
  );
}
