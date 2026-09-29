import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAjexOrderPayload,
  buildAjexReturnOrderPayload,
  cancelAjexShipment,
  createAjexReturnShipment,
  parseAjexCreateResponse,
  readAjexConfig,
  toAjexAddress,
  toAjexPhone,
} from '../ajex-api';
import { resolveAjexLocation } from '../ajex/address-mapper';
import { isAjexReturnRequest, orderShippedWithAjex } from '../../../lib/returns/return-provider';

const customer = {
  ContactName: 'Customer', ContactPhoneNumber: '0501234567', AddressLine1: 'Street 1, Al Malaz',
  City: 'الرياض', District: 'الملز', ShortCode: 'REMA2766', Country: 'SA',
};
const warehouse = {
  ContactName: 'Warehouse', ContactPhoneNumber: '0550000000', AddressLine1: 'Warehouse, Al Rayyan',
  City: 'Jeddah', District: 'Al Rayyan', ShortCode: 'JIEA8567', Country: 'SA',
};
const input = {
  referenceId: 'R-1001-abc', orderNumber: '1001', pickup: customer, receiver: warehouse,
  pieces: 2, weightKg: 1, declaredValue: 250, currency: 'SAR', description: 'Return for Order 1001',
};
const ENV_KEYS = ['AJEX_ENVIRONMENT', 'AJEX_CLIENT_ID', 'AJEX_CLIENT_SECRET', 'AJEX_CUSTOMER_ACCOUNT'];
const configure = () => {
  process.env.AJEX_CLIENT_ID = 'client';
  process.env.AJEX_CLIENT_SECRET = 'secret';
  process.env.AJEX_CUSTOMER_ACCOUNT = 'ACC1';
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const key of ENV_KEYS) delete process.env[key];
});

test('uses the AONE sandbox unless production is selected', () => {
  assert.equal(readAjexConfig().authUrl, 'https://api-aone-mw-stage.aj-ex.com/auth/api/v1/token');
  process.env.AJEX_ENVIRONMENT = 'production';
  assert.equal(readAjexConfig().orderUrl, 'https://api-aone-mw.aj-ex.com/mwo/api/v1/orders');
});

test('normalizes phones to the +966 format AJEX requires', () => {
  assert.equal(toAjexPhone('0501234567'), '+966501234567');
  assert.equal(toAjexPhone('501234567'), '+966501234567');
  assert.equal(toAjexPhone('+966 50 123 4567'), '+966501234567');
  assert.equal(toAjexPhone('00966501234567'), '+966501234567');
});

test('maps Arabic and English city/district names to AJEX codes', () => {
  assert.deepEqual(resolveAjexLocation('الرياض', 'حي الملز'), {
    country: 'Saudi Arabia', countryCode: 'SAU', region: 'Central', city: 'Riyadh',
    cityCode: 'RUH', district: 'Al Malaz', districtCode: 'SAU-CENTERAL-RUH-AL MALAZ',
  });
  assert.equal(resolveAjexLocation('Jeddah', 'Al Rayyan')?.districtCode, 'SAU-WESTERN-JED-AL RAYYAN');
  assert.equal(resolveAjexLocation('Riyadh', 'Nowhere'), null);
});

test('sends mapped addresses as CUSTOMER_MAPPINGS and unknown districts as FREE_TEXT', () => {
  const mapped = toAjexAddress(customer);
  assert.equal(mapped.addressType, 'CUSTOMER_MAPPINGS');
  assert.equal(mapped.cityCode, 'RUH');
  assert.equal(mapped.shortAddress, 'REMA2766');
  assert.equal(mapped.phone, '+966501234567');

  const free = toAjexAddress({ ...customer, District: 'Unknown District' });
  assert.equal(free.addressType, 'FREE_TEXT');
  assert.equal(free.city, 'Riyadh');
  assert.equal(free.region, 'Central');
  assert.equal(free.district, 'Unknown District');
});

test('books returns as an RPU pickup from the customer to the warehouse', () => {
  const payload = buildAjexReturnOrderPayload({ ...input, weightKg: 0.1 }, { ...readAjexConfig(), customerAccount: 'ACC' });
  assert.equal(payload.referenceNumber, 'R-1001-abc');
  assert.equal(payload.productCode, 'AJEX RPU');
  assert.equal(payload.pickupMethod, 'COURIER_PICKUP');
  assert.equal(payload.pickupAddress.name, 'Customer');
  assert.equal(payload.deliveryAddress.city, 'Jeddah');
  assert.equal(payload.cod, false);
  assert.equal(payload.packages[0].weight, 0.5);
  assert.deepEqual(payload.items[0], {
    description: 'Return for Order 1001', quantity: '2', unitPrice: 125, currency: 'SAR', packageSequence: 1,
  });
});

