import { fetch as undiciFetch } from 'undici';
import { getSallaAccessToken, getSallaDispatcher } from '@/app/lib/salla-oauth';
import { SallaCallError } from '@/app/lib/salla-transactions';

/**
 * Salla calls for app-created exchange orders.
 *
 * Verified on the live store (2026-11-04, test orders created and cancelled):
 * - POST /orders with `payment.status: 'pending_payment'` (not 'pending') creates
 *   an order in "بإنتظار الدفع" and returns `payment_actions.remaining_action.checkout_url`
 *   (short mtjr.at link) plus `urls.checkout`. `pending_payment_ends_at` is the
 *   remaining window in SECONDS (~21h).
 * - `payment.method` (e.g. 'mada') is accepted and recorded; `accepted_methods`
 *   comes back as [""], so it is not relied on.
 * - `payment.status: 'paid'` is only allowed for bank (with receipt) or cod, so a
 *   fully covered order stays payment_pending with total 0 and no checkout link.
 * - `coupon_code` works in the create body; a free-shipping coupon zeroes shipping.
 *   Fixed coupon amounts are pre-VAT (capped at the pre-VAT subtotal).
 * - Shipping requires `courier_id`, `ship_to.block`, `street_number`,
 *   `geo_coordinates`; `postal_code` must be a string; `notes` is rejected.
 * - Products without SKUs use identifier_type 'id' + options [{id, value:[valueId]}].
 * - Pending orders reserve stock; change_status canceled + restore_items releases it.
 * - Order update is PUT /orders/{id} (POST returns 405).
 * - Setting a status (e.g. the reservation hold) on an unpaid order is allowed.
 */

const BASE = 'https://api.salla.dev/admin/v2';

export const SALLA_CANCELED_STATUS_ID = Number(process.env.SALLA_CANCELED_STATUS_ID || '1183362113');
export const EXCHANGE_HOLD_STATUS_ID = Number(process.env.SALLA_UNDER_REVIEW_RESERVATION_ID || '1576217163');
export const EXCHANGE_RELEASE_STATUS_ID = Number(process.env.SALLA_UNDER_REVIEW_STATUS_ID || '1065456688');

export interface ExchangeTransport {
  call(merchantId: string, method: string, path: string, body?: unknown): Promise<any>;
}

