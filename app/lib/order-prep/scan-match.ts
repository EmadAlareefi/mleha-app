/**
 * Matching a scanned tag barcode to the items of the order on screen.
 *
 * Dress tags carry the product SKU, which is the same for every size, so a
 * match confirms the dress; the size is still confirmed by eye. Labels printed
 * later may carry "SKU|SIZE", which then confirms the size too.
 */

export type ScanItem = {
  index: number;
  sku: string | null;
  size: string | null;
  quantity: number;
};

export type ScanResult =
  | { kind: 'match'; index: number; sizeVerified: boolean }
  | { kind: 'already_done'; index: number }
  | { kind: 'mismatch'; scanned: string };

export function normalizeScanValue(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Which item a scan belongs to. `checked` holds units already confirmed per
 * item index. When two lines share a SKU (same dress, two sizes), the first one
 * still missing units takes the scan.
 */
export function matchScan(scanned: string, items: ScanItem[], checked: Record<number, number>): ScanResult {
  const value = normalizeScanValue(scanned);
  if (!value) return { kind: 'mismatch', scanned };

  const candidates = items.filter((item) => {
    const sku = item.sku ? normalizeScanValue(item.sku) : '';
    if (!sku) return false;
    if (value === sku) return true;
    const size = item.size ? normalizeScanValue(item.size) : '';
    return Boolean(size) && value === `${sku}|${size}`;
  });
  if (candidates.length === 0) return { kind: 'mismatch', scanned };

  const sizeTagged = candidates.filter(
    (item) => item.size && value === `${normalizeScanValue(item.sku ?? '')}|${normalizeScanValue(item.size)}`,
  );
  const pool = sizeTagged.length > 0 ? sizeTagged : candidates;
  const open = pool.find((item) => (checked[item.index] ?? 0) < item.quantity);
  if (!open) return { kind: 'already_done', index: pool[0].index };
  return { kind: 'match', index: open.index, sizeVerified: sizeTagged.length > 0 };
}

/** True when two or more lines of the order share one SKU (size must be read carefully). */
export function hasSharedSku(items: ScanItem[]): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const sku = item.sku ? normalizeScanValue(item.sku) : '';
    if (!sku) continue;
    if (seen.has(sku)) return true;
    seen.add(sku);
  }
  return false;
}
