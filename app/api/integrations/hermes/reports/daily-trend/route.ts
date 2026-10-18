import { createHermesHandler } from '@/app/lib/hermes/handler';
import { dailyTrendReport, REPORT_PARAMS } from '@/app/lib/hermes/reports';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Daily orders, revenue, refunds and shipments. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'reports.daily_trend',
    scope: HERMES_SCOPES.MANAGER_REPORTS,
    allowedParams: REPORT_PARAMS,
  },
  dailyTrendReport
);

export const GET = handler;
