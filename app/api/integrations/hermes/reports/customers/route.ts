import { createHermesHandler } from '@/app/lib/hermes/handler';
import { customerReport, REPORT_PARAMS } from '@/app/lib/hermes/reports';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** New vs returning customers, repeat rate, cities and (with PII scope) top customers. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'reports.customers',
    scope: HERMES_SCOPES.MANAGER_REPORTS,
    allowedParams: REPORT_PARAMS,
  },
  customerReport
);

export const GET = handler;
