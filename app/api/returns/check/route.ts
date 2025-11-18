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

    if (!merchantId || !orderId) {
      return NextResponse.json(
        { error: 'merchantId and orderId are required' },
        { status: 400 }
      );
    }

    log.info('Checking for existing return requests', { merchantId, orderId });

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
