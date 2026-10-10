import type { Config } from "tailwindcss";

/**
 * Semua warna diambil dari CSS variables di app/globals.css.
 * Jangan hardcode nilai hex di komponen — pakai token di bawah ini.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--c-bg) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-raised": "rgb(var(--c-surface-raised) / <alpha-value>)",
        border: "rgb(var(--c-border) / <alpha-value>)",
        text: "rgb(var(--c-text) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        "accent-fg": "rgb(var(--c-accent-fg) / <alpha-value>)",
        active: "rgb(var(--c-active) / <alpha-value>)",
        expired: "rgb(var(--c-expired) / <alpha-value>)",
        banned: "rgb(var(--c-banned) / <alpha-value>)",
      },
      borderRadius: {
        control: "6px",
        card: "8px",
      },
      fontSize: {
        label: ["12px", { lineHeight: "16px" }],
        body: ["14px", { lineHeight: "20px" }],
        title: ["20px", { lineHeight: "28px" }],
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        pop: "0 4px 16px rgb(0 0 0 / 0.35)",
      },
      transitionDuration: {
        150: "150ms",
        200: "200ms",
      },
      maxWidth: {
        content: "1280px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "60%": { opacity: "1", transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        /* ---------- Splash / overlay loading (sebelum masuk dashboard) ---------- */
        /* Mark X: 3D tilt + scale breathing. */
        "splash-float": {
          "0%, 100%": { transform: "rotateX(14deg) rotateY(-22deg) translateY(0) scale(1)" },
          "50%": { transform: "rotateX(-10deg) rotateY(18deg) translateY(-3px) scale(1.05)" },
        },
        /* Glow utama di belakang mark: napas halus. */
        "splash-glow": {
          "0%, 100%": { opacity: "0.45", transform: "scale(0.9)" },
          "50%": { opacity: "0.9", transform: "scale(1.15)" },
        },
        /* Ring pulse yang membesar & memudar (ripple). */
        "splash-ring": {
          "0%": { opacity: "0.7", transform: "scale(0.7)" },
          "100%": { opacity: "0", transform: "scale(1.4)" },
        },
        /* Orbit berputar (cincin conic gradient). */
        "splash-orbit": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        /* Orbit berputar terbalik (counter-rotate) untuk cincin dalam. */
        "splash-orbit-rev": {
          from: { transform: "rotate(360deg)" },
          to: { transform: "rotate(0deg)" },
        },
        /* Titik yang mengorbit pada cincin. */
        "splash-dot": {
          "0%": { transform: "rotate(0deg) translateX(0) rotate(0deg)" },
          "100%": { transform: "rotate(360deg) translateX(0) rotate(-360deg)" },
        },
        /* Grid background: pan ke bawah pelan supaya terasa "bergerak maju". */
        "splash-grid": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "0 40px" },
        },
        /* Scan line menyapu vertikal. */
        "splash-scan": {
          "0%": { transform: "translateY(-100%)", opacity: "0" },
          "10%": { opacity: "1" },
          "90%": { opacity: "1" },
          "100%": { transform: "translateY(240%)", opacity: "0" },
        },
        /* Progress bar: aksen menyapu dengan trail yang smooth. */
        "splash-progress": {
          "0%": { transform: "translateX(-120%) scaleX(0.4)" },
          "60%": { transform: "translateX(30%) scaleX(0.9)" },
          "100%": { transform: "translateX(360%) scaleX(0.4)" },
        },
        /* Progress fill: bar utama mengisi pelan. */
        "splash-fill": {
          "0%": { width: "0%" },
          "25%": { width: "28%" },
          "55%": { width: "62%" },
          "80%": { width: "86%" },
          "100%": { width: "96%" },
        },
        /* Titik loading "..." berdenyut bergantian. */
        "splash-blink": {
          "0%, 100%": { opacity: "0.25", transform: "translateY(0)" },
          "50%": { opacity: "1", transform: "translateY(-1px)" },
        },
        /* Partikel melayang ke atas (debu bercahaya). */
        "splash-particle": {
          "0%": { opacity: "0", transform: "translateY(0) scale(0.6)" },
          "20%": { opacity: "0.9" },
          "100%": { opacity: "0", transform: "translateY(-80px) scale(1.1)" },
        },
        /* Shimmer untuk skeleton dashboard. */
        "skeleton-shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        /* Bar skeleton chart naik-turun (wave). */
        "skeleton-bar": {
          "0%, 100%": { transform: "scaleY(0.55)" },
          "50%": { transform: "scaleY(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 250ms ease-out both",
        "fade-up": "fade-up 350ms ease-out both",
        "pop-in": "pop-in 250ms ease-out both",
        "scale-in": "scale-in 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "splash-float": "splash-float 3.2s ease-in-out infinite",
        "splash-glow": "splash-glow 3.2s ease-in-out infinite",
        "splash-ring": "splash-ring 2.2s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        "splash-orbit": "splash-orbit 2.8s linear infinite",
        "splash-orbit-rev": "splash-orbit-rev 4.2s linear infinite",
        "splash-grid": "splash-grid 3s linear infinite",
        "splash-scan": "splash-scan 2.4s ease-in-out infinite",
        "splash-progress": "splash-progress 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite",
        "splash-fill": "splash-fill 1.8s ease-out both",
        "splash-blink": "splash-blink 1.2s ease-in-out infinite",
        "splash-particle": "splash-particle 2.4s ease-out infinite",
        "skeleton-shimmer": "skeleton-shimmer 1.6s linear infinite",
        "skeleton-bar": "skeleton-bar 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
