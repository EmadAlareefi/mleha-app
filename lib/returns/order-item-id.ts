type AnyRecord = Record<string, any>;

/**
 * The product id Salla reports for an order line, or null when the payload
 * carries none.
 *
 * Its own module so the returns pricing rules can use it without pulling in
 * `./policy`, which reaches for Prisma and the Salla client.
 */
export const getOrderItemProductId = (item: AnyRecord): string | null => {
  const candidates = [
    item.product_id,
    item.productId,
    item.productID,
    item.product?.id,
    item.product?.product_id,
    item.product?.productId,
  ];

  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }

  return null;
};
