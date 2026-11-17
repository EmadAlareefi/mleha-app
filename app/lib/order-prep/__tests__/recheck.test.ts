import assert from 'node:assert/strict';
import test from 'node:test';
import { statusNeedsRecheck } from '@/app/lib/order-prep/recheck';

test('only a known status other than "طلب جديد" queues a live check', () => {
  assert.equal(statusNeedsRecheck('449146439'), false);
  assert.equal(statusNeedsRecheck('1183362113'), true); // cancelled
  assert.equal(statusNeedsRecheck('1065456688'), true); // under review
  // A payload with no status says nothing about the order.
  assert.equal(statusNeedsRecheck(null), false);
  assert.equal(statusNeedsRecheck(undefined), false);
  assert.equal(statusNeedsRecheck(''), false);
});