test('flags cash on delivery with its amount', () => {
  const payload = buildAjexOrderPayload({
    referenceNumber: 'X', productCode: 'AJEX DCE', pickup: warehouse, delivery: customer,
    pieces: 1, weightKg: 1, declaredValue: 150, currency: 'SAR', description: 'Abaya', codAmount: 150,
  });
  assert.equal(payload.cod, true);
  assert.equal(payload.codAmount, 150);
});

test('requires code 200 and status SUCCESS, not just HTTP 200', () => {
  const ok = parseAjexCreateResponse({
    code: 200, status: 'SUCCESS',
    data: { trackingId: 'AJA900000130747', waybillFileUrl: 'https://api-aone-stage.aj-ex.com/label' },
  });
  assert.equal(ok.success, true);
  assert.equal(ok.trackingNumber, 'AJA900000130747');
  assert.equal(ok.labelUrl, 'https://api-aone-stage.aj-ex.com/label');

  const rejected = parseAjexCreateResponse({ code: 400, status: 'BAD_REQUEST', msg: 'No cod rate found for provided input' });
  assert.equal(rejected.success, false);
  assert.equal(rejected.error, 'No cod rate found for provided input');
});

test('refuses to call AJEX without credentials', async () => {
  globalThis.fetch = (async () => assert.fail('must not call AJEX')) as typeof fetch;
  assert.equal((await createAjexReturnShipment(input)).errorCode, 'MISSING_CREDENTIALS');
});

test('exchanges client credentials without auth, then creates the order with the bearer token', async () => {
  configure();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/auth/api/v1/token')) return Response.json({ access_token: 'jwt-token', expires_in: 86400 });
    return Response.json({ code: 200, status: 'SUCCESS', data: { trackingId: 'AJA555' } });
  }) as typeof fetch;

  const result = await createAjexReturnShipment(input);
  assert.equal(result.success, true);
  assert.equal(result.trackingNumber, 'AJA555');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { clientId: 'client', clientSecret: 'secret' });
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, undefined);
  assert.equal(calls[1].url, 'https://api-aone-mw-stage.aj-ex.com/mwo/api/v1/orders');
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, 'Bearer jwt-token');
  assert.equal(JSON.parse(String(calls[1].init.body)).customerAccount, 'ACC1');
});

test('cancels by tracking id list and reports AJEX refusals', async () => {
  configure();
  let body: unknown;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (url.endsWith('/auth/api/v1/token')) return Response.json({ access_token: 'jwt-token', expires_in: 86400 });
    body = JSON.parse(String(init.body));
    return Response.json({ code: 400, status: 'BAD_REQUEST', msg: 'Already picked up' });
  }) as typeof fetch;
  const cancelled = await cancelAjexShipment('AJA1');
  assert.deepEqual(body, { trackingIds: ['AJA1'] });
  assert.equal(cancelled.success, false);
  assert.equal(cancelled.error, 'Already picked up');
});

test('routes only AJEX-shipped orders to AJEX', () => {
  // The stored Salla shipment wins over the order payload.
  assert.equal(orderShippedWithAjex({ shipping: { company: 'AJEX' } }, { courierCode: 'smsa', courierName: 'SMSA Express' }), false);
  assert.equal(orderShippedWithAjex({}, { courierCode: 'ajex', courierName: 'AJ-EX' }), true);
  assert.equal(orderShippedWithAjex({}, { courierName: 'أيجكس' }), true);
  assert.equal(orderShippedWithAjex({}, { trackingNumber: 'AJA1234567' }), true);
  // No stored shipment: fall back to the order's courier name, then tracking.
  assert.equal(orderShippedWithAjex({ shipping: { company: { name: 'AJEX Logistics' } } }), true);
  assert.equal(orderShippedWithAjex({ shipping: { company: 'Aramex' } }), false);
  assert.equal(orderShippedWithAjex({}), false);
});

test('reads the provider a request was created with', () => {
  assert.equal(isAjexReturnRequest({ provider: 'ajex' }), true);
  assert.equal(isAjexReturnRequest({ provider: 'salla' }), false);
  assert.equal(isAjexReturnRequest(null), false);
});
