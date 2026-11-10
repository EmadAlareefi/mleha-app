import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { storedRequestAmounts, type StoredAmounts } from '@/lib/returns/request-financials';

type Db = Pick<typeof prisma, 'returnRequest'>;

const REFUND_SETTLED = new Set(['requested', 'refunded', 'unknown']);
const ORDER_HOLDS_CREDIT = new Set(['creating', 'pending', 'paid', 'not_required', 'expiring']);

/** A refund was sent (or may have been): its amount is history now. */
export function refundSettled(refundStatus?: string | null): boolean {
  return REFUND_SETTLED.has(refundStatus || 'none');
}

/** The exchange credit was handed out: a coupon exists or a replacement order carries it. */
export function creditLocked(request: {
  couponCode?: string | null;
  exchangeMode?: string | null;
  exchangeOrderId?: string | null;
  exchangePaymentStatus?: string | null;
}): boolean {
  return (
    Boolean(request.couponCode) ||
    (request.exchangeMode === 'order' &&
      Boolean(request.exchangeOrderId) &&
      ORDER_HOLDS_CREDIT.has(request.exchangePaymentStatus || ''))
  );
}

/**
 * Re-stores the refund / credit after a piece's inspection or "included in the
 * refund" flag changed, so the list never shows a stale amount.
 *
 * It never changes the request type (piece types are a staff decision, see
 * piece-changes-service.ts) and leaves money that already moved alone. A request
 * whose stored type disagrees with its pieces (old data) is skipped and logged;
 * scripts/check-return-type-consistency.ts repairs those.
 */
export async function repriceRequest(id: string, db: Db = prisma): Promise<StoredAmounts | null> {
  const request = await db.returnRequest.findUnique({ where: { id }, include: { items: true } });
  if (!request) return null;
  const amounts = storedRequestAmounts({
    items: request.items,
    shippingAmount: request.shippingAmount,
    currency: request.currency,
    feeExchangeRate: request.feeExchangeRate,
    couponAmountOverride: request.couponAmountOverride,
  });
  if (amounts.type !== request.type) {
    log.warn('Skipping reprice: request type does not match its pieces', {
      returnRequestId: id,
      requestType: request.type,
      pieceType: amounts.type,
    });
    return null;
  }

  const data: Prisma.ReturnRequestUpdateInput = {};
  const locked = creditLocked(request);
  if (amounts.type === 'exchange') {
    // Exchange-only: totalRefundAmount is the credit (pre-v2 meaning).
    if (!locked) {
      data.totalRefundAmount = amounts.totalRefundAmount;
      data.couponAmount = amounts.couponAmount;
      data.returnFee = amounts.returnFee;
    }
  } else {
    if (!refundSettled(request.refundStatus)) {
      data.totalRefundAmount = amounts.totalRefundAmount;
      data.returnFee = amounts.returnFee;
    }
    if (!locked) data.couponAmount = amounts.couponAmount;
  }
  if (Object.keys(data).length > 0) {
    await db.returnRequest.update({ where: { id }, data });
  }
  return amounts;
}
