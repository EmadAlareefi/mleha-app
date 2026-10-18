import { createHermesHandler } from '@/app/lib/hermes/handler';
import { getShipment } from '@/app/lib/hermes/lookups';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One shipment, by tracking number, with public tracking events. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'shipments.get',
    scope: HERMES_SCOPES.SUPPORT_READ,
    allowedParams: [],
  },
  getShipment
);

export const GET = handler;
