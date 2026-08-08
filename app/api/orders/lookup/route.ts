import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/lib/auth';
import { getSallaOrderByReference, findOrdersByCustomerContact } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { normalizeOrderReference } from '@/app/lib/salla-order-reference';
import { getClientIp, hashIp } from '@/app/lib/public-request';
import { isInternationalOrder } from '@/lib/returns/order-country';
import { toPublicOrderView } from '@/app/lib/returns/public-order-view';
import {
  buildMissingReturnFeeRateMessage,
  getReturnFeeQuotesForOrder,
  MissingReturnFeeExchangeRateError,
} from '@/app/lib/returns/fee-quote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/orders/lookup?merchantId=XXX&orderNumber=YYY
 * or
 * GET /api/orders/lookup?merchantId=XXX&contact=email@example.com  (staff only)
 *
 * Looks up an order by its customer-facing number. Reachable without a session
 * because the public returns page at /returns needs it, which shapes the rest
 * of this file:
 *
 *  - the order number is validated here and re-verified against the order that
 *    comes back (see `salla-order-reference.ts`), so an unparseable value can
 *    no longer be answered with the store's most recent order;
 *  - anonymous callers get a trimmed order carrying no customer details, and a
 *    per-IP budget weighted towards misses, since sequential order numbers are
 *    otherwise walkable;
 *  - the `contact` lookup, which lists a customer's orders from their email or
 *    phone, requires a session.
 *
 * An Origin allowlist is deliberately not used: browsers omit `Origin` on
 * same-origin GETs, which is how both callers of this route fetch.
 */

/** Matches the window used by the other public endpoint in this app. */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOOKUPS_PER_IP = 20;
/** Enumeration is almost entirely misses; a real customer retypes one number. */
const MAX_MISSES_PER_IP = 8;
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

const NOT_FOUND_BODY = { error: 'لم يتم العثور على الطلب' };

function noStore(response: NextResponse): NextResponse {
  // Never let a CDN or the Next data cache hold one customer's order.
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

function jsonNoStore(body: unknown, status = 200): NextResponse {
  return noStore(NextResponse.json(body, { status }));
}

async function isLookupRateLimited(ipHash: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

  // Counted in the database rather than an in-process Map: this runs on
  // serverless, where each instance would keep its own private counter.
  const [total, misses] = await Promise.all([
    prisma.publicOrderLookupAttempt.count({
      where: { ipHash, createdAt: { gte: since } },
    }),
    prisma.publicOrderLookupAttempt.count({
      where: { ipHash, found: false, createdAt: { gte: since } },
    }),
  ]);

  return total >= MAX_LOOKUPS_PER_IP || misses >= MAX_MISSES_PER_IP;
}

async function recordLookupAttempt(params: {
  ipHash: string;
  merchantId: string;
  reference: string;
  found: boolean;
}): Promise<void> {
  try {
    await prisma.publicOrderLookupAttempt.create({ data: params });

    // Opportunistic pruning, so the ledger needs no separate cron.
    if (Math.random() < 0.05) {
      await prisma.publicOrderLookupAttempt.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - ATTEMPT_RETENTION_MS) } },
      });
    }
  } catch (error) {
    // The lookup itself already succeeded or failed on its own merits; a
    // bookkeeping failure must not turn that into a 500.
    log.warn('Failed to record order lookup attempt', { error });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get('merchantId');
    const orderNumber = searchParams.get('orderNumber');
    const contact = searchParams.get('contact');

    if (!merchantId) {
      return jsonNoStore({ error: 'معرف التاجر مطلوب' }, 400);
    }

    const session = await getServerSession(authOptions);
    const isStaff = Boolean(session);

    // Lookup by order number
    if (orderNumber) {
      const reference = normalizeOrderReference(orderNumber);

      if (!reference) {
        // Answered as "not found" rather than 400: a distinct status for a
        // malformed value would confirm which formats are real order numbers.
        return jsonNoStore(NOT_FOUND_BODY, 404);
      }

      const ipHash = isStaff ? null : hashIp(getClientIp(request));

      if (ipHash && (await isLookupRateLimited(ipHash))) {
        log.warn('Order lookup rate limit reached', { merchantId });
        return jsonNoStore(
          { error: 'تم استقبال عدة طلبات، يرجى المحاولة لاحقاً' },
          429
        );
      }

      const order = await getSallaOrderByReference(merchantId, reference);

      if (ipHash) {
        await recordLookupAttempt({
          ipHash,
          merchantId,
          reference,
          found: Boolean(order),
        });
      }

      if (!order) {
        return jsonNoStore(NOT_FOUND_BODY, 404);
      }

      // Both of these read the full order — fee quotes walk currency fields
      // across many paths, and the country check needs the addresses — so they
      // must run before the payload is trimmed for public callers.
      const isInternational = isInternationalOrder(order);

      let returnFeeQuotes: ReturnType<typeof getReturnFeeQuotesForOrder> | undefined;
      let returnFeeQuoteError: string | undefined;

      try {
        returnFeeQuotes = getReturnFeeQuotesForOrder(order);
      } catch (error) {
        if (error instanceof MissingReturnFeeExchangeRateError) {
          returnFeeQuoteError = buildMissingReturnFeeRateMessage(error.currency);
        } else {
          throw error;
        }
      }

      const payload = isStaff
        ? { ...order, isInternational }
        : toPublicOrderView(order, { isInternational });

      return jsonNoStore({
        success: true,
        order: { ...payload, returnFeeQuotes, returnFeeQuoteError },
      });
    }

    // Lookup by customer contact (email or phone). Staff only: it lists every
    // order behind an email or phone number, with no proof the caller owns it.
    if (contact) {
      if (!isStaff) {
        return jsonNoStore({ error: 'غير مصرح' }, 401);
      }

      const orders = await findOrdersByCustomerContact(merchantId, contact);

      if (orders.length === 0) {
        return jsonNoStore({ error: 'لم يتم العثور على طلبات لهذا العميل' }, 404);
      }

      return jsonNoStore({ success: true, orders });
    }

    return jsonNoStore({ error: 'يجب تقديم رقم الطلب أو معلومات الاتصال' }, 400);

  } catch (error) {
    log.error('Error in order lookup', { error });
    return jsonNoStore({ error: 'حدث خطأ أثناء البحث عن الطلب' }, 500);
  }
}
