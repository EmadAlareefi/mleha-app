const SMSA_RETURN_REFERENCE_PATTERN = /^R[\s_-]+(.+)$/i;

export function extractSmsaReturnOrderReference(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    return null;
  }

  const normalized = value.toString().trim();
  const match = normalized.match(SMSA_RETURN_REFERENCE_PATTERN);
  const orderReference = match?.[1]?.trim().replace(/^#/, '');

  return orderReference || null;
}

export function hasSallaReturnShipmentMarker(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 8) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasSallaReturnShipmentMarker(entry, depth + 1));
  }

  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();

    if (
      ['type', 'shipment_type', 'shipmenttype'].includes(normalizedKey) &&
      typeof candidate === 'string' &&
      /^(return|returned|reverse|مرتجع|رجيع)$/i.test(candidate.trim())
    ) {
      return true;
    }

    if (
      ['reference', 'shipment_reference', 'order_reference_id'].includes(normalizedKey) &&
      extractSmsaReturnOrderReference(candidate)
    ) {
      return true;
    }

    if (hasSallaReturnShipmentMarker(candidate, depth + 1)) {
      return true;
    }
  }

  return false;
}
