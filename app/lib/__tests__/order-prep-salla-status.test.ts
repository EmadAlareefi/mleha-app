import assert from 'node:assert/strict';
import test from 'node:test';
import { STATUS_IDS, SUB_STATUSES } from '@/SALLA_ORDER_STATUSES';
import { detectInternationalOrder } from '@/app/lib/order-destination';
import {
  resolveOrderPrepSallaStatusId,
  resolveOrderPrepStatusName,
} from '@/app/lib/order-prep-salla-status';
import { isOrderStatusEligible } from '@/app/lib/order-prep-status-guard';

test('local orders keep the regular in-progress status', () => {
  assert.equal(resolveOrderPrepSallaStatusId('preparing'), STATUS_IDS.IN_PROGRESS);
  assert.equal(resolveOrderPrepSallaStatusId('completed'), STATUS_IDS.IN_PROGRESS);
  assert.equal(resolveOrderPrepStatusName('preparing'), 'جاري التجهيز');
});

test('international orders move to the international in-progress sub-status', () => {
  const internationalId = SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.id;
  assert.equal(resolveOrderPrepSallaStatusId('preparing', true), internationalId);
  assert.equal(resolveOrderPrepSallaStatusId('completed', true), internationalId);
  assert.equal(
    resolveOrderPrepStatusName('preparing', true),
    SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.name,
  );
});

test('waiting is unaffected by the destination', () => {
  assert.equal(resolveOrderPrepSallaStatusId('waiting'), STATUS_IDS.UNDER_REVIEW);
  assert.equal(resolveOrderPrepSallaStatusId('waiting', true), STATUS_IDS.UNDER_REVIEW);
});

test('order destination drives the status used for a prep transition', () => {
  const kuwaitOrder = {
    shipping: { ship_to: { country_code: 'KW', country_name: 'Kuwait' } },
  };
  const riyadhOrder = {
    shipping: { ship_to: { country_code: 'SA', country_name: 'Saudi Arabia' } },
  };

  assert.equal(
    resolveOrderPrepSallaStatusId(
      'completed',
      detectInternationalOrder(kuwaitOrder).isInternational,
    ),
    SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.id,
  );
  assert.equal(
    resolveOrderPrepSallaStatusId(
      'completed',
      detectInternationalOrder(riyadhOrder).isInternational,
    ),
    STATUS_IDS.IN_PROGRESS,
  );
});

test('orders sitting in the international sub-status stay eligible for prep', () => {
  assert.equal(
    isOrderStatusEligible({
      id: SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.id,
      slug: 'in_progress',
      name: SUB_STATUSES.IN_PROGRESS_INTERNATIONAL.name,
    }),
    true,
  );

  // Same status without the id, and with the double space Salla stores.
  assert.equal(
    isOrderStatusEligible({ slug: 'in_progress', name: 'جاري التجهيز  الدولي' }),
    true,
  );
});
