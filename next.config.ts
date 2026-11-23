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
  async headers() {
    return [
      {
        // Phones must always check for a new worker; never let a CDN pin an old one.
        source: '/service-worker.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
      },
    ];
  },
  outputFileTracingIncludes: {
    '/api/local-shipping/*': ['./public/fonts/local-shipping/**/*'],
  },
} satisfies NextConfig;

export default nextConfig;
