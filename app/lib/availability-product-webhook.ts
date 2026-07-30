export const AVAILABILITY_PRODUCT_EVENTS = new Set([
  'product.updated',
  'product.available',
  'product.variant.updated',
  'product.option.updated',
  'product.status.updated',
]);

export function extractAvailabilityProductId(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const data =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : {};
  const product =
    data.product && typeof data.product === 'object'
      ? (data.product as Record<string, unknown>)
      : record.product && typeof record.product === 'object'
        ? (record.product as Record<string, unknown>)
        : {};

  const event = extractAvailabilityProductEvent(payload);
  const nestedProductCandidates = [data.product_id, product.id, record.product_id];
  // For variant/option events, data.id identifies the child record rather than
  // the product. Prefer the explicit parent product id in those payloads.
  const candidates =
    event === 'product.variant.updated' || event === 'product.option.updated'
      ? nestedProductCandidates
      : [data.id, ...nestedProductCandidates];
  for (const candidate of candidates) {
    const id = Number.parseInt(String(candidate ?? ''), 10);
    if (Number.isInteger(id) && id > 0) {
      return id;
    }
  }

  return null;
}

export function extractAvailabilityProductEvent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as Record<string, unknown>;
  const event = record.event ?? record.topic ?? record.type;
  return typeof event === 'string' ? event.trim() : '';
}
