import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSallaOrder } from '@/app/lib/salla-api';
import { log } from '@/app/lib/logger';
import {
  ReturnItemCondition,
  summarizeItemConditions,
  isReturnItemCondition,
} from '@/app/lib/returns/inspection';
import { maybeReleaseExchangeOrderHold } from '@/app/lib/returns/exchange-order';

export const runtime = 'nodejs';

const ALLOWED_ROLES = ['admin', 'warehouse'];

type InspectItemPayload = {
  itemId: string;
  conditionStatus?: ReturnItemCondition | null;
  conditionNotes?: string | null;
};

type ReturnRequestWithItems = Prisma.ReturnRequestGetPayload<{
  include: { items: true };
}>;

const canAccess = (session: any) => {
  const role = (session?.user as any)?.role;
  const roles: string[] =
    ((session?.user as any)?.roles as string[]) ||
    (role ? [role] : []);
  return roles.some((r) => ALLOWED_ROLES.includes(r));
};

const buildFilters = (raw: {
  query?: string | null;
  trackingNumber?: string | null;
  orderNumber?: string | null;
  returnRequestId?: string | null;
  orderId?: string | null;
}): Prisma.ReturnRequestWhereInput[] => {
  const filters: Prisma.ReturnRequestWhereInput[] = [];

  const normalized = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, value?.trim() || null])
  );

  const pushTracking = (value: string) => {
    const compact = value.replace(/\s+/g, '');
    filters.push(
      { smsaTrackingNumber: value },
      { smsaTrackingNumber: { equals: value, mode: 'insensitive' } },
      { smsaTrackingNumber: compact }
    );
  };

  const pushOrderNumber = (value: string) => {
    const withoutHash = value.startsWith('#') ? value.slice(1) : value;
    filters.push(
      { orderNumber: value },
      { orderNumber: { equals: value, mode: 'insensitive' } },
      { orderNumber: withoutHash },
      { orderNumber: { equals: withoutHash, mode: 'insensitive' } }
    );
  };

  if (normalized.query) {
    pushTracking(normalized.query);
    pushOrderNumber(normalized.query);
    filters.push(
      { id: normalized.query },
      { orderId: normalized.query }
    );
  }

  if (normalized.trackingNumber) {
    pushTracking(normalized.trackingNumber);
  }

  if (normalized.orderNumber) {
    pushOrderNumber(normalized.orderNumber);
  }

  if (normalized.returnRequestId) {
    filters.push({ id: normalized.returnRequestId });
  }

  if (normalized.orderId) {
    filters.push({ orderId: normalized.orderId });
  }

  return filters;
};

const normalizeLookupValue = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized || null;
};

const extractTrackingFromUrl = (value: string) => {
  try {
    const url = new URL(value);
    for (const key of ['tracking_number', 'trackingNumber', 'tracking_no', 'awb_number', 'awb']) {
      const candidate = normalizeLookupValue(url.searchParams.get(key));
      if (candidate) {
        return candidate;
      }
    }

    const pathCandidate = normalizeLookupValue(url.pathname.split('/').filter(Boolean).pop());
    return pathCandidate;
  } catch {
    return null;
  }
};

const buildTrackingLookupValues = (...values: Array<string | null | undefined>) => {
  const candidates = new Set<string>();

  for (const value of values) {
    const normalized = normalizeLookupValue(value);
    if (!normalized) {
      continue;
    }

    candidates.add(normalized);

    const compact = normalized.replace(/\s+/g, '');
    if (compact) {
      candidates.add(compact);
    }

    const fromUrl = extractTrackingFromUrl(normalized);
    if (fromUrl) {
      candidates.add(fromUrl);
      const compactFromUrl = fromUrl.replace(/\s+/g, '');
      if (compactFromUrl) {
        candidates.add(compactFromUrl);
      }
    }
  }

  return Array.from(candidates);
};

