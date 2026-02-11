import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { log } from '@/app/lib/logger';
import {
  getSallaOrderStatuses,
  getNewOrderStatusFilters,
  getStatusName,
  type SallaOrderStatus,
} from '@/app/lib/salla-statuses';
import { fetchSallaWithRetry } from '@/app/lib/fetch-with-retry';
import { ACTIVE_ASSIGNMENT_STATUS_VALUES } from '@/lib/order-assignment-statuses';
import { hasServiceAccess } from '@/app/lib/service-access';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const DEFAULT_LIMIT = 60;
const TARGET_NEW_ORDER_STATUS_IDS = [
  '449146439', // طلب جديد
  '1065456688', // تحت المراجعة ع
  '1576217163', // تحت المراجعة حجز قطع
  '1882207425', // تحت المراجعة ا
  '2046404155', // غير متوفر (ارجاع مبلغ)
];

const TARGET_STATUS_FALLBACK_NAMES: Record<string, string> = {
  '449146439': 'طلب جديد',
  '1065456688': 'تحت المراجعة ع',
  '1576217163': 'تحت المراجعة حجز قطع',
  '1882207425': 'تحت المراجعة ا',
  '2046404155': 'غير متوفر (ارجاع مبلغ)',
};

type AssignmentWithUser = Awaited<ReturnType<typeof prisma.orderAssignment.findMany>>[number] & {
  user?: {
    id: string;
    name: string | null;
    username: string | null;
  } | null;
};

type AssignmentState = 'new' | 'assigned';

const extractOrderId = (order: any): string | null => {
  const candidates = [
    order?.id,
    order?.order_id,
    order?.orderId,
    order?.reference_id,
    order?.referenceId,
  ];
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    return String(value);
  }
  return null;
};

const extractOrderNumber = (order: any): string | null => {
  const candidates = [
    order?.order_number,
    order?.orderNumber,
    order?.reference_id,
    order?.referenceId,
    order?.id,
  ];
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return null;
};

