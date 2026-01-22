import { Prisma, ReturnItem, ReturnRequest } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { updateSallaOrderStatus } from '@/app/lib/salla-order-status';
import { extractOrderDate } from '@/lib/returns/order-date';

type AnyRecord = Record<string, any>;

const RESERVATION_STATUS_ID =
  process.env.SALLA_UNDER_REVIEW_RESERVATION_ID || '1576217163';
const UNDER_REVIEW_STATUS_ID =
  process.env.SALLA_UNDER_REVIEW_STATUS_ID || '1065456688';

const RETURN_RECEIVED_STATUSES = new Set(['delivered', 'completed']);

const COUPON_KEYS = [
  'coupon',
  'coupon_code',
  'couponCode',
  'discount_code',
  'discountCode',
  'promotion_code',
  'promotionCode',
  'applied_coupon',
  'appliedCoupon',
];

const COUPON_COLLECTION_KEYS = [
  'coupons',
  'coupon_codes',
  'couponCodes',
  'applied_coupons',
  'appliedCoupons',
  'discounts',
  'discount_codes',
  'discountCodes',
  'promotions',
  'promotion_codes',
  'promotionCodes',
];

const COUPON_OBJECT_KEYS = ['code', 'coupon', 'coupon_code', 'name', 'title', 'value'];

const now = () => new Date();

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  return null;
}

function normalizeCoupon(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized ? normalized.toUpperCase() : null;
}

function extractAppliedCouponCodes(order: AnyRecord): string[] {
  const codes = new Set<string>();

  const push = (value: unknown) => {
    const normalized = normalizeCoupon(value);
    if (normalized) {
      codes.add(normalized);
    }
  };

  COUPON_KEYS.forEach((key) => {
    if (key in order) {
      push(order[key]);
    }
  });

  const collections = COUPON_COLLECTION_KEYS.map((key) => order[key]).filter(
    (value) => value !== undefined && value !== null
  );

  for (const collection of collections) {
    if (Array.isArray(collection)) {
      collection.forEach((entry) => {
        if (typeof entry === 'string' || typeof entry === 'number') {
          push(entry);
          return;
        }
        if (entry && typeof entry === 'object') {
          for (const key of COUPON_OBJECT_KEYS) {
            if (key in entry) {
              push((entry as AnyRecord)[key]);
              break;
            }
          }
        }
      });
      continue;
    }

    if (collection && typeof collection === 'object') {
      for (const key of COUPON_OBJECT_KEYS) {
        if (key in (collection as AnyRecord)) {
          push((collection as AnyRecord)[key]);
        }
      }
    }
  }

  if (order.discount && typeof order.discount === 'object') {
    const discount = order.discount as AnyRecord;
    if (discount.coupon) {
      push(discount.coupon);
    }
    if (discount.code) {
      push(discount.code);
    }
  }

  return Array.from(codes);
}

function deriveMerchantId(order: AnyRecord, fallback?: string | null): string | null {
  return (
    normalizeString(order?.merchant_id) ||
    normalizeString(order?.store_id) ||
    normalizeString(order?.store?.id) ||
    normalizeString(order?.merchantId) ||
    normalizeString(order?.storeId) ||
    (fallback ? normalizeString(fallback) : null)
  );
}

function deriveOrderId(order: AnyRecord, fallback?: string | null): string | null {
  return (
    normalizeString(order?.id) ||
    normalizeString(order?.order_id) ||
    normalizeString(order?.orderId) ||
    (fallback ? normalizeString(fallback) : null)
  );
}

function deriveOrderNumber(order: AnyRecord): string | null {
  return (
    normalizeString(order?.order_number) ||
    normalizeString(order?.orderNumber) ||
    normalizeString(order?.reference_id) ||
    normalizeString(order?.referenceId) ||
    normalizeString(order?.reference) ||
    null
  );
}

function hasReturnShipmentArrived(request: ReturnRequest): boolean {
  return RETURN_RECEIVED_STATUSES.has(request.status);
}

async function hasReturnShipmentScanBeforeOrder(
  request: ReturnRequest,
  orderCreatedAt: Date | null | undefined
): Promise<boolean> {
  const trackingNumber = request.smsaTrackingNumber?.trim();
  if (!trackingNumber) {
    return false;
  }

  const shipment = await prisma.shipment.findFirst({
    where: {
      trackingNumber,
      type: 'incoming',
    },
    orderBy: {
      scannedAt: 'desc',
    },
  });

  if (!shipment) {
    return false;
  }

  if (!orderCreatedAt) {
    return true;
  }

  return shipment.scannedAt.getTime() <= orderCreatedAt.getTime();
}

function areItemsFullyApproved(items: ReturnItem[]): boolean {
  if (!items || items.length === 0) {
    return false;
  }
  return items.every((item) => item.conditionStatus === 'good');
}

async function updateReturnRequest(
  id: string,
  data: Prisma.ReturnRequestUpdateInput
) {
  await prisma.returnRequest.update({
    where: { id },
    data,
  });
}

