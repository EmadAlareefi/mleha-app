import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNegativeERPInvoiceIdError,
  classifyERPProcedureInvalidLine,
} from '../erp-order-sync';

test('classifies a free quantity line before it can reach the ERP procedure', () => {
  assert.equal(
    classifyERPProcedureInvalidLine({
      quantity: 0,
      price: 96,
      netAmount: 0,
      discountPercentage: 0,
    }),
    'zero-quantity'
  );
});

test('classifies zero-price and fully discounted lines', () => {
  assert.equal(
    classifyERPProcedureInvalidLine({
      quantity: 1,
      price: 0,
      netAmount: 0,
      discountPercentage: 0,
    }),
    'zero-price'
  );
  assert.equal(
    classifyERPProcedureInvalidLine({
      quantity: 1,
      price: 96,
      netAmount: 0,
      discountPercentage: 100,
    }),
    'fully-discounted'
  );
});

test('allows valid paid lines', () => {
  assert.equal(
    classifyERPProcedureInvalidLine({
      quantity: 1,
      price: 96,
      netAmount: 40,
      discountPercentage: 58.33,
    }),
    null
  );
});

test('explains the ERP -12 response', () => {
  assert.match(buildNegativeERPInvoiceIdError(-12), /سطر غير صالح/);
});
