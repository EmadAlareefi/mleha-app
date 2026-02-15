import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import type { OrderPrepUnavailableItem } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const REQUIRED_SERVICES = ['order-prep', 'order-shortages'] as const;

const normalizeSku = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const stringValue =
    typeof value === 'string' || typeof value === 'number'
      ? value.toString()
      : typeof value === 'boolean'
        ? value
          ? 'TRUE'
          : 'FALSE'
        : '';
  return stringValue.trim().toUpperCase();
};

const hasUnavailableAccess = (session: any | null): boolean => {
  return REQUIRED_SERVICES.some((service) => hasServiceAccess(session, service));
};

const serializeRecord = (record: OrderPrepUnavailableItem) => ({
  id: record.id,
  merchantId: record.merchantId,
  orderId: record.orderId,
  orderNumber: record.orderNumber,
  sku: record.sku,
  normalizedSku: record.normalizedSku,
  itemName: record.itemName,
  reportedById: record.reportedById,
  reportedByName: record.reportedByName,
  createdAt: record.createdAt.toISOString(),
  resolvedAt: record.resolvedAt ? record.resolvedAt.toISOString() : null,
  resolvedById: record.resolvedById,
  resolvedByName: record.resolvedByName,
});

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user || !hasUnavailableAccess(session)) {
    return NextResponse.json({ error: 'ليست لديك صلاحية للوصول' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId')?.trim();
    const includeResolved = searchParams.get('includeResolved') === 'true';

    const where: any = { merchantId: MERCHANT_ID };

    if (orderId) {
      where.orderId = orderId;
    }

    if (!includeResolved) {
      where.resolvedAt = null;
    }

    const records = await prisma.orderPrepUnavailableItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: records.map(serializeRecord) });
  } catch (error) {
    log.error('Failed to load unavailable items', { error });
    return NextResponse.json({ error: 'تعذر جلب النواقص' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user || !hasUnavailableAccess(session)) {
    return NextResponse.json({ error: 'ليست لديك صلاحية للوصول' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    const orderNumber =
      typeof body?.orderNumber === 'string' ? body.orderNumber.trim() : '';
    const skuInput =
      typeof body?.sku === 'string' || typeof body?.sku === 'number'
        ? body.sku.toString()
        : '';
    const itemName =
      typeof body?.itemName === 'string' ? body.itemName.trim().slice(0, 200) : '';

    const skuRaw = skuInput.trim();
    const normalizedSku = normalizeSku(skuInput);

    if (!orderId || !normalizedSku) {
      return NextResponse.json(
        { error: 'يجب إرسال رقم الطلب و SKU صالح' },
        { status: 400 },
      );
    }

    const record = await prisma.orderPrepUnavailableItem.upsert({
      where: {
        merchantId_orderId_normalizedSku: {
          merchantId: MERCHANT_ID,
          orderId,
          normalizedSku,
        },
      },
      update: {
        sku: skuRaw || normalizedSku,
        itemName: itemName || null,
        orderNumber: orderNumber || null,
        resolvedAt: null,
        resolvedById: null,
        resolvedByName: null,
      },
      create: {
        merchantId: MERCHANT_ID,
        orderId,
        orderNumber: orderNumber || null,
        sku: skuRaw || normalizedSku,
        normalizedSku,
        itemName: itemName || null,
        reportedById: (session.user as any)?.id || null,
        reportedByName:
          session.user.name ||
          (session.user as any)?.username ||
          (session.user as any)?.email ||
          null,
      },
    });

    return NextResponse.json({ success: true, data: serializeRecord(record) });
  } catch (error) {
    log.error('Failed to create unavailable item record', { error });
    return NextResponse.json({ error: 'تعذر حفظ سجل النواقص' }, { status: 500 });
  }
}
