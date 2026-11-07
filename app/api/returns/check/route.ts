import { ONE_RIYAL_OFFER_ERROR } from '@/lib/returns/categories';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaOrder, getSallaOrderShipments } from '@/app/lib/salla-api';
import { extractTrackingFromShipment } from '@/app/lib/salla-shipment';
import {
  getDiscountedProductIds,
  getOneRiyalOfferProductIds,
  getOutletProductIds,
  getProductIdsForOrderItems,
  getReturnWindowPolicy,
  getWindowExpiredProductIds,
} from '@/lib/returns/policy';
import { extractAppliedCouponCodes } from '@/app/lib/returns/exchange-order';
import { loadPieceRules, toPublicPieces } from '@/app/lib/returns/piece-context';
import { isPhoneProofRequired, orderBelongsToPhone } from '@/app/lib/returns/customer-phone';
import { isRateLimited } from '@/app/lib/returns/public-rate-limit';

export const runtime = 'nodejs';

/** Fields of a stored return item that the customer may see (no inspection data). */
const PUBLIC_ITEM_FIELDS = [
  'id',
  'productId',
  'productName',
  'productSku',
  'variantId',
  'variantName',
  'quantity',
  'price',
  'type',
  'orderItemId',
  'unitIndex',
] as const;

function toPublicItem(item: Record<string, unknown>) {
  return Object.fromEntries(PUBLIC_ITEM_FIELDS.map((key) => [key, item[key] ?? null]));
}

/**
 * POST /api/returns/check
 *
 * Checks if there are existing return requests for an order. Public: the
 * caller must prove ownership with the order's customer mobile (sent in the
 * body, not the URL), the same proof /api/returns/create requires.
 */
