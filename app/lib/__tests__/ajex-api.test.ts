import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAjexOrder, describeAjexError, getAjexAccessToken } from '../ajex-api';

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  process.env.AJEX_CLIENT_ID = `client-${Math.random()}`;
  process.env.AJEX_CLIENT_SECRET = 'secret';
  process.env.AJEX_CUSTOMER_ACCOUNT = 'ACCOUNT';
  delete process.env.AJEX_API_ENVIRONMENT;
  delete process.env.AJEX_API_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const mockFetch = (handler: (url: string, init: RequestInit) => Response) => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
};

test('authenticates against the sandbox and caches the token', async () => {
  mockFetch(() => json({ access_token: 'tok', expires_in: 86400, token_type: 'Bearer' }));
  assert.equal(await getAjexAccessToken(), 'tok');
  assert.equal(await getAjexAccessToken(), 'tok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api-aone-mw-stage.aj-ex.com/auth/api/v1/token');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { clientId: process.env.AJEX_CLIENT_ID, clientSecret: 'secret' });
});

test('creates an order with the configured customer account', async () => {
  mockFetch((url) =>
    url.endsWith('/token')
      ? json({ access_token: 'tok', expires_in: 86400 })
      : json({ code: 200, status: 'SUCCESS', data: { referenceNumber: 'R1', trackingId: 'AJA1', waybillFileUrl: 'https://label' } }),
  );

  const result = await createAjexOrder({
    referenceNumber: 'R1',
    productCode: 'AJEX RPU',
    contentType: 'NON_DOCUMENT',
    pickupAddress: {} as any,
    deliveryAddress: {} as any,
    packages: [],
    items: [],
  });

  assert.ok(result.success);
  assert.equal(result.data.trackingId, 'AJA1');
  const orderCall = calls[1];
  assert.equal(orderCall.url, 'https://api-aone-mw-stage.aj-ex.com/mwo/api/v1/orders');
  assert.equal((orderCall.init.headers as Record<string, string>).Authorization, 'Bearer tok');
  assert.equal(JSON.parse(String(orderCall.init.body)).customerAccount, 'ACCOUNT');
});

test('reports validation errors with their fields', async () => {
  mockFetch((url) =>
    url.endsWith('/token')
      ? json({ access_token: 'tok', expires_in: 86400 })
      : json({ code: 400, status: 'BAD_REQUEST', msg: 'Validation error', data: [{ field: 'pickupAddress.district', message: 'must not be blank' }] }, 400),
  );

  const result = await createAjexOrder({
    referenceNumber: 'R1', productCode: 'AJEX RPU', contentType: 'NON_DOCUMENT',
    pickupAddress: {} as any, deliveryAddress: {} as any, packages: [], items: [],
  });
  assert.equal(result.success, false);
  assert.ok(!result.success && result.error === 'Validation error (pickupAddress.district: must not be blank)');
});

test('retries once with a fresh token on 401', async () => {
  let tokens = 0;
  let orders = 0;
  mockFetch((url) => {
    if (url.endsWith('/token')) return json({ access_token: `tok${++tokens}`, expires_in: 86400 });
    return ++orders === 1
      ? json({ code: 401, status: 'ERROR', msg: 'Unauthorized' }, 401)
      : json({ code: 200, status: 'SUCCESS', data: { referenceNumber: 'R', trackingId: 'AJA2', waybillFileUrl: null } });
  });
  const result = await createAjexOrder({
    referenceNumber: 'R', productCode: 'AJEX RPU', contentType: 'NON_DOCUMENT',
    pickupAddress: {} as any, deliveryAddress: {} as any, packages: [], items: [],
  });
  assert.ok(result.success);
  assert.equal(tokens, 2);
});

test('describes plain and missing error bodies', () => {
  assert.equal(describeAjexError({ code: 400, msg: 'Wrong Customer Account Number' }, 'x'), 'Wrong Customer Account Number');
  assert.equal(describeAjexError(null, 'HTTP 500'), 'HTTP 500');
});
