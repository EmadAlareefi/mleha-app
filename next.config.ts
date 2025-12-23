import type { NextConfig } from "next";

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.salla.sa',
      },
      {
        protocol: 'https',
        hostname: 'salla.sa',
      },
    ],
  },
} satisfies NextConfig & { eslint?: { ignoreDuringBuilds?: boolean } };

export default nextConfig;
