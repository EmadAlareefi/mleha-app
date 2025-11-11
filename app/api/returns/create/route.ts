import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSallaOrder } from '@/app/lib/salla-api';
import { createSMSAReturnShipment } from '@/app/lib/smsa-api';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

interface ReturnItemRequest {
  productId: string;
  productName: string;
  productSku?: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  price: number;
}

interface CreateReturnRequest {
  merchantId: string;
  orderId: string;
  type: 'return' | 'exchange';
  reason: string;
  reasonDetails?: string;
  items: ReturnItemRequest[];

  // Merchant/warehouse address for return shipment destination
  merchantName: string;
  merchantPhone: string;
  merchantAddress: string;
  merchantCity: string;
}

/**
 * POST /api/returns/create
 *
 * Creates a return/exchange request:
 * 1. Validates the order
 * 2. Creates SMSA return shipment
 * 3. Stores return request in database
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateReturnRequest = await request.json();

    // Validate required fields
    if (!body.merchantId || !body.orderId || !body.type || !body.reason || !body.items || body.items.length === 0) {
      return NextResponse.json(
        { error: 'الرجاء تقديم جميع الحقول المطلوبة' },
        { status: 400 }
      );
    }

    if (!body.merchantName || !body.merchantPhone || !body.merchantAddress || !body.merchantCity) {
      return NextResponse.json(
        { error: 'معلومات عنوان المرتجع مطلوبة' },
        { status: 400 }
      );
    }

    // Fetch order from Salla to validate and get customer details
    log.info('Fetching order from Salla', { merchantId: body.merchantId, orderId: body.orderId });

    const order = await getSallaOrder(body.merchantId, body.orderId);

    if (!order) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب' },
        { status: 404 }
      );
    }

    // Validate order status - should be delivered or completed
    const returnableStatuses = ['delivered', 'completed'];
    if (!returnableStatuses.includes(order.status.slug.toLowerCase())) {
      return NextResponse.json(
        { error: 'هذا الطلب غير قابل للإرجاع. يجب أن يكون الطلب مكتملاً أو تم تسليمه.' },
        { status: 400 }
      );
    }

    // Calculate total number of items and weight (estimate)
    const totalQuantity = body.items.reduce((sum, item) => sum + item.quantity, 0);
    const estimatedWeight = totalQuantity * 0.5; // Estimate 0.5 kg per item

    // Calculate total refund amount
    const totalRefundAmount = body.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    // Create SMSA return shipment
    log.info('Creating SMSA return shipment', {
      orderId: body.orderId,
      totalQuantity,
      merchantCity: body.merchantCity
    });

    const smsaResult = await createSMSAReturnShipment({
      // Sender is the customer (return origin)
      senderName: `${order.customer.first_name} ${order.customer.last_name}`,
      senderPhone: order.customer.mobile,
      senderAddress: order.shipping?.pickup_address?.address || 'Customer Address',
      senderCity: order.shipping?.pickup_address?.city || 'Riyadh',

      // Receiver is the merchant (return destination)
      receiverName: body.merchantName,
      receiverPhone: body.merchantPhone,
      receiverAddress: body.merchantAddress,
      receiverCity: body.merchantCity,

      // Shipment details
      shipmentType: 'RET',
      numberOfPieces: totalQuantity,
      weight: estimatedWeight,
      goodsDescription: `Return for Order ${order.reference_id}`,
      reference1: order.reference_id,
      reference2: body.type === 'exchange' ? 'EXCHANGE' : 'RETURN',
    });

    if (!smsaResult.success) {
      log.error('SMSA shipment creation failed', { error: smsaResult.error });
      return NextResponse.json(
        { error: `فشل إنشاء شحنة الإرجاع: ${smsaResult.error}` },
        { status: 500 }
      );
    }

    // Store return request in database
    log.info('Storing return request in database', {
      orderId: body.orderId,
      smsaTrackingNumber: smsaResult.trackingNumber
    });

    const returnRequest = await prisma.returnRequest.create({
      data: {
        merchantId: body.merchantId,
        orderId: body.orderId.toString(),
        orderNumber: order.reference_id,
        customerId: order.customer.id.toString(),
        customerName: `${order.customer.first_name} ${order.customer.last_name}`,
        customerEmail: order.customer.email,
        customerPhone: order.customer.mobile,

        type: body.type,
        status: 'pending_review',
        reason: body.reason,
        reasonDetails: body.reasonDetails,

        smsaTrackingNumber: smsaResult.trackingNumber,
        smsaAwbNumber: smsaResult.awbNumber,
        smsaResponse: smsaResult.rawResponse as any,

        totalRefundAmount,

        items: {
          create: body.items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            productSku: item.productSku,
            variantId: item.variantId,
            variantName: item.variantName,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    log.info('Return request created successfully', {
      returnRequestId: returnRequest.id,
      smsaTrackingNumber: smsaResult.trackingNumber
    });

    return NextResponse.json({
      success: true,
      returnRequest: {
        id: returnRequest.id,
        orderNumber: returnRequest.orderNumber,
        type: returnRequest.type,
        status: returnRequest.status,
        smsaTrackingNumber: returnRequest.smsaTrackingNumber,
        totalRefundAmount: returnRequest.totalRefundAmount,
        createdAt: returnRequest.createdAt,
      },
    });

  } catch (error) {
    log.error('Error creating return request', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء طلب الإرجاع' },
      { status: 500 }
    );
  }
}
