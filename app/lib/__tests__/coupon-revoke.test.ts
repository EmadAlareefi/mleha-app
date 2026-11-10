import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCouponUnused, type CouponRequest, type CouponUsageDeps } from '../returns/coupon-revoke';

const request = (overrides: Partial<CouponRequest> = {}): CouponRequest => ({
  merchantId: 'm1',
  couponCode: 'EXCHANGE1',
  couponId: 'c1',
  couponCreatedAt: new Date('2026-11-02T10:00:00Z'),
  createdAt: new Date('2026-11-01T10:00:00Z'),
  exchangeMode: 'coupon',
  exchangeOrderId: null,
  exchangeOrderNumber: null,
  ...overrides,
});

const deps = (usage: number | null, orders: string[] | null): CouponUsageDeps & { since: Date[] } => {
  const since: Date[] = [];
  return {
    since,
    getCouponUsage: async () => usage,
    findOrdersUsingCode: async (_m, _code, from) => {
      since.push(from);
      return orders;
    },
  };
};

test('unused only when no linked order, no Salla usage and no order in the mirror carries the code', async () => {
  const clean = deps(0, []);
  assert.deepEqual(await checkCouponUnused(request(), clean), { unused: true });
  // The mirror is scanned from a day before the coupon was created.
  assert.equal(clean.since[0].toISOString(), '2026-11-01T10:00:00.000Z');

  assert.equal((await checkCouponUnused(request({ exchangeOrderId: '55', exchangeOrderNumber: '298' }), deps(0, []))).unused, false);
  assert.equal((await checkCouponUnused(request(), deps(1, []))).unused, false);
  // Salla's statistics skip unpaid orders; the mirror catches them.
  const pending = await checkCouponUnused(request(), deps(0, ['298112']));
  assert.deepEqual(pending, { unused: false, reason: 'الكوبون مستخدم في الطلب #298112' });
});

test('any lookup that fails refuses (fail closed)', async () => {
  assert.equal((await checkCouponUnused(request(), deps(null, []))).unused, false);
  assert.equal((await checkCouponUnused(request(), deps(0, null))).unused, false);
});

test('a manual coupon (no Salla id) is still checked against the order mirror', async () => {
  assert.equal((await checkCouponUnused(request({ couponId: null }), deps(null, []))).unused, true);
  assert.equal((await checkCouponUnused(request({ couponId: null }), deps(null, ['1']))).unused, false);
});
