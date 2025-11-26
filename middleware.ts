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

      const roleAccess: Record<
        string,
        { home: string; allowed: RegExp[] }
      > = {
        orders: {
          home: '/order-prep',
          allowed: [/^\/$/, /^\/order-prep(\/.*)?$/],
        },
        store_manager: {
          home: '/returns-management',
          allowed: [/^\/$/, /^\/returns-management(\/.*)?$/],
        },
        warehouse: {
          home: '/warehouse',
          allowed: [
            /^\/$/,
            /^\/warehouse(\/.*)?$/,
            /^\/local-shipping(\/.*)?$/,
            /^\/api\/shipments(\/.*)?$/,
            /^\/api\/local-shipping(\/.*)?$/,
          ],
        },
      };

      if (role === 'admin' && path.startsWith('/order-prep')) {
        return NextResponse.redirect(new URL('/', req.url));
      }

      const restrictions = role ? roleAccess[role] : undefined;
      if (restrictions) {
        const isAllowed = restrictions.allowed.some((pattern) =>
          pattern.test(path)
        );
        if (!isAllowed) {
          return NextResponse.redirect(new URL(restrictions.home, req.url));
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
