import assert from 'node:assert/strict';
import test from 'node:test';
import { isReturnableOrderStatus } from '../order-status';

test('allows completed orders and shipping statuses that can miss delivery updates', () => {
  for (const slug of ['delivered', 'completed', 'delivering', 'shipped']) {
    assert.equal(isReturnableOrderStatus({ slug }), true);
    assert.equal(isReturnableOrderStatus(` ${slug.toUpperCase()} `), true);
  }
  for (const name of ['تم التوصيل', 'تم التسليم', 'مكتمل', 'تم التنفيذ', 'جاري التوصيل', 'تم الشحن']) {
    assert.equal(isReturnableOrderStatus({ name }), true);
  }
});

test('keeps cancelled, refunded, unshipped and unknown orders blocked', () => {
  for (const slug of ['canceled', 'cancelled', 'refunded', 'under_review', 'in_progress', 'payment_pending', 'ready_for_pickup', 'restored', 'restoring', 'deleted', '']) {
    assert.equal(isReturnableOrderStatus({ slug }), false);
  }
  for (const status of [null, undefined, {}, 123]) {
    assert.equal(isReturnableOrderStatus(status), false);
  }
  assert.equal(isReturnableOrderStatus({ slug: 'canceled', name: 'تم التوصيل' }), false);
});
