import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { serviceDefinitions, ServiceKey } from '@/app/lib/service-definitions';

const PUBLIC_PATHS = [
  '/returns',
  '/api/returns',
  '/api/orders/lookup',
  '/api/order-users',
  '/api/order-assignments',
  '/api/order-prep',
  '/api/warehouses',
  '/api/auth',
  '/api/salla/sync-invoices',
  '/salla/webhook',
  '/logo.png',
  '/cv.pdf',
  '/trademark.pdf',
];

const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

const SERVICE_PATHS = new Map<ServiceKey, RegExp[]>([
  ['order-prep', [/^\/order-prep(\/.*)?$/, /^\/order-history(\/.*)?$/]],
  [
    'order-shipping',
    [
      /^\/order-shipping(\/.*)?$/,
      /^\/api\/salla\/create-shipment(\/.*)?$/,
      /^\/api\/salla\/shipments(\/.*)?$/,
    ],
  ],
  [
    'admin-order-prep',
    [/^\/admin\/order-prep(\/.*)?$/, /^\/api\/admin\/order-assignments(\/.*)?$/],
  ],
  ['warehouse', [/^\/warehouse(\/.*)?$/, /^\/api\/shipments(\/.*)?$/]],
  ['local-shipping', [/^\/local-shipping(\/.*)?$/, /^\/api\/shipments(\/.*)?$/]],
  ['warehouse-locations', [/^\/warehouse-locations(\/.*)?$/]],
  [
    'search-update-stock',
    [
      /^\/warehouse\/search-update-stock(\/.*)?$/,
      /^\/api\/warehouse\/stock-search(\/.*)?$/,
      /^\/api\/salla\/products\/quantities\/bulk(\/.*)?$/,
      /^\/api\/product-locations(\/.*)?$/,
    ],
  ],
  ['barcode-labels', [/^\/barcode-labels(\/.*)?$/]],
  ['shipment-assignments', [/^\/shipment-assignments(\/.*)?$/, /^\/api\/shipments(\/.*)?$/]],
  [
    'delivery-agent-tasks',
    [/^\/delivery-agent-tasks(\/.*)?$/, /^\/api\/delivery-agent-tasks(\/.*)?$/, /^\/api\/delivery-agents(\/.*)?$/],
  ],
  ['order-invoice-search', [/^\/order-invoice-search(\/.*)?$/]],
  ['cod-tracker', [/^\/cod-tracker(\/.*)?$/]],
  [
    'my-deliveries',
    [
      /^\/my-deliveries(\/.*)?$/,
      /^\/api\/shipment-assignments(\/.*)?$/,
      /^\/api\/delivery-agent-tasks(\/.*)?$/,
    ],
  ],
  ['returns-management', [/^\/returns-management(\/.*)?$/, /^\/cancel-shipment(\/.*)?$/]],
  ['returns-inspection', [/^\/returns-inspection(\/.*)?$/, /^\/api\/shipments(\/.*)?$/]],
  ['returns-priority', [/^\/returns-priority(\/.*)?$/]],
  ['returns-gifts', [/^\/returns-gifts(\/.*)?$/]],
  ['salla-products', [/^\/salla\/products(\/.*)?$/, /^\/api\/salla\/products(\/.*)?$/, /^\/api\/salla\/requests(\/.*)?$/]],
  ['salla-requests', [/^\/salla\/requests(\/.*)?$/, /^\/api\/salla\/requests(\/.*)?$/]],
  ['settings', [/^\/settings(\/.*)?$/, /^\/erp-settings(\/.*)?$/]],
  ['order-users-management', [/^\/order-users-management(\/.*)?$/]],
  ['user-recognition', [/^\/user-recognition(\/.*)?$/]],
  ['my-recognition', [/^\/my-recognition(\/.*)?$/]],
  ['warehouse-management', [/^\/warehouse-management(\/.*)?$/]],
  ['order-reports', [/^\/order-reports(\/.*)?$/]],
  ['settlements', [/^\/settlements(\/.*)?$/]],
  ['invoices', [/^\/invoices(\/.*)?$/]],
  ['expenses', [/^\/expenses(\/.*)?$/]],
]);

const serviceHomeByKey = new Map<ServiceKey, string>(
  serviceDefinitions.map((service) => [service.key, service.href])
);

const FALLBACK_EXCLUDED_PATHS = new Set(['/warehouse', '/local-shipping', '/returns-management']);

function getFallbackPath(serviceKeys: ServiceKey[]): string {
  for (const key of serviceKeys) {
    const home = serviceHomeByKey.get(key);
    if (home && !FALLBACK_EXCLUDED_PATHS.has(home)) {
      return home;
    }
  }
  return '/';
}

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    // Skip auth logic for explicitly public paths
    if (isPublicPath(path)) {
      return NextResponse.next();
    }

    if (token) {
      const role = token.role as string | undefined;
      if (role === 'admin') {
        return NextResponse.next();
      }

      const serviceKeys = (token.serviceKeys as string[]) || [];
      const allowedServices = serviceKeys.filter((key): key is ServiceKey =>
        SERVICE_PATHS.has(key as ServiceKey)
      ) as ServiceKey[];

      if (
        path === '/' ||
        path.startsWith('/affiliate-stats') ||
        path.startsWith('/api/affiliate-stats')
      ) {
        return NextResponse.next();
      }

      const hasAccess = allowedServices.some((service) =>
        SERVICE_PATHS.get(service)?.some((pattern) => pattern.test(path))
      );

      if (!hasAccess) {
        const fallback = getFallbackPath(allowedServices);
        return NextResponse.redirect(new URL(fallback, req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        if (isPublicPath(req.nextUrl.pathname)) {
          return true;
        }
        return !!token;
      },
    },
    pages: {
      signIn: '/login',
    },
  }
);

// Protect all routes except:
// - /returns (public return/exchange page)
// - /login (login page)
// - /api/returns/* (return API endpoints)
// - /api/orders/lookup (order lookup for returns)
// - /api/order-users/* (order users API - still used for management)
// - /api/order-assignments/* (order assignments API)
// - /salla/webhook (Salla webhook)
// - /api/auth/* (NextAuth endpoints)
// - /_next/* (Next.js internal)
// - /favicon.ico, etc.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - returns (public returns page)
     * - login (login page)
     * - api/returns (returns API)
     * - api/orders/lookup (order lookup)
     * - api/order-users (order users API)
     * - api/order-assignments (order assignments API)
     * - api/auth (NextAuth)
     * - salla/webhook (Salla webhook)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - logo.png, cv.pdf, trademark.pdf (public branding assets)
     */
    '/((?!returns|login|api/returns|api/orders/lookup|api/order-users|api/order-assignments|api/warehouses|api/auth|api/salla/sync-invoices|salla/webhook|_next/static|_next/image|favicon.ico|logo.png|cv.pdf|trademark.pdf).*)',
  ],
};
