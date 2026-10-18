import { createHermesHandler } from '@/app/lib/hermes/handler';
import { searchOrders } from '@/app/lib/hermes/lookups';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Find orders by one exact identifier. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'orders.search',
    scope: HERMES_SCOPES.SUPPORT_READ,
    allowedParams: ['order_number', 'phone', 'email', 'tracking_number', 'page', 'page_size'],
    allowPostBody: true,
  },
  searchOrders
);

export const GET = handler;
export const POST = handler;
