import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    // Allow the request to proceed
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
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
     * - api/auth (NextAuth)
     * - salla/webhook (Salla webhook)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!returns|login|api/returns|api/orders/lookup|api/auth|salla/webhook|_next/static|_next/image|favicon.ico).*)',
  ],
};
