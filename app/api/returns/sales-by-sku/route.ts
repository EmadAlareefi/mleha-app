import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import { getSallaOrderItems } from '@/app/lib/salla-api';
import { upsertSallaOrderItems } from '@/app/lib/salla-order-items';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

// Orders in range that have no local SallaOrderItem yet (e.g. a webhook that
// hasn't landed) are gap-filled with a live fetch, capped so a large backlog
// can't turn a page load back into hundreds of upstream calls — the backfill
// script (scripts/backfill-order-items.ts) handles bulk historical gaps.
const MAX_LIVE_FALLBACK = 50;

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
    const merchantId = resolved.merchantId;

    const daysParam = Number.parseInt(searchParams.get('days') || '30', 10);
    const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Gross sales (return-rate denominator): every non-canceled order counts,
    // even ones later returned — otherwise a 100%-returned SKU would divide
    // by a near-zero "net sales" figure instead of showing a 100% rate.
    const ordersInRange = await prisma.sallaOrder.findMany({
      where: { merchantId, placedAt: { gte: startDate }, statusSlug: { not: 'canceled' } },
      select: { orderId: true },
    });
    const orderIdsInRange = ordersInRange.map((o) => o.orderId);

    const localItems = await prisma.sallaOrderItem.findMany({
      where: { merchantId, orderId: { in: orderIdsInRange } },
      select: { orderId: true, skuNormalized: true, quantity: true },
    });

    const bySku: Record<string, number> = {};
    const coveredOrderIds = new Set<string>();
    localItems.forEach((item) => {
      coveredOrderIds.add(item.orderId);
      if (!item.skuNormalized || item.quantity <= 0) {
        return;
      }
      bySku[item.skuNormalized] = (bySku[item.skuNormalized] || 0) + item.quantity;
    });

    const missingOrderIds = orderIdsInRange.filter((id) => !coveredOrderIds.has(id));
    const fallbackOrderIds = missingOrderIds.slice(0, MAX_LIVE_FALLBACK);
    let fallbackFailed = 0;

    if (fallbackOrderIds.length > 0) {
      await mapWithConcurrency(fallbackOrderIds, 6, async (orderId) => {
        const items = await getSallaOrderItems(merchantId, orderId);
        if (!items) {
          fallbackFailed += 1;
          return;
        }
        await upsertSallaOrderItems(merchantId, orderId, items, 'api');
        items.forEach((item) => {
          const sku = (item.sku || item.product?.sku || '').toString().trim().toUpperCase();
          const quantity = Number(item.quantity ?? 0);
          if (!sku || !Number.isFinite(quantity) || quantity <= 0) {
            return;
          }
          bySku[sku] = (bySku[sku] || 0) + quantity;
        });
      });
    }

    if (missingOrderIds.length > 0) {
      log.info('sales-by-sku: gap-filled orders missing local items', {
        merchantId,
        missing: missingOrderIds.length,
        fallbackAttempted: fallbackOrderIds.length,
        fallbackFailed,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        bySku,
        ordersInRange: orderIdsInRange.length,
        ordersMissingLocally: missingOrderIds.length,
        ordersStillMissing: Math.max(0, missingOrderIds.length - fallbackOrderIds.length + fallbackFailed),
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
