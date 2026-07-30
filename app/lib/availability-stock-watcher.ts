import { log } from '@/app/lib/logger';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { getSallaProductLiveStats, getSallaProductVariations } from '@/app/lib/salla-api';
import { isAvailabilityAutoNotifyEnabled } from '@/app/lib/settings';
import {
  sendAvailabilityNotification,
  type AvailabilityNotificationResult,
} from '@/app/lib/availability-notification';
import {
  claimRequestsForNotification,
  listPendingRequestsForWatcher,
  markRequestFailed,
  markRequestNotified,
  markRequestsBackInStock,
  markRequestsChecked,
  recoverStaleNotificationClaims,
  releaseClaimedRequest,
  type AvailabilityRequestRecord,
} from '@/app/lib/salla-availability-requests';

/**
 * Polls Salla for the products people are waiting on and notifies the waiting
 * customers once stock returns.
 *
 * Two properties matter here and are worth stating plainly:
 *  - a customer must never receive the same back-in-stock message twice, which is
 *    why sending is gated behind an atomic pending -> notifying claim; and
 *  - a Salla outage must not burn through a request's retry budget silently, which
 *    is why a failed *stock lookup* leaves requests untouched rather than failing them.
 */

export type ProductAvailability = {
  productId: number;
  found: boolean;
  /** Product-level stock, or null when Salla does not expose it (variable products). */
  productQuantity: number | null;
  /** Variant id -> remaining quantity, for requests tied to a specific size. */
  variantQuantities: Record<string, number | null>;
  /** Unique normalized variant name -> quantity; safe fallback for storefront IDs. */
  variantQuantitiesByName: Record<string, number | null>;
};

export type WatcherDeps = {
  listPending: () => Promise<AvailabilityRequestRecord[]>;
  loadAvailability: (productId: number) => Promise<ProductAvailability>;
  notify: (request: AvailabilityRequestRecord) => Promise<AvailabilityNotificationResult>;
  claim: (ids: string[]) => Promise<string[]>;
  release: (id: string) => Promise<void>;
  markNotified: (id: string) => Promise<unknown>;
  markFailed: (id: string, error: string) => Promise<unknown>;
  markChecked: (ids: string[]) => Promise<void>;
  markBackInStock: (ids: string[]) => Promise<void>;
  recoverStaleClaims: () => Promise<number>;
  autoNotifyEnabled: () => Promise<boolean>;
};

export type WatcherProductSummary = {
  productId: number;
  productName: string;
  found: boolean;
  waiting: number;
  backInStock: number;
  sent: number;
  failed: number;
  skipped: number;
  error?: string;
};

export type WatcherRunResult = {
  dryRun: boolean;
  autoNotifyEnabled: boolean;
  pendingRequests: number;
  productsChecked: number;
  backInStock: number;
  sent: number;
  failed: number;
  skipped: number;
  recoveredStale: number;
  products: WatcherProductSummary[];
};

export function normalizeVariantName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ar');
}

/**
 * Decides whether a single request's specific product/variant is purchasable again.
 *
 * A request that names a variant is only satisfied by that variant having stock —
 * a dress being back in size L does nothing for someone waiting on size S. A
 * request with no variant falls back to product-level stock, and when Salla reports
 * no product-level quantity (the usual case for variable products) the sum of the
 * variants stands in for it, which is what getSallaProductLiveStats already does.
 */
export function isRequestSatisfied(
  request: Pick<AvailabilityRequestRecord, 'variationId' | 'variationName' | 'requestedSize'>,
  availability: ProductAvailability
): boolean {
  if (!availability.found) {
    return false;
  }

  if (request.variationId) {
    const variationId = String(request.variationId);
    if (Object.prototype.hasOwnProperty.call(availability.variantQuantities, variationId)) {
      const quantity = availability.variantQuantities[variationId];
      return typeof quantity === 'number' && quantity > 0;
    }

    // Salla storefront option markup exposes SKU-combination ids, while the
    // Admin API exposes different variant ids. Fall back only to a unique exact
    // label match; ambiguous labels are deliberately omitted from the map.
    const labels = [request.variationName, request.requestedSize]
      .map(normalizeVariantName)
      .filter(Boolean);
    for (const label of labels) {
      if (Object.prototype.hasOwnProperty.call(availability.variantQuantitiesByName, label)) {
        const quantity = availability.variantQuantitiesByName[label];
        return typeof quantity === 'number' && quantity > 0;
      }
    }
    return false;
  }

  return typeof availability.productQuantity === 'number' && availability.productQuantity > 0;
}

function groupByProduct(
  requests: AvailabilityRequestRecord[]
): Map<number, AvailabilityRequestRecord[]> {
  const grouped = new Map<number, AvailabilityRequestRecord[]>();
  for (const request of requests) {
    const existing = grouped.get(request.productId);
    if (existing) {
      existing.push(request);
    } else {
      grouped.set(request.productId, [request]);
    }
  }
  return grouped;
}

