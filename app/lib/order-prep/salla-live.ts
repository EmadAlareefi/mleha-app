import { log } from '@/app/lib/logger';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { deriveStatusCustomId } from '@/app/lib/salla-orders';
import { upsertSallaOrderFromPayload } from '@/app/lib/salla-sync';
import { parseRetryAfter } from './sync-rules';

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

export type LiveOrderResult =
  | { kind: 'ok'; detail: Record<string, any>; statusCustomId: string | null; statusName: string | null }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'error'; message: string };

/**
 * One live read of an order from Salla, with a short timeout and no retries —
 * callers run in the background and retry on their own schedule.
 */
export async function fetchLiveOrder(
  merchantId: string,
  orderId: string,
  options: { timeoutMs?: number; withItems?: boolean } = {},
): Promise<LiveOrderResult> {
  const token = await getSallaAccessToken(merchantId);
  if (!token) return { kind: 'error', message: 'missing_salla_token' };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const timeoutMs = options.timeoutMs ?? 10_000;
  try {
    const id = encodeURIComponent(orderId);
    const [detailResponse, itemsResponse] = await Promise.all([
      fetch(`${SALLA_API_BASE}/orders/${id}`, { headers, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' }),
      options.withItems
        ? fetch(`${SALLA_API_BASE}/orders/items?order_id=${id}`, {
            headers,
            signal: AbortSignal.timeout(timeoutMs),
            cache: 'no-store',
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (detailResponse.status === 404) return { kind: 'not_found' };
    if (detailResponse.status === 429) {
      return { kind: 'rate_limited', retryAfterMs: parseRetryAfter(detailResponse.headers.get('retry-after')) };
    }
    if (!detailResponse.ok) {
      const text = await detailResponse.text().catch(() => '');
      return { kind: 'error', message: `salla_${detailResponse.status}: ${text.slice(0, 200)}` };
    }
    const body = await detailResponse.json();
    const detail = (body?.data ?? {}) as Record<string, any>;
    if (itemsResponse?.ok) {
      const itemsBody = await itemsResponse.json().catch(() => null);
      // An empty list must not wipe the items embedded in the detail.
      if (Array.isArray(itemsBody?.data) && itemsBody.data.length > 0) detail.items = itemsBody.data;
    }
    const statusName =
      (typeof detail?.status?.customized?.name === 'string' && detail.status.customized.name) ||
      (typeof detail?.status?.name === 'string' && detail.status.name) ||
      null;
    return { kind: 'ok', detail, statusCustomId: deriveStatusCustomId(detail), statusName };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'unknown_error' };
  }
}

/** Writes a live order (detail + items) into the local mirror. */
export async function refreshMirrorFromLive(merchantId: string, detail: Record<string, any>): Promise<void> {
  try {
    await upsertSallaOrderFromPayload({
      merchantId,
      merchant_id: merchantId,
      order: { ...detail, merchant_id: merchantId, merchantId },
    });
  } catch (error) {
    log.warn('Failed to refresh mirrored Salla order', {
      orderId: detail?.id,
      error: error instanceof Error ? error.message : error,
    });
  }
}
