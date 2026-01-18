import { NextRequest, NextResponse } from 'next/server';
import { Prisma, type HighPriorityOrder, type OrderAssignment, type OrderGiftFlag } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { ACTIVE_ASSIGNMENT_STATUS_VALUES } from '@/lib/order-assignment-statuses';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { fetchSallaWithRetry } from '@/app/lib/fetch-with-retry';

export const runtime = 'nodejs';
const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const SALLA_API_BASE_URL = 'https://api.salla.dev/admin/v2';
const MAX_CONCURRENT_SALLA_REQUESTS = 4;
const SALLA_FETCH_TIMEOUT_MS = 12000;

type AssignmentWithUser = OrderAssignment & {
  user: {
    id: string;
    name: string | null;
    username: string | null;
  };
};

const extractHttpUrl = (value: unknown): string | null => {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  }

  if (typeof value === 'object') {
    const candidate =
      (value as Record<string, unknown>)?.url ??
      (value as Record<string, unknown>)?.href ??
      (value as Record<string, unknown>)?.link ??
      (value as Record<string, unknown>)?.value ??
      null;
    return extractHttpUrl(candidate);
  }

  return null;
};

const findUrlInsideText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
};

const getShipmentLabelUrl = (orderData: any): string | null => {
  if (!orderData || typeof orderData !== 'object') {
    return null;
  }

  const shipping = (orderData as any)?.shipping || {};
  const delivery = (orderData as any)?.delivery || {};
  const shipments = Array.isArray((orderData as any)?.shipments) ? (orderData as any).shipments : [];
  const shippingShipments = Array.isArray(shipping?.shipments) ? shipping.shipments : [];

  const candidateValues: unknown[] = [
    delivery?.label_url,
    delivery?.labelUrl,
    delivery?.label?.url,
    delivery?.label,
    shipping?.label_url,
    shipping?.labelUrl,
    shipping?.label?.url,
    shipping?.label,
    shipping?.shipment?.label_url,
    shipping?.shipment?.labelUrl,
    shipping?.shipment?.label?.url,
    shipping?.shipment?.label,
    shipping?.shipment?.url,
    shipping?.shipment_url,
    shipping?.shipmentUrl,
    shipping?.tracking_url,
    shipping?.trackingUrl,
    shipping?.tracking_link,
    shipping?.trackingLink,
  ];

  shipments.forEach((shipment: any) => {
    candidateValues.push(
      shipment?.label_url,
      shipment?.labelUrl,
      shipment?.label?.url,
      shipment?.label,
      shipment?.url,
      shipment?.shipment_url,
      shipment?.shipmentUrl,
      shipment?.tracking_url,
      shipment?.trackingUrl,
      shipment?.tracking_link,
      shipment?.trackingLink,
    );
  });

  shippingShipments.forEach((shipment: any) => {
    candidateValues.push(
      shipment?.label_url,
      shipment?.labelUrl,
      shipment?.label?.url,
      shipment?.label,
      shipment?.url,
      shipment?.shipment_url,
      shipment?.shipmentUrl,
      shipment?.tracking_url,
      shipment?.trackingUrl,
      shipment?.tracking_link,
      shipment?.trackingLink,
    );
  });

  for (const candidate of candidateValues) {
    const url = extractHttpUrl(candidate);
    if (url) {
      return url;
    }
  }

  const notesUrl =
    extractHttpUrl((orderData as any)?.notes) ||
    findUrlInsideText((orderData as any)?.notes);
  if (notesUrl) {
    return notesUrl;
  }

  return null;
};

const getOrderStatusSlug = (orderData: any): string | null => {
  if (!orderData || typeof orderData !== 'object') {
    return null;
  }

  const status = (orderData as any)?.status;

  if (typeof status === 'string') {
    return status;
  }

  if (typeof status === 'object' && status !== null) {
    const candidates = [
      (status as any).slug,
      (status as any).code,
      (status as any).status,
      (status as any).name,
      (status as any).label,
      (status as any).id,
    ];

    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined) continue;
      return typeof candidate === 'string' ? candidate : candidate.toString();
    }
  }

  const fallbackCandidates = [
    (orderData as any)?.status_id,
    (orderData as any)?.statusId,
    (orderData as any)?.shipping?.status?.slug,
    (orderData as any)?.shipping?.status?.name,
  ];

  for (const candidate of fallbackCandidates) {
    if (candidate === null || candidate === undefined) continue;
    return typeof candidate === 'string' ? candidate : candidate.toString();
  }

  return null;
};

