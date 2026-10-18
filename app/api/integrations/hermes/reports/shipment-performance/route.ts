import { createHermesHandler } from '@/app/lib/hermes/handler';
import { shipmentPerformanceReport, REPORT_PARAMS } from '@/app/lib/hermes/reports';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Carrier and delivery performance. Contract: docs/hermes-openapi.json. */
const handler = createHermesHandler(
  {
    action: 'reports.shipment_performance',
    scope: HERMES_SCOPES.MANAGER_REPORTS,
    allowedParams: REPORT_PARAMS,
  },
  shipmentPerformanceReport
);

export const GET = handler;
