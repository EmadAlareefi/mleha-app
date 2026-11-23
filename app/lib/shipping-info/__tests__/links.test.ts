import assert from 'node:assert/strict';
import test from 'node:test';
import { createShippingInfoUrl, signShippingInfoLink, verifyShippingInfoLink } from '../links';

const secret = 'x'.repeat(40);
const now = 1_800_000_000;

test('a link it created verifies, and expires', () => {
  const url = new URL(createShippingInfoUrl({ merchantId: '1696031053', orderId: '623201136', nowSeconds: now, baseUrl: 'https://app.example.com/', secret }));
  assert.equal(url.pathname, '/shipping-info/1696031053/623201136');
  const expiresAt = Number(url.searchParams.get('exp'));
  const signature = url.searchParams.get('sig') ?? '';
  const base = { merchantId: '1696031053', orderId: '623201136', expiresAt, signature, secret };
  assert.equal(verifyShippingInfoLink({ ...base, nowSeconds: now }), true);
  assert.equal(verifyShippingInfoLink({ ...base, nowSeconds: expiresAt + 1 }), false);
});

test('tampering is refused', () => {
  const expiresAt = now + 100;
  const signature = signShippingInfoLink('1696031053', '623201136', expiresAt, secret);
  const base = { merchantId: '1696031053', orderId: '623201136', expiresAt, signature, secret, nowSeconds: now };
  assert.equal(verifyShippingInfoLink({ ...base, orderId: '623201137' }), false);
  assert.equal(verifyShippingInfoLink({ ...base, expiresAt: expiresAt + 1 }), false);
  assert.equal(verifyShippingInfoLink({ ...base, signature: '0'.repeat(64) }), false);
  assert.equal(verifyShippingInfoLink({ ...base, signature: 'nothex' }), false);
  assert.equal(verifyShippingInfoLink({ ...base, merchantId: '../x' }), false);
});
