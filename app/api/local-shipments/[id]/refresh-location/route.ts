import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaOrder } from '@/app/lib/salla-api';
import { buildOrderItemsPayload, normalizeOrderItems } from '@/app/lib/local-shipping/serializer';

const MAPS_SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query=';

const isAdminSession = (sessionUser: any) => {
  const roles: string[] = Array.isArray(sessionUser?.roles) ? sessionUser.roles : [];
  const serviceKeys: string[] = Array.isArray(sessionUser?.serviceKeys)
    ? sessionUser.serviceKeys
    : [];
  return (
    roles.includes('admin') ||
    serviceKeys.includes('admin') ||
    sessionUser?.role === 'admin'
  );
};

const extractLocationCode = (value?: string | null) => {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const firstSegment = trimmed.split(',')[0]?.trim();
  if (!firstSegment) return null;
  return /^[A-Za-z0-9]+$/.test(firstSegment) ? firstSegment : null;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !isAdminSession(session.user)) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { id } = await params;
    const shipment = await prisma.localShipment.findUnique({
      where: { id },
      select: { id: true, merchantId: true, orderId: true, orderItems: true },
    });

    if (!shipment) {
      return NextResponse.json({ error: 'الشحنة غير موجودة' }, { status: 404 });
    }

    if (!shipment.orderId || !shipment.merchantId) {
      return NextResponse.json(
        { error: 'لا توجد بيانات طلب مرتبطة بهذه الشحنة' },
        { status: 400 }
      );
    }

    const order = await getSallaOrder(shipment.merchantId, shipment.orderId);
    if (!order) {
      return NextResponse.json(
        { error: 'تعذر جلب بيانات الطلب من سلة' },
        { status: 502 }
      );
    }

    const locationText =
      typeof order.customer?.location === 'string'
        ? order.customer.location.trim()
        : '';
    if (!locationText) {
      return NextResponse.json(
        { error: 'لا يحتوي الطلب على موقع العميل' },
        { status: 404 }
      );
    }

    const locationCode = extractLocationCode(locationText);
    const normalized = normalizeOrderItems(shipment.orderItems);
    const updatedMeta = {
      ...normalized.meta,
      shipToLocationText: locationText,
      shipToLocationCode: locationCode || null,
      mapsLink:
        normalized.meta?.mapsLink ||
        (locationCode ? `${MAPS_SEARCH_BASE}${encodeURIComponent(locationCode)}` : normalized.meta?.mapsLink),
    };
    const updatedOrderItems = buildOrderItemsPayload(normalized.items, updatedMeta);

    await prisma.localShipment.update({
      where: { id: shipment.id },
      data: { orderItems: updatedOrderItems },
    });

    return NextResponse.json({
      success: true,
      locationText,
      locationCode,
      mapsLink: updatedMeta.mapsLink || null,
    });
  } catch (error) {
    log.error('Error refreshing Salla location for local shipment', {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تحديث الموقع' },
      { status: 500 }
    );
  }
}
