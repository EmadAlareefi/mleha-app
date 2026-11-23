import crypto from 'node:crypto';

import { env } from '@/app/lib/env';

/**
 * Signed customer links to the shipping-info form. The signature binds the
 * merchant, the order and the expiry; it reuses the customer-document secret.
 */

export const SHIPPING_INFO_LINK_TTL_SECONDS = 14 * 24 * 60 * 60;

function signingSecret(secretOverride?: string): string {
  const secret = (
    secretOverride ??
    (process.env.CUSTOMER_DOCUMENT_SIGNING_SECRET || env.CUSTOMER_DOCUMENT_SIGNING_SECRET)
  ).trim();
  if (secret.length < 32) throw new Error('CUSTOMER_DOCUMENT_SIGNING_SECRET must be at least 32 characters');
  return secret;
}

export function signShippingInfoLink(merchantId: string, orderId: string, expiresAt: number, secret?: string): string {
  return crypto
    .createHmac('sha256', signingSecret(secret))
    .update(['shipping-info', merchantId, orderId, String(expiresAt)].join(':'))
    .digest('hex');
}

export function verifyShippingInfoLink(input: {
  merchantId: string;
  orderId: string;
  expiresAt: number;
  signature: string;
  nowSeconds?: number;
  secret?: string;
}): boolean {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!/^\d{1,20}$/.test(input.merchantId) || !/^\d{1,20}$/.test(input.orderId)) return false;
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt < nowSeconds) return false;
  if (!/^[a-f0-9]{64}$/i.test(input.signature)) return false;
  const expected = signShippingInfoLink(input.merchantId, input.orderId, input.expiresAt, input.secret);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(input.signature.toLowerCase(), 'hex'));
}

export function createShippingInfoUrl(input: {
  merchantId: string;
  orderId: string;
  nowSeconds?: number;
  baseUrl?: string;
  secret?: string;
}): string {
  const baseUrl = (input.baseUrl ?? (process.env.CUSTOMER_DOCUMENT_BASE_URL || env.CUSTOMER_DOCUMENT_BASE_URL))
    .trim()
    .replace(/\/$/, '');
  if (!baseUrl) throw new Error('CUSTOMER_DOCUMENT_BASE_URL or NEXTAUTH_URL is not configured');
  const expiresAt = (input.nowSeconds ?? Math.floor(Date.now() / 1000)) + SHIPPING_INFO_LINK_TTL_SECONDS;
  const sig = signShippingInfoLink(input.merchantId, input.orderId, expiresAt, input.secret);
  return `${baseUrl}/shipping-info/${encodeURIComponent(input.merchantId)}/${encodeURIComponent(input.orderId)}?exp=${expiresAt}&sig=${sig}`;
}
