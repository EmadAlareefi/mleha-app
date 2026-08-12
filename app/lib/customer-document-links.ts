import crypto from 'node:crypto';

import { env } from '@/app/lib/env';

export type CustomerDocumentKind = 'invoice';

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function signingSecret(): string {
  const secret = (
    process.env.CUSTOMER_DOCUMENT_SIGNING_SECRET ||
    env.CUSTOMER_DOCUMENT_SIGNING_SECRET
  ).trim();
  if (!secret) {
    throw new Error('CUSTOMER_DOCUMENT_SIGNING_SECRET is not configured');
  }
  if (secret.length < 32) {
    throw new Error('CUSTOMER_DOCUMENT_SIGNING_SECRET must be at least 32 characters');
  }
  return secret;
}

function signaturePayload(
  kind: CustomerDocumentKind,
  merchantId: string,
  orderId: string,
  expiresAt: number
): string {
  return [kind, merchantId, orderId, String(expiresAt)].join(':');
}

export function signCustomerDocument(
  kind: CustomerDocumentKind,
  merchantId: string,
  orderId: string,
  expiresAt: number
): string {
  return crypto
    .createHmac('sha256', signingSecret())
    .update(signaturePayload(kind, merchantId, orderId, expiresAt))
    .digest('hex');
}

export function verifyCustomerDocumentSignature(input: {
  kind: CustomerDocumentKind;
  merchantId: string;
  orderId: string;
  expiresAt: number;
  signature: string;
  nowSeconds?: number;
}): boolean {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt < nowSeconds) return false;
  if (!/^[a-f0-9]{64}$/i.test(input.signature)) return false;

  const expected = signCustomerDocument(
    input.kind,
    input.merchantId,
    input.orderId,
    input.expiresAt
  );
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(input.signature, 'hex')
    );
  } catch {
    return false;
  }
}

export function createSignedCustomerDocumentUrl(input: {
  kind: CustomerDocumentKind;
  merchantId: string;
  orderId: string;
  expiresAt?: number;
}): string {
  const baseUrl = (
    process.env.CUSTOMER_DOCUMENT_BASE_URL ||
    env.CUSTOMER_DOCUMENT_BASE_URL
  ).trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('CUSTOMER_DOCUMENT_BASE_URL or NEXTAUTH_URL is not configured');
  const expiresAt =
    input.expiresAt ?? Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS;
  const signature = signCustomerDocument(
    input.kind,
    input.merchantId,
    input.orderId,
    expiresAt
  );
  const path = [
    'api/public/order-documents',
    encodeURIComponent(input.kind),
    encodeURIComponent(input.merchantId),
    encodeURIComponent(input.orderId),
  ].join('/');
  return `${baseUrl}/${path}?exp=${expiresAt}&sig=${signature}`;
}
