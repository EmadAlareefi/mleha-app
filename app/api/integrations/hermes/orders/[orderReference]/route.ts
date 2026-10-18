import { createHermesHandler } from '@/app/lib/hermes/handler';
import { getOrder } from '@/app/lib/hermes/lookups';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Order details for one customer-facing order number. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'orders.get',
    scope: HERMES_SCOPES.SUPPORT_READ,
    allowedParams: [],
  },
  getOrder
);

export const GET = handler;
