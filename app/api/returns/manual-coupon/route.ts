import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/returns/manual-coupon
 * Manually assign a coupon code to an exchange request (when auto-creation fails)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { returnRequestId, couponCode } = body;

    if (!returnRequestId || !couponCode) {
      return NextResponse.json(
        { error: 'معرف الطلب ورمز الكوبون مطلوبان' },
        { status: 400 }
      );
    }

    // Fetch return request
    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      include: { items: true },
    });

    if (!returnRequest) {
      return NextResponse.json(
        { error: 'طلب الإرجاع غير موجود' },
        { status: 404 }
      );
    }

    // Check if it's an exchange
    if (returnRequest.type !== 'exchange') {
      return NextResponse.json(
        { error: 'الكوبونات متاحة فقط لطلبات الاستبدال' },
        { status: 400 }
      );
    }

    // Update return request with manual coupon code
    const updatedRequest = await prisma.returnRequest.update({
      where: { id: returnRequestId },
      data: {
        couponCode: couponCode.trim(),
        couponCreatedAt: new Date(),
      },
      include: { items: true },
    });

    log.info('Manual coupon code assigned', {
      returnRequestId,
      couponCode: couponCode.trim(),
    });

    return NextResponse.json({
      success: true,
      returnRequest: updatedRequest,
    });

  } catch (error) {
    log.error('Error assigning manual coupon', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تعيين الكوبون' },
      { status: 500 }
    );
  }
}
