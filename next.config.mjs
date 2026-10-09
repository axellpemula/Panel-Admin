/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Lint dijalankan terpisah lewat `npm run lint`, bukan saat build.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Dipakai hanya di server (API routes) — tidak perlu di-bundle ulang ke client.
    serverComponentsExternalPackages: ["@supabase/supabase-js", "@supabase/ssr", "better-sqlite3"],
  },
};

export default nextConfig;
