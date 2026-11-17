import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerStage, sallaDateToIso } from '../customer-stage';
import { getOrderItemUnitListPrice, getOrderItemUnitPrice } from '../item-price';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW - hours * 3600_000).toISOString();
const stage = (slug: string, name: string, placedHoursAgo = 1, prepStarted = false) =>
  customerStage({ status: { slug, name }, placedAt: hoursAgo(placedHoursAgo), prepStarted, now: NOW });

// The table on page 3 of the returns test report (2026-11-16).
test('new order within 3 hours can be cancelled or changed', () => {
  assert.equal(stage('under_review', 'طلب جديد', 2), 'editable');
  assert.equal(stage('under_review', 'بإنتظار المراجعة', 2), 'editable');
});

test('new order after 3 hours, or once a packer picked it up, waits', () => {
  assert.equal(stage('under_review', 'طلب جديد', 4), 'waiting');
  assert.equal(stage('under_review', 'طلب جديد', 1, true), 'waiting');
  assert.equal(customerStage({ status: { slug: 'under_review', name: 'طلب جديد' }, placedAt: null, now: NOW }), 'waiting');
});

test('custom review statuses, preparing, done, shipped and out for delivery wait', () => {
  for (const [slug, name] of [
    ['under_review', 'تحت المراجعة R'],
    ['under_review', 'تحت المراجعة حجز قطع'],
    ['under_review', 'X4'],
    ['in_progress', 'جاري التجهيز'],
    ['in_progress', 'جاري التجهيز الدولي'],
    ['completed', 'تم التنفيذ'],
    ['delivering', 'جاري التوصيل'],
    ['shipped', 'تم الشحن'],
  ]) {
    assert.equal(stage(slug, name, 1), 'waiting', name);
  }
});

test('only delivered orders open returns and exchanges', () => {
  assert.equal(stage('delivered', 'تم التوصيل', 48), 'returnable');
});

test('cancelled and being-returned orders get their own screens', () => {
  assert.equal(stage('canceled', 'ملغي'), 'cancelled');
  assert.equal(stage('restoring', 'قيد الإسترجاع'), 'returning');
  assert.equal(stage('payment_pending', 'بانتظار الدفع'), 'unavailable');
});

test('Salla naive dates are read as Riyadh time', () => {
  assert.equal(sallaDateToIso('2026-11-16 10:00:00.000000'), '2026-11-16T07:00:00.000Z');
  assert.equal(sallaDateToIso({ date: '2026-11-16 10:00:00' }), '2026-11-16T07:00:00.000Z');
  assert.equal(sallaDateToIso('2026-11-16T10:00:00Z'), '2026-11-16T10:00:00.000Z');
  assert.equal(sallaDateToIso('not a date'), null);
});

test('list price ignores the discount that the paid price includes', () => {
  // A dress paid for entirely with a 100% coupon.
  const item = { quantity: 1, amounts: { price_without_tax: { amount: 188.28 }, tax: { amount: 28.24 }, total_discount: { amount: 216.52 } } };
  assert.equal(getOrderItemUnitPrice(item), 0);
  assert.equal(getOrderItemUnitListPrice(item), 216.52);
});
