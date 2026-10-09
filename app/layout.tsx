import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { ToastProvider } from "@/components/ui/Toast";

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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1c1b19",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body className="min-h-screen bg-bg font-sans text-body text-text antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