const production: ExchangeTransport = {
  async call(merchantId, method, path, body) {
    const token = await getSallaAccessToken(merchantId);
    if (!token) throw new SallaCallError('انتهت صلاحية توكن سلة.', 401);
    let response;
    try {
      response = await undiciFetch(`${BASE}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        dispatcher: getSallaDispatcher() ?? undefined,
        signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      });
    } catch (error) {
      throw new SallaCallError(`تعذر الاتصال بسلة: ${error instanceof Error ? error.message : 'unknown'}`, undefined, method !== 'GET');
    }
    const text = await response.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (response.status >= 400 || json?.success === false) {
      const error = json?.error || {};
      const fields = error.fields ? ` ${JSON.stringify(error.fields)}` : '';
      throw new SallaCallError(
        `سلة (${response.status}): ${error.message || json?.message || text.slice(0, 300)}${fields}`,
        response.status,
        response.status >= 500 && method !== 'GET',
      );
    }
    return json;
  },
};

let transport: ExchangeTransport = production;
export function setExchangeOrderTransport(value: ExchangeTransport | null) {
  transport = value ?? production;
}

export interface ExchangeShipTo {
  country: number;
  city: number;
  district?: number | null;
  block: string;
  street_number: string;
  address_line: string;
  postal_code?: string | null;
  short_address?: string | null;
  building_number?: string | null;
  additional_number?: number | null;
  geo_coordinates: { lat: number; lng: number };
}

export interface ExchangeOrderProduct {
  productId: string;
  quantity: number;
  options: Array<{ id: number | string; value: Array<number | string> }>;
}

export interface CreateExchangeOrderInput {
  customerId: string | number;
  products: ExchangeOrderProduct[];
  courierId: number;
  shipTo: ExchangeShipTo;
  couponCode?: string;
  paymentMethod?: string | null;
}

export interface ExchangeOrderState {
  id: string;
  referenceId: string;
  statusSlug: string;
  statusId?: number;
  total: number;
  currency: string;
  remainingAmount: number;
  paidAmount: number;
  checkoutUrl: string | null;
  pendingSecondsLeft: number | null;
  paymentMethod: string | null;
}

export function toOrderState(order: any): ExchangeOrderState {
  const remaining = order?.payment_actions?.remaining_action || {};
  const checkout = remaining.checkout_url || order?.urls?.checkout || null;
  const seconds = Number(order?.pending_payment_ends_at);
  return {
    id: String(order?.id),
    referenceId: String(order?.reference_id ?? order?.id),
    statusSlug: String(order?.status?.slug || ''),
    statusId: order?.status?.id ? Number(order.status.id) : undefined,
    total: Number(order?.amounts?.total?.amount) || 0,
    currency: order?.amounts?.total?.currency || order?.currency || 'SAR',
    remainingAmount: Number(remaining?.remaining_amount?.amount) || 0,
    paidAmount: Number(remaining?.paid_amount?.amount) || 0,
    checkoutUrl: checkout ? String(checkout) : null,
    pendingSecondsLeft: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    paymentMethod: order?.payment_method ?? null,
  };
}

/** Paid means something was due and nothing is left to pay. */
export function isOrderPaid(state: ExchangeOrderState): boolean {
  if (state.statusSlug === 'canceled' || state.statusSlug === 'deleted') return false;
  return state.total > 0 && state.remainingAmount <= 0 && state.statusSlug !== 'payment_pending';
}

export async function createPendingExchangeOrder(merchantId: string, input: CreateExchangeOrderInput) {
  const body = await transport.call(merchantId, 'POST', '/orders', {
    customer: { id: Number(input.customerId) },
    products: input.products.map((product) => ({
      identifier_type: 'id',
      identifier: Number(product.productId),
      quantity: product.quantity,
      ...(product.options.length > 0 ? { options: product.options } : {}),
    })),
    delivery_method: 'shipping',
    courier_id: input.courierId,
    ship_to: input.shipTo,
    ...(input.couponCode ? { coupon_code: input.couponCode } : {}),
    payment: {
      status: 'pending_payment',
      ...(input.paymentMethod ? { method: input.paymentMethod } : {}),
    },
  });
  return toOrderState(body?.data);
}

export async function getExchangeOrderState(merchantId: string, orderId: string) {
  const body = await transport.call(merchantId, 'GET', `/orders/${encodeURIComponent(orderId)}`);
  return toOrderState(body?.data);
}

export async function setExchangeOrderStatus(merchantId: string, orderId: string, statusId: number) {
  await transport.call(merchantId, 'POST', `/orders/${encodeURIComponent(orderId)}/status`, { status_id: statusId });
}

/** Cancels and returns the reserved items to stock. */
export async function cancelExchangeOrder(merchantId: string, orderId: string) {
  const body = await transport.call(merchantId, 'POST', '/orders/actions', {
    operations: [
      {
        action_name: 'change_status',
        value: { status: SALLA_CANCELED_STATUS_ID, restore_items: true, send_status_sms: false },
      },
    ],
    filters: { order_ids: [Number(orderId)] },
  });
  const result = Array.isArray(body?.data) ? body.data[0] : null;
  if (result?.status === 'failed') {
    throw new SallaCallError(`تعذر إلغاء الطلب: ${result.message || ''}`);
  }
}

/**
 * The outbound shipment of the original order holds the full national address
 * (district, block, street, coordinates) and the courier that delivered it.
 */
export async function getOriginalShipping(
  merchantId: string,
  orderId: string,
): Promise<{ courierId: number; shipTo: ExchangeShipTo } | null> {
  const body = await transport.call(merchantId, 'GET', `/orders/${encodeURIComponent(orderId)}/shipments`);
  const shipments: any[] = Array.isArray(body?.data) ? body.data : [];
  const shipment = shipments.find((s) => String(s?.type || '').toLowerCase() !== 'return' && s?.ship_to && s?.courier_id);
  if (!shipment) return null;
  const to = shipment.ship_to;
  const lat = Number(to.latitude);
  const lng = Number(to.longitude);
  const countryId = Number(to.country_id);
  const cityId = Number(to.city_id);
  if (!countryId || !cityId || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const district = Number(to.district_id ?? to.district);
  return {
    courierId: Number(shipment.courier_id),
    shipTo: {
      country: countryId,
      city: cityId,
      ...(Number.isFinite(district) && district > 0 ? { district } : {}),
      block: String(to.block || to.district || to.region || to.city || '-'),
      street_number: String(to.street_number || to.building_number || '-'),
      address_line: String(to.address_line || [to.block, to.street_number].filter(Boolean).join(' ') || to.city || '-'),
      ...(to.postal_code ? { postal_code: String(to.postal_code) } : {}),
      ...(to.short_address ? { short_address: String(to.short_address) } : {}),
      ...(to.building_number ? { building_number: String(to.building_number) } : {}),
      ...(Number(to.additional_number) ? { additional_number: Number(to.additional_number) } : {}),
      geo_coordinates: { lat, lng },
    },
  };
}
