import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalTrackingWhere, localTrackingSelect } from '../tracking-query';
import { localShipmentLocation, RETURN_PICKUP_STATUSES } from '../tracking';

test('search, exact shipment and status remain intersected', () => {
  const where = buildLocalTrackingWhere({ id: 'shipment-1', search: '123', status: 'failed' });
  assert.deepEqual(where, { AND: [
    { id: 'shipment-1' },
    { OR: [
      { trackingNumber: { contains: '123', mode: 'insensitive' } },
      { orderNumber: { contains: '123', mode: 'insensitive' } },
      { customerName: { contains: '123', mode: 'insensitive' } },
    ] },
    { OR: [
      { assignment: { is: { status: 'failed' } } },
      { assignment: { is: null }, status: 'failed' },
    ] },
  ] });
  assert.deepEqual(buildLocalTrackingWhere({ search: '', status: '' }), {});
});

test('staff selection excludes credentials and OTP fields and selects only return pickups', () => {
  const selected = JSON.stringify(localTrackingSelect);
  assert.doesNotMatch(selected, /password|deliveryOtp|Signature/);
  assert.deepEqual(localTrackingSelect.tasks.where, { requestType: 'return_pickup' });
  assert.deepEqual(localTrackingSelect.assignment.select.deliveryAgent.select, { name: true, phone: true });
});

test('location reflects custody without claiming a location after failed or cancelled delivery', () => {
  assert.match(localShipmentLocation('assigned', 'المستودع الرئيسي'), /المستودع الرئيسي/);
  assert.match(localShipmentLocation('picked_up'), /مع مندوب/);
  assert.match(localShipmentLocation('delivered'), /للعميل/);
  assert.match(localShipmentLocation('failed'), /راجع المندوب/);
  assert.match(localShipmentLocation('cancelled'), /غير مؤكد/);
  assert.match(localShipmentLocation('unexpected'), /لا يتوفر/);
  assert.match(RETURN_PICKUP_STATUSES.agent_completed, /بانتظار التأكيد/);
});
