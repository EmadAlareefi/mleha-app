import { NextRequest, NextResponse } from 'next/server';
import { getSallaOrderByReference } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import { PrismaClient } from '@prisma/client';
import { buildOrderItemsPayload, serializeLocalShipment } from '../serializer';

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

    const normalizedOrderNumber = body.orderNumber.toString().trim();

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
    const shippingAddress =
      (order as any).shipping_address?.street_address ||
      (order as any).shipping?.pickup_address?.address ||
      (order.customer?.city ? `مدينة العميل: ${order.customer.city}` : null) ||
      'لم يتم توفير العنوان';
    const shippingCity =
      (order as any).shipping_address?.city ||
      (order as any).shipping?.pickup_address?.city ||
      order.customer?.city ||
      'الرياض';
    const shippingPostcode =
      (order as any).shipping_address?.postal_code ||
      (order as any).shipping?.pickup_address?.postal_code ||
      '';

    // Generate unique tracking number (format: LOCAL-YYYYMMDD-XXXXX)
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    const trackingNumber = `LOCAL-${dateStr}-${randomNum}`;

    // Calculate items count
    const orderItems = Array.isArray(order.items) ? order.items : [];
    const itemsCount = orderItems.reduce((sum, item) => sum + (item.quantity ?? 0), 0);

    const rawOrderTotal =
      (order as any).amounts?.total?.amount ??
      (order as any).total?.amount ??
      0;
    const orderTotalAmount = Number(rawOrderTotal) || 0;
    const paymentMethodRaw = (
      (order as any).payment_method ??
      (order as any).payment_method_label ??
      (order as any).payment?.method ??
      ''
    ).toString();
    const normalizedPaymentMethod = paymentMethodRaw.toLowerCase();
    const isCashOnDelivery =
      normalizedPaymentMethod.includes('cod') ||
      normalizedPaymentMethod.includes('cash on delivery') ||
      normalizedPaymentMethod.includes('collect') ||
      normalizedPaymentMethod.includes('الدفع عند الاستلام');
    const collectionAmount = isCashOnDelivery ? Number(orderTotalAmount) : 0;
    const paymentLabel = paymentMethodRaw || (isCashOnDelivery ? 'Cash On Delivery' : 'Prepaid');

    // Ensure we reuse existing labels for the same order
    const existingShipment = await prisma.localShipment.findFirst({
      where: {
        merchantId: body.merchantId,
        orderNumber: normalizedOrderNumber,
      },
    });

    if (existingShipment) {
      log.info('Local shipping label already exists, returning existing label', {
        orderNumber: normalizedOrderNumber,
        trackingNumber: existingShipment.trackingNumber,
      });

      return NextResponse.json({
        success: true,
        reused: true,
        shipment: serializeLocalShipment(existingShipment, {
          collectionAmount,
          paymentMethod: paymentLabel,
        }),
      });
    }

    const customerName =
      `${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim() ||
      order.customer?.full_name ||
      'عميل غير معروف';
    const customerPhone = `${order.customer?.mobile ?? ''}`.trim() || '0000000000';

    // Create local shipment in database
    const localShipment = await prisma.localShipment.create({
      data: {
        merchantId: body.merchantId,
        orderId: order.id.toString(),
        orderNumber: normalizedOrderNumber,
        customerName,
        customerPhone,
        shippingAddress,
        shippingCity,
        shippingPostcode,
        orderTotal: orderTotalAmount,
        itemsCount,
        orderItems: buildOrderItemsPayload(orderItems, {
          collectionAmount,
          paymentMethod: paymentLabel,
        }),
        paymentMethod: isCashOnDelivery ? 'cod' : 'prepaid',
        isCOD: isCashOnDelivery,
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
      shipment: serializeLocalShipment(localShipment, {
        collectionAmount,
        paymentMethod: paymentLabel,
      }),
    });

  } catch (error) {
    log.error('Error creating local shipping label', {
      error: error instanceof Error ? error.message : error
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء ملصق الشحن' },
      { status: 500 }
    );
  }
}
