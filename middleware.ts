import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/returns',
  '/api/returns',
  '/api/orders/lookup',
  '/api/order-users',
  '/api/order-assignments',
  '/api/warehouses',
  '/api/auth',
  '/api/salla/sync-invoices',
  '/salla/webhook',
  '/logo.png',
];

const isPublicPath = (pathname: string) =>
  PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

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
      const roles = (token.roles as string[]) || (role ? [role] : []);

      const roleAccess: Record<
        string,
        { home?: string; allowed: RegExp[] }
      > = {
        orders: {
          home: '/order-prep',
          allowed: [/^\/$/, /^\/order-prep(\/.*)?$/, /^\/order-history(\/.*)?$/, /^\/api\/order-assignments(\/.*)?$/],
        },
        store_manager: {
          home: '/returns-management',
          allowed: [/^\/$/, /^\/returns-management(\/.*)?$/, /^\/api\/returns(\/.*)?$/],
        },
        warehouse: {
          allowed: [
            /^\/$/,
            /^\/warehouse(\/.*)?$/,
            /^\/local-shipping(\/.*)?$/,
            /^\/shipment-assignments(\/.*)?$/,
            /^\/cod-tracker(\/.*)?$/,
            /^\/api\/shipments(\/.*)?$/,
            /^\/api\/local-shipping(\/.*)?$/,
            /^\/api\/shipment-assignments(\/.*)?$/,
            /^\/api\/delivery-agents(\/.*)?$/,
            /^\/api\/cod-collections(\/.*)?$/,
          ],
        },
        accountant: {
          home: '/order-reports',
          allowed: [/^\/$/, /^\/order-reports(\/.*)?$/, /^\/api\/order-history(\/.*)?$/, /^\/expenses(\/.*)?$/, /^\/api\/expenses(\/.*)?$/, /^\/cod-tracker(\/.*)?$/, /^\/api\/cod-collections(\/.*)?$/],
        },
        delivery_agent: {
          home: '/my-deliveries',
          allowed: [/^\/$/, /^\/my-deliveries(\/.*)?$/, /^\/api\/shipment-assignments(\/.*)?$/, /^\/api\/cod-collections(\/.*)?$/],
        },
      };

      // Admin can't access order-prep (it's for order users only)
      if (role === 'admin' && path.startsWith('/order-prep')) {
        return NextResponse.redirect(new URL('/', req.url));
      }

      // Check if user has any role that allows access to this path
      const hasAccess = roles.some(userRole => {
        const restrictions = roleAccess[userRole];
        if (!restrictions) return false;
        return restrictions.allowed.some((pattern) => pattern.test(path));
      });

      // If path requires role-based access and user doesn't have permission
      if (!hasAccess && role !== 'admin') {
        const primaryRestrictions = role ? roleAccess[role] : undefined;
        if (primaryRestrictions && primaryRestrictions.home) {
          // Redirect to primary role's home page
          return NextResponse.redirect(new URL(primaryRestrictions.home, req.url));
        }
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
     */
    '/((?!returns|login|api/returns|api/orders/lookup|api/order-users|api/order-assignments|api/warehouses|api/auth|api/salla/sync-invoices|salla/webhook|_next/static|_next/image|favicon.ico|logo.png).*)',
  ],
};
