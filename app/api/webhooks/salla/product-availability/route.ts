import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runAvailabilityStockCheck } from '@/app/lib/availability-stock-watcher';
import {
  AVAILABILITY_PRODUCT_EVENTS,
  extractAvailabilityProductEvent,
  extractAvailabilityProductId,
} from '@/app/lib/availability-product-webhook';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

function secretsMatch(expected: string, actual: string | null): boolean {
  if (!actual) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

/**
 * Salla product events accelerate a targeted stock check. The 15-minute cron
 * remains the source-of-truth fallback because Salla is deprecating its broad
 * product.updated/product.available events.
 *
 * The Salla subscription supplies CRON_SECRET as a private custom header. This
 * endpoint fails closed if that secret is absent or incorrect.
 */
export async function POST(request: NextRequest) {
  const expectedSecret =
    process.env.SALLA_PRODUCT_WEBHOOK_SECRET || process.env.CRON_SECRET || '';
  const suppliedSecret = request.headers.get('x-mleha-webhook-secret');

  if (!expectedSecret) {
    log.error('Product availability webhook secret is not configured');
    return NextResponse.json({ success: false, error: 'not_configured' }, { status: 503 });
  }

  if (!secretsMatch(expectedSecret, suppliedSecret)) {
    log.warn('Rejected product availability webhook due to invalid secret');
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const event = extractAvailabilityProductEvent(payload);
  if (!AVAILABILITY_PRODUCT_EVENTS.has(event)) {
    return NextResponse.json({ success: true, ignored: event || 'unknown' });
  }

  const productId = extractAvailabilityProductId(payload);
  if (!productId) {
    log.warn('Product availability webhook did not contain a product id', { event });
    return NextResponse.json(
      { success: false, error: 'missing_product_id' },
      { status: 400 }
    );
  }

  try {
    const result = await runAvailabilityStockCheck({ productIds: [productId] });
    return NextResponse.json({
      success: true,
      event,
      productId,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    log.error('Targeted product availability check failed', {
      event,
      productId,
      error: message,
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
