import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import type { CSSProperties } from "react";

import { ToastProvider } from "@/components/ui/Toast";
import { parseTheme, THEME_COOKIE, themeColorHex, themeCssVariables } from "@/lib/theme";

import "./globals.css";

// Geist Sans (UI) + Geist Mono (key & HWID) — di-serve lewat next/font,
// tanpa request ke CDN saat runtime.
const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "XLOOP PANEL",
  description: "Key management panel XLOOP — kelola tool, duration, key, reseller, dan credit.",
  robots: { index: false, follow: false },
};

/** Tema dibaca dari cookie `xloop_theme` (diatur di menu Pengaturan). */
function currentTheme() {
  return parseTheme(cookies().get(THEME_COOKIE.name)?.value);
}

/** `theme-color` mengikuti palet dasar yang dipilih (bar atas browser HP). */
export function generateViewport(): Viewport {
  return {
    width: "device-width",
    initialScale: 1,
    themeColor: themeColorHex(currentTheme()),
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // CSS variable tema ditulis sebagai inline style di <html> supaya warna
  // pilihan user sudah final di HTML pertama — tidak berkedip dari default.
  const themeStyle = themeCssVariables(currentTheme()) as CSSProperties;

  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} dark`}
      style={themeStyle}
    >
      <body className="min-h-screen bg-bg font-sans text-body text-text antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
