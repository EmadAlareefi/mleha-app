/**
 * Top-level page folders under `app/`. The middleware sends a visitor without a
 * session to the login page only for these; any other path falls through to
 * Next.js, which shows the not-found page. A customer who mistypes a link
 * (`/return`, `/my-orders`) must not land on the staff login.
 *
 * `lib/__tests__/app-routes.test.ts` fails when this list and `app/` drift.
 */
export const APP_PAGE_SEGMENTS: ReadonlySet<string> = new Set([
  'admin',
  'affiliate-management',
  'affiliate-stats',
  'agents',
  'barcode-labels',
  'cancel-shipment',
  'cod-tracker',
  'delivery-agent-tasks',
  'delivery-agent-wallets',
  'developer',
  'embed',
  'employee-performance',
  'erp-settings',
  'erp-sync',
  'expenses',
  'fabric-hub',
  'fabric-management',
  'invoice-refunds',
  'invoices',
  'invoices-and-refund-invoices',
  'local-shipping',
  'login',
  'marketing',
  'my-deliveries',
  'my-order',
  'my-profile',
  'my-recognition',
  'order-history',
  'order-invoice-search',
  'order-monitor',
  'order-prep',
  'order-reports',
  'order-shipping',
  'order-shortages',
  'order-users-management',
  'printer-settings',
  'promo-monitor',
  'returns',
  'returns-analytics',
  'returns-gifts',
  'returns-inspection',
  'returns-management',
  'returns-priority',
  'salla',
  'settings',
  'settlements',
  'shipment-assignments',
  'shipping-info',
  'smsa-webhook',
  'user-recognition',
  'warehouse',
  'warehouse-location',
  'warehouse-locations',
  'warehouse-management',
  'zoko-notifications',
]);

/** Folders under `app/` that hold no pages. */
export const NON_PAGE_APP_FOLDERS: ReadonlySet<string> = new Set(['api', 'lib']);

/**
 * True for a page path no route serves: its first segment is not a page folder.
 * The home page and API paths are never "unknown" here; API routes keep their
 * own auth.
 */
export function isUnknownPagePath(pathname: string): boolean {
  const first = pathname.split('/')[1] ?? '';
  if (!first || first === 'api' || first.startsWith('_next')) return false;
  return !APP_PAGE_SEGMENTS.has(first);
}
