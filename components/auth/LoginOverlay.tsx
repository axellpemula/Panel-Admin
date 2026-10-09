"use client";

import { useEffect, useMemo, useState } from "react";

import { XloopMark } from "@/components/ui/XloopMark";

/**
 * Overlay loading interaktif setelah login sukses — tampil sebelum masuk dashboard.
 *
 * Dibanding versi sebelumnya (cincin + tilt + shimmer sederhana), splash ini jauh
 * lebih hidup supaya user merasa aplikasi sedang "bekerja" bukan cuma nunggu diam:
 *
 *   • Background grid radial yang bergerak pelan (kesan terbang maju).
 *   • Scan-line vertikal menyapu di area logo.
 *   • Mark X dengan 3D float + breathe.
 *   • Tiga lapis cincin orbit:
 *       - cincin luar (conic aksen) berputar cepat,
 *       - cincin tengah (dashed) counter-rotate lambat,
 *       - cincin dalam (statis) dengan ripple pulse yang membesar.
 *   • Dua dot (accent + aktif) yang mengorbit mengikuti cincin luar.
 *   • 6 partikel cahaya melayang ke atas dengan delay acak.
 *   • Wordmark XLOOP PANEL per-huruf fade-up bergantian.
 *   • Progress bar yang benar-benar terisi (0 → 96%) dengan persentase.
 *   • Status text yang berganti-ganti (sekuens inisialisasi) sesuai progress.
 *
 * Total durasi splash mengikuti konstanta ENTER_DELAY_MS di LoginForm.
 * Semua animasi menghormati `prefers-reduced-motion` via globals.css.
 */

const STATUS_STEPS: { at: number; text: string }[] = [
  { at: 0, text: "Memverifikasi sesi" },
  { at: 18, text: "Menyiapkan workspace" },
  { at: 40, text: "Memuat data reseller" },
  { at: 62, text: "Mengambil statistik" },
  { at: 82, text: "Membuka dashboard" },
];

/** Hitung status yang aktif berdasarkan progress (0–100). */
function pickStatus(progress: number): string {
  let active = STATUS_STEPS[0].text;
  for (const step of STATUS_STEPS) {
    if (progress >= step.at) active = step.text;
  }
  return active;
}

