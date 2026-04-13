import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSallaOrderByReference } from '@/app/lib/salla-api';
import { createSMSAB2CShipment } from '@/app/lib/smsa-api';
import { log } from '@/app/lib/logger';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import { buildConsigneeAddressFromOrder, buildMerchantShipperAddress } from '@/app/lib/manual-smsa/address';
import { serializeManualSmsaShipment } from '@/app/lib/manual-smsa/serializer';
import type {
  ManualSmsaShipmentItem,
  ManualSmsaShipmentPayload,
} from '@/app/lib/manual-smsa/types';
import { extractSmsaLabelBase64, buildSmsaLabelDataUrl } from '@/lib/returns/smsa-label';

const FALLBACK_MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const MIN_DECLARED_VALUE = 1;
const MIN_WEIGHT = 0.5;
const DEFAULT_ITEM_WEIGHT = 0.5;

const toJsonValue = (value: unknown): Prisma.InputJsonValue =>
  value as unknown as Prisma.InputJsonValue;

const safeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const positiveNumber = (value: unknown): number | null => {
  const parsed = safeNumber(value);
  if (parsed === null) return null;
  return parsed > 0 ? parsed : null;
};

const positiveInteger = (value: unknown): number | null => {
  const parsed = safeNumber(value);
  if (parsed === null) return null;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : null;
};

const normalizeItems = (items: ManualSmsaShipmentPayload['items']): ManualSmsaShipmentItem[] => {
  if (!Array.isArray(items)) {
    return [];
  }

  const normalized: ManualSmsaShipmentItem[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const quantity = positiveInteger(raw.quantity);
    if (!name || !quantity) {
      continue;
    }

    const price = positiveNumber(raw.price);
    const weight = positiveNumber(raw.weight);

    normalized.push({
      id: raw.id ?? raw.productId ?? null,
      productId: raw.productId ?? null,
      variantId: raw.variantId ?? null,
      name,
      sku: typeof raw.sku === 'string' ? raw.sku.trim() || null : raw.sku ?? null,
      quantity,
      price: price ?? null,
      weight: weight ?? null,
      source: raw.source || null,
      notes: typeof raw.notes === 'string' ? raw.notes : null,
      total: price ? Number((price * quantity).toFixed(2)) : null,
    });
  }

  return normalized;
};

const resolveOrderReference = (order: any, fallbackNumber: string): string => {
  if (order?.reference_id) {
    return String(order.reference_id);
  }
  if (order?.referenceId) {
    return String(order.referenceId);
  }
  if (order?.order_number) {
    return String(order.order_number);
  }
  return fallbackNumber;
};

