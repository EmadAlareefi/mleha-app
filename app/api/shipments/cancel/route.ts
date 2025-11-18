import { NextRequest, NextResponse } from 'next/server';
import { cancelC2BShipment } from '@/app/lib/smsa-api';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/shipments/cancel
 *
 * Cancels a C2B (return) shipment by AWB/tracking number
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { trackingNumber } = body;

    if (!trackingNumber) {
      return NextResponse.json(
        { error: 'رقم الشحنة مطلوب' },
        { status: 400 }
      );
    }

    log.info('Cancelling shipment via API', { trackingNumber });

    const result = await cancelC2BShipment(trackingNumber);

    if (!result.success) {
      log.error('Shipment cancellation failed', { trackingNumber, error: result.error });

      // Translate error to Arabic
      let arabicError = 'فشل إلغاء الشحنة';
      if (result.error?.includes('not found')) {
        arabicError = 'لم يتم العثور على الشحنة. يرجى التحقق من رقم التتبع.';
      } else if (result.error?.includes('cannot be cancelled')) {
        arabicError = 'لا يمكن إلغاء هذه الشحنة. قد تكون قيد التسليم أو تم تسليمها بالفعل.';
      } else if (result.error?.includes('picked up')) {
        arabicError = 'لا يمكن إلغاء الشحنة. تم استلامها من قبل شركة الشحن.';
      }

      return NextResponse.json(
        { error: arabicError },
        { status: 500 }
      );
    }

    log.info('Shipment cancelled successfully', { trackingNumber });

    return NextResponse.json({
      success: true,
      message: result.message || 'تم إلغاء الشحنة بنجاح',
    });

  } catch (error) {
    log.error('Error in cancel shipment API', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إلغاء الشحنة' },
      { status: 500 }
    );
  }
}