export function LoginOverlay({ label }: { label?: string }) {
  // Progress 0 → 96 selama splash ditampilkan (tidak pernah 100 supaya tidak
  // terlihat "selesai" sebelum halaman dashboard beneran dimount).
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Durasi total splash (ms) — sinkron dengan ENTER_DELAY_MS di LoginForm.
    const DURATION = 1700;
    const START = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const elapsed = now - START;
      const t = Math.min(1, elapsed / DURATION);
      // Ease-out cubic supaya progress terasa natural (cepat di awal, melambat).
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(Math.round(eased * 96));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const statusText = useMemo(() => pickStatus(progress), [progress]);

  // Partikel cahaya: 6 butir dengan posisi sudut & jarak acak yang ditentukan
  // saat mount (tidak berubah tiap render).
  const particles = useMemo(
    () =>
      Array.from({ length: 6 }).map((_, i) => ({
        id: i,
        angle: (i / 6) * 360 + (Math.random() * 30 - 15),
        distance: 90 + Math.random() * 22,
        delay: Math.random() * 1.6,
        duration: 2 + Math.random() * 1.2,
        size: 2 + Math.random() * 2,
      })),
    [],
  );

  // Wordmark dipecah per huruf untuk animasi fade-up bergantian.
  const letters = "XLOOP PANEL".split("");

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[60] flex min-h-screen flex-col items-center justify-center overflow-hidden bg-bg animate-fade-in"
    >
      {/* Background: radial vignette agar logo ter-fokus di tengah. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgb(var(--c-accent) / 0.07) 0%, rgb(var(--c-bg) / 0) 55%)",
        }}
      />

      {/* Grid background yang bergerak pelan ke bawah (kesan maju / docking). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.12] animate-splash-grid"
        style={{
          backgroundImage:
            "linear-gradient(rgb(var(--c-border)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-border)) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "radial-gradient(ellipse at 50% 45%, #000 20%, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 50% 45%, #000 20%, transparent 70%)",
        }}
      />

      {/* Panggung logo. */}
      <div className="relative flex items-center justify-center">
        {/* Glow napas utama di belakang mark. */}
        <span
          aria-hidden="true"
          className="absolute h-52 w-52 rounded-full bg-accent/15 blur-3xl animate-splash-glow"
        />

        {/* Ripple pulse — dua cincin yang membesar dan memudar bergantian. */}
        <span
          aria-hidden="true"
          className="absolute h-32 w-32 rounded-full border border-accent/30 animate-splash-ring"
        />
        <span
          aria-hidden="true"
          className="absolute h-32 w-32 rounded-full border border-accent/20 animate-splash-ring"
          style={{ animationDelay: "1.1s" }}
        />

        {/* Cincin luar: conic gradient berputar cepat dengan mask jadi cincin tipis. */}
        <span
          aria-hidden="true"
          className="absolute h-40 w-40 animate-splash-orbit rounded-full"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, rgb(var(--c-accent)) 60deg, transparent 120deg, rgb(var(--c-accent) / 0.7) 220deg, transparent 290deg, rgb(var(--c-accent)) 360deg)",
            WebkitMask:
              "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 1px))",
          }}
        >
          {/* Dot aksen yang menumpang di cincin luar. */}
          <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
            <span className="block h-2 w-2 rounded-full bg-accent shadow-[0_0_12px_rgb(var(--c-accent))]" />
          </span>
        </span>

        {/* Cincin tengah: dashed, counter-rotate lambat, tone lebih lembut. */}
        <span
          aria-hidden="true"
          className="absolute h-32 w-32 animate-splash-orbit-rev rounded-full border border-dashed border-accent/30"
        >
          {/* Dot aktif (hijau) pada cincin tengah. */}
          <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
            <span className="block h-1.5 w-1.5 rounded-full bg-active shadow-[0_0_8px_rgb(var(--c-active))]" />
          </span>
        </span>

        {/* Cincin dalam: border solid statis sebagai penyeimbang visual. */}
        <span
          aria-hidden="true"
          className="absolute h-24 w-24 rounded-full border border-border"
        />

        {/* Scan line yang menyapu vertikal di area logo (crop ke area kecil). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-40 w-40 overflow-hidden rounded-full"
        >
          <span
            className="absolute left-0 right-0 h-8 animate-splash-scan"
            style={{
              background:
                "linear-gradient(to bottom, transparent, rgb(var(--c-accent) / 0.35), transparent)",
              filter: "blur(3px)",
            }}
          />
        </span>

        {/* Mark X: tampil dengan scale-in pop lalu float 3D. */}
        <div style={{ perspective: 700 }} className="animate-scale-in">
          <XloopMark size={80} className="animate-splash-float" />
        </div>

        {/* Partikel cahaya yang terlepas ke atas dari orbit luar. */}
        {particles.map((p) => (
          <span
            key={p.id}
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 block animate-splash-particle rounded-full bg-accent/80"
            style={{
              width: p.size,
              height: p.size,
              margin: -p.size / 2,
              transform: `rotate(${p.angle}deg) translateY(-${p.distance}px)`,
              transformOrigin: "center",
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
              boxShadow: "0 0 8px rgb(var(--c-accent) / 0.8)",
            }}
          />
        ))}
      </div>

      {/* Wordmark — per huruf fade-up bergantian supaya terasa "ketik". */}
      <p
        className="mt-8 flex text-[13px] font-medium tracking-[0.35em] pl-[0.35em] text-text select-none"
        aria-label="XLOOP PANEL"
      >
        {letters.map((ch, i) => (
          <span
            key={i}
            className={ch === " " ? "w-2" : "inline-block animate-fade-up"}
            style={{
              animationDelay: `${120 + i * 55}ms`,
              opacity: 0,
            }}
          >
            {ch === " " ? "\u00A0" : ch}
          </span>
        ))}
      </p>

      {/* Progress bar: track + fill yang terisi + shimmer aksen menyapu. */}
      <div
        aria-hidden="true"
        className="relative mt-5 h-1 w-56 overflow-hidden rounded-full bg-surface-raised"
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent/80 via-accent to-accent/80 animate-splash-fill"
          style={{ boxShadow: "0 0 10px rgb(var(--c-accent) / 0.5)" }}
        />
        <span className="absolute inset-0 overflow-hidden rounded-full">
          <span className="block h-full w-1/3 -skew-x-12 bg-white/30 animate-splash-progress" />
        </span>
      </div>

      {/* Baris status: teks + titik berdenyut + persentase. */}
      <div className="mt-3 flex items-center gap-2 animate-fade-in" style={{ animationDelay: "200ms" }}>
        <p className="text-label text-muted">
          {label ?? statusText}
          <span className="inline-flex ml-0.5">
            <span className="animate-splash-blink">.</span>
            <span className="animate-splash-blink" style={{ animationDelay: "0.25s" }}>.</span>
            <span className="animate-splash-blink" style={{ animationDelay: "0.5s" }}>.</span>
          </span>
        </p>
        <span className="font-mono text-label text-accent/80 tabular-nums">
          {progress}%
        </span>
      </div>
    </div>
  );
}

export default LoginOverlay;
