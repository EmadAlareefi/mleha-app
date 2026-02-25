import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaOrder, getSallaOrderByReference } from '@/app/lib/salla-api';
import { getSallaOrderStatuses, getStatusBySlug } from '@/app/lib/salla-statuses';
import { updateSallaOrderStatus } from '@/app/lib/salla-order-status';
import { MAIN_STATUSES } from '@/SALLA_ORDER_STATUSES';

export const runtime = 'nodejs';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const FALLBACK_PREPARING_STATUS_ID =
  MAIN_STATUSES?.IN_PROGRESS?.originalId ||
  MAIN_STATUSES?.IN_PROGRESS?.id ||
  1939592358;

type OrderLookupResult = {
  orderId: string;
  orderNumber: string;
  orderData: Record<string, unknown>;
  statusSlug: string | null;
};

type AssignmentWithUser = Awaited<
  ReturnType<typeof prisma.orderAssignment.create>
> & {
  user?: {
    id: string;
    name: string | null;
    username: string | null;
  } | null;
};

const sanitizeIdentifier = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return value.toString().trim();
  }
  return '';
};

const extractStatusSlug = (order: Record<string, unknown> | null | undefined): string | null => {
  if (!order) {
    return null;
  }
  const status: any =
    (order as any).status ||
    (order as any).order_status ||
    (order as any).status_info ||
    null;

  if (!status) {
    return null;
  }

  if (typeof status === 'string') {
    return status;
  }

  if (typeof status === 'object') {
    const slugCandidate =
      status.slug ||
      status.code ||
      status.id ||
      status.status_id ||
      status.statusId;
    return slugCandidate ? String(slugCandidate) : null;
  }

  return null;
};

const buildAssignmentPayload = (assignment: AssignmentWithUser) => ({
  id: assignment.id,
  orderId: assignment.orderId,
  orderNumber: assignment.orderNumber,
  status: assignment.status,
  sallaStatus: assignment.sallaStatus,
  assignedUserId: assignment.userId,
  assignedUserName: assignment.user?.name || assignment.user?.username || 'غير معروف',
  assignedAt: assignment.assignedAt.toISOString(),
  startedAt: assignment.startedAt ? assignment.startedAt.toISOString() : null,
  completedAt: assignment.completedAt ? assignment.completedAt.toISOString() : null,
  orderData: assignment.orderData,
  notes: assignment.notes,
  assignmentState: 'assigned' as const,
});