const calculateDurationMinutes = (assignment: { startedAt: Date | null; assignedAt: Date }): number | null => {
  const start = assignment.startedAt || assignment.assignedAt;
  if (!start) {
    return null;
  }

  const now = new Date();
  const diff = now.getTime() - start.getTime();
  if (Number.isNaN(diff) || diff < 0) {
    return null;
  }

  return Math.floor(diff / 60000);
};

const fetchOrderDetailsWithItems = async (orderId: string, accessToken: string) => {
  const detailUrl = `${SALLA_API_BASE_URL}/orders/${encodeURIComponent(orderId)}`;
  const detailResponse = await fetchSallaWithRetry(detailUrl, accessToken, {
    timeoutMs: SALLA_FETCH_TIMEOUT_MS,
  });

  if (!detailResponse.ok) {
    const errorText = await detailResponse.text();
    throw new Error(`فشل جلب تفاصيل الطلب ${orderId} من سلة: ${detailResponse.status} ${errorText}`);
  }

  const detailData = await detailResponse.json();
  const orderDetail = detailData.data;

  if (!orderDetail) {
    throw new Error(`الاستجابة من سلة لا تحتوي على بيانات الطلب ${orderId}`);
  }

  try {
    const itemsUrl = `${SALLA_API_BASE_URL}/orders/items?order_id=${encodeURIComponent(orderId)}`;
    const itemsResponse = await fetchSallaWithRetry(itemsUrl, accessToken, {
      timeoutMs: SALLA_FETCH_TIMEOUT_MS,
    });

    if (itemsResponse.ok) {
      const itemsData = await itemsResponse.json();
      orderDetail.items = itemsData.data || [];
    } else {
      const errorText = await itemsResponse.text();
      log.warn('Failed to fetch order items from Salla', {
        orderId,
        status: itemsResponse.status,
        error: errorText,
      });
      orderDetail.items = Array.isArray(orderDetail.items) ? orderDetail.items : [];
    }
  } catch (error) {
    log.warn('Failed to fetch order items from Salla', { orderId, error });
    orderDetail.items = Array.isArray(orderDetail.items) ? orderDetail.items : [];
  }

  return orderDetail;
};

const autoCompleteAssignmentDueToLabel = async ({
  assignment,
  orderData,
  finalSallaStatus,
  labelUrl,
}: {
  assignment: AssignmentWithUser;
  orderData: Prisma.InputJsonValue | null;
  finalSallaStatus?: string | null;
  labelUrl?: string | null;
}) => {
  const finishedAt = new Date();
  const durationMinutes = calculateDurationMinutes({
    startedAt: assignment.startedAt,
    assignedAt: assignment.assignedAt,
  });
  const dataToPersist =
    orderData !== null && orderData !== undefined
      ? orderData
      : ((assignment.orderData ?? Prisma.JsonNull) as Prisma.InputJsonValue);
  const resolvedStatus = finalSallaStatus ?? assignment.sallaStatus ?? null;

  await prisma.$transaction([
    prisma.orderHistory.create({
      data: {
        userId: assignment.userId,
        userName: assignment.user?.name || assignment.user?.username || assignment.userId,
        merchantId: assignment.merchantId,
        orderId: assignment.orderId,
        orderNumber: assignment.orderNumber,
        orderData: dataToPersist,
        status: 'completed',
        assignedAt: assignment.assignedAt,
        startedAt: assignment.startedAt,
        finishedAt,
        durationMinutes,
        finalSallaStatus: resolvedStatus,
        notes: assignment.notes,
      },
    }),
    prisma.orderAssignment.update({
      where: { id: assignment.id },
      data: {
        status: 'completed',
        completedAt: finishedAt,
        orderData: dataToPersist,
        sallaStatus: resolvedStatus,
      },
    }),
  ]);

  log.info('Auto-completed assignment because shipment label already exists', {
    assignmentId: assignment.id,
    orderId: assignment.orderId,
    labelUrl,
    resolvedStatus,
    durationMinutes,
  });
};

