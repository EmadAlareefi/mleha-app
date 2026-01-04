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

  const returnRequest = await prisma.returnRequest.findFirst({
    where: { OR: filters },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!returnRequest) {
    return NextResponse.json(
      { error: 'لم يتم العثور على شحنة الإرجاع' },
      { status: 404 }
    );
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
