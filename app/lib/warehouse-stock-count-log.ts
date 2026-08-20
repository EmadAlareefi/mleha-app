export type StockCountMode = 'override' | 'increment';

export type StockCountAuditInput = {
  mode?: unknown;
  productId?: unknown;
  productName?: unknown;
  productSku?: unknown;
  productImageUrl?: unknown;
  location?: unknown;
  entries?: unknown;
};

type AuditActor = {
  id: string | null;
  name: string | null;
  username: string | null;
};

export type WarehouseStockCountLogRow = {
  operationId: string;
  merchantId: string;
  mode: StockCountMode;
  productId: string;
  productName: string;
  productSku: string | null;
  productImageUrl: string | null;
  variantId: string;
  variantName: string;
  variantSku: string | null;
  barcode: string | null;
  countedQuantity: number;
  pendingQuantity: number;
  previousQuantity: number;
  resultingQuantity: number;
  delta: number;
  location: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdByUsername: string | null;
};

function cleanString(value: unknown) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function quantity(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

export function buildWarehouseStockCountLogRows(input: {
  audit: StockCountAuditInput;
  operationId: string;
  merchantId: string;
  actor: AuditActor;
}): WarehouseStockCountLogRow[] {
  const { audit, operationId, merchantId, actor } = input;
  const mode = audit.mode === 'override' || audit.mode === 'increment' ? audit.mode : null;
  const productId = cleanString(audit.productId);
  const productName = cleanString(audit.productName);
  const entries = Array.isArray(audit.entries) ? audit.entries.slice(0, 100) : [];

  if (!mode || !productId || !productName) return [];

  return entries.flatMap((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object') return [];
    const entry = rawEntry as Record<string, unknown>;
    const variantId = cleanString(entry.variantId);
    const variantName = cleanString(entry.variantName);
    const countedQuantity = quantity(entry.countedQuantity);
    const pendingQuantity = quantity(entry.pendingQuantity);
    const previousQuantity = quantity(entry.previousQuantity);

    if (
      !variantId ||
      !variantName ||
      countedQuantity === null ||
      pendingQuantity === null ||
      previousQuantity === null
    ) {
      return [];
    }

    const resultingQuantity =
      mode === 'increment'
        ? previousQuantity + countedQuantity
        : Math.max(0, countedQuantity - pendingQuantity);

    return [{
      operationId,
      merchantId,
      mode,
      productId,
      productName,
      productSku: cleanString(audit.productSku),
      productImageUrl: cleanString(audit.productImageUrl),
      variantId,
      variantName,
      variantSku: cleanString(entry.variantSku),
      barcode: cleanString(entry.barcode),
      countedQuantity,
      pendingQuantity,
      previousQuantity,
      resultingQuantity,
      delta: resultingQuantity - previousQuantity,
      location: cleanString(audit.location),
      createdById: actor.id,
      createdByName: actor.name,
      createdByUsername: actor.username,
    }];
  });
}

export function stockAdjustmentsMatchAudit(
  adjustments: Array<{ identifer: string | number; quantity: string | number; mode: string }>,
  rows: WarehouseStockCountLogRow[]
) {
  const expected = new Map<string, number>();
  for (const row of rows) {
    if (row.delta !== 0) expected.set(row.variantId, row.delta);
  }

  if (expected.size !== adjustments.length) return false;

  return adjustments.every((adjustment) => {
    const identifier = String(adjustment.identifer);
    const numericQuantity = Number(adjustment.quantity);
    const signedQuantity = adjustment.mode === 'increment' ? numericQuantity : -numericQuantity;
    return Number.isFinite(numericQuantity) && expected.get(identifier) === signedQuantity;
  });
}
