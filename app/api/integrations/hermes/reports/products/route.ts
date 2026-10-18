import { createHermesHandler } from '@/app/lib/hermes/handler';
import { productReport, REPORT_PARAMS } from '@/app/lib/hermes/reports';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Best sellers, revenue by product, returns by product. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'reports.products',
    scope: HERMES_SCOPES.MANAGER_REPORTS,
    allowedParams: REPORT_PARAMS,
  },
  productReport
);

export const GET = handler;
