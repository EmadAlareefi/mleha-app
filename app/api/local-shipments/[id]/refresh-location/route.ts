import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaOrder } from '@/app/lib/salla-api';
import { buildOrderItemsPayload, normalizeOrderItems } from '@/app/lib/local-shipping/serializer';
import { withStoredShippingSnapshot } from '@/app/lib/local-shipping/order-shipping-snapshot';
import { extractShipToLocation } from '@/app/lib/local-shipping/ship-to-location';

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
  const firstSegment = trimmed.split(/[,،]/u)[0]?.trim();
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

    const liveOrder = await getSallaOrder(shipment.merchantId, shipment.orderId);
    if (!liveOrder) {
      return NextResponse.json(
        { error: 'تعذر جلب بيانات الطلب من سلة' },
        { status: 502 }
      );
    }
    const order = await withStoredShippingSnapshot(shipment.merchantId, liveOrder);

    const locationText =
      typeof order.customer?.location === 'string'
        ? order.customer.location.trim()
        : '';
    const shipToLocation = extractShipToLocation(order);
    if (!locationText && !shipToLocation) {
      return NextResponse.json(
        { error: 'لا يحتوي الطلب على موقع العميل' },
        { status: 404 }
      );
    }

    const locationCode = extractLocationCode(locationText);
    const normalized = normalizeOrderItems(shipment.orderItems);
    const updatedMeta = {
      ...normalized.meta,
      shipToLocationText: locationText || normalized.meta?.shipToLocationText,
      shipToLocationCode: locationCode || normalized.meta?.shipToLocationCode,
      shipToLatitude: shipToLocation?.latitude ?? normalized.meta?.shipToLatitude,
      shipToLongitude: shipToLocation?.longitude ?? normalized.meta?.shipToLongitude,
      shipToBuildingNumber: shipToLocation?.buildingNumber ?? normalized.meta?.shipToBuildingNumber,
      shipToStreet: shipToLocation?.street ?? normalized.meta?.shipToStreet,
      shipToDistrict: normalized.meta?.shipToDistrict ?? shipToLocation?.district ?? undefined,
      shipToShortAddress: shipToLocation?.shortAddress ?? normalized.meta?.shipToShortAddress,
      shipToAddressNote: shipToLocation?.addressNote ?? normalized.meta?.shipToAddressNote,
    };
    const updatedOrderItems = buildOrderItemsPayload(normalized.items, updatedMeta);

    await prisma.localShipment.update({
      where: { id: shipment.id },
      data: { orderItems: updatedOrderItems },
    });

    return NextResponse.json({
      success: true,
      meta: updatedMeta,
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