const resolvePersistedOrder = async (
  orderId: string | null,
  orderNumber: string | null,
): Promise<OrderLookupResult | null> => {
  const normalizedOrderId = orderId?.trim() || null;
  const normalizedOrderNumber = orderNumber?.trim() || null;

  let record = null;

  if (normalizedOrderId) {
    record = await prisma.sallaOrder.findUnique({
      where: {
        merchantId_orderId: {
          merchantId: MERCHANT_ID,
          orderId: normalizedOrderId,
        },
      },
    });
  }

  if (!record && normalizedOrderNumber) {
    record = await prisma.sallaOrder.findFirst({
      where: {
        merchantId: MERCHANT_ID,
        OR: [
          { orderNumber: normalizedOrderNumber },
          { referenceId: normalizedOrderNumber },
        ],
      },
      orderBy: [
        { updatedAtRemote: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
  }

  if (!record) {
    return null;
  }

  const fallbackOrderNumber =
    normalizedOrderNumber || record.orderNumber || record.referenceId || record.orderId;

  const payload =
    (record.rawOrder as Record<string, unknown>) ||
    {
      id: record.orderId,
      reference_id: record.referenceId,
      order_number: record.orderNumber,
      status: {
        slug: record.statusSlug,
        name: record.statusName,
      },
      customer: {
        name: record.customerName,
        mobile: record.customerMobile,
        email: record.customerEmail,
      },
    };

  return {
    orderId: record.orderId,
    orderNumber: fallbackOrderNumber || record.orderId,
    orderData: payload,
    statusSlug: record.statusSlug || extractStatusSlug(payload),
  };
};

const fetchOrderData = async (
  rawOrderId: string | null,
  rawOrderNumber: string | null,
): Promise<OrderLookupResult | null> => {
  const normalizedOrderId = rawOrderId?.trim() || null;
  const normalizedOrderNumber = rawOrderNumber?.trim() || null;

  if (normalizedOrderId) {
    const remoteOrder = await getSallaOrder(MERCHANT_ID, normalizedOrderId).catch(() => null);
    if (remoteOrder) {
      return {
        orderId: String(remoteOrder.id ?? remoteOrder.order_id ?? normalizedOrderId),
        orderNumber:
          normalizedOrderNumber ||
          String(
            remoteOrder.order_number ??
              remoteOrder.reference_id ??
              remoteOrder.id ??
              normalizedOrderId,
          ),
        orderData: remoteOrder as Record<string, unknown>,
        statusSlug: extractStatusSlug(remoteOrder as unknown as Record<string, unknown>),
      };
    }
  }

  if (normalizedOrderNumber) {
    const remoteOrder = await getSallaOrderByReference(
      MERCHANT_ID,
      normalizedOrderNumber,
    ).catch(() => null);

    if (remoteOrder) {
      return {
        orderId: String(remoteOrder.id ?? remoteOrder.order_id ?? remoteOrder.reference_id),
        orderNumber:
          normalizedOrderNumber ||
          String(remoteOrder.order_number ?? remoteOrder.reference_id ?? remoteOrder.id),
        orderData: remoteOrder as Record<string, unknown>,
        statusSlug: extractStatusSlug(remoteOrder as unknown as Record<string, unknown>),
      };
    }
  }

  return resolvePersistedOrder(normalizedOrderId, normalizedOrderNumber);
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = sanitizeIdentifier(body?.userId);
    const orderIdInput = sanitizeIdentifier(body?.orderId);
    const orderNumberInput = sanitizeIdentifier(body?.orderNumber || body?.referenceId);

    if (!userId || (!orderIdInput && !orderNumberInput)) {
      return NextResponse.json(
        { error: 'المستخدم ورقم الطلب مطلوبة للتعيين' },
        { status: 400 },
      );
    }

    const user = await prisma.orderUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        isActive: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'المستخدم غير موجود' },
        { status: 404 },
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'لا يمكن التعيين لمستخدم غير نشط' },
        { status: 400 },
      );
    }

    const orderData = await fetchOrderData(orderIdInput || null, orderNumberInput || null);

    if (!orderData || !orderData.orderId) {
      return NextResponse.json(
        { error: 'تعذر العثور على بيانات الطلب من سلة' },
        { status: 404 },
      );
    }

    const existingAssignment = await prisma.orderAssignment.findUnique({
      where: {
        merchantId_orderId: {
          merchantId: MERCHANT_ID,
          orderId: orderData.orderId,
        },
      },
      select: {
        id: true,
        orderNumber: true,
        userId: true,
      },
    });

    if (existingAssignment) {
      return NextResponse.json(
        { error: 'هذا الطلب مرتبط بالفعل بمستخدم آخر، يرجى إزالة الارتباط أولاً' },
        { status: 409 },
      );
    }

    const statuses = await getSallaOrderStatuses(MERCHANT_ID);
    const preparingStatus = getStatusBySlug(statuses, 'in_progress');
    const preparingStatusId = preparingStatus?.id?.toString() || FALLBACK_PREPARING_STATUS_ID.toString();
    const parsedStatusId = Number.parseInt(preparingStatusId, 10);
    const resolvedPreparingStatusId = Number.isNaN(parsedStatusId)
      ? FALLBACK_PREPARING_STATUS_ID
      : parsedStatusId;

    const sallaUpdateResult = await updateSallaOrderStatus(MERCHANT_ID, orderData.orderId, {
      statusId: resolvedPreparingStatusId,
    });

    const assignment = await prisma.orderAssignment.create({
      data: {
        user: {
          connect: { id: user.id },
        },
        merchantId: MERCHANT_ID,
        orderId: orderData.orderId,
        orderNumber: orderData.orderNumber || orderData.orderId,
        orderData: (orderData.orderData ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        sallaStatus: sallaUpdateResult.success
          ? preparingStatus?.slug || MAIN_STATUSES.IN_PROGRESS.slug
          : orderData.statusSlug || extractStatusSlug(orderData.orderData) || null,
        sallaUpdated: sallaUpdateResult.success,
        status: 'assigned',
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
    });

    const payload = buildAssignmentPayload(assignment);
    const responseMessage = sallaUpdateResult.success
      ? 'تم تعيين الطلب وتحديث حالة سلة'
      : 'تم تعيين الطلب لكن تعذر تحديث حالة سلة، يرجى التحقق من سلة يدوياً';

    log.info('Admin manually assigned order', {
      orderId: orderData.orderId,
      orderNumber: orderData.orderNumber,
      userId: user.id,
      assignmentId: assignment.id,
      sallaStatusUpdated: sallaUpdateResult.success,
      sallaError: sallaUpdateResult.error,
    });

    return NextResponse.json({
      success: true,
      assignment: payload,
      message: responseMessage,
      sallaStatusUpdated: sallaUpdateResult.success,
      sallaError: sallaUpdateResult.success ? undefined : sallaUpdateResult.error,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'الطلب مرتبط حالياً بمستخدم آخر' },
        { status: 409 },
      );
    }

    log.error('Error assigning order manually', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء تعيين الطلب' },
      { status: 500 },
    );
  }
}
