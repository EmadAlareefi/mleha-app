import { createHermesHandler } from '@/app/lib/hermes/handler';
import { searchShipments } from '@/app/lib/hermes/lookups';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Shipments for an order number or tracking number. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'shipments.search',
    scope: HERMES_SCOPES.SUPPORT_READ,
    allowedParams: ['order_number', 'tracking_number'],
    allowPostBody: true,
  },
  searchShipments
);

export const GET = handler;
export const POST = handler;
