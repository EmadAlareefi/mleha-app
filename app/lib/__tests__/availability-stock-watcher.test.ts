import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRequestSatisfied,
  runAvailabilityStockCheck,
  type ProductAvailability,
  type WatcherDeps,
} from '../availability-stock-watcher';
import type { AvailabilityRequestRecord } from '../salla-availability-requests';

function makeRequest(
  overrides: Partial<AvailabilityRequestRecord> = {}
): AvailabilityRequestRecord {
  return {
    id: 'req-1',
    merchantId: 'm1',
    productId: 100,
    productName: 'عباية سوداء',
    productSku: 'AB-1',
    productImageUrl: null,
    variationId: null,
    variationName: null,
    requestedSize: null,
    customerFirstName: 'سارة',
    customerLastName: null,
    customerEmail: null,
    customerPhone: '+966500000001',
    notes: null,
    status: 'pending',
    requestedBy: 'storefront',
    requestedByUser: null,
    notifiedAt: null,
    notifiedBy: null,
    source: 'storefront',
    customerId: null,
    isGuest: true,
    pageUrl: null,
    locale: 'ar',
    notifyChannel: null,
    notifyAttempts: 0,
    notifyError: null,
    lastCheckedAt: null,
    backInStockAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AvailabilityRequestRecord;
}

function availability(overrides: Partial<ProductAvailability> = {}): ProductAvailability {
  return {
    productId: 100,
    found: true,
    productQuantity: 0,
    variantQuantities: {},
    ...overrides,
  };
}

describe('isRequestSatisfied', () => {
  it('uses product-level stock when the request names no variant', () => {
    const request = makeRequest({ variationId: null });
    assert.equal(isRequestSatisfied(request, availability({ productQuantity: 3 })), true);
    assert.equal(isRequestSatisfied(request, availability({ productQuantity: 0 })), false);
    assert.equal(isRequestSatisfied(request, availability({ productQuantity: null })), false);
  });

  it('requires the requested variant specifically, not any variant', () => {
    const request = makeRequest({ variationId: '55' });

    // Size L came back but this customer is waiting on size S (id 55).
    const otherSizeOnly = availability({
      productQuantity: 7,
      variantQuantities: { '99': 7, '55': 0 },
    });
    assert.equal(isRequestSatisfied(request, otherSizeOnly), false);

    const theirSize = availability({ variantQuantities: { '55': 2 } });
    assert.equal(isRequestSatisfied(request, theirSize), true);
  });

  it('treats an unknown or missing product as unavailable', () => {
    const request = makeRequest();
    assert.equal(
      isRequestSatisfied(request, availability({ found: false, productQuantity: 5 })),
      false
    );
  });
});

describe('runAvailabilityStockCheck', () => {
  let notified: string[];
  let failed: Array<{ id: string; error: string }>;
  let released: string[];
  let claimable: Set<string>;

  function makeDeps(overrides: Partial<WatcherDeps> = {}): WatcherDeps {
    return {
      listPending: async () => [makeRequest({ id: 'req-1' })],
      loadAvailability: async () => availability({ productQuantity: 5 }),
      notify: async () => ({ status: 'sent' as const }),
      claim: async (ids) => ids.filter((id) => claimable.has(id)),
      release: async (id) => {
        released.push(id);
      },
      markNotified: async (id) => {
        notified.push(id);
      },
      markFailed: async (id, error) => {
        failed.push({ id, error });
      },
      markChecked: async () => {},
      markBackInStock: async () => {},
      autoNotifyEnabled: async () => true,
      ...overrides,
    };
  }

  beforeEach(() => {
    notified = [];
    failed = [];
    released = [];
    claimable = new Set(['req-1', 'req-2']);
  });

  it('notifies a waiting customer once stock returns', async () => {
    const result = await runAvailabilityStockCheck({ deps: makeDeps() });

    assert.deepEqual(notified, ['req-1']);
    assert.equal(result.sent, 1);
    assert.equal(result.backInStock, 1);
    assert.equal(result.failed, 0);
  });

  it('sends nothing while the product is still out of stock', async () => {
    const result = await runAvailabilityStockCheck({
      deps: makeDeps({ loadAvailability: async () => availability({ productQuantity: 0 }) }),
    });

    assert.deepEqual(notified, []);
    assert.equal(result.backInStock, 0);
    assert.equal(result.sent, 0);
  });

  it('does not send twice when another run already claimed the request', async () => {
    claimable = new Set(); // this run wins nothing

    const result = await runAvailabilityStockCheck({ deps: makeDeps() });

    assert.deepEqual(notified, []);
    assert.equal(result.sent, 0);
    assert.equal(result.skipped, 1);
  });

  it('records a failure so the request can be retried', async () => {
    const result = await runAvailabilityStockCheck({
      deps: makeDeps({
        notify: async () => ({ status: 'failed' as const, error: 'Zoko error 400' }),
      }),
    });

    assert.equal(result.sent, 0);
    assert.equal(result.failed, 1);
    assert.deepEqual(failed, [{ id: 'req-1', error: 'Zoko error 400' }]);
  });

  it('releases the claim when a send is skipped rather than failed', async () => {
    const result = await runAvailabilityStockCheck({
      deps: makeDeps({
        notify: async () => ({ status: 'skipped' as const, reason: 'missing_phone' }),
      }),
    });

    assert.deepEqual(released, ['req-1']);
    assert.deepEqual(failed, []);
    assert.equal(result.skipped, 1);
  });

  it('leaves requests untouched when the Salla lookup itself fails', async () => {
    const result = await runAvailabilityStockCheck({
      deps: makeDeps({
        loadAvailability: async () => {
          throw new Error('Salla timeout');
        },
      }),
    });

    // A provider outage must not burn a retry or mark anyone notified.
    assert.deepEqual(notified, []);
    assert.deepEqual(failed, []);
    assert.equal(result.productsChecked, 0);
    assert.equal(result.products[0]?.error, 'Salla timeout');
  });

  it('detects but does not send when the kill switch is off', async () => {
    const result = await runAvailabilityStockCheck({
      deps: makeDeps({ autoNotifyEnabled: async () => false }),
    });

    assert.deepEqual(notified, []);
    assert.equal(result.backInStock, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.autoNotifyEnabled, false);
  });

  it('reports what a dry run would send without sending it', async () => {
    const result = await runAvailabilityStockCheck({ dryRun: true, deps: makeDeps() });

    assert.deepEqual(notified, []);
    assert.equal(result.dryRun, true);
    assert.equal(result.backInStock, 1);
    assert.equal(result.skipped, 1);
  });

  it('handles several customers waiting on different sizes of one product', async () => {
    const requests = [
      makeRequest({ id: 'req-1', variationId: '10' }),
      makeRequest({ id: 'req-2', variationId: '20' }),
    ];

    const result = await runAvailabilityStockCheck({
      deps: makeDeps({
        listPending: async () => requests,
        // Only size 10 is back.
        loadAvailability: async () =>
          availability({ productQuantity: null, variantQuantities: { '10': 4, '20': 0 } }),
      }),
    });

    assert.deepEqual(notified, ['req-1']);
    assert.equal(result.backInStock, 1);
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].waiting, 2);
  });
});
