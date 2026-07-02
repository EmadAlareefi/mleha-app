import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import { serviceDefinitions, ServiceKey } from '@/app/lib/service-definitions';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

// Soft, per-instance cache to bound how often middleware hits the DB to
// check isActive. Not a security boundary (serverless instances aren't
// guaranteed to share it) — a deactivated user is blocked within, at worst,
// one TTL window of their next request.
const DEACTIVATION_CACHE_TTL_MS = 10_000;
const deactivationCache = new Map<string, { isActive: boolean; checkedAt: number }>();

async function isOrderUserActive(userId: string): Promise<boolean> {
  const cached = deactivationCache.get(userId);
  if (cached && Date.now() - cached.checkedAt < DEACTIVATION_CACHE_TTL_MS) {
    return cached.isActive;
  }
  const row = await prisma.orderUser.findUnique({
    where: { id: userId },
    select: { isActive: true },
  });
  const isActive = row?.isActive ?? false;
  deactivationCache.set(userId, { isActive, checkedAt: Date.now() });
  return isActive;
}

function clearAuthCookies(res: NextResponse) {
  res.cookies.delete('next-auth.session-token');
  res.cookies.delete('__Secure-next-auth.session-token');
}

const PUBLIC_PATHS = [
  '/returns',
  '/api/returns',
  '/api/orders/lookup',
  '/api/products/category',
  '/api/order-users',
  '/api/order-assignments',
  '/api/order-prep',
  '/api/warehouses',
  '/api/webhooks',
  '/api/auth',
  '/api/salla/sync-invoices',
  '/salla/webhook',
  '/logo.png',
  '/manifest.webmanifest',
  '/cv.pdf',
  '/trademark.pdf',
];

// Public paths matched by pattern rather than exact prefix. Used for routes
// that live under an otherwise-protected segment (e.g. the customer-facing
// invoice PDF under /invoices/{orderId}/pdf, while the /invoices admin pages
// stay gated behind the `invoices` service).
const PUBLIC_PATTERNS = [/^\/invoices\/[^/]+\/pdf\/?$/];

const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  ) || PUBLIC_PATTERNS.some((pattern) => pattern.test(pathname));

