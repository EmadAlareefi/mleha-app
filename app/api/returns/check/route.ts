import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

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
    const orderUpdatedAt = searchParams.get('orderUpdatedAt'); // ISO date string from order.date.updated

    if (!merchantId || !orderId) {
      return NextResponse.json(
        { error: 'merchantId and orderId are required' },
        { status: 400 }
      );
    }

    log.info('Checking for existing return requests', { merchantId, orderId, orderUpdatedAt });

    // Check if order last updated date exceeds 3 days
    if (!orderUpdatedAt) {
      log.warn('No orderUpdatedAt provided for validation', { merchantId, orderId });
      return NextResponse.json({
        error: 'لا يمكن التحقق من تاريخ الطلب',
        errorCode: 'MISSING_ORDER_DATE',
        message: 'لم يتم تقديم تاريخ الطلب للتحقق من صلاحية الإرجاع.',
        canCreateNew: false,
      }, { status: 400 });
    }

    const updatedDate = new Date(orderUpdatedAt);

    // Validate that the date is valid
    if (isNaN(updatedDate.getTime())) {
      log.error('Invalid date format', { merchantId, orderId, orderUpdatedAt });
      return NextResponse.json({
        error: 'تاريخ الطلب غير صالح',
        errorCode: 'INVALID_DATE_FORMAT',
        message: 'تاريخ الطلب المقدم غير صالح.',
        canCreateNew: false,
      }, { status: 400 });
    }

    const now = new Date();
    const daysDifference = (now.getTime() - updatedDate.getTime()) / (1000 * 60 * 60 * 24);

    // Allow returns within 3 days (exceeds means > 3 days, with small epsilon for floating point)
    const EPSILON = 0.001; // ~1.5 minutes tolerance
    if (daysDifference > 3 + EPSILON) {
      log.warn('Order update date exceeds 3 days', {
        merchantId,
        orderId,
        orderUpdatedAt,
        daysDifference: daysDifference.toFixed(2),
      });

      return NextResponse.json({
        error: 'انتهت مدة الإرجاع المسموحة',
        errorCode: 'RETURN_PERIOD_EXPIRED',
        message: 'لقد تجاوز الطلب مدة 3 أيام من آخر تحديث. لا يمكن إنشاء طلب إرجاع.',
        daysSinceUpdate: Math.floor(daysDifference),
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
