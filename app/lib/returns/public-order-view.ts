import type { SallaOrder } from '../salla-api';

/**
 * Trims a Salla order down to what the public returns flow at `/returns`
 * actually renders.
 *
 * `GET /api/orders/lookup` is unauthenticated, so anything it returns is
 * readable by anyone who can guess an order number. The full Salla order
 * carries the customer's name, mobile, email, city and shipping address; none
 * of it is used by the returns UI — `ReturnForm` never reads `order.customer`,
 * and `/api/returns/check` and `/api/returns/create` both re-fetch the order
 * server-side — so none of it needs to reach the browser.
 *
 * Items and options are passed through rather than allowlisted field by field:
 * `getItemAttributes` (`lib/returns/item-attributes.ts`) discovers colour and
 * size by scanning arbitrary keys on the item, its product, variant, details,
 * metadata and options, so an allowlist there would silently drop attributes.
 * Item payloads are product data, not customer data; `stripCustomerKeys` is the
 * backstop in case Salla ever nests contact details inside one.
 */

/**
 * Keys that may carry customer contact or address data. Matched exactly, so
 * product fields such as `shipping_cost` or `total_discount` are unaffected.
 */
const CUSTOMER_KEYS = new Set([
  'customer',
  'customers',
  'receiver',
  'sender',
  'address',
  'addresses',
  'shipping_address',
  'shippingAddress',
  'billing_address',
  'billingAddress',
  'email',
  'mobile',
  'phone',
  'mobile_code',
  'mobileCode',
  'phone_code',
  'phoneCode',
  'national_id',
  'nationalId',
  'vat_number',
  'vatNumber',
]);

/** Guards against a pathological or cyclic payload. */
const MAX_DEPTH = 8;

function stripCustomerKeys<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stripCustomerKeys(entry, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (CUSTOMER_KEYS.has(key)) {
      continue;
    }
    out[key] = stripCustomerKeys(entry, depth + 1);
  }
  return out as T;
}

export interface PublicOrderView {
  id: number;
  reference_id: string;
  order_number?: string | number;
  status: SallaOrder['status'];
  amounts: SallaOrder['amounts'];
  date?: { created?: string; updated?: string };
  items: SallaOrder['items'];
  options?: SallaOrder['options'];
  /**
   * Computed server-side from the full order's shipping and billing addresses,
   * which are themselves withheld. The returns page uses this to reject orders
   * shipped outside Saudi Arabia.
   */
  isInternational: boolean;
}

/**
 * Builds the browser-facing view of an order.
 *
 * Note the ordering constraint for callers: anything that reads the raw order —
 * `getReturnFeeQuotesForOrder` walks currency fields across many paths, and
 * `isInternationalOrder` needs the addresses — must run on the full order
 * *before* this trims it.
 */
export function toPublicOrderView(
  order: SallaOrder,
  options: { isInternational: boolean }
): PublicOrderView {
  return {
    id: order.id,
    reference_id: order.reference_id,
    order_number: order.order_number,
    status: order.status,
    amounts: order.amounts,
    date: order.date
      ? { created: order.date.created, updated: order.date.updated }
      : undefined,
    items: stripCustomerKeys(order.items ?? []),
    options: order.options ? stripCustomerKeys(order.options) : undefined,
    isInternational: options.isInternational,
  };
}