async function loadAvailabilityFromSalla(
  merchantId: string,
  productId: number
): Promise<ProductAvailability> {
  const stats = await getSallaProductLiveStats(merchantId, productId);

  const variantQuantities: Record<string, number | null> = {};
  const variantQuantitiesByName: Record<string, number | null> = {};
  const ambiguousVariantNames = new Set<string>();
  if (stats.found) {
    try {
      const variations = await getSallaProductVariations(merchantId, productId);
      for (const variation of variations) {
        if (variation.id != null) {
          variantQuantities[String(variation.id)] = variation.availableQuantity ?? null;
        }
        const nameKey = normalizeVariantName(variation.name);
        if (nameKey) {
          if (
            ambiguousVariantNames.has(nameKey) ||
            Object.prototype.hasOwnProperty.call(variantQuantitiesByName, nameKey)
          ) {
            delete variantQuantitiesByName[nameKey];
            ambiguousVariantNames.add(nameKey);
          } else {
            variantQuantitiesByName[nameKey] = variation.availableQuantity ?? null;
          }
        }
      }
    } catch (error) {
      // A variant lookup failure must not read as "everything is in stock".
      log.warn('Could not load variants while checking availability', {
        productId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  return {
    productId,
    found: stats.found,
    productQuantity: stats.remainingQuantity,
    variantQuantities,
    variantQuantitiesByName,
  };
}

export function createDefaultWatcherDeps(merchantId: string): WatcherDeps {
  return {
    listPending: listPendingRequestsForWatcher,
    loadAvailability: (productId) => loadAvailabilityFromSalla(merchantId, productId),
    notify: sendAvailabilityNotification,
    claim: claimRequestsForNotification,
    release: releaseClaimedRequest,
    markNotified: (id) => markRequestNotified({ id, channel: 'whatsapp', actorName: 'auto' }),
    markFailed: (id, error) => markRequestFailed({ id, error }),
    markChecked: markRequestsChecked,
    markBackInStock: markRequestsBackInStock,
    recoverStaleClaims: recoverStaleNotificationClaims,
    autoNotifyEnabled: isAvailabilityAutoNotifyEnabled,
  };
}

export async function runAvailabilityStockCheck(
  options: { dryRun?: boolean; productIds?: number[]; deps?: WatcherDeps } = {}
): Promise<WatcherRunResult> {
  const dryRun = options.dryRun === true;

  let deps = options.deps;
  if (!deps) {
    const { merchantId, error } = await resolveSallaMerchantId();
    if (!merchantId) {
      throw new Error(error || 'تعذر تحديد المتجر المرتبط بسلة');
    }
    deps = createDefaultWatcherDeps(merchantId);
  }

  const autoNotifyEnabled = await deps.autoNotifyEnabled();
  const recoveredStale = dryRun ? 0 : await deps.recoverStaleClaims();
  const requestedProductIds = new Set(
    (options.productIds || []).filter((id) => Number.isInteger(id) && id > 0)
  );
  const allPending = await deps.listPending();
  const pending =
    requestedProductIds.size > 0
      ? allPending.filter((request) => requestedProductIds.has(request.productId))
      : allPending;
  const grouped = groupByProduct(pending);

  const result: WatcherRunResult = {
    dryRun,
    autoNotifyEnabled,
    pendingRequests: pending.length,
    productsChecked: 0,
    backInStock: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    recoveredStale,
    products: [],
  };

  for (const [productId, requests] of grouped) {
    const summary: WatcherProductSummary = {
      productId,
      productName: requests[0]?.productName ?? '',
      found: false,
      waiting: requests.length,
      backInStock: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };

    let availability: ProductAvailability;
    try {
      availability = await deps.loadAvailability(productId);
      result.productsChecked += 1;
    } catch (error) {
      // Salla was unreachable for this product. Leave every request exactly as it
      // was so the next run retries; do not spend anyone's retry budget on it.
      summary.error = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      log.error('Availability check failed for product', { productId, error: summary.error });
      result.products.push(summary);
      continue;
    }

    summary.found = availability.found;
    await deps.markChecked(requests.map((request) => request.id));

    const satisfied = requests.filter((request) => isRequestSatisfied(request, availability));
    summary.backInStock = satisfied.length;
    result.backInStock += satisfied.length;

    if (satisfied.length === 0) {
      result.products.push(summary);
      continue;
    }

    await deps.markBackInStock(satisfied.map((request) => request.id));

    if (dryRun || !autoNotifyEnabled) {
      summary.skipped += satisfied.length;
      result.skipped += satisfied.length;
      result.products.push(summary);
      continue;
    }

    for (const request of satisfied) {
      // Claim immediately before this send. Claiming a whole product batch at
      // once left dozens of rows stranded when an invocation was interrupted.
      const claimedIds = await deps.claim([request.id]);
      if (!claimedIds.includes(request.id)) {
        // Another run already owns this one.
        summary.skipped += 1;
        result.skipped += 1;
        continue;
      }

      try {
        const outcome = await deps.notify(request);
        if (outcome.status === 'sent') {
          await deps.markNotified(request.id);
          summary.sent += 1;
          result.sent += 1;
        } else if (outcome.status === 'skipped') {
          if (outcome.reason === 'missing_phone') {
            await deps.markFailed(request.id, 'missing_phone');
            summary.failed += 1;
            result.failed += 1;
          } else {
            await deps.release(request.id);
            summary.skipped += 1;
            result.skipped += 1;
          }
        } else {
          await deps.markFailed(request.id, outcome.error || 'UNKNOWN_ERROR');
          summary.failed += 1;
          result.failed += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
        await deps.markFailed(request.id, message);
        summary.failed += 1;
        result.failed += 1;
        log.error('Unexpected error while notifying availability request', {
          requestId: request.id,
          error: message,
        });
      }
    }

    result.products.push(summary);
  }

  log.info('Availability stock check finished', {
    dryRun,
    pendingRequests: result.pendingRequests,
    backInStock: result.backInStock,
    sent: result.sent,
    failed: result.failed,
    recoveredStale: result.recoveredStale,
  });

  return result;
}
