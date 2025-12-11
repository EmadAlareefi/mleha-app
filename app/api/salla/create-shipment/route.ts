import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

interface ShipmentResponse {
  status: number;
  success: boolean;
  data?: {
    id: number;
    order_id: number;
    tracking_number: string;
    courier_id: number;
    courier_name: string;
    status: string;
    payment_method: string;
    created_at: {
      date: string;
      timezone: string;
    };
  };
  error?: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}

/**
 * POST /api/salla/create-shipment
 * Creates a shipment for an order via Salla API
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assignmentId, courierId } = body;

    if (!assignmentId) {
      return NextResponse.json(
        { error: 'معرف الطلب مطلوب' },
        { status: 400 }
      );
    }

    // Get assignment with order data
    const assignment = await prisma.orderAssignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignment) {
      return NextResponse.json(
        { error: 'الطلب غير موجود' },
        { status: 404 }
      );
    }

    const orderData = assignment.orderData as any;

    // Determine courier ID (from parameter, environment variable, or error)
    const finalCourierId = courierId || process.env.SALLA_DEFAULT_COURIER_ID;

    if (!finalCourierId) {
      return NextResponse.json(
        {
          error: 'لم يتم تحديد شركة الشحن',
          details: 'يجب تحديد SALLA_DEFAULT_COURIER_ID في إعدادات البيئة أو إرسال courierId في الطلب'
        },
        { status: 400 }
      );
    }

    // Extract customer/shipping address
    const customer = orderData.customer || {};
    const shippingAddress = orderData.shipping_address || orderData.shipping?.address || {};
    const billingAddress = orderData.billing_address || orderData.billing?.address || {};

    // Build ship_to object (recipient)
    const shipTo: any = {
      name: customer.first_name && customer.last_name
        ? `${customer.first_name} ${customer.last_name}`.trim()
        : customer.name || 'عميل',
      email: customer.email || '',
      phone: customer.mobile || customer.phone || '',
    };

    // Add address details if available
    if (shippingAddress.country || billingAddress.country) {
      shipTo.country = shippingAddress.country || billingAddress.country;
    }
    if (shippingAddress.city || billingAddress.city) {
      shipTo.city = shippingAddress.city || billingAddress.city;
    }
    if (shippingAddress.street || shippingAddress.address || billingAddress.street || billingAddress.address) {
      shipTo.address_line = shippingAddress.street || shippingAddress.address || billingAddress.street || billingAddress.address;
    }
    if (shippingAddress.street_number || billingAddress.street_number) {
      shipTo.street_number = shippingAddress.street_number || billingAddress.street_number;
    }
    if (shippingAddress.block || billingAddress.block) {
      shipTo.block = shippingAddress.block || billingAddress.block;
    }
    if (shippingAddress.postal_code || shippingAddress.zip || billingAddress.postal_code || billingAddress.zip) {
      shipTo.postal_code = shippingAddress.postal_code || shippingAddress.zip || billingAddress.postal_code || billingAddress.zip;
    }

    // Build packages array from order items
    const packages = (orderData.items || []).map((item: any) => ({
      name: item.name || 'منتج',
      sku: item.sku || '',
      quantity: item.quantity || 1,
      price: {
        amount: parseFloat(item.price?.amount || item.amounts?.price || item.unit_price || 0),
        currency: item.price?.currency || orderData.currency || 'SAR',
      },
      weight: {
        value: parseFloat(item.weight?.value || item.weight || 0.5), // Default 0.5kg if not specified
        units: item.weight?.units || 'kg',
      },
    }));

    // Determine payment method (cod or pre_paid)
    const paymentMethod = orderData.payment_method === 'cod' ||
                          orderData.payment?.method === 'cod' ||
                          orderData.payment_status === 'cod'
                            ? 'cod'
                            : 'pre_paid';

    // Build shipment request
    const shipmentData: any = {
      courier_id: parseInt(finalCourierId),
      order_id: parseInt(assignment.orderId),
      shipment_type: 'shipment',
      payment_method: paymentMethod,
      service_types: ['fulfillment', 'normal'],
      description: `طلب #${assignment.orderNumber} - ${packages.length} منتج`,
      ship_to: shipTo,
      packages: packages,
    };

    // Add COD amount if applicable
    if (paymentMethod === 'cod') {
      const totalAmount = parseFloat(
        orderData.amounts?.total?.amount ||
        orderData.total_amount ||
        orderData.total ||
        0
      );

      shipmentData.cash_on_delivery = {
        amount: totalAmount,
        currency: orderData.currency || 'SAR',
      };
    }

    log.info('Creating shipment via Salla API', {
      assignmentId,
      orderId: assignment.orderId,
      orderNumber: assignment.orderNumber,
      courierId: finalCourierId,
      paymentMethod,
    });

    // Call Salla API to create shipment
    const response = await sallaMakeRequest<ShipmentResponse>(
      assignment.merchantId,
      '/shipments',
      {
        method: 'POST',
        body: JSON.stringify(shipmentData),
      }
    );

    if (!response || !response.success) {
      const errorMessage = response?.error?.message || 'فشل إنشاء الشحنة';
      const errorFields = response?.error?.fields
        ? Object.entries(response.error.fields)
            .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
            .join('\n')
        : '';

      log.error('Failed to create shipment', {
        assignmentId,
        orderId: assignment.orderId,
        error: errorMessage,
        fields: errorFields,
        responseStatus: response?.status,
      });

      return NextResponse.json(
        {
          error: errorMessage,
          details: errorFields || undefined,
        },
        { status: 400 }
      );
    }

    const shipmentId = response.data?.id;
    const trackingNumber = response.data?.tracking_number;
    const courierName = response.data?.courier_name;

    log.info('Shipment created successfully', {
      assignmentId,
      orderId: assignment.orderId,
      shipmentId,
      trackingNumber,
      courierName,
    });

    // Update the SallaOrder record with tracking number
    await prisma.sallaOrder.updateMany({
      where: {
        merchantId: assignment.merchantId,
        orderId: assignment.orderId,
      },
      data: {
        trackingNumber: trackingNumber || undefined,
        fulfillmentCompany: courierName || undefined,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'تم إنشاء الشحنة بنجاح',
      data: {
        shipmentId,
        trackingNumber,
        courierName,
        status: response.data?.status,
      },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';

    log.error('Error creating shipment', {
      error: errorMessage,
      stack: errorStack,
    });

    return NextResponse.json(
      {
        error: 'حدث خطأ أثناء إنشاء الشحنة',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}