/**
 * GET /api/order-assignments/my-orders
 * Get orders assigned to a specific user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const status = searchParams.get('status'); // optional filter

    if (!userId) {
      return NextResponse.json(
        { error: 'معرف المستخدم مطلوب' },
        { status: 400 }
      );
    }

    const where: any = {
      userId,
    };

    if (status) {
      where.status = status;
    } else {
      // Default: show active assignments including shipped orders
      where.status = {
        in: ACTIVE_ASSIGNMENT_STATUS_VALUES,
      };
    }

    const assignments = (await prisma.orderAssignment.findMany({
      where,
      orderBy: {
        assignedAt: 'asc', // Oldest first (FIFO)
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    })) as AssignmentWithUser[];

    const orderIds = assignments.map((assignment) => assignment.orderId);
    let priorityMap = new Map<string, HighPriorityOrder>();
    let giftFlagMap = new Map<string, OrderGiftFlag>();

    if (orderIds.length > 0) {
      const priorityOrders = await prisma.highPriorityOrder.findMany({
        where: {
          merchantId: MERCHANT_ID,
          orderId: { in: orderIds },
        },
      });
      priorityMap = new Map(priorityOrders.map((order) => [order.orderId, order]));
    }

    if (orderIds.length > 0) {
      const giftFlags = await prisma.orderGiftFlag.findMany({
        where: {
          merchantId: MERCHANT_ID,
          orderId: { in: orderIds },
        },
      });
      giftFlagMap = new Map(giftFlags.map((flag) => [flag.orderId, flag]));
    }

    const autoCompletedAssignments: string[] = [];
    const assignmentsWithLiveData: AssignmentWithUser[] = [];

    if (assignments.length > 0) {
      const accessToken = await getSallaAccessToken(MERCHANT_ID);

      if (!accessToken) {
        return NextResponse.json(
          { error: 'فشل الحصول على بيانات الطلب من سلة' },
          { status: 502 }
        );
      }

      const results = await runWithConcurrency<AssignmentWithUser, AssignmentProcessResult>(
        assignments,
        MAX_CONCURRENT_SALLA_REQUESTS,
        async (assignment) => {
          try {
            const orderData = await fetchOrderDetailsWithItems(assignment.orderId, accessToken);
            const sallaStatus = getOrderStatusSlug(orderData) || assignment.sallaStatus;
            const labelUrl = getShipmentLabelUrl(orderData);

            if (labelUrl) {
              await autoCompleteAssignmentDueToLabel({
                assignment,
                orderData: orderData as Prisma.InputJsonValue,
                finalSallaStatus: sallaStatus,
                labelUrl,
              });
              return { type: 'auto-completed', assignmentId: assignment.id } as const;
            }

            await prisma.orderAssignment.update({
              where: { id: assignment.id },
              data: {
                orderData: orderData as Prisma.InputJsonValue,
                sallaStatus,
              },
            });

            return {
              type: 'updated',
              assignment: {
                ...assignment,
                orderData,
                sallaStatus: sallaStatus ?? null,
              },
            } as const;
          } catch (error) {
            log.error('Failed to fetch live order data from Salla', {
              assignmentId: assignment.id,
              orderId: assignment.orderId,
              error,
            });
            throw error;
          }
        }
      );

      results.forEach((result) => {
        if (result.type === 'auto-completed') {
          autoCompletedAssignments.push(result.assignmentId);
        } else if (result.type === 'updated') {
          assignmentsWithLiveData.push(result.assignment);
        }
      });
    }

    const enrichedAssignments = assignmentsWithLiveData
      .map((assignment) => {
        const priority = priorityMap.get(assignment.orderId);
        const giftFlag = giftFlagMap.get(assignment.orderId);
        const { user: _user, ...publicAssignment } = assignment;
        void _user;
        return {
          ...publicAssignment,
          isHighPriority: Boolean(priority),
          highPriorityReason: priority?.reason || null,
          highPriorityNotes: priority?.notes || null,
          highPriorityMarkedAt: priority?.createdAt || null,
          highPriorityMarkedBy: priority?.createdByName || priority?.createdByUsername || null,
          hasGiftFlag: Boolean(giftFlag),
          giftFlagReason: giftFlag?.reason || null,
          giftFlagNotes: giftFlag?.notes || null,
          giftFlagMarkedAt: giftFlag?.createdAt || null,
          giftFlagMarkedBy: giftFlag?.createdByName || giftFlag?.createdByUsername || null,
        };
      })
      .sort((a, b) => {
        if (a.isHighPriority && !b.isHighPriority) return -1;
        if (!a.isHighPriority && b.isHighPriority) return 1;
        return new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime();
      });

    return NextResponse.json({
      success: true,
      assignments: enrichedAssignments,
      autoCompletedAssignments,
    });

  } catch (error) {
    log.error('Error fetching user orders', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الطلبات' },
      { status: 500 }
    );
  }
}

type AssignmentProcessResult =
  | { type: 'auto-completed'; assignmentId: string }
  | { type: 'updated'; assignment: AssignmentWithUser };

const runWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) {
    return [];
  }

  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    (async () => {
      while (true) {
        const index = currentIndex++;
        if (index >= items.length) {
          break;
        }
        results[index] = await worker(items[index], index);
      }
    })()
  );

  await Promise.all(workers);
  return results;
};
