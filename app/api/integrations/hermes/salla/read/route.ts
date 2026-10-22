import { createHermesHandler } from '@/app/lib/hermes/handler';
import { sallaOperation } from '@/app/lib/hermes/salla';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createHermesHandler({
  action: 'salla.read', scope: HERMES_SCOPES.SALLA_READ,
  allowedParams: ['operation', 'id', 'query_json', 'payload_json'], allowPostBody: true,
}, sallaOperation(false));
