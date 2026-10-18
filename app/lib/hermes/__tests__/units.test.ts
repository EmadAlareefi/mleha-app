import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { extractSallaOrderFacts } from '@/app/lib/salla-order-facts';
import { readActor, signActor } from '../actor';
import { cachedReport, clearReportCache, reportCacheKey } from '../cache';
import {
  credentialRejection,
  generateApiKey,
  getApiKeyPepper,
  parseApiKey,
  readBearerToken,
  verifySecret,
} from '../credentials';
import { customerRef, phoneLookupVariants, resolveCustomerRef } from '../identifiers';
import { formatMoney, percentChange, sarRateFor, toSar } from '../money';
import { maskEmail, maskPhone, redactForLog } from '../pii';
import { normalizeScopes } from '../scopes';
import { ajexStatusView, derivePaymentState, normalizeCarrier, orderStage, smsaStatusView } from '../statuses';
import { addYears, daysInclusive, localDateKey, startOfLocalDay } from '../time';
import { parseReportParams } from '../validation';
import { TEST_PEPPER } from './fixtures';

test('generated keys parse, verify, and are stored only as a peppered hash', () => {
  const { apiKey, keyId, secretHash } = generateApiKey(TEST_PEPPER);
  assert.match(apiKey, /^hrm_[a-z0-9]{16}_[A-Za-z0-9_-]{43}$/);
  const parsed = parseApiKey(apiKey)!;
  assert.equal(parsed.keyId, keyId);
  assert.ok(!secretHash.includes(parsed.secret));
  assert.equal(verifySecret(parsed.secret, secretHash, TEST_PEPPER), true);
  assert.equal(verifySecret(parsed.secret, secretHash, `${TEST_PEPPER}x`), false, 'pepper is part of the hash');
  assert.equal(verifySecret(`${parsed.secret.slice(0, -1)}A`, secretHash, TEST_PEPPER), false);
  assert.notEqual(generateApiKey(TEST_PEPPER).apiKey, apiKey);
});

test('bearer parsing and key format are strict', () => {
  assert.equal(readBearerToken('Bearer abc'), 'abc');
  assert.equal(readBearerToken('Basic abc'), null);
  assert.equal(readBearerToken(null), null);
  assert.equal(parseApiKey('hrm_short_secret'), null);
  assert.equal(parseApiKey(`hrm_${'a'.repeat(16)}_${'b'.repeat(43)} extra`), null);
});

test('a short or missing pepper is a configuration error', () => {
  assert.throws(() => getApiKeyPepper({ HERMES_API_KEY_PEPPER: 'short' } as unknown as NodeJS.ProcessEnv));
  assert.throws(() => getApiKeyPepper({} as unknown as NodeJS.ProcessEnv));
});

test('revocation and expiry are enforced at the exact instant', () => {
  const now = new Date('2026-10-18T10:00:00Z');
  assert.equal(credentialRejection({ revokedAt: null, expiresAt: null }, now), null);
  assert.equal(credentialRejection({ revokedAt: now, expiresAt: null }, now), 'revoked');
  assert.equal(credentialRejection({ revokedAt: null, expiresAt: now }, now), 'expired');
  assert.equal(credentialRejection({ revokedAt: null, expiresAt: new Date(now.getTime() + 1) }, now), null);
});

test('unknown scopes are dropped and the set is sorted', () => {
  assert.deepEqual(normalizeScopes(['hermes:manager:reports', 'admin', 'hermes:support:read', 'hermes:support:read']), [
    'hermes:manager:reports',
    'hermes:support:read',
  ]);
});

