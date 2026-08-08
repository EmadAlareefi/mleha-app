import { getOrderItemUnitPrice } from './item-price';
import { getOrderItemProductId } from './order-item-id';

/**
 * Matches the lines a customer submitted against the order they belong to, and
 * prices them from the order.
 *
 * `/api/returns/create` is public, so everything in its body is
 * attacker-controlled. Only each line's order-item id is taken on trust, and
 * even that has to resolve to a real line on the order; the price, name, SKU
 * and variant are all read back from Salla. This matters because the resulting
 * amount lands in `ReturnRequest.totalRefundAmount` and, through the exchange
 * flow, in a real fixed-amount Salla coupon.
 *
 * Kept pure and separate from the route so the money rules can be tested
 * without a Salla token or a database.
 */

export interface RequestedReturnItem {
  /**
   * Salla order-item id — the only key that maps a line back unambiguously.
   * `productId` repeats across lines of the same product in different variants,
   * and the browser falls back to the item id when Salla omits the product
   * object, so the two id spaces overlap.
   */
  orderItemId?: number | string;
  productId?: string;
  quantity?: number;
}

export interface ResolvedReturnItem {
  productId: string;
  productName: string;
  productSku?: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  price: number;
}

export type ResolveReturnItemsResult =
  | { ok: true; items: ResolvedReturnItem[] }
  | { ok: false; reason: 'unknown_item' | 'invalid_quantity'; orderItemId: string };

interface OrderLike {
  items?: Array<Record<string, any>> | null;
}

export function resolveReturnItems(
  order: OrderLike | null | undefined,
  requestedItems: RequestedReturnItem[] | null | undefined
): ResolveReturnItemsResult {
  const orderItemsById = new Map(
    (order?.items || []).map((item) => [String(item?.id), item] as const)
  );

  // Tracked across lines so the same item cannot be submitted twice to slip
  // past the per-line ceiling.
  const requestedQuantityByItem = new Map<string, number>();
  const items: ResolvedReturnItem[] = [];

  for (const requested of requestedItems || []) {
    const key = String(requested?.orderItemId ?? '').trim();
    const orderItem = key ? orderItemsById.get(key) : undefined;

    if (!orderItem) {
      return { ok: false, reason: 'unknown_item', orderItemId: key };
    }

    const quantity = Number(requested?.quantity);
    const orderedQuantity = Number(orderItem.quantity) || 0;
    const alreadyRequested = requestedQuantityByItem.get(key) ?? 0;

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      alreadyRequested + quantity > orderedQuantity
    ) {
      return { ok: false, reason: 'invalid_quantity', orderItemId: key };
    }

    requestedQuantityByItem.set(key, alreadyRequested + quantity);

    items.push({
      // Prefer the id Salla reports for the line; the browser's value is only a
      // fallback for payloads that carry no product object at all.
      productId:
        getOrderItemProductId(orderItem) || String(requested?.productId || '').trim(),
      productName: orderItem.name || orderItem.product?.name || 'منتج',
      productSku: orderItem.sku || orderItem.product?.sku,
      variantId: orderItem.variant?.id ? String(orderItem.variant.id) : undefined,
      variantName: orderItem.variant?.name,
      quantity,
      price: getOrderItemUnitPrice(orderItem),
    });
  }

  return { ok: true, items };
}
