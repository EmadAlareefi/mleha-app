import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { findTabbyPaymentForOrder, isTabbyOrder, refundTabbyPayment, setTabbyTransport } from '../tabby';

afterEach(() => setTabbyTransport(null));

test('finds the Salla order payment by order reference across pages, preferring the captured one', async () => {
  const paths: string[] = [];
  const filler = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, status: 'CLOSED', order: { reference_id: `9${i}` } }));
  setTabbyTransport({
    async call(_method, path) {
      paths.push(path);
      if (path.includes('offset=0')) return { payments: filler, pagination: { total_count: 23 } };
      return {
        payments: [
          { id: 'expired', status: 'EXPIRED', order: { reference_id: '1001' } },
          { id: 'paid', status: 'CLOSED', order: { reference_id: '1001' } },
        ],
        pagination: { total_count: 23 },
      };
    },
  });
  const payment = await findTabbyPaymentForOrder({ references: ['1001'], placedAt: new Date('2026-11-10T12:00:00Z') });
  assert.equal(payment?.id, 'paid');
  assert.equal(paths.length, 2);
  assert.match(paths[0], /created_at__gte=2026-11-09T00%3A00%3A00Z&created_at__lte=2026-11-11T23%3A59%3A59Z&limit=20&offset=0/);
});

test('returns null when no payment matches', async () => {
  setTabbyTransport({ async call() { return { payments: [{ id: 'a', order: { reference_id: '5' } }], pagination: { total_count: 1 } }; } });
  assert.equal(await findTabbyPaymentForOrder({ references: ['1001'], placedAt: new Date() }), null);
});

test('refund sends a 2-decimal string amount and refuses over-refunds before calling', async () => {
  const bodies: any[] = [];
  setTabbyTransport({ async call(method, path, body) { bodies.push({ method, path, body }); return {}; } });
  await refundTabbyPayment({ paymentId: 'tp', amount: 12.5, refundable: 100, referenceId: 'ret-1' });
  assert.deepEqual(bodies[0], { method: 'POST', path: '/payments/tp/refunds', body: { amount: '12.50', reference_id: 'ret-1' } });
  await assert.rejects(refundTabbyPayment({ paymentId: 'tp', amount: 101, refundable: 100, referenceId: 'ret-2' }));
  await assert.rejects(refundTabbyPayment({ paymentId: 'tp', amount: 0, refundable: 100, referenceId: 'ret-3' }));
  assert.equal(bodies.length, 1);
});

test('detects Tabby orders from the Salla transaction or the order', () => {
  assert.equal(isTabbyOrder([{ id: 1, payment_method: { slug: 'tabby_installment' } }]), true);
  assert.equal(isTabbyOrder([], { payment_method: 'tabby_installment' }), true);
  assert.equal(isTabbyOrder([{ id: 1, payment_method: { slug: 'mada' } }], { payment_method: 'mada' }), false);
});