export async function linkExchangeOrderFromWebhook(
  payloadOrder: AnyRecord,
  meta?: { merchantId?: string | null; orderId?: string | null }
): Promise<{ handled: boolean; holdApplied?: boolean; reason?: string }> {
  const order = payloadOrder?.order ?? payloadOrder ?? {};
  const merchantId = deriveMerchantId(order, meta?.merchantId);
  const orderId = deriveOrderId(order, meta?.orderId ?? null);
  const orderDateResult = extractOrderDate(order);
  const orderCreatedAt = orderDateResult.date;

  if (!merchantId || !orderId) {
    return { handled: false, reason: 'missing_ids' };
  }

  const couponCodes = extractAppliedCouponCodes(order).filter((code) =>
    code.startsWith('EX')
  );
  if (couponCodes.length === 0) {
    return { handled: false, reason: 'no_return_coupon' };
  }

  const returnRequest = await prisma.returnRequest.findFirst({
    where: {
      merchantId,
      type: 'exchange',
      OR: couponCodes.map((code) => ({
        couponCode: {
          equals: code,
          mode: 'insensitive',
        },
      })),
    },
    include: { items: true },
  });

  if (!returnRequest) {
    return { handled: false, reason: 'coupon_not_linked' };
  }

  const alreadyLinked = returnRequest.exchangeOrderId === orderId;
  const orderNumber = deriveOrderNumber(order) || orderId;
  const updateData: Prisma.ReturnRequestUpdateInput = {};
  let needsUpdate = false;

  if (!alreadyLinked) {
    updateData.exchangeOrderId = orderId;
    updateData.exchangeOrderNumber = orderNumber;
    updateData.exchangeOrderLinkedAt = now();
    needsUpdate = true;
  } else if (
    !returnRequest.exchangeOrderNumber &&
    orderNumber &&
    returnRequest.exchangeOrderNumber !== orderNumber
  ) {
    updateData.exchangeOrderNumber = orderNumber;
    needsUpdate = true;
  }

  let holdApplied = false;
  const hasWarehouseReceipt = await hasReturnShipmentScanBeforeOrder(
    returnRequest,
    orderCreatedAt
  );
  const hasArrivedByStatus = hasReturnShipmentArrived(returnRequest);
  const requiresHold = !(hasWarehouseReceipt || hasArrivedByStatus);
  const holdOutdated = returnRequest.exchangeOrderId !== orderId;

  if (requiresHold && (holdOutdated || !returnRequest.exchangeOrderHoldActive)) {
    const statusResult = await updateSallaOrderStatus(merchantId, orderId, {
      statusId: RESERVATION_STATUS_ID,
    });

    if (statusResult.success) {
      updateData.exchangeOrderHoldActive = true;
      updateData.exchangeOrderHeldAt = now();
      updateData.exchangeOrderReleasedAt = null;
      needsUpdate = true;
      holdApplied = true;
      log.info('Applied reservation hold for exchange order', {
        returnRequestId: returnRequest.id,
        orderId,
        merchantId,
      });
    } else {
      log.error('Failed to set reservation status for exchange order', {
        returnRequestId: returnRequest.id,
        orderId,
        merchantId,
        error: statusResult.error,
      });
    }
  }

  if (needsUpdate) {
    await updateReturnRequest(returnRequest.id, updateData);
  }

  return { handled: true, holdApplied };
}

export async function maybeReleaseExchangeOrderHold(
  returnRequestId: string
): Promise<{ released: boolean; reason?: string }> {
  const returnRequest = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: { items: true },
  });

  if (
    !returnRequest ||
    !returnRequest.exchangeOrderId ||
    !returnRequest.exchangeOrderHoldActive
  ) {
    return { released: false, reason: 'no_active_hold' };
  }

  if (!hasReturnShipmentArrived(returnRequest)) {
    return { released: false, reason: 'shipment_not_received' };
  }

  if (!areItemsFullyApproved(returnRequest.items)) {
    return { released: false, reason: 'items_not_approved' };
  }

  const statusResult = await updateSallaOrderStatus(
    returnRequest.merchantId,
    returnRequest.exchangeOrderId,
    { statusId: UNDER_REVIEW_STATUS_ID }
  );

  if (!statusResult.success) {
    log.error('Failed to restore new order status after inspection', {
      returnRequestId,
      orderId: returnRequest.exchangeOrderId,
      merchantId: returnRequest.merchantId,
      error: statusResult.error,
    });
    return { released: false, reason: 'status_update_failed' };
  }

  await updateReturnRequest(returnRequest.id, {
    exchangeOrderHoldActive: false,
    exchangeOrderReleasedAt: now(),
  });

  log.info('Released reservation hold for exchange order', {
    returnRequestId,
    orderId: returnRequest.exchangeOrderId,
    merchantId: returnRequest.merchantId,
  });

  return { released: true };
}
