import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { parseRetryAfter } from '@/app/lib/order-prep/sync-rules';
import { pickOutgoingShipment, type OutgoingShipment } from './rules';

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

export type PolicyResult =
  /** Salla took the request; the label arrives by webhook. */
  | { kind: 'accepted'; operationId: string | null; status: string }
  /** Salla answered and nothing was created — safe to try again later. */
  | { kind: 'rejected'; message: string }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  /** No clear answer (timeout, network): a shipment may or may not exist. */
  | { kind: 'unknown'; message: string };

/**
 * Asks Salla to create the shipping policy (waybill) for one order through
 * its courier integration — the same `orders/actions` call the old shipping
 * page made (docs.salla.dev/7549669e0), with a timeout and the HTTP outcome
 * kept, so the caller can tell "rejected" (retry) from "unknown" (don't
 * re-send; check the order instead).
 */
export async function createShippingPolicy(
  merchantId: string,
  orderId: string,
  options: { timeoutMs?: number } = {},
): Promise<PolicyResult> {
  const token = await getSallaAccessToken(merchantId);
  if (!token) return { kind: 'rejected', message: 'missing_salla_token' };
  const parsed = Number.parseInt(orderId, 10);
  const id = Number.isNaN(parsed) ? orderId : parsed;
  let response: Response;
  try {
    response = await fetch(`${SALLA_API_BASE}/orders/actions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        operations: [{ action_name: 'create_shipping_policy', value: [id] }],
        filters: { order_ids: [id] },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      cache: 'no-store',
    });
  } catch (error) {
    return { kind: 'unknown', message: error instanceof Error ? error.message : 'network_error' };
  }

  if (response.status === 429) {
    return { kind: 'rate_limited', retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) };
  }
  const body = (await response.json().catch(() => null)) as Record<string, any> | null;
  if (response.status >= 500) {
    // The request reached Salla; a 5xx can still have created the shipment.
    return { kind: 'unknown', message: `salla_${response.status}` };
  }
  if (!response.ok || !body?.success) {
    const message = body?.error?.message || body?.message || `salla_${response.status}`;
    return { kind: 'rejected', message: String(message).slice(0, 500) };
  }
  const operations = Array.isArray(body.data) ? body.data : [];
  const operation = operations.find((entry: any) => entry?.action_name === 'create_shipping_policy') ?? operations[0];
  const status = String(operation?.status ?? '').toLowerCase();
  if (status === 'success' || status === 'in_progress') {
    return {
      kind: 'accepted',
      operationId: operation?.operation_id != null ? String(operation.operation_id) : null,
      status,
    };
  }
  const message = operation?.message || body.message || `status=${status || 'unknown'}`;
  return { kind: 'rejected', message: String(message).slice(0, 500) };
}

export type ShipmentLookup =
  | { kind: 'found'; shipment: OutgoingShipment }
  | { kind: 'none' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'error'; message: string };

/**
 * The order's outgoing waybill, if Salla has made one. Uses the order-scoped
 * route (the app's token lacks the scope for `/shipments?order_id=`).
 */
export async function fetchOutgoingShipment(
  merchantId: string,
  orderId: string,
  options: { timeoutMs?: number } = {},
): Promise<ShipmentLookup> {
  const token = await getSallaAccessToken(merchantId);
  if (!token) return { kind: 'error', message: 'missing_salla_token' };
  try {
    const response = await fetch(`${SALLA_API_BASE}/orders/${encodeURIComponent(orderId)}/shipments`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      cache: 'no-store',
    });
    if (response.status === 429) {
      return { kind: 'rate_limited', retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) };
    }
    if (!response.ok) return { kind: 'error', message: `salla_shipments_${response.status}` };
    const body = (await response.json().catch(() => null)) as Record<string, any> | null;
    const shipment = pickOutgoingShipment(body?.data);
    return shipment ? { kind: 'found', shipment } : { kind: 'none' };
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : 'network_error' };
  }
}
