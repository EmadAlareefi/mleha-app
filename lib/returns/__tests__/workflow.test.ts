import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransition, carrierDelivered, deriveStage } from '../workflow';

test('stages follow the request through the warehouse', () => {
  const base = { status: 'pending_review', items: [{ conditionStatus: null }, { conditionStatus: null }] };
  assert.equal(deriveStage(base), 'awaiting_pickup');
  assert.equal(deriveStage({ ...base, smsaLiveStatus: { code: 'IT' } }), 'in_transit');
  assert.equal(deriveStage({ ...base, smsaLiveStatus: { code: 'DL', delivered: true } }), 'received');
  assert.equal(deriveStage({ ...base, status: 'delivered' }), 'received');
  assert.equal(deriveStage({ ...base, items: [{ conditionStatus: 'good' }, { conditionStatus: null }] }), 'received');
  assert.equal(deriveStage({ ...base, items: [{ conditionStatus: 'good' }, { conditionStatus: 'damaged' }] }), 'ready');
  assert.equal(deriveStage({ ...base, processingStatus: 'needs_attention' }), 'needs_attention');
  assert.equal(deriveStage({ ...base, processingStatus: 'processing' }), 'processing');
  assert.equal(deriveStage({ ...base, status: 'completed' }), 'completed');
  assert.equal(deriveStage({ ...base, status: 'cancelled' }), 'closed');
});

test('status transitions are explicit', () => {
  assert.equal(canTransition('pending_review', 'completed'), true);
  assert.equal(canTransition('delivered', 'completed'), true);
  assert.equal(canTransition('completed', 'pending_review'), true);
  assert.equal(canTransition('completed', 'delivered'), false);
  assert.equal(canTransition('cancelled', 'completed'), false);
});

test('carrierDelivered reads AJEX codes: 604 delivered, 609 RTO Delivered is not', () => {
  assert.equal(carrierDelivered({ code: '604', description: 'Delivered' }), true);
  assert.equal(carrierDelivered({ code: '609', description: 'RTO Delivered' }), false);
  assert.equal(carrierDelivered({ code: '606', description: 'Delivery failed' }), false);
  assert.equal(carrierDelivered({ code: 'DL', description: 'Delivered' }), true);
});
