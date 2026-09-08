import { timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';

type StoreEvent = (data: Prisma.WebhookLogCreateInput) => Promise<unknown>;
const reply = (code: number, message: string) => Response.json(
  { responseCode: String(code), responseMessage: message }, { status: code },
);

export async function receiveAjexWebhook(request: Request, token: string | undefined, store: StoreEvent) {
  if (!token) return reply(503, 'Callback authentication is not configured');
  const parts = (request.headers.get('authorization') || '').trim().split(/\s+/);
  const supplied = Buffer.from(parts[1] || '');
  const expected = Buffer.from(token);
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer'
    || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return reply(401, 'Unauthorized');
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply(415, 'Expected application/json');
  }
  const rawText = await request.text();
  let payload: Record<string, Prisma.InputJsonValue>;
  try {
    payload = JSON.parse(rawText);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    for (const key of ['trackingId', 'referenceId', 'status', 'timezone']) {
      if (typeof payload[key] !== 'string' || !payload[key].trim()) throw new Error();
    }
    if ((payload.trackingId as string).length > 100
      || !Number.isSafeInteger(payload.statusCode) || !Number.isSafeInteger(payload.eventTime)
      || (payload.eventTime as number) < 0) throw new Error();
  } catch {
    return reply(400, 'Invalid tracking event');
  }
  try {
    await store({
      method: 'POST', url: new URL(request.url).origin + new URL(request.url).pathname,
      headers: { 'content-type': request.headers.get('content-type') || 'application/json' },
      verified: true, event: 'ajex.tracking', status: String(payload.statusCode),
      rawText, json: payload,
    });
  } catch {
    console.error('AJEX callback storage failed');
    return reply(500, 'Unable to store tracking event');
  }
  return reply(200, 'Success');
}
