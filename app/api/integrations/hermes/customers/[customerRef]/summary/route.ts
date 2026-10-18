import { createHermesHandler } from '@/app/lib/hermes/handler';
import { getCustomerSummary } from '@/app/lib/hermes/lookups';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Support summary for a customer reference returned by customer search. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'customers.summary',
    scope: HERMES_SCOPES.SUPPORT_READ,
    allowedParams: [],
  },
  getCustomerSummary
);

export const GET = handler;
