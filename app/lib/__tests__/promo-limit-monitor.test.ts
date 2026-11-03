import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePromoOrders, inspectThemeScript, type PromoMonitorOrderInput } from '../promo-limit-monitor';

let seq = 0;
function order(partial: Partial<PromoMonitorOrderInput> & { units: number[]; at: string }): PromoMonitorOrderInput {
  seq += 1;
  return {
    orderId: partial.orderId ?? String(seq),
    referenceId: partial.referenceId ?? `R${seq}`,
    placedAt: new Date(partial.at),
    statusSlug: partial.statusSlug ?? 'under_review',
    statusName: null,
    customerId: partial.customerId ?? null,
    customerName: null,
    customerMobile: partial.customerMobile ?? null,
    customerEmail: partial.customerEmail ?? null,
    items: partial.units.map((quantity, index) => ({ name: `p${index}`, sku: null, quantity })),
  };
}

test('one unit per customer is fine; two in one order is an in-order violation', () => {
  const [ok, bad] = analyzePromoOrders(
    [order({ customerId: '1', units: [1], at: '2026-11-03T10:00:00Z' }), order({ customerId: '2', units: [1, 2], at: '2026-11-03T10:00:00Z' })],
    1
  );
  assert.equal(ok.violation, false);
  assert.equal(bad.violation, true);
  assert.equal(bad.reason, 'in_order');
  assert.equal(bad.extraUnits, 2);
});

test('a later order is flagged against the first one, matched by mobile across ids', () => {
  const result = analyzePromoOrders(
    [
      order({ customerId: '1', customerMobile: '+966500000001', units: [1], at: '2026-11-03T10:00:00Z', referenceId: 'FIRST' }),
      order({ customerMobile: '0500000001', units: [1], at: '2026-11-03T11:00:00Z' }),
    ],
    1
  );
  assert.equal(result[0].violation, false);
  assert.equal(result[1].violation, true);
  assert.equal(result[1].reason, 'prior_order');
  assert.equal(result[1].firstOrderRef, 'FIRST');
});

test('cancelled orders do not use up the allowance', () => {
  const result = analyzePromoOrders(
    [
      order({ customerId: '1', units: [1], at: '2026-11-03T10:00:00Z', statusSlug: 'canceled' }),
      order({ customerId: '1', units: [1], at: '2026-11-03T11:00:00Z' }),
    ],
    1
  );
  assert.equal(result[0].cancelled, true);
  assert.equal(result[0].violation, false);
  assert.equal(result[1].violation, false);
});

test('theme script check spots a missing loader and a broken file', () => {
  assert.equal(inspectThemeScript("inject('promo-limit');").state, 'ok');
  assert.equal(inspectThemeScript("inject('size-guide');").state, 'missing');
  assert.equal(inspectThemeScript("var x = ['a', 'promo-limit;").state, 'broken');
});