const findSallaShipmentByTracking = async (trackingValues: string[]) => {
  const shipmentFilters: Prisma.SallaShipmentWhereInput[] = trackingValues.flatMap((value) => [
    { trackingNumber: { equals: value, mode: 'insensitive' } },
    { awbNumber: { equals: value, mode: 'insensitive' } },
    { sawb: { equals: value, mode: 'insensitive' } },
  ]);

  const shipment = await prisma.sallaShipment.findFirst({
    where: { OR: shipmentFilters },
    orderBy: { updatedAt: 'desc' },
  });

  if (shipment) {
    return {
      shipment,
      matchedTrackingNumber: shipment.trackingNumber || shipment.awbNumber || shipment.sawb || null,
    };
  }

  for (const value of trackingValues.filter((candidate) => candidate.length >= 5)) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id
        FROM "SallaShipment"
        WHERE "shipmentData"::text ILIKE ${`%${value}%`}
        ORDER BY "updatedAt" DESC
        LIMIT 1
      `
    );

    const matchedId = rows[0]?.id;
    if (!matchedId) {
      continue;
    }

    const jsonMatchedShipment = await prisma.sallaShipment.findUnique({
      where: { id: matchedId },
    });

    if (jsonMatchedShipment) {
      return {
        shipment: jsonMatchedShipment,
        matchedTrackingNumber: value,
      };
    }
  }

  return null;
};

const findReturnRequestFromSallaShipment = async (
  trackingValues: string[]
): Promise<{ returnRequest: ReturnRequestWithItems; trackingNumber: string | null } | null> => {
  if (trackingValues.length === 0) {
    return null;
  }

  const shipmentMatch = await findSallaShipmentByTracking(trackingValues);
  if (!shipmentMatch) {
    return null;
  }

  const { shipment, matchedTrackingNumber } = shipmentMatch;
  const returnRequest = await prisma.returnRequest.findFirst({
    where: {
      merchantId: shipment.merchantId,
      OR: [
        { orderId: shipment.orderId },
        { orderNumber: shipment.orderId },
        { orderId: shipment.orderNumber },
        { orderNumber: shipment.orderNumber },
      ],
    },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!returnRequest) {
    return null;
  }

  return {
    returnRequest,
    trackingNumber: matchedTrackingNumber,
  };
};

const backfillReturnTrackingNumber = async (
  returnRequest: ReturnRequestWithItems,
  trackingNumber: string | null
) => {
  if (returnRequest.smsaTrackingNumber || !trackingNumber) {
    return returnRequest;
  }

  try {
    return await prisma.returnRequest.update({
      where: { id: returnRequest.id },
      data: { smsaTrackingNumber: trackingNumber },
      include: { items: true },
    });
  } catch (error) {
    log.warn('Failed to backfill return request tracking number from Salla shipment', {
      returnRequestId: returnRequest.id,
      trackingNumber,
      error,
    });
    return returnRequest;
  }
};

const toInspectableItems = (
  items: Array<{ quantity: number | null; conditionStatus: string | null }>
) =>
  items.map((item) => ({
    quantity: item.quantity,
    conditionStatus: isReturnItemCondition(item.conditionStatus)
      ? item.conditionStatus
      : null,
  }));

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAccess(session)) {
    return NextResponse.json(
      { error: 'غير مصرح بالوصول' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const filters = buildFilters({
    query: searchParams.get('query'),
    trackingNumber: searchParams.get('trackingNumber'),
    orderNumber: searchParams.get('orderNumber'),
    returnRequestId: searchParams.get('returnRequestId'),
    orderId: searchParams.get('orderId'),
  });

  if (filters.length === 0) {
    return NextResponse.json(
      { error: 'يرجى إدخال رقم التتبع أو الطلب' },
      { status: 400 }
    );
  }

  let returnRequest = await prisma.returnRequest.findFirst({
    where: { OR: filters },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!returnRequest) {
    const sallaShipmentMatch = await findReturnRequestFromSallaShipment(
      buildTrackingLookupValues(searchParams.get('query'), searchParams.get('trackingNumber'))
    );

    if (sallaShipmentMatch) {
      returnRequest = await backfillReturnTrackingNumber(
        sallaShipmentMatch.returnRequest,
        sallaShipmentMatch.trackingNumber
      );
    } else {
      return NextResponse.json(
        { error: 'لم يتم العثور على شحنة الإرجاع' },
        { status: 404 }
      );
    }
  }

  let sallaOrder = null;
  try {
    sallaOrder = await getSallaOrder(
      returnRequest.merchantId,
      returnRequest.orderId
    );
  } catch (error) {
    log.error('Failed to fetch Salla order for inspection', {
      returnRequestId: returnRequest.id,
      error,
    });
  }

  const summary = summarizeItemConditions(toInspectableItems(returnRequest.items));

  return NextResponse.json({
    success: true,
    returnRequest,
    sallaOrder,
    inspectionSummary: summary,
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAccess(session)) {
    return NextResponse.json(
      { error: 'غير مصرح بالوصول' },
      { status: 401 }
    );
  }

  const body = await request.json();
  const { returnRequestId, items } = body as {
    returnRequestId?: string;
    items?: InspectItemPayload[];
  };

  if (!returnRequestId || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: 'بيانات الفحص غير مكتملة' },
      { status: 400 }
    );
  }

  const requestRecord = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: { items: true },
  });

  if (!requestRecord) {
    return NextResponse.json(
      { error: 'طلب الإرجاع غير موجود' },
      { status: 404 }
    );
  }

  const validIds = new Set(requestRecord.items.map((item) => item.id));

  for (const item of items) {
    if (!item.itemId || !validIds.has(item.itemId)) {
      return NextResponse.json(
        { error: 'العنصر المحدد غير مرتبط بطلب الإرجاع' },
        { status: 400 }
      );
    }

    if (item.conditionStatus && !isReturnItemCondition(item.conditionStatus)) {
      return NextResponse.json(
        { error: 'حالة الفحص غير معروفة' },
        { status: 400 }
      );
    }
  }

  const inspector =
    (session.user as any)?.name ||
    (session.user as any)?.username ||
    (session.user as any)?.id ||
    'system';

  const now = new Date();

  await prisma.$transaction(
    items.map((item) =>
      prisma.returnItem.update({
        where: { id: item.itemId },
        data: {
          conditionStatus: item.conditionStatus ?? null,
          conditionNotes: item.conditionNotes?.trim()
            ? item.conditionNotes.trim().slice(0, 1000)
            : null,
          inspectedBy: item.conditionStatus ? inspector : null,
          inspectedAt: item.conditionStatus ? now : null,
        },
      })
    )
  );

  const updatedRequest = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: { items: true },
  });

  if (!updatedRequest) {
    return NextResponse.json(
      { error: 'تعذر تحديث بيانات طلب الإرجاع' },
      { status: 500 }
    );
  }

  if (updatedRequest.type === 'exchange') {
    await maybeReleaseExchangeOrderHold(updatedRequest.id);
  }

  const summary = summarizeItemConditions(toInspectableItems(updatedRequest.items));

  return NextResponse.json({
    success: true,
    returnRequest: updatedRequest,
    inspectionSummary: summary,
  });
}