test('gateway actor headers are verified only with a valid, fresh signature', () => {
  const now = new Date('2026-10-18T10:00:00Z');
  const timestamp = String(now.getTime() / 1000);
  const headers = (signature: string, ts = timestamp) =>
    new Headers({ 'x-hermes-actor-id': 'emp-1', 'x-hermes-actor-channel': 'telegram', 'x-hermes-actor-timestamp': ts, 'x-hermes-actor-signature': signature });
  const good = signActor('s3cret', { timestamp, actorId: 'emp-1', channel: 'telegram', path: '/p' });
  assert.equal(readActor(headers(good), '/p', { secret: 's3cret', now }).verified, true);
  assert.equal(readActor(headers(good), '/other', { secret: 's3cret', now }).verified, false, 'bound to the path');
  assert.equal(readActor(headers(good), '/p', { secret: 'wrong', now }).verified, false);
  const stale = String(now.getTime() / 1000 - 3600);
  assert.equal(readActor(headers(signActor('s3cret', { timestamp: stale, actorId: 'emp-1', channel: 'telegram', path: '/p' }), stale), '/p', { secret: 's3cret', now }).verified, false);
  const odd = readActor(new Headers({ 'x-hermes-actor-id': '<script>', 'x-hermes-actor-channel': 'sms' }), '/p', { secret: '', now });
  assert.deepEqual(odd, { actorId: null, channel: null, verified: false });
});

test('masking keeps enough to confirm identity but not to reuse it', () => {
  assert.equal(maskPhone('+966501234567'), '+966*******67');
  assert.equal(maskEmail('someone@example.test'), 'so***@example.test');
  assert.equal(maskEmail('a@example.test'), 'a***@example.test');
});

test('log redaction removes keys, contact details and sensitive fields', () => {
  const redacted = JSON.stringify(
    redactForLog({
      message: `failed for +966501234567 and x@y.com with hrm_${'a'.repeat(16)}_${'b'.repeat(43)}`,
      authorization: 'Bearer zzz',
      nested: { customerPhone: '0501234567', count: 3 },
    })
  );
  for (const leaked of ['501234567', 'x@y.com', 'bbbbbbbb', 'Bearer zzz']) assert.ok(!redacted.includes(leaked), leaked);
  assert.ok(redacted.includes('"count":3'));
});

test('customer references are signed per merchant and reject tampering', () => {
  const ref = customerRef('111', '42', TEST_PEPPER)!;
  assert.equal(resolveCustomerRef('111', ref, TEST_PEPPER), '42');
  assert.equal(resolveCustomerRef('222', ref, TEST_PEPPER), null);
  assert.equal(resolveCustomerRef('111', ref.replace('cus_42_', 'cus_43_'), TEST_PEPPER), null);
  assert.equal(resolveCustomerRef('111', '42', TEST_PEPPER), null);
});

test('phone variants cover every stored Saudi spelling', () => {
  assert.deepEqual(phoneLookupVariants('+966501234567').sort(), ['+966501234567', '0501234567', '501234567', '966501234567'].sort());
});

test('money is exact and formatted with two decimals', () => {
  assert.equal(formatMoney(new Prisma.Decimal('0.1').plus('0.2')), '0.30');
  assert.equal(formatMoney('2.005'), '2.01');
  assert.equal(formatMoney(null), null);
  assert.equal(percentChange(new Prisma.Decimal(150), new Prisma.Decimal(100)), '50.00');
  assert.equal(percentChange(5, 0), null);
  const kwd = sarRateFor('KWD', { rate: '12.25', base_currency: 'SAR', exchange_currency: 'KWD' })!;
  assert.equal(formatMoney(toSar(new Prisma.Decimal('10'), kwd)), '122.50');
  assert.equal(sarRateFor('SAR', null)!.toString(), '1');
  assert.equal(sarRateFor('XYZ', null), null, 'unconvertible currencies are not guessed');
});

