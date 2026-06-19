import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaOrder, getSallaOrderShipments } from '@/app/lib/salla-api';
import { extractTrackingFromShipment } from '@/app/lib/salla-shipment';
import {
  evaluateReturnWindow,
  getCategoryNamesByProductId,
  getDiscountedProductIds,
  getOutletProductIds,
  getProductIdsForOrderItems,
  resolveReturnDeliveryDate,
} from '@/lib/returns/policy';
import { isEveningDressCategory } from '@/lib/returns/categories';

export const runtime = 'nodejs';

/**
 * GET /api/returns/check
 *
 * Checks if there are existing return requests for an order
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get('merchantId');
    const orderId = searchParams.get('orderId');

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

    const deliveryDateResult = await resolveReturnDeliveryDate(merchantId, order as any);
    if (!deliveryDateResult.date) {
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
    const categoriesByProductId = await getCategoryNamesByProductId(merchantId, productIds);
    const discountedProductIds = getDiscountedProductIds(categoriesByProductId);
    const outletProductIds = getOutletProductIds(categoriesByProductId);
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

    const productCategoryGroups = Object.values(categoriesByProductId);
    const allDetectedProductsAreEveningDresses =
      productCategoryGroups.length > 0 &&
      productCategoryGroups.every((categoryNames) => categoryNames.some(isEveningDressCategory));
    const categoryNamesForPreCheck = allDetectedProductsAreEveningDresses
      ? Object.values(categoriesByProductId).flat()
      : [];
    const windowEvaluation = evaluateReturnWindow({
      categoryNames: categoryNamesForPreCheck,
      deliveryDate: deliveryDateResult.date,
    });

    if (!windowEvaluation.eligible) {
      log.warn('Shipment delivery date exceeds allowed return window', {
        merchantId,
        orderId,
        deliveryDate: deliveryDateResult.date.toISOString(),
        deliveryDateSource: deliveryDateResult.source,
        elapsedHours: windowEvaluation.elapsedHours.toFixed(2),
        policyWindowHours: windowEvaluation.policy.windowHours,
      });

      return NextResponse.json({
        error: 'انتهت مدة الإرجاع المسموحة',
        errorCode: 'RETURN_PERIOD_EXPIRED',
        message: windowEvaluation.policy.message,
        daysSinceDelivery: Math.floor(windowEvaluation.daysSinceDelivery),
        elapsedHours: Math.floor(windowEvaluation.elapsedHours),
        allowedHours: windowEvaluation.policy.windowHours,
        deliveryDate: deliveryDateResult.date.toISOString(),
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
        createdAt: ret.createdAt,
        items: ret.items,
      })),
      allowMultipleRequests: allowMultiple,
      canCreateNew: allowMultiple, // Can create new only if multiple requests are allowed
    });

  } catch (error) {
    log.error('Error checking return requests', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء البحث عن طلبات الإرجاع' },
      { status: 500 }
    );
  }
}
