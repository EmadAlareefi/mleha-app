import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export interface RawOrderItemLike {
  id?: number | string;
  sku?: string;
  name?: string;
  quantity?: number;
  currency?: string;
  amounts?: {
    price_without_tax?: { amount?: number };
    tax?: { amount?: { amount?: number } };
    total?: { amount?: number };
  };
  product?: { id?: number | string; sku?: string };
}

function unwrapOrderPayload(payload: Record<string, any>): Record<string, any> {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return data?.order && typeof data.order === 'object' ? data.order : data;
}

/** Extracts the `items` array from a raw webhook payload (same shape as WebhookEvent.rawPayload). */
export function extractItemsFromWebhookPayload(rawPayload: unknown): RawOrderItemLike[] {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return [];
  }
  const order = unwrapOrderPayload(rawPayload as Record<string, any>);
  return Array.isArray(order?.items) ? order.items : [];
}

export function normalizeSkuForMatch(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

/**
 * Replaces the locally stored line items for one order. Salla's order-list
 * sync doesn't carry items, so this is how SallaOrderItem gets populated —
 * either from a webhook payload (which does carry items) or from a live
 * `/orders/items` fetch (backfill fallback for orders with no webhook history).
 */
export async function upsertSallaOrderItems(
  merchantId: string,
  orderId: string,
  items: RawOrderItemLike[],
  source: 'webhook' | 'api'
): Promise<{ stored: number }> {
  if (!items || items.length === 0) {
    return { stored: 0 };
  }

  const rows = items
    .map((item) => {
      const itemId = item.id != null ? String(item.id) : null;
      if (!itemId) {
        return null;
      }
      const rawSku = (item.sku || item.product?.sku || '').toString();
      const priceWithoutTax = item.amounts?.price_without_tax?.amount;
      const taxAmount = item.amounts?.tax?.amount?.amount;
      const totalAmount = item.amounts?.total?.amount;
      const priceAmount =
        priceWithoutTax != null && taxAmount != null ? priceWithoutTax + taxAmount : totalAmount ?? null;
      const quantityNum = Number(item.quantity);

      return {
        merchantId,
        orderId,
        itemId,
        productId: item.product?.id != null ? String(item.product.id) : null,
        sku: rawSku || null,
        skuNormalized: normalizeSkuForMatch(rawSku),
        name: item.name || null,
        quantity: Number.isFinite(quantityNum) ? Math.max(0, Math.round(quantityNum)) : 0,
        priceAmount: priceAmount != null ? new Prisma.Decimal(priceAmount) : null,
        totalAmount: totalAmount != null ? new Prisma.Decimal(totalAmount) : null,
        currency: item.currency || null,
        source,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) {
    return { stored: 0 };
  }

  try {
    await prisma.$transaction([
      prisma.sallaOrderItem.deleteMany({ where: { merchantId, orderId } }),
      prisma.sallaOrderItem.createMany({ data: rows }),
    ]);
    return { stored: rows.length };
  } catch (error) {
    log.error('Failed to persist Salla order items', { merchantId, orderId, source, error });
    return { stored: 0 };
  }
}
