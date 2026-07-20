import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import { getSallaOrderItems } from '@/app/lib/salla-api';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

// Salla has no bulk "order items across many orders" endpoint, so this route
// live-fetches items per order. Cap how many orders we touch per request so a
// wide timeframe can't turn one page load into hundreds of upstream calls.
const MAX_ORDERS = 300;
const CONCURRENCY = 8;

function normalizeSku(input: unknown): string {
  if (typeof input !== 'string') {
    return '';
  }
  const trimmed = input.trim();
  return trimmed ? trimmed.toUpperCase() : '';
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !hasServiceAccess(session, 'returns-analytics')) {
    return NextResponse.json({ error: 'ليس لديك صلاحية للوصول إلى هذه البيانات' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const requestedMerchant = searchParams.get('merchantId');
    const resolved = await resolveSallaMerchantId(requestedMerchant);

    if (!resolved.merchantId) {
      return NextResponse.json(
        { error: resolved.error || 'لا يوجد متجر مرتبط بسلة.' },
        { status: requestedMerchant ? 404 : 503 }
      );
    }

    const daysParam = Number.parseInt(searchParams.get('days') || '30', 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orders = await prisma.sallaOrder.findMany({
      where: {
        merchantId: resolved.merchantId,
        placedAt: { gte: startDate },
        statusSlug: { not: 'canceled' },
      },
      select: { orderId: true },
      orderBy: { placedAt: 'desc' },
      take: MAX_ORDERS,
    });

    const bySku: Record<string, number> = {};
    let failedOrders = 0;

    await mapWithConcurrency(orders, CONCURRENCY, async ({ orderId }) => {
      const items = await getSallaOrderItems(resolved.merchantId, orderId);
      if (!items) {
        failedOrders += 1;
        return;
      }
      items.forEach((item) => {
        const sku = normalizeSku(item.sku || item.product?.sku);
        if (!sku) {
          return;
        }
        const quantity = Number(item.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return;
        }
        bySku[sku] = (bySku[sku] || 0) + quantity;
      });
    });

    if (failedOrders > 0) {
      log.warn('Some orders failed while computing sales-by-sku', {
        merchantId: resolved.merchantId,
        failedOrders,
        ordersProcessed: orders.length,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        bySku,
        ordersProcessed: orders.length - failedOrders,
        ordersFailed: failedOrders,
        truncated: orders.length >= MAX_ORDERS,
      },
    });
  } catch (error) {
    log.error('Error computing sales by SKU', { error });
    return NextResponse.json(
      { error: 'تعذر حساب بيانات المبيعات لكل SKU' },
      { status: 500 }
    );
  }
}
