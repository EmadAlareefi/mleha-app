import type { NextConfig } from "next";

const nextConfig = {
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
      {
        protocol: 'https',
        hostname: 'cdn.files.salla.network',
      },
    ],
  },
  outputFileTracingIncludes: {
    '/api/local-shipping/*': ['./public/fonts/local-shipping/**/*'],
  },
} satisfies NextConfig;

export default nextConfig;
