import { createHermesHandler } from '@/app/lib/hermes/handler';
import { salesReport, REPORT_PARAMS } from '@/app/lib/hermes/reports';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sales summary for a date range. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'reports.sales',
    scope: HERMES_SCOPES.MANAGER_REPORTS,
    allowedParams: REPORT_PARAMS,
  },
  salesReport
);

export const GET = handler;
