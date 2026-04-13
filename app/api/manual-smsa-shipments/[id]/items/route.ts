import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getSallaOrderByReference,
  getSallaProductBySku,
  type SallaOrderItem,
} from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import {
  parseManualShipmentItems,
  serializeManualSmsaShipment,
} from '@/app/lib/manual-smsa/serializer';
import type { ManualSmsaShipmentItem } from '@/app/lib/manual-smsa/types';

export const runtime = 'nodejs';

const DEFAULT_ITEM_WEIGHT = 0.5;

interface AddShipmentItemsPayload {
  orderItems?: Array<{ id: number; quantity: number }>;
  skuItems?: Array<{ sku: string; quantity: number }>;
  replace?: boolean;
}

const safeNumber = (value: unknown): number | null => {
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

const normalizeQuantity = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : 0;
};

const normalizeOrderItem = (item: SallaOrderItem, quantity: number): ManualSmsaShipmentItem => {
  const safeQuantity = normalizeQuantity(quantity);
  const lineQuantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
  const lineTotal = safeNumber(item.amounts?.total?.amount);
  const unitPrice =
    lineQuantity > 0 && lineTotal != null
      ? Number((lineTotal / lineQuantity).toFixed(2))
      : lineTotal;
  const totalForSelection =
    unitPrice != null ? Number((unitPrice * safeQuantity).toFixed(2)) : null;

  return {
    id: item.id,
    productId: item.product?.id ?? item.id,
    variantId: item.variant?.id ?? null,
    name: item.name || item.product?.name || `Item ${item.id}`,
    sku: item.sku || item.product?.sku || null,
    quantity: safeQuantity,
    price: unitPrice ?? null,
    weight: safeNumber(item.weight) ?? DEFAULT_ITEM_WEIGHT,
    source: 'order',
    total: totalForSelection,
  };
};

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const shipmentId = params.id;
  if (!shipmentId) {
    return NextResponse.json({ error: 'معرف الشحنة مطلوب' }, { status: 400 });
  }

  try {
    const payload = (await request.json()) as AddShipmentItemsPayload;
    const orderItemsInput = Array.isArray(payload?.orderItems) ? payload.orderItems : [];
    const skuItemsInput = Array.isArray(payload?.skuItems) ? payload.skuItems : [];

    const normalizedOrderItems = orderItemsInput
      .map((item) => ({
        id: Number(item.id),
        quantity: normalizeQuantity(Number(item.quantity)),
      }))
      .filter((item) => Number.isFinite(item.id) && item.id > 0 && item.quantity > 0);

    const normalizedSkuItems = skuItemsInput
      .map((item) => ({
        sku: typeof item.sku === 'string' ? item.sku.trim() : '',
        quantity: normalizeQuantity(Number(item.quantity)),
      }))
      .filter((item) => item.sku && item.quantity > 0);

    if (normalizedOrderItems.length === 0 && normalizedSkuItems.length === 0) {
      return NextResponse.json(
        { error: 'يجب اختيار منتج واحد على الأقل لإضافته للشحنة' },
        { status: 400 },
      );
    }

    const shipment = await prisma.manualSmsaShipment.findUnique({
      where: { id: shipmentId },
    });

    if (!shipment || shipment.deletedAt) {
      return NextResponse.json({ error: 'الشحنة غير موجودة' }, { status: 404 });
    }

    const sallaOrder = await getSallaOrderByReference(shipment.merchantId, shipment.orderNumber);
    if (!sallaOrder) {
      return NextResponse.json(
        { error: 'تعذر الحصول على الطلب من سلة لإضافة المنتجات' },
        { status: 502 },
      );
    }

    const orderItemsMap = new Map<number, SallaOrderItem>();
    if (Array.isArray(sallaOrder.items)) {
      sallaOrder.items.forEach((item) => {
        if (typeof item.id === 'number') {
          orderItemsMap.set(item.id, item);
        }
      });
    }

    const newItems: ManualSmsaShipmentItem[] = [];

    normalizedOrderItems.forEach(({ id, quantity }) => {
      const orderItem = orderItemsMap.get(id);
      if (orderItem) {
        newItems.push(normalizeOrderItem(orderItem, quantity));
      }
    });

    for (const skuEntry of normalizedSkuItems) {
      const product = await getSallaProductBySku(shipment.merchantId, skuEntry.sku);
      if (!product) {
        log.warn('Salla product not found for manual shipment SKU', {
          shipmentId,
          sku: skuEntry.sku,
        });
        continue;
      }

      const price = safeNumber(
        product.priceAmount ?? (product as any)?.price?.amount ?? (product as any)?.price,
      );
      const weight = safeNumber((product as any)?.weight) ?? DEFAULT_ITEM_WEIGHT;

      newItems.push({
        id: product.id,
        productId: product.id,
        variantId: null,
        name: product.name,
        sku: product.sku || skuEntry.sku,
        quantity: skuEntry.quantity,
        price: price ?? null,
        weight,
        source: 'sku',
        total: price ? Number((price * skuEntry.quantity).toFixed(2)) : null,
      });
    }

    if (newItems.length === 0) {
      return NextResponse.json(
        { error: 'لم يتم العثور على أي منتجات صالحة في سلة لإضافتها' },
        { status: 422 },
      );
    }

    const existingItems = parseManualShipmentItems(shipment.shipmentItems);
    const nextItems = payload?.replace
      ? newItems
      : [...existingItems, ...newItems];

    const updated = await prisma.manualSmsaShipment.update({
      where: { id: shipment.id },
      data: {
        shipmentItems: nextItems as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      shipment: serializeManualSmsaShipment(updated),
    });
  } catch (error) {
    log.error('Failed to add items to manual SMSA shipment', { error, shipmentId });
    return NextResponse.json(
      { error: 'تعذر إضافة المنتجات إلى هذه الشحنة' },
      { status: 500 },
    );
  }
}
