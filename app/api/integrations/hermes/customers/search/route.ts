import { createHermesHandler } from '@/app/lib/hermes/handler';
import { searchCustomers } from '@/app/lib/hermes/lookups';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Find a customer by one exact identifier. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'customers.search',
    scope: HERMES_SCOPES.SUPPORT_READ,
    allowedParams: ['phone', 'email', 'customer_id'],
    allowPostBody: true,
  },
  searchCustomers
);

export const GET = handler;
export const POST = handler;