test('local-day boundaries follow the requested time zone', () => {
  assert.equal(startOfLocalDay('2026-10-01', 'Asia/Riyadh').toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(startOfLocalDay('2026-10-01', 'UTC').toISOString(), '2026-10-01T00:00:00.000Z');
  // DST: New York switches from EDT (−4) to EST (−5) on 2026-11-01.
  assert.equal(startOfLocalDay('2026-11-01', 'America/New_York').toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(startOfLocalDay('2026-11-02', 'America/New_York').toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(localDateKey(new Date('2026-10-01T21:00:00Z'), 'Asia/Riyadh'), '2026-10-02');
  assert.equal(daysInclusive('2026-10-01', '2026-10-31'), 31);
  assert.equal(addYears('2028-02-29', -1), '2027-02-28');
});

test('report params: comparison windows and maximum range', () => {
  const now = new Date('2026-10-18T00:00:00Z');
  const previous = parseReportParams(new URLSearchParams('from=2026-10-01&to=2026-10-10&compare=previous_period'), now);
  assert.deepEqual(previous.comparison, { mode: 'previous_period', from: '2026-09-21', to: '2026-09-30' });
  const year = parseReportParams(new URLSearchParams('from=2026-10-01&to=2026-10-10&compare=previous_year'), now);
  assert.deepEqual(year.comparison, { mode: 'previous_year', from: '2025-10-01', to: '2025-10-10' });
  assert.doesNotThrow(() => parseReportParams(new URLSearchParams('from=2026-07-01&to=2026-09-30'), now));
  assert.throws(() => parseReportParams(new URLSearchParams('from=2026-07-01&to=2026-10-01'), now));
  assert.throws(() => parseReportParams(new URLSearchParams('from=2027-01-01&to=2027-01-02'), now));
});

test('statuses: payment derivation and carrier classification', () => {
  assert.equal(derivePaymentState({ statusSlug: 'payment_pending', paymentMethod: 'mada' }).code, 'awaiting_payment');
  assert.equal(derivePaymentState({ statusSlug: 'shipped', paymentMethod: 'cod' }).code, 'cod_due');
  assert.equal(derivePaymentState({ statusSlug: 'delivered', paymentMethod: 'cod' }).code, 'paid');
  assert.equal(derivePaymentState({ statusSlug: 'restored', paymentMethod: 'mada' }).code, 'refunded');
  assert.equal(derivePaymentState({ statusSlug: 'canceled', paymentMethod: 'mada' }).code, 'void');
  assert.equal(orderStage('محذوف'), 'deleted');
  assert.equal(normalizeCarrier('إيجكس'), 'ajex');
  assert.equal(normalizeCarrier('مندوب توصيل - جدة'), 'local_courier');
  assert.equal(normalizeCarrier('0', 'سمسا'), 'smsa');
  assert.equal(normalizeCarrier(null, ''), null);
  assert.equal(ajexStatusView({ code: '604', delivered: true })!.status, 'delivered');
  assert.equal(ajexStatusView({ code: '609' })!.status, 'returned_to_sender');
  assert.equal(smsaStatusView({ code: 'OD' })!.status, 'out_for_delivery');
});

test('order facts follow the same rules as the SQL fallback', () => {
  const facts = extractSallaOrderFacts({
    amounts: { discounts: [{ discount: '10.50' }, { discount: 'n/a' }, { discount: 4 }, {}] },
    refunded_items: [{ amounts: { total: { amount: 20.25 } } }, { amounts: { total: { amount: '7' } } }],
    is_pending_payment: false,
    exchange_rate: { rate: '1', base_currency: 'SAR', exchange_currency: 'SAR' },
  });
  // Non-numeric discount strings count as 0; refunded amounts must be JSON numbers.
  assert.equal(facts.discountTotal.toFixed(2), '14.50');
  assert.equal(facts.refundedItemsTotal.toFixed(2), '20.25');
  assert.equal(facts.refundedItemsCount, 2);
  assert.equal(facts.isPendingPayment, false);
  const empty = extractSallaOrderFacts(null);
  assert.equal(empty.discountTotal.toFixed(2), '0.00');
  assert.equal(empty.isPendingPayment, null);
  assert.equal(empty.exchangeRate, Prisma.JsonNull);
});

test('report cache keys include scopes and expire', async () => {
  clearReportCache();
  const base = { merchantId: 'm', action: 'reports.sales', params: { a: 1 } };
  assert.notEqual(reportCacheKey({ ...base, scopes: ['x'] }), reportCacheKey({ ...base, scopes: ['x', 'y'] }));
  assert.equal(reportCacheKey({ ...base, scopes: ['y', 'x'] }), reportCacheKey({ ...base, scopes: ['x', 'y'] }));
  let clock = 0;
  let computed = 0;
  const run = () => cachedReport('k', async () => ++computed, { now: () => clock, ttlMs: 100 });
  assert.equal((await run()).hit, false);
  clock = 50;
  assert.equal((await run()).hit, true);
  clock = 150;
  assert.equal((await run()).hit, false);
  assert.equal(computed, 2);
});
