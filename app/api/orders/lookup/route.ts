import { NextRequest, NextResponse } from 'next/server';
import { getSallaOrderByReference, findOrdersByCustomerContact } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * GET /api/orders/lookup?merchantId=XXX&orderNumber=YYY
 * or
 * GET /api/orders/lookup?merchantId=XXX&contact=email@example.com
 *
 * Looks up orders by order number or customer contact (email/phone)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantId = searchParams.get('merchantId');
    const orderNumber = searchParams.get('orderNumber');
    const contact = searchParams.get('contact');

    if (!merchantId) {
      return NextResponse.json(
        { error: 'معرف التاجر مطلوب' },
        { status: 400 }
      );
    }

    // Lookup by order number
    if (orderNumber) {
      log.info('Looking up order by number', { merchantId, orderNumber });

      const order = await getSallaOrderByReference(merchantId, orderNumber);

      if (!order) {
        return NextResponse.json(
          { error: 'لم يتم العثور على الطلب' },
          { status: 404 }
        );
      }

      // Debug: Log order items structure
      if (order.items && order.items.length > 0) {
        log.info('Order items structure', {
          firstItem: JSON.stringify(order.items[0], null, 2),
          itemKeys: Object.keys(order.items[0]),
          amounts: order.items[0].amounts,
          product: order.items[0].product
        });
      }

      return NextResponse.json({
        success: true,
        order,
      });
    }

    // Lookup by customer contact (email or phone)
    if (contact) {
      log.info('Looking up orders by contact', { merchantId, contact });

      const orders = await findOrdersByCustomerContact(merchantId, contact);

      if (orders.length === 0) {
        return NextResponse.json(
          { error: 'لم يتم العثور على طلبات لهذا العميل' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        orders,
      });
    }

    return NextResponse.json(
      { error: 'يجب تقديم رقم الطلب أو معلومات الاتصال' },
      { status: 400 }
    );

  } catch (error) {
    log.error('Error in order lookup', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء البحث عن الطلب' },
      { status: 500 }
    );
  }
}
