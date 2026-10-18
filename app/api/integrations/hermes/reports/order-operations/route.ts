import { createHermesHandler } from '@/app/lib/hermes/handler';
import { orderOperationsReport, REPORT_PARAMS } from '@/app/lib/hermes/reports';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Order status, payment, fulfillment, aging and pending work. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'reports.order_operations',
    scope: HERMES_SCOPES.MANAGER_REPORTS,
    allowedParams: REPORT_PARAMS,
  },
  orderOperationsReport
);

export const GET = handler;