const extractDate = (order: any): string | null => {
  const candidates = [
    order?.date?.date,
    order?.date?.created_at,
    order?.date?.createdAt,
    order?.created_at,
    order?.createdAt,
    order?.updated_at,
    order?.updatedAt,
  ];
  for (const rawValue of candidates) {
    if (!rawValue) continue;
    const parsed = new Date(rawValue);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return null;
};

const extractTimestamp = (order: any): number => {
  const date = extractDate(order);
  if (!date) return 0;
  const timestamp = Date.parse(date);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const extractCustomerName = (order: any): string | null => {
  const customer = order?.customer || order?.customer_data || order?.customerDetails || null;
  if (!customer || typeof customer !== 'object') return null;
  const name =
    customer.name ||
    customer.full_name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(' ');
  return name?.trim() || null;
};

const extractPaymentMethod = (order: any): string | null => {
  const payment = order?.payment || order?.payment_method || order?.paymentMethod;

  if (typeof payment === 'string') {
    return payment;
  }

  if (payment && typeof payment === 'object') {
    return (
      payment?.name ||
      payment?.title ||
      payment?.method ||
      payment?.method_name ||
      payment?.methodName ||
      payment?.payment_method ||
      null
    );
  }

  return (
    order?.payment_method_name ||
    order?.payment_method ||
    order?.paymentMethod ||
    null
  );
};

const extractItemsCount = (order: any): number | null => {
  if (typeof order?.items_count === 'number') {
    return order.items_count;
  }
  if (Array.isArray(order?.items)) {
    return order.items.length;
  }
  if (typeof order?.itemsCount === 'number') {
    return order.itemsCount;
  }
  return null;
};

const extractTotalAmount = (order: any): number | null => {
  const amountCandidates = [
    order?.amounts?.grand_total?.amount,
    order?.amounts?.total?.amount,
    order?.amounts?.total,
    order?.total,
    order?.total_price,
    order?.totalPrice,
    order?.amount?.total,
  ];

  for (const value of amountCandidates) {
    if (value === null || value === undefined) continue;
    const numberValue =
      typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    if (!Number.isNaN(numberValue)) {
      return Number(numberValue);
    }
  }
  return null;
};

const extractStatusSlug = (order: any): string | null => {
  const status = order?.status || order?.order_status || order?.status_info || null;
  if (typeof status === 'string') {
    return status;
  }
  if (status && typeof status === 'object') {
    return status.slug || status.code || status.id || status.name || null;
  }
  return null;
};

const extractStatusLabel = (
  order: any,
  statuses: Awaited<ReturnType<typeof getSallaOrderStatuses>>
): string | null => {
  const status = order?.status || order?.order_status || order?.status_info || null;
  if (status && typeof status === 'object' && status.name) {
    return status.name;
  }

  const slug = extractStatusSlug(order);
  if (slug) {
    return getStatusName(statuses, slug);
  }

  return null;
};

const classifyAssignment = (assignment?: AssignmentWithUser | null) => {
  const base = {
    state: 'new' as AssignmentState,
    reason: null as string | null,
    assignedUserName: null as string | null,
  };

  if (!assignment) {
    return base;
  }

  const status = assignment.status || 'assigned';
  const assignedUserName =
    assignment.user?.name ||
    assignment.user?.username ||
    'غير محدد';

  if (ACTIVE_ASSIGNMENT_STATUS_VALUES.includes(status as any)) {
    return {
      state: 'assigned' as AssignmentState,
      reason: null,
      assignedUserName,
    };
  }

  return {
    ...base,
    reason:
      status === 'released'
        ? 'تم تحرير الطلب لمراجعته'
        : status === 'removed'
          ? 'تمت إزالته بسبب تحديث حالة الطلب في سلة'
          : status === 'completed'
            ? 'تم إكمال الطلب سابقاً'
            : status
              ? `الحالة السابقة: ${status}`
              : null,
  };
};

const normalizeIdentifier = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const stringValue = typeof value === 'number' ? value.toString() : String(value);
  const normalized = stringValue.trim();
  return normalized.length > 0 ? normalized : null;
};

const extractStatusContext = (order: any) => {
  const statusLike =
    order?.status ||
    order?.order_status ||
    order?.status_info ||
    order?.orderStatus ||
    null;
  const subStatus = statusLike?.sub_status || statusLike?.subStatus || null;

  const normalizeFirst = (values: unknown[]) => {
    for (const value of values) {
      const normalized = normalizeIdentifier(value);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  };

  const baseId = normalizeFirst([
    statusLike?.sub_status_id,
    statusLike?.status_id,
    statusLike?.statusId,
    statusLike?.id,
    statusLike?.code,
    order?.status_id,
    order?.statusId,
    order?.status_code,
  ]);

  const subId = normalizeFirst([
    subStatus?.status_id,
    subStatus?.statusId,
    subStatus?.id,
    subStatus?.code,
  ]);

  const parentId = normalizeIdentifier(
    statusLike?.parent?.id ||
      statusLike?.parent_id ||
      statusLike?.parentId ||
      statusLike?.parent?.status_id,
  );

  return {
    statusLike,
    subStatus,
    baseId,
    subId,
    parentId,
    baseName: typeof statusLike?.name === 'string' ? statusLike.name : null,
  };
};

const extractStatusIdCandidates = (order: any): string[] => {
  const candidates: string[] = [];
  const context = extractStatusContext(order);
  const pushCandidate = (value: unknown) => {
    const normalized = normalizeIdentifier(value);
    if (normalized) {
      candidates.push(normalized);
    }
  };

  if (context.subId) {
    pushCandidate(context.subId);
  }
  if (context.baseId) {
    pushCandidate(context.baseId);
  }

  return candidates;
};

const buildStatusLookups = (statuses: SallaOrderStatus[]) => {
  const byId = new Map<string, SallaOrderStatus>();
  const bySlug = new Map<string, SallaOrderStatus>();

  statuses.forEach((status) => {
    const id = normalizeIdentifier(status.id);
    if (id) {
      byId.set(id, status);
    }
    const originalId = normalizeIdentifier(status.original?.id);
    if (originalId) {
      byId.set(originalId, status);
    }
    if (status.slug) {
      bySlug.set(status.slug, status);
    }
  });

  return { byId, bySlug };
};

const extractPrimaryStatusId = (order: any): string | null => {
  const candidates = extractStatusIdCandidates(order);
  return candidates.length > 0 ? candidates[0] : null;
};

const resolveStatusRecord = (
  order: any,
  lookups: ReturnType<typeof buildStatusLookups>,
  fallbackSlug: string | null,
) => {
  const idCandidates = extractStatusIdCandidates(order);
  for (const candidate of idCandidates) {
    const match = lookups.byId.get(candidate);
    if (match) {
      return match;
    }
  }

  if (fallbackSlug) {
    const slugMatch = lookups.bySlug.get(fallbackSlug);
    if (slugMatch) {
      return slugMatch;
    }
  }

  return null;
};

const resolveParentName = (
  status: SallaOrderStatus | null,
  lookups: ReturnType<typeof buildStatusLookups>,
): string | null => {
  if (!status) {
    return null;
  }
  if (status.parent?.name) {
    return status.parent.name;
  }
  const parentId = normalizeIdentifier(status.parent?.id);
  if (parentId) {
    const parentStatus = lookups.byId.get(parentId);
    if (parentStatus?.name) {
      return parentStatus.name;
    }
  }
  return null;
};

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const user = session.user as any;
    const roles = user?.roles || [];
    const role = user?.role;
    const isAdmin = roles.includes('admin') || role === 'admin';
    const hasAdminOrderPrepAccess = hasServiceAccess(session, 'admin-order-prep');

    if (!isAdmin && !hasAdminOrderPrepAccess) {
      return NextResponse.json({ error: 'لا تملك صلاحية الوصول' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = Number.parseInt(searchParams.get('limit') || '', 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 10), 100)
      : DEFAULT_LIMIT;

    const statuses = await getSallaOrderStatuses(MERCHANT_ID);
    const { primaryStatus } = getNewOrderStatusFilters(statuses);
    const statusLookups = buildStatusLookups(statuses);
    const statusFilters = TARGET_NEW_ORDER_STATUS_IDS;

    const { getSallaAccessToken } = await import('@/app/lib/salla-oauth');
    const accessToken = await getSallaAccessToken(MERCHANT_ID);

    if (!accessToken) {
      log.error('Failed to resolve Salla access token for new orders dashboard');
      return NextResponse.json(
        { error: 'تعذر الاتصال بسلة لجلب الطلبات الجديدة' },
        { status: 502 }
      );
    }

    const baseUrl = 'https://api.salla.dev/admin/v2';
    const allOrders: { order: any; statusFilter: string }[] = [];
    const seenOrderIds = new Set<string>();

    for (const filterValue of statusFilters) {
      const url = `${baseUrl}/orders?status=${encodeURIComponent(filterValue)}&per_page=${limit}&sort_by=created_at-desc`;
      try {
        const response = await fetchSallaWithRetry(url, accessToken);
        if (!response.ok) {
          const errorText = await response.text();
          log.warn('Failed to fetch Salla orders for dashboard', {
            status: response.status,
            error: errorText,
            filterValue,
          });
          continue;
        }

        const data = await response.json();
        const orders = Array.isArray(data?.data) ? data.data : [];

        for (const order of orders) {
          const orderId = extractOrderId(order);
          if (!orderId || seenOrderIds.has(orderId)) {
            continue;
          }
          seenOrderIds.add(orderId);
          allOrders.push({ order, statusFilter: String(filterValue) });
        }
      } catch (error) {
        log.warn('Error fetching Salla orders for dashboard', {
          filterValue,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (allOrders.length === 0) {
      return NextResponse.json({
        success: true,
        fetchedAt: new Date().toISOString(),
        statusFilters,
        primaryStatusName: primaryStatus?.name || 'تحت المراجعة',
        orders: [],
        totals: {
          new: 0,
          assigned: 0,
        },
      });
    }

    const normalizedOrders = allOrders.sort(
      (a, b) => extractTimestamp(a.order) - extractTimestamp(b.order),
    );

    const orderIds = normalizedOrders
      .map(({ order }) => extractOrderId(order))
      .filter((id): id is string => Boolean(id));

    const assignments = orderIds.length > 0
      ? await prisma.orderAssignment.findMany({
          where: {
            merchantId: MERCHANT_ID,
            orderId: { in: orderIds },
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
          orderBy: {
            assignedAt: 'desc',
          },
        })
      : [];

    const latestAssignmentByOrder = new Map<string, AssignmentWithUser>();
    for (const assignment of assignments) {
      if (!assignment.orderId) continue;
      if (latestAssignmentByOrder.has(assignment.orderId)) {
        continue;
      }
      latestAssignmentByOrder.set(assignment.orderId, assignment as AssignmentWithUser);
    }

    const prepAssignments =
      orderIds.length > 0
        ? await prisma.orderPrepAssignment.findMany({
            where: {
              merchantId: MERCHANT_ID,
              orderId: { in: orderIds },
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
          })
        : [];

    const priorityRecords =
      orderIds.length > 0
        ? await prisma.highPriorityOrder.findMany({
            where: {
              merchantId: MERCHANT_ID,
              orderId: { in: orderIds },
            },
          })
        : [];

    const prepAssignmentByOrder = new Map<string, (typeof prepAssignments)[number]>();
    prepAssignments.forEach((assignment) => {
      if (!prepAssignmentByOrder.has(assignment.orderId)) {
        prepAssignmentByOrder.set(assignment.orderId, assignment);
      }
    });
    const priorityByOrder = new Map<string, (typeof priorityRecords)[number]>();
    priorityRecords.forEach((record) => {
      priorityByOrder.set(record.orderId, record);
    });

    const serializedOrders = normalizedOrders.map(({ order, statusFilter }) => {
      const orderId = extractOrderId(order);
      const assignment = orderId ? latestAssignmentByOrder.get(orderId) : undefined;
      const classification = classifyAssignment(assignment);
      const fallbackPrepAssignment = orderId ? prepAssignmentByOrder.get(orderId) : undefined;
      const statusSlug = extractStatusSlug(order);
      const statusLabel = extractStatusLabel(order, statuses);
      const statusContext = extractStatusContext(order);
      const statusLookupRecord = statusLookups.byId.get(String(statusFilter));
      const statusRecord = statusLookupRecord || resolveStatusRecord(order, statusLookups, statusSlug);
      const statusIdFromFilter = normalizeIdentifier(statusFilter);
      const resolvedStatusId =
        statusIdFromFilter ||
        statusContext.subId ||
        normalizeIdentifier(statusRecord?.id) ||
        statusContext.baseId ||
        extractPrimaryStatusId(order);
      const normalizedParentId = normalizeIdentifier(statusRecord?.parent?.id);
      const parentId =
        normalizedParentId ||
        statusContext.parentId ||
        (statusIdFromFilter && statusIdFromFilter !== TARGET_NEW_ORDER_STATUS_IDS[0]
          ? TARGET_NEW_ORDER_STATUS_IDS[0]
          : null);
      const parentName =
        statusIdFromFilter && statusIdFromFilter !== TARGET_NEW_ORDER_STATUS_IDS[0]
          ? statusLookups.byId.get(TARGET_NEW_ORDER_STATUS_IDS[0])?.name ||
            resolveParentName(statusRecord, statusLookups)
          : resolveParentName(statusRecord, statusLookups);
      const groupKey = resolvedStatusId
        ? `status-${resolvedStatusId}`
        : statusSlug
          ? `slug-${statusSlug}`
          : statusLabel
            ? `label-${statusLabel}`
            : 'unknown';
      const assignmentState =
        classification.state === 'new' && fallbackPrepAssignment ? 'assigned' : classification.state;
      const assignedUserName =
        classification.assignedUserName ||
        fallbackPrepAssignment?.user?.name ||
        fallbackPrepAssignment?.user?.username ||
        fallbackPrepAssignment?.userName ||
        null;
      const assignedUserId = assignment?.userId || fallbackPrepAssignment?.userId || null;
      const priorityRecord = orderId ? priorityByOrder.get(orderId) : undefined;

      return {
        id: orderId,
        orderNumber: extractOrderNumber(order),
        createdAt: extractDate(order),
        paymentMethod: extractPaymentMethod(order),
        totalAmount: extractTotalAmount(order),
        customerName: extractCustomerName(order),
        itemsCount: extractItemsCount(order),
        statusSlug,
        statusLabel,
        statusId: resolvedStatusId,
        statusParentId: parentId,
        statusParentName: parentName,
        statusGroupKey: groupKey,
        assignmentState,
        assignmentReason: classification.reason,
        assignmentId: assignment?.id || null,
        assignedUserId,
        assignedUserName,
        assignmentStatus: assignment?.status || null,
        isHighPriority: Boolean(priorityRecord),
        priorityId: priorityRecord?.id || null,
        priorityReason: priorityRecord?.reason || null,
        priorityNotes: priorityRecord?.notes || null,
        priorityCreatedAt:
          priorityRecord && priorityRecord.createdAt
            ? priorityRecord.createdAt.toISOString()
            : null,
      };
    });

    const totals = serializedOrders.reduce(
      (acc, order) => {
        acc[order.assignmentState] += 1;
        return acc;
      },
      { new: 0, assigned: 0 }
    );

    const targetStatuses = TARGET_NEW_ORDER_STATUS_IDS.map((id) => {
      const record = statusLookups.byId.get(id);
      return {
        id: Number(id),
        name:
          record?.name ||
          (id === TARGET_NEW_ORDER_STATUS_IDS[0]
            ? primaryStatus?.name || TARGET_STATUS_FALLBACK_NAMES[id]
            : TARGET_STATUS_FALLBACK_NAMES[id]),
        slug: record?.slug || 'under_review',
        parentId: record?.parent?.id || null,
        parentName: record?.parent?.name || null,
      };
    });

    return NextResponse.json({
      success: true,
      fetchedAt: new Date().toISOString(),
      statusFilters,
      primaryStatusName: primaryStatus?.name || 'تحت المراجعة',
      statusDetails: {
        primaryStatusName: primaryStatus?.name || null,
        relatedStatuses: targetStatuses,
      },
      orders: serializedOrders,
      totals,
    });
  } catch (error) {
    log.error('Failed to build admin order prep dashboard feed', { error });
    return NextResponse.json(
      { error: 'حدث خطأ أثناء جلب الطلبات الجديدة' },
      { status: 500 }
    );
  }
}
