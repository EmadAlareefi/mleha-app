import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateDesignModelSku, getDesignModelSkuPrefix } from '../design-model-sku';

const session = { user: { username: '40' } };
const date = new Date('2026-07-01T00:00:00.000Z');

test('builds design model SKU prefix from username and two digit year', () => {
  assert.equal(getDesignModelSkuPrefix(session, date), '4026');
  assert.equal(getDesignModelSkuPrefix(session, new Date('2025-12-31T22:00:00.000Z')), '4026');
});

test('allocates the next three digit design model sequence', async () => {
  const client = {
    designModel: {
      findMany: async () => [
        { sku: '4026001' },
        { sku: '4026009' },
        { sku: '4026010' },
        { sku: '4026ABC' },
      ],
    },
  };

  await assert.rejects(
    () => allocateDesignModelSku({
      designModel: {
        findMany: async () => [{ sku: '4026999' }],
      },
    } as any, session, date),
    /تم استهلاك كل تسلسل SKU/
  );
  assert.equal(await allocateDesignModelSku(client as any, session, date), '4026011');
});

test('starts sequence at 001 when no matching SKU exists', async () => {
  const client = {
    designModel: {
      findMany: async () => [],
    },
  };

  assert.equal(await allocateDesignModelSku(client as any, session, date), '4026001');
});