const SERVICE_PATHS = new Map<ServiceKey, RegExp[]>([
  ['order-prep', [/^\/order-prep(\/.*)?$/, /^\/order-history(\/.*)?$/]],
  [
    'order-shortages',
    [/^\/order-shortages(\/.*)?$/, /^\/api\/order-prep\/unavailable-items(\/.*)?$/],
  ],
  [
    'order-shipping',
    [
      /^\/order-shipping(\/.*)?$/,
      /^\/api\/salla\/create-shipment(\/.*)?$/,
      /^\/api\/salla\/shipments(\/.*)?$/,
      /^\/api\/local-shipping(\/.*)?$/,
      /^\/api\/shipment-assignments(\/.*)?$/,
      /^\/api\/delivery-agents(\/.*)?$/,
    ],
  ],
  [
    'admin-order-prep',
    [/^\/admin\/order-prep(\/.*)?$/, /^\/api\/admin\/order-assignments(\/.*)?$/],
  ],
  ['warehouse', [/^\/warehouse(\/.*)?$/, /^\/api\/shipments(\/.*)?$/]],
  [
    'local-shipping',
    [
      /^\/local-shipping(\/.*)?$/,
      /^\/api\/local-shipping(\/.*)?$/,
      /^\/api\/shipment-assignments(\/.*)?$/,
      /^\/api\/shipments(\/.*)?$/,
    ],
  ],
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
  [
    'shipment-assignments',
    [/^\/shipment-assignments(\/.*)?$/, /^\/api\/shipment-assignments(\/.*)?$/, /^\/api\/shipments(\/.*)?$/],
  ],
  [
    'delivery-agent-tasks',
    [/^\/delivery-agent-tasks(\/.*)?$/, /^\/api\/delivery-agent-tasks(\/.*)?$/, /^\/api\/delivery-agents(\/.*)?$/],
  ],
  [
    'delivery-agent-wallets',
    [/^\/delivery-agent-wallets(\/.*)?$/, /^\/api\/delivery-agent-wallets(\/.*)?$/],
  ],
  [
    'affiliate-management',
    [/^\/affiliate-management(\/.*)?$/, /^\/api\/affiliate-management(\/.*)?$/],
  ],
  ['order-invoice-search', [/^\/order-invoice-search(\/.*)?$/]],
  [
    'salla-product-search',
    [
      /^\/salla\/product-search(\/.*)?$/,
      /^\/api\/salla\/product-search(\/.*)?$/,
      /^\/api\/salla\/purchase-requests(\/.*)?$/,
    ],
  ],
  ['cod-tracker', [/^\/cod-tracker(\/.*)?$/]],
  [
    'my-deliveries',
    [
      /^\/my-deliveries(\/.*)?$/,
      /^\/api\/shipment-assignments(\/.*)?$/,
      /^\/api\/delivery-agent-tasks(\/.*)?$/,
      /^\/api\/delivery-agent-wallets(\/.*)?$/,
    ],
  ],
  ['returns-management', [/^\/returns-management(\/.*)?$/, /^\/cancel-shipment(\/.*)?$/]],
  ['returns-inspection', [/^\/returns-inspection(\/.*)?$/, /^\/api\/shipments(\/.*)?$/]],
  ['returns-priority', [/^\/returns-priority(\/.*)?$/]],
  ['returns-gifts', [/^\/returns-gifts(\/.*)?$/]],
  [
    'salla-products',
    [
      /^\/salla\/products(\/.*)?$/,
      /^\/api\/salla\/products(\/.*)?$/,
      /^\/api\/salla\/requests(\/.*)?$/,
      /^\/api\/product-suppliers(\/.*)?$/,
    ],
  ],
  [
    'salla-manufacturer-links',
    [
      /^\/salla\/manufacturer-links(\/.*)?$/,
      /^\/api\/salla\/products(\/.*)?$/,
      /^\/api\/product-suppliers(\/.*)?$/,
    ],
  ],
  [
    'salla-notify',
    [
      /^\/salla\/notify(\/.*)?$/,
      /^\/api\/salla\/availability-requests(\/.*)?$/,
      /^\/api\/salla\/products(\/.*)?$/,
    ],
  ],
  [
    'salla-purchase-requests',
    [
      /^\/salla\/purchase-requests(\/.*)?$/,
      /^\/api\/salla\/purchase-requests(\/.*)?$/,
      /^\/api\/salla\/products(\/.*)?$/,
    ],
  ],
  ['settings', [/^\/settings(\/.*)?$/, /^\/erp-settings(\/.*)?$/]],
  [
    'order-users-management',
    [/^\/order-users-management(\/.*)?$/, /^\/api\/printers(\/.*)?$/],
  ],
  ['user-recognition', [/^\/user-recognition(\/.*)?$/]],
  ['my-recognition', [/^\/my-recognition(\/.*)?$/]],
  ['warehouse-management', [/^\/warehouse-management(\/.*)?$/]],
  [
    'order-reports',
    [
      /^\/order-reports(\/.*)?$/,
      /^\/erp-sync(\/.*)?$/,
      /^\/invoices-and-refund-invoices(\/.*)?$/,
      /^\/api\/invoices-and-refund-invoices(\/.*)?$/,
    ],
  ],
  ['settlements', [/^\/settlements(\/.*)?$/]],
  ['invoices', [/^\/invoices(\/.*)?$/]],
  [
    'invoice-refunds',
    [
      /^\/invoice-refunds(\/.*)?$/,
      /^\/erp-sync(\/.*)?$/,
      /^\/invoices-and-refund-invoices(\/.*)?$/,
      /^\/api\/invoice-refunds(\/.*)?$/,
      /^\/api\/invoices-and-refund-invoices(\/.*)?$/,
    ],
  ],
  [
    'invoices-and-refund-invoices',
    [
      /^\/erp-sync(\/.*)?$/,
      /^\/invoices-and-refund-invoices(\/.*)?$/,
      /^\/api\/invoices-and-refund-invoices(\/.*)?$/,
    ],
  ],
  ['expenses', [/^\/expenses(\/.*)?$/]],
  [
    'fabric-management',
    [
      /^\/fabric-management\/?$/,
      /^\/api\/fabric-management\/?$/,
      /^\/fabric-hub\/?$/,
    ],
  ],
  [
    'fabric-warehouse',
    [
      /^\/fabric-management\/?$/,
      /^\/api\/fabric-management\/?$/,
      /^\/fabric-hub\/?$/,
    ],
  ],
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
  async function middleware(req) {
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

      // The env-var pseudo-admin always has role 'admin' (handled above), so
      // anything reaching here is a real OrderUser row — verify it hasn't
      // been deactivated since this session's token was issued.
      const active = await isOrderUserActive(token.id as string);
      if (!active) {
        const isApi = path.startsWith('/api/');
        const res = isApi
          ? NextResponse.json({ error: 'account_deactivated' }, { status: 401 })
          : NextResponse.redirect(new URL('/login?reason=deactivated', req.url));
        clearAuthCookies(res);
        return res;
      }

      const serviceKeys = (token.serviceKeys as string[]) || [];
      const allowedServices = serviceKeys.filter((key): key is ServiceKey =>
        SERVICE_PATHS.has(key as ServiceKey)
      ) as ServiceKey[];

      if (
        path === '/' ||
        path.startsWith('/affiliate-stats') ||
        path.startsWith('/api/affiliate-stats') ||
        path.startsWith('/salla/notify') ||
        path.startsWith('/api/salla/availability-requests') ||
        path.startsWith('/api/salla/products')
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
     * - logo.png, manifest.webmanifest, cv.pdf, trademark.pdf (public branding assets)
     */
    '/((?!returns|login|api/returns|api/orders/lookup|api/order-users|api/order-assignments|api/warehouses|api/webhooks|api/auth|api/salla/sync-invoices|salla/webhook|_next/static|_next/image|favicon.ico|logo.png|manifest.webmanifest|cv.pdf|trademark.pdf).*)',
  ],
};
