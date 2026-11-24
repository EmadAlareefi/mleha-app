import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { detectInternationalOrder } from '@/app/lib/order-destination';
import { getShippingAddressSummary } from '@/app/lib/shipping-company';
import { normalizeCity } from './city-name';
import { NEW_ORDER_STATUS_ID } from './sync-rules';

export { normalizeCity };

/**
 * Where each waiting order ships (city, domestic or international), for the
 * «city» and «destination» priority rules.
 *
 * Only the raw Salla payload has the shipping address (SallaOrder.customerCity
 * is the customer's profile city), and reading it costs about 1.5 ms per order,
 * too slow to do in the queue SQL. So each instance reads the payload once per
 * order and remembers the answer; later calls only read orders that are new
 * since. The list follows the «طلب جديد» orders and drops the rest.
 */

export type Destination = { city: string; international: boolean };

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const REFRESH_MS = 15_000;
const BATCH = 200;

const known = new Map<string, Destination>();
let refreshedAt = 0;
let inflight: Promise<Map<string, Destination>> | null = null;

async function refresh(): Promise<Map<string, Destination>> {
  const waiting = await prisma.sallaOrder.findMany({
    where: { merchantId: MERCHANT_ID, statusCustomId: NEW_ORDER_STATUS_ID },
    select: { orderId: true },
  });
  const ids = new Set(waiting.map((row) => row.orderId));
  for (const id of known.keys()) if (!ids.has(id)) known.delete(id);

  const missing = [...ids].filter((id) => !known.has(id));
  for (let index = 0; index < missing.length; index += BATCH) {
    const rows = await prisma.sallaOrder.findMany({
      where: { merchantId: MERCHANT_ID, orderId: { in: missing.slice(index, index + BATCH) } },
      select: { orderId: true, rawOrder: true },
    });
    for (const row of rows) {
      known.set(row.orderId, {
        city: normalizeCity(getShippingAddressSummary(row.rawOrder).city),
        international: detectInternationalOrder(row.rawOrder).isInternational,
      });
    }
  }
  refreshedAt = Date.now();
  return known;
}

/** Destinations of the waiting orders (at most ~15 s old). */
export async function getWaitingDestinations(): Promise<Map<string, Destination>> {
  if (Date.now() - refreshedAt < REFRESH_MS) return known;
  if (!inflight) {
    inflight = refresh()
      .catch((error) => {
        log.error('Prep destination cache refresh failed; using what is known', {
          error: error instanceof Error ? error.message : error,
        });
        return known;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Waiting order ids shipping to any of `cities` (already normalised). */
export function orderIdsForCities(destinations: Map<string, Destination>, cities: string[]): string[] {
  const wanted = new Set(cities);
  return [...destinations].filter(([, destination]) => wanted.has(destination.city)).map(([id]) => id);
}

export function orderIdsForDestination(destinations: Map<string, Destination>, international: boolean): string[] {
  return [...destinations].filter(([, destination]) => destination.international === international).map(([id]) => id);
}
