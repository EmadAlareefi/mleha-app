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
  async redirects() {
    // The prep board, shipping board and stuck-orders pages were merged into the
    // live dashboard; old bookmarks on warehouse screens land there. Redirects run
    // before middleware, so shipping-board users are not refused on the old URL.
    // The old admin page (/admin/order-prep) and /order-monitor went the same way.
    return ['/admin/order-prep', '/order-monitor', ...['board', 'shipping', 'stuck'].map((page) => `/admin/order-prep/${page}`)].map(
      (source) => ({ source, destination: '/admin/order-prep/live', permanent: false }),
    );
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
