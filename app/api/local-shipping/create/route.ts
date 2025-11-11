import { NextRequest, NextResponse } from 'next/server';
import { getSallaOrderByReference } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const runtime = 'nodejs';

/**
 * POST /api/local-shipping/create
 * Creates a local shipping label for an order
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.merchantId || !body.orderNumber) {
      return NextResponse.json(
        { error: 'معرف التاجر ورقم الطلب مطلوبان' },
        { status: 400 }
      );
    }

    log.info('Creating local shipping label', {
      merchantId: body.merchantId,
      orderNumber: body.orderNumber
    });

    // Fetch order from Salla
    const order = await getSallaOrderByReference(body.merchantId, body.orderNumber);

    if (!order) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب' },
        { status: 404 }
      );
    }

    // Extract shipping information
    const shippingAddress = (order as any).shipping_address?.street_address ||
                          (order as any).shipping?.pickup_address?.address ||
                          'لم يتم توفير العنوان';
    const shippingCity = (order as any).shipping_address?.city ||
                        (order as any).shipping?.pickup_address?.city ||
                        'الرياض';
    const shippingPostcode = (order as any).shipping_address?.postal_code ||
                            (order as any).shipping?.pickup_address?.postal_code ||
                            '';

    // Generate unique tracking number (format: LOCAL-YYYYMMDD-XXXXX)
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    const trackingNumber = `LOCAL-${dateStr}-${randomNum}`;

    // Calculate items count
    const itemsCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

    // Create local shipment in database
    const localShipment = await prisma.localShipment.create({
      data: {
        merchantId: body.merchantId,
        orderId: order.id.toString(),
        orderNumber: order.reference_id,
        customerName: `${order.customer.first_name} ${order.customer.last_name}`,
        customerPhone: order.customer.mobile,
        shippingAddress,
        shippingCity,
        shippingPostcode,
        orderTotal: order.amounts.total.amount,
        itemsCount,
        orderItems: order.items,
        trackingNumber,
        generatedBy: body.generatedBy || 'system',
        notes: body.notes || null,
      },
    });

    log.info('Local shipping label created', {
      shipmentId: localShipment.id,
      trackingNumber: localShipment.trackingNumber
    });

    return NextResponse.json({
      success: true,
      shipment: {
        id: localShipment.id,
        trackingNumber: localShipment.trackingNumber,
        orderNumber: localShipment.orderNumber,
        customerName: localShipment.customerName,
        customerPhone: localShipment.customerPhone,
        shippingAddress: localShipment.shippingAddress,
        shippingCity: localShipment.shippingCity,
        shippingPostcode: localShipment.shippingPostcode,
        orderTotal: localShipment.orderTotal,
        itemsCount: localShipment.itemsCount,
        orderItems: localShipment.orderItems,
        createdAt: localShipment.createdAt,
      },
    });

  } catch (error) {
    log.error('Error creating local shipping label', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء ملصق الشحن' },
      { status: 500 }
    );
  }
}
