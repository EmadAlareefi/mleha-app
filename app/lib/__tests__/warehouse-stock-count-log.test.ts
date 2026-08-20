import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWarehouseStockCountLogRows,
  stockAdjustmentsMatchAudit,
} from '../warehouse-stock-count-log';

const actor = { id: 'user-1', name: 'موظف المستودع', username: 'warehouse' };

test('derives override quantities on the server and keeps a zero-delta count', () => {
  const rows = buildWarehouseStockCountLogRows({
    operationId: 'operation-1',
    merchantId: 'merchant-1',
    actor,
    audit: {
      mode: 'override',
      productId: 'product-1',
      productName: 'عباية',
      entries: [
        {
          variantId: 'variant-1',
          variantName: 'مقاس 52',
          countedQuantity: 12,
          pendingQuantity: 2,
          previousQuantity: 10,
        },
      ],
    },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].resultingQuantity, 10);
  assert.equal(rows[0].delta, 0);
  assert.equal(rows[0].createdByUsername, 'warehouse');
});

test('derives increment results and verifies the matching Salla adjustment', () => {
  const rows = buildWarehouseStockCountLogRows({
    operationId: 'operation-2',
    merchantId: 'merchant-1',
    actor,
    audit: {
      mode: 'increment',
      productId: 'product-1',
      productName: 'عباية',
      entries: [
        {
          variantId: 'variant-2',
          variantName: 'مقاس 54',
          countedQuantity: 4,
          pendingQuantity: 3,
          previousQuantity: 8,
        },
      ],
    },
  });

  assert.equal(rows[0].resultingQuantity, 12);
  assert.equal(rows[0].delta, 4);
  assert.equal(
    stockAdjustmentsMatchAudit(
      [{ identifer: 'variant-2', quantity: 4, mode: 'increment' }],
      rows
    ),
    true
  );
  assert.equal(
    stockAdjustmentsMatchAudit(
      [{ identifer: 'variant-2', quantity: 3, mode: 'increment' }],
      rows
    ),
    false
  );
});

test('rejects incomplete or negative count rows', () => {
  const rows = buildWarehouseStockCountLogRows({
    operationId: 'operation-3',
    merchantId: 'merchant-1',
    actor,
    audit: {
      mode: 'override',
      productId: 'product-1',
      productName: 'عباية',
      entries: [
        { variantId: 'variant-1', countedQuantity: -1, pendingQuantity: 0, previousQuantity: 2 },
      ],
    },
  });

  assert.deepEqual(rows, []);
});
