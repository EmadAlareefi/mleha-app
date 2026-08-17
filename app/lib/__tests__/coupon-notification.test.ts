import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExchangeCouponTemplateArgs } from '../returns/coupon-notification';

test('builds exchange coupon template variables in the approved positional order', () => {
  const args = buildExchangeCouponTemplateArgs({
    customerName: ' مها السهلي ',
    customerPhone: '0500000000',
    orderNumber: '277248355',
    couponCode: 'EXCHANGE-9MN6Z6O3T',
    discountedAmount: 322.61,
    fullAmount: 371,
    currency: 'SAR',
    expiryDate: new Date('2026-09-12T12:00:00.000Z'),
  });

  assert.equal(args.length, 5);
  assert.equal(args[0], 'مها السهلي');
  assert.equal(args[1], '277248355');
  assert.equal(args[2], 'EXCHANGE-9MN6Z6O3T');
  assert.equal(args[3], '322.61 ر.س (371.00 ر.س شامل الضريبة)');
  assert.ok(String(args[4]).length > 0);
});