const detectCodAmountFromOrder = (order: any): number | null => {
  const paymentMethodRaw =
    order?.payment_method ||
    order?.payment_method_label ||
    order?.payment?.method ||
    '';
  const amount =
    order?.amounts?.total?.amount ??
    order?.total?.amount ??
    null;
  if (!amount) {
    return null;
  }
  const method = typeof paymentMethodRaw === 'string' ? paymentMethodRaw.toLowerCase() : '';
  if (!method) {
    return null;
  }
  const isCod =
    method.includes('cod') ||
    method.includes('cash on delivery') ||
    method.includes('collect') ||
    method.includes('الدفع عند الاستلام');
  return isCod ? Number(amount) : null;
};

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderNumber = searchParams.get('orderNumber');
    const orderId = searchParams.get('orderId');
    const requestedMerchant = searchParams.get('merchantId');
    const includeDeleted = searchParams.get('includeDeleted') === '1';

    if (!orderNumber && !orderId) {
      return NextResponse.json(
        { error: 'يجب تحديد رقم الطلب أو معرّف الطلب لعرض الشحنات' },
        { status: 400 },
      );
    }

    const resolvedMerchant = await resolveSallaMerchantId(
      requestedMerchant || FALLBACK_MERCHANT_ID,
    );

    if (!resolvedMerchant.merchantId) {
      return NextResponse.json(
        { error: resolvedMerchant.error || 'تعذر تحديد تاجر سلة' },
        { status: 503 },
      );
    }

    const filters: Record<string, any> = {
      merchantId: resolvedMerchant.merchantId,
    };

    if (orderNumber) {
      filters.orderNumber = orderNumber;
    }
    if (orderId) {
      filters.orderId = orderId;
    }
    if (!includeDeleted) {
      filters.deletedAt = null;
    }

    const shipments = await prisma.manualSmsaShipment.findMany({
      where: filters,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      shipments: shipments.map(serializeManualSmsaShipment),
    });
  } catch (error) {
    log.error('Failed to list manual SMSA shipments', { error });
    return NextResponse.json(
      { error: 'تعذر تحميل الشحنات اليدوية لهذا الطلب' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload: ManualSmsaShipmentPayload = await request.json();
    if (!payload || !payload.orderNumber) {
      return NextResponse.json({ error: 'رقم الطلب مطلوب' }, { status: 400 });
    }

    const shipmentItems = normalizeItems(payload.items);
    if (shipmentItems.length === 0) {
      return NextResponse.json(
        { error: 'يجب اختيار منتج واحد على الأقل لإنشاء الشحنة' },
        { status: 400 },
      );
    }

    const session = await getServerSession(authOptions).catch(() => null);
    const user = session?.user as { id?: string; name?: string; username?: string } | undefined;

    const resolvedMerchant = await resolveSallaMerchantId(
      payload.merchantId || FALLBACK_MERCHANT_ID,
    );
    if (!resolvedMerchant.merchantId) {
      return NextResponse.json(
        { error: resolvedMerchant.error || 'لا يوجد تاجر مرتبط بسلة' },
        { status: 503 },
      );
    }

    const merchantId = resolvedMerchant.merchantId;
    const orderNumber = payload.orderNumber.trim();
    const order = await getSallaOrderByReference(merchantId, orderNumber);

    if (!order) {
      return NextResponse.json(
        { error: 'لم يتم العثور على الطلب في سلة' },
        { status: 404 },
      );
    }

    const consigneeAddress = buildConsigneeAddressFromOrder(order);
    const shipperAddress = buildMerchantShipperAddress(null);

    const totalItemsAmount = shipmentItems.reduce((sum, item) => {
      const itemTotal = typeof item.total === 'number' ? item.total : 0;
      return sum + (Number.isFinite(itemTotal) ? itemTotal : 0);
    }, 0);
    const totalQuantity = shipmentItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalWeightFromItems = shipmentItems.reduce((sum, item) => {
      const weight = typeof item.weight === 'number' ? item.weight : DEFAULT_ITEM_WEIGHT;
      return sum + weight * item.quantity;
    }, 0);

    const userDeclaredValue = positiveNumber(payload.declaredValue);
    const declaredValueSource =
      userDeclaredValue ??
      (totalItemsAmount > 0 ? totalItemsAmount : safeNumber(order.amounts?.total?.amount)) ??
      MIN_DECLARED_VALUE;
    const declaredValue = Number(Math.max(MIN_DECLARED_VALUE, declaredValueSource).toFixed(2));

    const parcels =
      positiveInteger(payload.parcels) ??
      Math.max(1, totalQuantity) ??
      1;

    const userWeight = positiveNumber(payload.weight);
    const resolvedWeightSource =
      userWeight ??
      (totalWeightFromItems > 0 ? totalWeightFromItems : MIN_WEIGHT);
    const weight = Number(Math.max(MIN_WEIGHT, resolvedWeightSource).toFixed(2));

    const currency =
      (typeof payload.currency === 'string' && payload.currency.trim()) ||
      order.amounts?.total?.currency ||
      'SAR';

    const contentDescription =
      (typeof payload.contentDescription === 'string' && payload.contentDescription.trim()) ||
      `Extra shipment for order ${orderNumber}`;

    const providedCodAmount = positiveNumber(payload.codAmount);
    const inferredCodAmount = detectCodAmountFromOrder(order);
    const codAmount = providedCodAmount ?? inferredCodAmount ?? null;

    const shipmentReference = `${resolveOrderReference(order, orderNumber)}-NX-${randomUUID().slice(0, 8)}`;

    log.info('Creating manual SMSA shipment', {
      orderNumber,
      merchantId,
      shipmentReference,
      declaredValue,
      parcels,
      weight,
      codAmount,
    });

    const smsaResult = await createSMSAB2CShipment({
      OrderNumber: shipmentReference,
      DeclaredValue: declaredValue,
      Parcels: parcels,
      ShipDate: new Date().toISOString(),
      ShipmentCurrency: currency,
      Weight: weight,
      WeightUnit: 'KG',
      ContentDescription: contentDescription,
      ConsigneeAddress: consigneeAddress,
      ShipperAddress: shipperAddress,
      CODAmount: codAmount ?? undefined,
    });

    if (!smsaResult.success) {
      log.error('Manual SMSA shipment creation failed', {
        orderNumber,
        error: smsaResult.error,
        response: smsaResult.rawResponse,
      });
      return NextResponse.json(
        { error: smsaResult.error || 'تعذر إنشاء الشحنة مع شركة الشحن' },
        { status: 502 },
      );
    }

    const smsaLabelBase64 = extractSmsaLabelBase64(smsaResult.rawResponse);
    const smsaLabelDataUrl = buildSmsaLabelDataUrl(smsaLabelBase64);
    const tracking = smsaResult.trackingNumber || smsaResult.awbNumber || smsaResult.sawb || null;

    const createdShipment = await prisma.manualSmsaShipment.create({
      data: {
        merchantId,
        orderId: order.id ? String(order.id) : null,
        orderNumber: resolveOrderReference(order, orderNumber),
        customerName: consigneeAddress.ContactName,
        customerPhone: consigneeAddress.ContactPhoneNumber,
        customerEmail: order.customer?.email ? String(order.customer.email) : null,
        addressLine1: consigneeAddress.AddressLine1,
        addressLine2: consigneeAddress.AddressLine2,
        city: consigneeAddress.City,
        country: consigneeAddress.Country,
        district: consigneeAddress.District,
        postalCode: consigneeAddress.PostalCode,
        shortCode: consigneeAddress.ShortCode,
        declaredValue,
        currency,
        parcels,
        weight,
        weightUnit: 'KG',
        contentDescription,
        codAmount,
        shipmentItems: toJsonValue(shipmentItems),
        orderSnapshot: toJsonValue(order),
        consigneeAddress: toJsonValue(consigneeAddress),
        shipperAddress: toJsonValue(shipperAddress),
        status: 'created',
        smsaAwbNumber: smsaResult.sawb || null,
        smsaTrackingNumber: tracking,
        smsaResponse: smsaResult.rawResponse as any,
        smsaLabelDataUrl,
        createdById: user?.id || null,
        createdByName: user?.name || (user as any)?.username || null,
      },
    });

    log.info('Manual SMSA shipment stored', {
      id: createdShipment.id,
      trackingNumber: createdShipment.smsaTrackingNumber,
    });

    return NextResponse.json({
      success: true,
      shipment: serializeManualSmsaShipment(createdShipment),
    });
  } catch (error) {
    log.error('Failed to create manual SMSA shipment', { error });
    return NextResponse.json(
      { error: 'تعذر إنشاء الشحنة اليدوية، حاول مرة أخرى.' },
      { status: 500 },
    );
  }
}
