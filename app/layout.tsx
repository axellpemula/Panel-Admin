import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import type { CSSProperties } from "react";

import { ToastProvider } from "@/components/ui/Toast";
import { DENSITY_CLASS, DENSITY_COOKIE, parseDensity } from "@/lib/density";
import { parseTheme, THEME_COOKIE, themeColorHex, themeCssVariables } from "@/lib/theme";

import "./globals.css";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "XLOOP PANEL",
  description: "Key management panel XLOOP — kelola tool, duration, key, reseller, dan credit.",
  robots: { index: false, follow: false },
};

function currentTheme() {
  return parseTheme(cookies().get(THEME_COOKIE.name)?.value);
}

export function generateViewport(): Viewport {
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: themeColorHex(currentTheme()),
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeStyle = themeCssVariables(currentTheme()) as CSSProperties;
  const compact = parseDensity(cookies().get(DENSITY_COOKIE.name)?.value) === "compact";

  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} dark${compact ? ` ${DENSITY_CLASS}` : ""}`}
      style={themeStyle}
    >
      <body className="min-h-screen bg-bg font-sans text-body text-text antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
