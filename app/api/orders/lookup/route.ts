import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/app/lib/auth';
import { getSallaOrderByReference, findOrdersByCustomerContact } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { normalizeOrderReference } from '@/app/lib/salla-order-reference';
import { getClientIp, hashIp } from '@/app/lib/public-request';
import { isInternationalOrder } from '@/lib/returns/order-country';
import {
  isPhoneProofRequired,
  orderBelongsToPhone,
} from '@/app/lib/returns/customer-phone';
import { toPublicOrderView } from '@/app/lib/returns/public-order-view';
import { sallaDateToIso } from '@/lib/returns/customer-stage';
import {
  buildMissingReturnFeeRateMessage,
  getReturnFeeQuotesForOrder,
  MissingReturnFeeExchangeRateError,
} from '@/app/lib/returns/fee-quote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/lookup  { merchantId, orderNumber, mobile }   (returns page)
 * GET /api/orders/lookup?merchantId=XXX&orderNumber=YYY&mobile=05XXXXXXXX  (older callers)
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
 *  - anonymous callers must supply the order customer's mobile, since order
 *    numbers are sequential and knowing one otherwise proves nothing. Staff
 *    sessions are exempt, and `RETURNS_REQUIRE_PHONE=false` disables it;
 *  - anonymous callers get a trimmed order carrying no customer details, and a
 *    per-IP budget weighted towards misses;
 *  - the `contact` lookup, which lists a customer's orders from their email or
 *    phone, requires a session.
 *
 * An Origin allowlist is deliberately not used: browsers omit `Origin` on
 * same-origin GETs, which is how the older callers of this route fetch.
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

/**
 * Seconds until the caller may look up again, or 0 when not limited. The total
 * budget is per IP and order number, so customers behind one network (a mall,
 * a mobile carrier's NAT) do not use up each other's lookups; the miss budget
 * stays per IP, since guessing numbers is what it exists to slow down.
 */
async function lookupRetryAfterSeconds(ipHash: string, reference: string): Promise<number> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

  // Counted in the database rather than an in-process Map: this runs on
  // serverless, where each instance would keep its own private counter.
  const [total, misses] = await Promise.all([
    prisma.publicOrderLookupAttempt.count({
      where: { ipHash, reference, createdAt: { gte: since } },
    }),
    prisma.publicOrderLookupAttempt.count({
      where: { ipHash, found: false, createdAt: { gte: since } },
    }),
  ]);

  const overTotal = total >= MAX_LOOKUPS_PER_IP;
  const overMisses = misses >= MAX_MISSES_PER_IP;
  if (!overTotal && !overMisses) return 0;

  // The window frees up when the oldest counted attempt ages out.
  const oldest = await prisma.publicOrderLookupAttempt.findFirst({
    where: overMisses
      ? { ipHash, found: false, createdAt: { gte: since } }
      : { ipHash, reference, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const freeAt = (oldest?.createdAt.getTime() ?? Date.now()) + RATE_LIMIT_WINDOW_MS;
  return Math.max(30, Math.ceil((freeAt - Date.now()) / 1000));
}

/** Whether a packer has already picked the order up (local prep queue). */
async function hasPrepStarted(merchantId: string, orderId: string): Promise<boolean> {
  try {
    const assignment = await prisma.orderPrepAssignment.findFirst({
      where: { merchantId, orderId },
      select: { id: true },
    });
    return Boolean(assignment);
  } catch (error) {
    log.warn('Failed to read prep assignment for order lookup', { error });
    return false;
  }
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

/**
 * POST /api/orders/lookup  { merchantId, orderNumber, mobile }
 *
 * What the public returns page uses, so the customer's mobile and order number
 * stay out of URLs, server logs and browser history.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? null : String(value));
  return lookup(request, {
    merchantId: text(body.merchantId),
    orderNumber: text(body.orderNumber),
    mobile: text(body.mobile),
    contact: null,
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  return lookup(request, {
    merchantId: searchParams.get('merchantId'),
    orderNumber: searchParams.get('orderNumber'),
    mobile: searchParams.get('mobile'),
    contact: searchParams.get('contact'),
  });
}

async function lookup(
  request: NextRequest,
  { merchantId, orderNumber, mobile, contact }: { merchantId: string | null; orderNumber: string | null; mobile: string | null; contact: string | null },
) {
  try {

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

      const retryAfter = ipHash ? await lookupRetryAfterSeconds(ipHash, reference) : 0;
      if (retryAfter > 0) {
        log.warn('Order lookup rate limit reached', { merchantId });
        const minutes = Math.ceil(retryAfter / 60);
        const response = jsonNoStore(
          {
            error: `محاولات كثيرة، يرجى المحاولة بعد ${minutes} ${minutes === 1 ? 'دقيقة' : minutes === 2 ? 'دقيقتين' : minutes <= 10 ? 'دقائق' : 'دقيقة'}`,
            errorCode: 'RATE_LIMITED',
            retryAfterSeconds: retryAfter,
          },
          429
        );
        response.headers.set('Retry-After', String(retryAfter));
        return response;
      }

      // Anonymous callers must prove the order is theirs. A missing parameter
      // is answered plainly — it says nothing about which orders exist — but a
      // wrong number gets the same 404 as an unknown order, so the response
      // cannot be used to test numbers against a known order.
      const requirePhoneProof = !isStaff && isPhoneProofRequired();

      if (requirePhoneProof && !mobile?.trim()) {
        return jsonNoStore({ error: 'رقم الجوال مطلوب للتحقق من الطلب' }, 400);
      }

      const order = await getSallaOrderByReference(merchantId, reference);
      const ownsOrder = !requirePhoneProof || orderBelongsToPhone(order, mobile);
      const found = Boolean(order) && ownsOrder;

      if (ipHash) {
        // A phone mismatch counts as a miss: guessing numbers against a known
        // order is exactly what the miss budget is meant to slow down.
        await recordLookupAttempt({ ipHash, merchantId, reference, found });
      }

      if (!order || !ownsOrder) {
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
      // For the returns page's per-status screens (cancel window, waiting).
      const placedAt = sallaDateToIso(order.date?.created ?? order.date);
      const prepStarted = await hasPrepStarted(merchantId, String(order.id));

      return jsonNoStore({
        success: true,
        order: { ...payload, returnFeeQuotes, returnFeeQuoteError, placedAt, prepStarted },
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