export async function POST(request: NextRequest) {
  if (isRateLimited(request, 'returns-check', 30)) {
    return NextResponse.json({ error: 'طلبات كثيرة، حاول مرة أخرى بعد قليل' }, { status: 429 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const merchantId = typeof body.merchantId === 'string' ? body.merchantId : body.merchantId ? String(body.merchantId) : null;
    const orderId = body.orderId !== undefined && body.orderId !== null ? String(body.orderId) : null;
    const customerMobile = body.customerMobile;

    if (!merchantId || !orderId) {
      return NextResponse.json(
        { error: 'merchantId and orderId are required' },
        { status: 400 }
      );
    }

    log.info('Checking for existing return requests', { merchantId, orderId });

    const order = await getSallaOrder(merchantId, orderId);
    if (!order) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب', canCreateNew: false },
        { status: 404 }
      );
    }

    if (isPhoneProofRequired() && !orderBelongsToPhone(order, customerMobile)) {
      log.warn('Rejected return check without matching customer mobile', { merchantId, orderId });
      return NextResponse.json(
        { error: 'رقم الجوال لا يطابق الطلب', canCreateNew: false },
        { status: 403 }
      );
    }

    // Orders that already carry an exchange coupon (EX…) are the result of a
    // previous exchange and cannot be returned or exchanged again.
    const appliedCouponCodes = extractAppliedCouponCodes(order as any);
    if (appliedCouponCodes.some((code) => code.toUpperCase().startsWith('EX'))) {
      log.warn('Order already exchanged, blocking new return/exchange', {
        merchantId,
        orderId,
      });
      return NextResponse.json({
        error: 'هذا الطلب تم استبداله مسبقاً ولا يمكن إرجاعه أو استبداله مرة أخرى',
        errorCode: 'ORDER_ALREADY_EXCHANGED',
        message: 'تم استخدام كوبون استبدال على هذا الطلب سابقاً، لذلك لا يمكن إنشاء طلب إرجاع أو استبدال جديد له.',
        canCreateNew: false,
      }, { status: 400 });
    }

    // One Salla round-trip per product for categories, shared with the per-piece rules.
    const pieceRules = await loadPieceRules(merchantId, order);
    const windowOverride = pieceRules.windowOverride;
    const deliveryDateResult = pieceRules.deliveryDateResult;
    if (!deliveryDateResult.date && !windowOverride) {
      log.warn('No delivery date found for return validation', {
        merchantId,
        orderId,
        orderDateCandidates: deliveryDateResult.fallbackCandidates,
      });
      return NextResponse.json({
        error: 'لا يمكن التحقق من تاريخ الطلب',
        errorCode: 'MISSING_ORDER_DATE',
        message: 'لم يتم العثور على تاريخ وصول الشحنة للتحقق من صلاحية الإرجاع.',
        canCreateNew: false,
      }, { status: 400 });
    }

    const productIds = getProductIdsForOrderItems(order.items || []);
    const categoriesByProductId = pieceRules.categoriesByProductId;
    const discountedProductIds = getDiscountedProductIds(categoriesByProductId);
    const outletProductIds = getOutletProductIds(categoriesByProductId);
    const oneRiyalProductIds = getOneRiyalOfferProductIds(categoriesByProductId);
    if (productIds.length > 0 && productIds.every((productId) => oneRiyalProductIds.has(productId))) {
      return NextResponse.json({
        error: ONE_RIYAL_OFFER_ERROR,
        errorCode: 'ONE_RIYAL_OFFER_NOT_RETURNABLE',
        message: 'جميع منتجات هذا الطلب من عرض الريال الواحد، ولا يمكن إنشاء طلب إرجاع أو استبدال لها.',
        canCreateNew: false,
      }, { status: 400 });
    }
    const fullyBlockedDiscountProductIds = new Set(
      Array.from(discountedProductIds).filter((productId) => !outletProductIds.has(productId))
    );
    if (productIds.length > 0 && productIds.every((productId) => fullyBlockedDiscountProductIds.has(productId))) {
      return NextResponse.json({
        error: 'منتجات التخفيضات غير قابلة للإرجاع أو الاستبدال',
        errorCode: 'DISCOUNTED_CATEGORY_NOT_RETURNABLE',
        message: 'جميع منتجات هذا الطلب ضمن فئات التخفيضات، ولا يمكن إنشاء طلب إرجاع أو استبدال لها.',
        canCreateNew: false,
      }, { status: 400 });
    }

    // Evaluate the return window per item using each product's own category, so evening
    // dresses (24h) and other categories (3 days) are judged independently. Only block the
    // whole order when every item is past its own window.
    const windowExpiredProductIds = deliveryDateResult.date
      ? getWindowExpiredProductIds(categoriesByProductId, deliveryDateResult.date)
      : new Set<string>();
    const allProductsExpired =
      productIds.length > 0 && productIds.every((productId) => windowExpiredProductIds.has(productId));

    if (allProductsExpired && !windowOverride) {
      // Use the evening-dress message only when every product is an evening dress; otherwise
      // the default 3-day window is the binding constraint.
      const orderPolicy = getReturnWindowPolicy(Object.values(categoriesByProductId).flat());

      log.warn('Shipment delivery date exceeds allowed return window for all items', {
        merchantId,
        orderId,
        deliveryDate: deliveryDateResult.date!.toISOString(),
        deliveryDateSource: deliveryDateResult.source,
        policyWindowHours: orderPolicy.windowHours,
      });

      return NextResponse.json({
        error: 'انتهت مدة الإرجاع المسموحة',
        errorCode: 'RETURN_PERIOD_EXPIRED',
        message: orderPolicy.message,
        allowedHours: orderPolicy.windowHours,
        deliveryDate: deliveryDateResult.date!.toISOString(),
        deliveryDateSource: deliveryDateResult.source,
        canCreateNew: false,
      }, { status: 400 });
    }

    // Check if multiple requests are allowed
    let allowMultiple = false;
    try {
      const multipleSetting = await prisma.settings.findUnique({
        where: { key: 'allow_multiple_return_requests' },
      });
      if (multipleSetting && multipleSetting.value === 'true') {
        allowMultiple = true;
      }
    } catch (err) {
      log.warn('Failed to fetch multiple requests setting', { error: err });
    }

    // Per-piece choices for the form: allowed types, block reasons, and pieces
    // already claimed by earlier requests.
    const pieces = toPublicPieces(pieceRules.pieces, pieceRules.rules, pieceRules.claimed);

    // Find existing return requests for this order
    const existingReturns = await prisma.returnRequest.findMany({
      where: {
        merchantId,
        orderId: String(orderId),
        status: {
          notIn: ['cancelled', 'rejected'], // Exclude cancelled and rejected
        },
      },
      include: {
        items: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (existingReturns.length === 0) {
      return NextResponse.json({
        hasExistingReturns: false,
        returns: [],
        allowMultipleRequests: allowMultiple,
        canCreateNew: true,
        returnWindowOverridden: windowOverride,
        windowExpiredProductIds: windowOverride ? [] : Array.from(windowExpiredProductIds),
        pieces,
      });
    }

    log.info('Found existing return requests', {
      merchantId,
      orderId,
      count: existingReturns.length,
    });

    // Salla now issues the return waybill asynchronously, so `smsaTrackingNumber`
    // is null at creation time. Backfill it from the return-type shipment in Salla
    // so the customer can see the tracking label.
    const returnsMissingTracking = existingReturns.filter((ret) => !ret.smsaTrackingNumber);
    if (returnsMissingTracking.length > 0) {
      try {
        const shipments = await getSallaOrderShipments(merchantId, String(orderId));
        const returnTrackingNumbers = Array.from(
          new Set(
            shipments
              .filter((shipment) => String(shipment?.type || '').toLowerCase() === 'return')
              .map((shipment) => extractTrackingFromShipment(shipment))
              .filter((tracking): tracking is string => Boolean(tracking))
          )
        );

        for (let i = 0; i < returnsMissingTracking.length && i < returnTrackingNumbers.length; i++) {
          const target = returnsMissingTracking[i];
          const trackingNumber = returnTrackingNumbers[i];

          try {
            await prisma.returnRequest.update({
              where: { id: target.id },
              data: { smsaTrackingNumber: trackingNumber },
            });
          } catch (updateError) {
            // smsaTrackingNumber is unique; ignore conflicts but still surface the
            // tracking number in the response below.
            log.warn('Failed to persist backfilled return tracking number', {
              returnRequestId: target.id,
              trackingNumber,
              error: updateError,
            });
          }

          target.smsaTrackingNumber = trackingNumber;
        }

        log.info('Backfilled return tracking numbers from Salla shipments', {
          merchantId,
          orderId,
          backfilled: Math.min(returnsMissingTracking.length, returnTrackingNumbers.length),
        });
      } catch (shipmentError) {
        log.warn('Failed to backfill return tracking from Salla shipments', {
          merchantId,
          orderId,
          error: shipmentError,
        });
      }
    }

    return NextResponse.json({
      hasExistingReturns: true,
      returns: existingReturns.map(ret => ({
        id: ret.id,
        type: ret.type,
        status: ret.status,
        reason: ret.reason,
        reasonDetails: ret.reasonDetails,
        smsaTrackingNumber: ret.smsaTrackingNumber,
        totalRefundAmount: ret.totalRefundAmount,
        returnFee: ret.returnFee,
        shippingAmount: ret.shippingAmount,
        currency: ret.currency,
        feeExchangeRate: ret.feeExchangeRate,
        feeExchangeRateSource: ret.feeExchangeRateSource,
        createdAt: ret.createdAt,
        items: ret.items.map((item) => toPublicItem(item as unknown as Record<string, unknown>)),
      })),
      // Category label per product, already loaded for the per-piece rules;
      // saves the page one Salla call per product.
      itemCategories: Object.fromEntries(
        Object.entries(categoriesByProductId)
          .filter(([, names]) => Array.isArray(names) && names.length > 0)
          .map(([productId, names]) => [productId, names[0]]),
      ),
      allowMultipleRequests: allowMultiple,
      canCreateNew: allowMultiple, // Can create new only if multiple requests are allowed
      returnWindowOverridden: windowOverride,
      windowExpiredProductIds: windowOverride ? [] : Array.from(windowExpiredProductIds),
      pieces,
    });

  } catch (error) {
    log.error('Error checking return requests', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء البحث عن طلبات الإرجاع' },
      { status: 500 }
    );
  }
}
