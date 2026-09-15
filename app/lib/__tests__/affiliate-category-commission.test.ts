import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import {
  getExcludedNationalDayAmounts,
  loadNationalDayProductIds,
} from '../affiliate-category-commission';

test('collects National Day products from every category page', async () => {
  const requestedPages: number[] = [];
  const productIds = await loadNationalDayProductIds('merchant-a', async (merchantId, page) => {
    assert.equal(merchantId, 'merchant-a');
    requestedPages.push(page);
    return { productIds: [`p${page}`, 'shared'], totalPages: 8 };
  });

  assert.deepEqual(requestedPages.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(productIds.size, 9);
  assert.ok(productIds.has('p8'));
});

test('fails instead of silently dropping exclusions when a page cannot be loaded', async () => {
  await assert.rejects(
    loadNationalDayProductIds('merchant-a', async (_merchantId, page) => {
      if (page === 3) throw new Error('Salla API 429');
      return { productIds: [], totalPages: 3 };
    }),
    /429/
  );
});

test('excludes only National Day line items and skips lookups for orders without products', async () => {
  const resolved: string[] = [];
  const excluded = await getExcludedNationalDayAmounts(
    [
      {
        id: 'o1',
        merchantId: 'm1',
        items: [
          { productId: 'nd', totalAmount: new Prisma.Decimal(80) },
          { productId: 'regular', totalAmount: 150 },
        ],
      },
      { id: 'o2', merchantId: 'm2', items: [{ productId: null, totalAmount: 40 }] },
    ],
    async (merchantId) => {
      resolved.push(merchantId);
      return new Set(['nd']);
    }
  );

  assert.deepEqual(resolved, ['m1']);
  assert.equal(excluded.get('o1'), 80);
  assert.equal(excluded.get('o2'), 0);
});
