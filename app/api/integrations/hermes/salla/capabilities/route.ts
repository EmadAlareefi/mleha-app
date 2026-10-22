import { createHermesHandler } from '@/app/lib/hermes/handler';
import { sallaCapabilities } from '@/app/lib/hermes/salla';
import { HERMES_SCOPES } from '@/app/lib/hermes/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createHermesHandler({ action: 'salla.capabilities', scope: HERMES_SCOPES.SALLA_READ, allowedParams: [] }, sallaCapabilities);
