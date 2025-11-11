import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSallaOrder } from '@/app/lib/salla-api';
import type { SallaOrder } from '@/app/lib/salla-api';
import { createSMSAReturnShipment } from '@/app/lib/smsa-api';
import type { ShipmentAddress } from '@/app/lib/smsa-api';
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
  merchantAddressLine2?: string;
  merchantDistrict?: string;
  merchantPostalCode?: string;
  merchantCountry?: string;
  merchantCoordinates?: string;
}

const ensureAddressLine = (value: unknown, fallbackLabel: string): string => {
  const fallback = `${fallbackLabel} address`.trim();
  if (typeof value === 'string' && value.trim().length >= 10) {
    return value.trim().slice(0, 100);
  }
  return fallback.length >= 10 ? fallback.slice(0, 100) : 'Return address';
};

const formatCoordinates = (address: Record<string, any>): string | undefined => {
  if (!address) return undefined;
  if (typeof address.coordinates === 'string' && address.coordinates.trim()) {
    return address.coordinates.trim();
  }

  const lat = address.latitude ?? address.lat;
  const lng = address.longitude ?? address.lng ?? address.long;

  if (lat && lng) {
    return `${lat},${lng}`;
  }

  return undefined;
};

const buildPickupAddress = (order: SallaOrder): ShipmentAddress => {
  const pickupAddress = order.shipping?.pickup_address ?? {};
  const city =
    pickupAddress.city ??
    pickupAddress.city_en ??
    pickupAddress.city_ar ??
    pickupAddress.region ??
    'Riyadh';

  return {
    ContactName: `${order.customer.first_name} ${order.customer.last_name}`.trim(),
    ContactPhoneNumber: String(
      pickupAddress.phone ?? pickupAddress.mobile ?? order.customer.mobile ?? '0000000000'
    ).trim(),
    AddressLine1: ensureAddressLine(
      pickupAddress.address ??
        pickupAddress.address_line1 ??
        pickupAddress.address_line_1 ??
        pickupAddress.street ??
        pickupAddress.description,
      `${city} customer`
    ),
    AddressLine2:
      pickupAddress.address_line2 ??
      pickupAddress.district ??
      pickupAddress.neighborhood ??
      pickupAddress.area,
    City: city,
    Country: pickupAddress.country ?? pickupAddress.country_code ?? 'SA',
    Coordinates: formatCoordinates(pickupAddress),
    District: pickupAddress.district ?? pickupAddress.area ?? undefined,
    PostalCode: pickupAddress.postal_code ?? pickupAddress.zip_code ?? undefined,
    ShortCode: pickupAddress.shortcode ?? pickupAddress.short_code ?? undefined,
  };
};

const buildReturnAddress = (body: CreateReturnRequest): ShipmentAddress => {
  const city = body.merchantCity || 'Riyadh';
  return {
    ContactName: body.merchantName.trim(),
    ContactPhoneNumber: `${body.merchantPhone}`.trim(),
    AddressLine1: ensureAddressLine(body.merchantAddress, `${city} merchant`),
    AddressLine2: body.merchantAddressLine2 ?? city,
    City: city,
    Country: body.merchantCountry ?? 'SA',
    Coordinates: body.merchantCoordinates,
    District: body.merchantDistrict,
    PostalCode: body.merchantPostalCode,
  };
};

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
    const parcels = Math.max(1, totalQuantity);
    const estimatedWeight = totalQuantity * 0.5; // Estimate 0.5 kg per item
    const shipmentWeight = Math.max(0.5, Number(estimatedWeight.toFixed(2)));
    const orderReference = order.reference_id || order.id.toString();
    const shipmentCurrency = order.amounts?.total?.currency?.toUpperCase() || 'SAR';

    // Calculate total refund amount
    const totalRefundAmount = body.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
    const declaredValue = Math.max(0.1, Number(totalRefundAmount.toFixed(2)));

    const pickupAddress = buildPickupAddress(order);
    const returnAddress = buildReturnAddress(body);
    const waybillType = process.env.SMSA_WAYBILL_TYPE as 'PDF' | 'ZPL' | undefined;
    const serviceCode = process.env.SMSA_SERVICE_CODE;
    const smsRetailId = process.env.SMSA_RETAIL_ID;

    // Create SMSA return shipment
    log.info('Creating SMSA return shipment', {
      orderId: body.orderId,
      totalQuantity: parcels,
      merchantCity: body.merchantCity,
      declaredValue,
    });

    const smsaResult = await createSMSAReturnShipment({
      OrderNumber: orderReference,
      DeclaredValue: declaredValue,
      Parcels: parcels,
      ShipDate: new Date().toISOString(),
      ShipmentCurrency: shipmentCurrency,
      Weight: shipmentWeight,
      WeightUnit: 'KG',
      ContentDescription: `Return for Order ${orderReference}`,
      PickupAddress: pickupAddress,
      ReturnToAddress: returnAddress,
      WaybillType: waybillType,
      ServiceCode: serviceCode,
      SMSARetailID: smsRetailId,
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
      smsaTrackingNumber: smsaResult.awbNumber
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

        smsaTrackingNumber: smsaResult.awbNumber,
        smsaAwbNumber: smsaResult.sawb,
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
      smsaTrackingNumber: smsaResult.awbNumber
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
