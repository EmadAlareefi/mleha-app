import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { Prisma } from '@prisma/client';
import type { OrderGiftFlag, SallaOrder as PrismaSallaOrder } from '@prisma/client';
import { findOrdersByCustomerContact, getSallaOrder, getSallaOrderByReference } from '@/app/lib/salla-api';
import type { SallaOrder as RemoteSallaOrder } from '@/app/lib/salla-api';
import { upsertSallaOrderFromPayload } from '@/app/lib/salla-sync';
import { extractDates } from '@/app/lib/salla-orders';
import { hasServiceAccess } from '@/app/lib/service-access';
import type { ServiceKey } from '@/app/lib/service-definitions';
import { serializeLocalShipment } from '@/app/lib/local-shipping/serializer';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';
import type { SmsaLiveStatus } from '@/types/smsa';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const DEBUG_SEARCH_LOGS = process.env.ORDER_SEARCH_DEBUG === 'true';
const SALLA_PHONE_ORDER_BY = [
  { placedAt: 'desc' as const },
  { updatedAtRemote: 'desc' as const },
  { updatedAt: 'desc' as const },
];

const logSallaOrderPayload = (assignment: any) => {
  if (!DEBUG_SEARCH_LOGS || !assignment?.orderData) {
    return;
  }
  const identifier = assignment.orderNumber || assignment.orderId || assignment.id || 'unknown';
  const label =
    assignment.source === 'salla' || assignment.assignedUserId === 'salla-system'
      ? 'Salla order JSON payload'
      : 'Order data payload';
  try {
    const serialized = JSON.stringify(assignment.orderData, null, 2);
    console.log(
      `[order-assignments/search][server] ${label} for ${identifier}:\n${serialized}`,
    );
  } catch {
    console.log(
      `[order-assignments/search][server] ${label} for ${identifier} (object logged separately)`,
      assignment.orderData,
    );
  }
};

const logSearchDebug = (message: string, data?: Record<string, unknown>) => {
  if (!DEBUG_SEARCH_LOGS) {
    return;
  }
  console.log(`[order-assignments/search] ${message}`, data || {});
};

const buildResponsePayload = (record: any, type: 'assignment' | 'history') => {
  const assignedName = type === 'assignment'
    ? (record.user as any)?.name || (record.user as any)?.username
    : record.userName;

  return {
    id: record.id,
    orderId: record.orderId,
    orderNumber: record.orderNumber,
    orderData: record.orderData,
    merchantId: record.merchantId,
    status: record.status,
    sallaStatus: type === 'assignment' ? record.sallaStatus : record.finalSallaStatus,
    assignedUserId: record.userId,
    assignedUserName: assignedName || '—',
    assignedAt: record.assignedAt.toISOString(),
    startedAt: record.startedAt ? record.startedAt.toISOString() : null,
    completedAt: type === 'assignment'
      ? (record.completedAt ? record.completedAt.toISOString() : null)
      : (record.finishedAt ? record.finishedAt.toISOString() : null),
    notes: record.notes,
    source: type,
    assignmentState: 'assigned',
  };
};

const respondWithPayloadAndShipment = async (payload: any) => {
  const enrichedPayload = await enrichPayloadItemDetails(payload);
  const shipment = await getShipmentInfoForOrder({
    merchantId: enrichedPayload.merchantId,
    orderId: enrichedPayload.orderId,
    orderNumber: enrichedPayload.orderNumber,
  });
  return respondWithAssignment(enrichedPayload, shipment);
};

const respondWithAssignment = async (payload: any, shipment: any) => {
  const [giftFlag, priorityRecord, doNotShipFlag] = await Promise.all([
    getGiftFlagForOrder(payload.merchantId, payload.orderId),
    getPriorityRecordForOrder(payload.merchantId, payload.orderId),
    getDoNotShipFlagForOrder(payload.merchantId, payload.orderId, shipment?.trackingNumber),
  ]);

  const assignmentPayload = {
    success: true,
    assignment: {
      ...payload,
      shipment,
      giftFlag: serializeGiftFlag(giftFlag),
      isHighPriority: Boolean(priorityRecord),
      priorityId: priorityRecord?.id || null,
      priorityReason: priorityRecord?.reason || null,
      priorityNotes: priorityRecord?.notes || null,
      priorityCreatedAt: priorityRecord?.createdAt
        ? priorityRecord.createdAt.toISOString()
        : null,
      doNotShipFlag: serializeDoNotShipFlag(doNotShipFlag),
    },
  };

  logSallaOrderPayload(assignmentPayload.assignment);

  return NextResponse.json(assignmentPayload);
};

const getGiftFlagForOrder = async (
  merchantId: string | null | undefined,
  orderId?: string | null,
): Promise<OrderGiftFlag | null> => {
  if (!orderId) {
    return null;
  }

  const resolvedMerchantId = merchantId && merchantId.trim().length > 0
    ? merchantId
    : MERCHANT_ID;

  return prisma.orderGiftFlag.findUnique({
    where: {
      merchantId_orderId: {
        merchantId: resolvedMerchantId,
        orderId,
      },
    },
  });
};

const getPriorityRecordForOrder = async (
  merchantId: string | null | undefined,
  orderId?: string | null,
) => {
  if (!orderId) {
    return null;
  }

  const resolvedMerchantId =
    merchantId && merchantId.trim().length > 0 ? merchantId : MERCHANT_ID;

  return prisma.highPriorityOrder.findUnique({
    where: {
      merchantId_orderId: {
        merchantId: resolvedMerchantId,
        orderId,
      },
    },
  });
};

const getDoNotShipFlagForOrder = async (
  merchantId: string | null | undefined,
  orderId?: string | null,
  trackingNumber?: string | null,
) => {
  const resolvedMerchantId = merchantId && merchantId.trim().length > 0
    ? merchantId
    : MERCHANT_ID;

  const orFilters: Prisma.OrderDoNotShipFlagWhereInput[] = [];

  if (orderId) {
    orFilters.push({ orderId });
  }
  if (trackingNumber) {
    orFilters.push({ trackingNumber });
  }

  if (orFilters.length === 0) {
    return null;
  }

  return prisma.orderDoNotShipFlag.findFirst({
    where: {
      merchantId: resolvedMerchantId,
      OR: orFilters,
    },
    orderBy: { createdAt: 'desc' },
  });
};

const serializeGiftFlag = (flag: OrderGiftFlag | null) => {
  if (!flag) {
    return null;
  }

  return {
    id: flag.id,
    reason: flag.reason || null,
    notes: flag.notes || null,
    createdAt: flag.createdAt.toISOString(),
    updatedAt: flag.updatedAt.toISOString(),
    createdById: flag.createdById || null,
    createdByName: flag.createdByName || null,
    createdByUsername: flag.createdByUsername || null,
  };
};

const serializeDoNotShipFlag = (flag: any | null) => {
  if (!flag) {
    return null;
  }

  return {
    id: flag.id,
    merchantId: flag.merchantId,
    orderId: flag.orderId,
    orderNumber: flag.orderNumber || null,
    trackingNumber: flag.trackingNumber || null,
    notes: flag.notes || null,
    createdById: flag.createdById || null,
    createdByName: flag.createdByName || null,
    createdByUsername: flag.createdByUsername || null,
    createdAt: flag.createdAt.toISOString(),
    updatedAt: flag.updatedAt.toISOString(),
  };
};

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const allowedServices: ServiceKey[] = [
      'order-prep',
      'order-shipping',
      'order-invoice-search',
      'warehouse',
      'local-shipping',
      'shipment-assignments',
      'returns-management',
      'returns-inspection',
      'returns-priority',
      'returns-gifts',
    ];

    if (!hasServiceAccess(session, allowedServices)) {
      return NextResponse.json({ error: 'غير مصرح للوصول' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const rawQuery = searchParams.get('query') || searchParams.get('orderNumber');

    if (!rawQuery || !rawQuery.trim()) {
      return NextResponse.json({ error: 'يرجى إدخال رقم الطلب أو بيانات البحث' }, { status: 400 });
    }

    const searchQuery = rawQuery.trim();
    const digitsOnlyQuery = searchQuery.replace(/[^0-9]/g, '');

    const normalizedQueryVariants = new Set<string>();
    const addVariant = (value?: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      normalizedQueryVariants.add(trimmed);
    };

    addVariant(searchQuery);
    addVariant(searchQuery.toLowerCase());
    addVariant(searchQuery.toUpperCase());
    if (digitsOnlyQuery) {
      addVariant(digitsOnlyQuery);
      const noLeadingZeros = digitsOnlyQuery.replace(/^0+/, '');
      if (noLeadingZeros && noLeadingZeros !== digitsOnlyQuery) {
        addVariant(noLeadingZeros);
      }
      addVariant(`#${digitsOnlyQuery}`);
    }

    const phoneVariants = new Set<string>();
    if (digitsOnlyQuery) {
      phoneVariants.add(digitsOnlyQuery);

      const internationalDigits = digitsOnlyQuery.startsWith('00966')
        ? `966${digitsOnlyQuery.slice(5)}`
        : digitsOnlyQuery;
      phoneVariants.add(internationalDigits);

      const localMobileDigits = internationalDigits.startsWith('9665') && internationalDigits.length === 12
        ? internationalDigits.slice(3)
        : internationalDigits.startsWith('05') && internationalDigits.length === 10
          ? internationalDigits.slice(1)
          : internationalDigits.startsWith('5') && internationalDigits.length === 9
            ? internationalDigits
            : null;

      if (localMobileDigits) {
        phoneVariants.add(localMobileDigits);
        phoneVariants.add(`0${localMobileDigits}`);
        phoneVariants.add(`966${localMobileDigits}`);
        phoneVariants.add(`+966${localMobileDigits}`);
      }

      phoneVariants.add(`+${internationalDigits}`);
    }
    phoneVariants.add(searchQuery);

    const exactVariants = Array.from(normalizedQueryVariants).filter(Boolean);
    const exactAssignmentFilters = exactVariants.flatMap<Prisma.OrderAssignmentWhereInput>((variant) => [
      { orderNumber: variant },
      { orderId: variant },
    ]);
    const exactHistoryFilters = exactVariants.flatMap<Prisma.OrderHistoryWhereInput>((variant) => [
      { orderNumber: variant },
      { orderId: variant },
    ]);
    const exactSallaFilters = exactVariants.flatMap<Prisma.SallaOrderWhereInput>((variant) => [
      { orderNumber: variant },
      { referenceId: variant },
      { orderId: variant },
      { id: variant },
      { customerId: variant },
    ]);

    if (digitsOnlyQuery.length >= 5) {
      phoneVariants.forEach((variant) => {
        exactSallaFilters.push({ customerMobile: variant });
      });
    }

    const [exactAssignment, exactHistoryEntry, exactSallaOrder] = await Promise.all([
      exactAssignmentFilters.length > 0
        ? prisma.orderAssignment.findFirst({
            where: { OR: exactAssignmentFilters },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true,
                },
              },
            },
            orderBy: { assignedAt: 'desc' },
          })
        : Promise.resolve(null),
      exactHistoryFilters.length > 0
        ? prisma.orderHistory.findFirst({
            where: { OR: exactHistoryFilters },
            orderBy: { finishedAt: 'desc' },
          })
        : Promise.resolve(null),
      exactSallaFilters.length > 0
        ? prisma.sallaOrder.findFirst({
            where: {
              merchantId: MERCHANT_ID,
              OR: exactSallaFilters,
            },
            orderBy: isLikelySaudiMobileSearch(digitsOnlyQuery)
              ? SALLA_PHONE_ORDER_BY
              : { updatedAtRemote: 'desc' },
          })
        : Promise.resolve(null),
    ]);

    if (exactAssignment) {
      logSearchDebug('Found via exact OrderAssignment', {
        orderId: exactAssignment.orderId,
        orderNumber: exactAssignment.orderNumber,
      });
      return respondWithPayloadAndShipment(buildResponsePayload(exactAssignment, 'assignment'));
    }

    if (exactHistoryEntry) {
      logSearchDebug('Found via exact OrderHistory', {
        orderId: exactHistoryEntry.orderId,
        orderNumber: exactHistoryEntry.orderNumber,
      });
      return respondWithPayloadAndShipment(buildResponsePayload(exactHistoryEntry, 'history'));
    }

    if (isLikelySaudiMobileSearch(digitsOnlyQuery)) {
      const syncedPhoneOrder = await syncOrderFromSallaByPhone(phoneVariants);
      if (syncedPhoneOrder?.persisted) {
        const payload = buildSallaAssignmentFromRecord(syncedPhoneOrder.persisted);
        logSearchDebug('Found via Salla phone lookup', {
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
        });
        return respondWithPayloadAndShipment(payload);
      }
      if (syncedPhoneOrder?.remote) {
        const payload = buildAssignmentFromRemoteOrder(syncedPhoneOrder.remote);
        logSearchDebug('Found via Salla phone lookup without persisted record', {
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
        });
        return respondWithPayloadAndShipment(payload);
      }
    }

    if (exactSallaOrder) {
      logSearchDebug('Found via exact cached SallaOrder', {
        orderId: exactSallaOrder.orderId,
        orderNumber: exactSallaOrder.orderNumber,
        referenceId: exactSallaOrder.referenceId,
      });
      return respondWithPayloadAndShipment(buildSallaAssignmentFromRecord(exactSallaOrder));
    }

    const referencePaths = [
      ['reference_id'],
      ['referenceId'],
      ['reference'],
      ['reference_code'],
      ['referenceCode'],
      ['reference_number'],
      ['referenceNumber'],
      ['order_number'],
      ['orderNumber'],
      ['order_no'],
      ['orderNo'],
    ];

    const phonePaths = [
      ['customer', 'mobile'],
      ['customer', 'phone'],
      ['customer', 'mobile_code'],
      ['customer', 'mobileNumber'],
      ['customer', 'contact'],
      ['shipping_address', 'mobile'],
      ['shipping_address', 'phone'],
      ['billing_address', 'mobile'],
      ['billing_address', 'phone'],
    ];

    const customerIdPaths = [
      ['customer', 'id'],
      ['customer_id'],
      ['customerId'],
      ['customer_number'],
      ['customerNumber'],
    ];

    const sallaFilters: Prisma.SallaOrderWhereInput[] = [];
    const assignmentFilters: Prisma.OrderAssignmentWhereInput[] = [];
    const historyFilters: Prisma.OrderHistoryWhereInput[] = [];
    const addFiltersForBoth = (
      assignmentFilter: Prisma.OrderAssignmentWhereInput,
      historyFilter: Prisma.OrderHistoryWhereInput,
    ) => {
      assignmentFilters.push(assignmentFilter);
      historyFilters.push(historyFilter);
    };

    addFiltersForBoth({ orderNumber: searchQuery }, { orderNumber: searchQuery });
    addFiltersForBoth({ orderId: searchQuery }, { orderId: searchQuery });

    normalizedQueryVariants.forEach((variant) => {
      addFiltersForBoth({ orderNumber: variant }, { orderNumber: variant });
      addFiltersForBoth(
        { orderNumber: { contains: variant, mode: 'insensitive' } },
        { orderNumber: { contains: variant, mode: 'insensitive' } },
      );
      addFiltersForBoth({ orderId: variant }, { orderId: variant });
      addFiltersForBoth(
        { orderId: { contains: variant, mode: 'insensitive' } },
        { orderId: { contains: variant, mode: 'insensitive' } },
      );

      sallaFilters.push(
        { orderNumber: variant },
        { orderNumber: { contains: variant, mode: 'insensitive' } },
        { referenceId: variant },
        { referenceId: { contains: variant, mode: 'insensitive' } },
        { orderId: variant },
        { orderId: { contains: variant, mode: 'insensitive' } },
        { id: variant },
        { id: { contains: variant, mode: 'insensitive' } },
        { customerId: variant },
        { customerId: { contains: variant, mode: 'insensitive' } },
      );
    });

    referencePaths.forEach((path) => {
      normalizedQueryVariants.forEach((variant) => {
        addFiltersForBoth(
          { orderData: { path, equals: variant } },
          { orderData: { path, equals: variant } },
        );
        addFiltersForBoth(
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
        );
        if (/^\d+$/.test(variant)) {
          const variantNumber = Number(variant);
          if (Number.isFinite(variantNumber)) {
            addFiltersForBoth(
              { orderData: { path, equals: variantNumber } },
              { orderData: { path, equals: variantNumber } },
            );
          }
        }
      });
    });

    customerIdPaths.forEach((path) => {
      normalizedQueryVariants.forEach((variant) => {
        addFiltersForBoth(
          { orderData: { path, equals: variant } },
          { orderData: { path, equals: variant } },
        );
        addFiltersForBoth(
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
          { orderData: { path, string_contains: variant, mode: 'insensitive' } },
        );
        if (/^\d+$/.test(variant)) {
          const variantNumber = Number(variant);
          if (Number.isFinite(variantNumber)) {
            addFiltersForBoth(
              { orderData: { path, equals: variantNumber } },
              { orderData: { path, equals: variantNumber } },
            );
          }
        }
      });
    });

    if (digitsOnlyQuery.length >= 5) {
      phonePaths.forEach((path) => {
        phoneVariants.forEach((variant) => {
          addFiltersForBoth(
            { orderData: { path, string_contains: variant, mode: 'insensitive' } },
            { orderData: { path, string_contains: variant, mode: 'insensitive' } },
          );
          addFiltersForBoth(
            { orderData: { path, equals: variant } },
            { orderData: { path, equals: variant } },
          );
        });
      });

      phoneVariants.forEach((variant) => {
        sallaFilters.push(
          { customerMobile: { contains: variant } },
          { customerMobile: { equals: variant } },
        );
      });
    }

    // Search for the order assignment
    const assignment = await prisma.orderAssignment.findFirst({
      where: {
        OR: assignmentFilters,
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
        assignedAt: 'desc', // Get the most recent assignment
      },
    });

    if (assignment) {
      const payload = buildResponsePayload(assignment, 'assignment');
      logSearchDebug('Found via broad OrderAssignment', {
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
      });
      return respondWithPayloadAndShipment(payload);
    }

    const historyEntry = await prisma.orderHistory.findFirst({
      where: {
        OR: historyFilters,
      },
      orderBy: {
        finishedAt: 'desc',
      },
    });

    if (historyEntry) {
      const payload = buildResponsePayload(historyEntry, 'history');
      logSearchDebug('Found via broad OrderHistory', {
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
      });
      return respondWithPayloadAndShipment(payload);
    }

    if (sallaFilters.length > 0) {
      const sallaOrder = await prisma.sallaOrder.findFirst({
        where: {
          merchantId: MERCHANT_ID,
          OR: sallaFilters,
        },
        orderBy: isLikelySaudiMobileSearch(digitsOnlyQuery)
          ? SALLA_PHONE_ORDER_BY
          : { updatedAtRemote: 'desc' },
      });

      if (sallaOrder) {
        const payload = buildSallaAssignmentFromRecord(sallaOrder);
        logSearchDebug('Found via broad cached SallaOrder', {
          orderId: payload.orderId,
          orderNumber: payload.orderNumber,
        });
        return respondWithPayloadAndShipment(payload);
      }

      const syncedOrder = await syncOrderFromSalla(normalizedQueryVariants, digitsOnlyQuery);
      if (syncedOrder?.persisted) {
        const payload = buildSallaAssignmentFromRecord(syncedOrder.persisted);
        return respondWithPayloadAndShipment(payload);
      }
      if (syncedOrder?.remote) {
        const payload = buildAssignmentFromRemoteOrder(syncedOrder.remote);
        return respondWithPayloadAndShipment(payload);
      }
    }

    return NextResponse.json({
      success: false,
      error: 'لم يتم العثور على الطلب'
    }, { status: 404 });
  } catch (error) {
    console.error('Error searching for order:', error);
    return NextResponse.json(
      { error: 'فشل في البحث عن الطلب' },
      { status: 500 }
    );
  }
}

type SyncedOrderResult = {
  persisted: PrismaSallaOrder | null;
  remote: RemoteSallaOrder;
};

function mergeStoredFulfillmentData<T extends Record<string, any>>(
  order: T,
  record: PrismaSallaOrder,
): T {
  const fulfillmentCompany = record.fulfillmentCompany || null;
  if (!fulfillmentCompany) {
    return order;
  }

  return {
    ...order,
    fulfillmentCompany: order.fulfillmentCompany ?? fulfillmentCompany,
    shippingCompany: order.shippingCompany ?? fulfillmentCompany,
    shipping_company: order.shipping_company ?? fulfillmentCompany,
    shipping_method: order.shipping_method ?? fulfillmentCompany,
    delivery: {
      ...(order.delivery || {}),
      courier_name: order.delivery?.courier_name ?? fulfillmentCompany,
    },
  };
}

const ITEM_ARRAY_PATHS = [
  ['options'],
  ['product_options'],
  ['productOptions'],
  ['option_values'],
  ['optionValues'],
  ['attributes'],
  ['metadata', 'options'],
  ['details', 'options'],
  ['variant', 'options'],
  ['variant', 'attributes'],
  ['variant', 'values'],
  ['variant', 'option_values'],
  ['product', 'options'],
  ['product', 'attributes'],
];

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const normalizeKeyPart = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
};

const normalizeFilterValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
};

const getPathValue = (source: unknown, path: string[]): unknown => {
  let current = source;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const setPathValue = (target: Record<string, any>, path: string[], value: unknown) => {
  let current = target;
  path.slice(0, -1).forEach((segment) => {
    if (!isRecord(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  });
  current[path[path.length - 1]] = value;
};

const getOptionEntryValue = (entry: unknown): string => {
  if (entry === null || entry === undefined) {
    return '';
  }
  if (typeof entry === 'string' || typeof entry === 'number') {
    return String(entry).trim();
  }
  if (!isRecord(entry)) {
    return '';
  }
  const value = entry.value;
  if (isRecord(value)) {
    return normalizeKeyPart(value.name ?? value.label ?? value.value) ?? '';
  }
  return normalizeKeyPart(value ?? entry.name ?? entry.label) ?? '';
};

const optionArrayScore = (value: unknown): number => {
  if (!Array.isArray(value) || value.length === 0) {
    return 0;
  }
  return value.reduce((score, entry) => score + (getOptionEntryValue(entry) ? 2 : 1), 0);
};

const itemOptionScore = (item: unknown): number => {
  if (!isRecord(item)) {
    return 0;
  }

  const optionScore = ITEM_ARRAY_PATHS.reduce(
    (score, path) => score + optionArrayScore(getPathValue(item, path)),
    0,
  );
  const variantName =
    normalizeKeyPart(item.variant?.name ?? item.variantName ?? item.variant_name) ? 1 : 0;

  return optionScore + variantName;
};

const hasItemIdentity = (item: unknown): boolean => {
  if (!isRecord(item)) {
    return false;
  }
  return Boolean(
    normalizeKeyPart(
      item.id ??
        item.item_id ??
        item.order_item_id ??
        item.sku ??
        item.code ??
        item.variant_id ??
        item.variantId ??
        item.variant?.id ??
        item.variant?.sku ??
        item.product_id ??
        item.productId ??
        item.product?.id ??
        item.product?.sku,
    ),
  );
};

const itemMayHaveVariantOptions = (item: unknown): boolean => {
  if (!isRecord(item)) {
    return false;
  }

  const itemSku = normalizeKeyPart(item.sku ?? item.code);
  const productSku = normalizeKeyPart(item.product?.sku ?? item.product?.code);

  return Boolean(
    normalizeKeyPart(
      item.variant_id ??
        item.variantId ??
        item.variant?.id ??
        item.variant?.sku ??
        item.variant?.name ??
        item.variantName ??
        item.variant_name,
    ) ||
      (itemSku && productSku && itemSku !== productSku),
  );
};

const orderNeedsItemEnrichment = (orderData: unknown): boolean => {
  const items = isRecord(orderData) && Array.isArray(orderData.items) ? orderData.items : [];
  return items.some(
    (item) => hasItemIdentity(item) && itemMayHaveVariantOptions(item) && itemOptionScore(item) === 0,
  );
};

const getBestArray = (primary: unknown, fallback: unknown): unknown => {
  return optionArrayScore(primary) >= optionArrayScore(fallback) ? primary : fallback;
};

const mergeNestedRecord = (primary: unknown, fallback: unknown): Record<string, any> | undefined => {
  if (!isRecord(primary) && !isRecord(fallback)) {
    return undefined;
  }
  return {
    ...(isRecord(fallback) ? fallback : {}),
    ...(isRecord(primary) ? primary : {}),
  };
};

const buildItemKeys = (item: unknown, index: number): string[] => {
  if (!isRecord(item)) {
    return [`index:${index}`];
  }

  const candidates: Array<[string, unknown]> = [
    ['id', item.id],
    ['id', item.item_id],
    ['id', item.order_item_id],
    ['sku', item.sku],
    ['sku', item.code],
    ['sku', item.product?.sku],
    ['sku', item.variant?.sku],
    ['variant', item.variant_id],
    ['variant', item.variantId],
    ['variant', item.variant?.id],
    ['product', item.product_id],
    ['product', item.productId],
    ['product', item.product?.id],
  ];

  const keys = candidates
    .map(([prefix, value]) => {
      const normalized = normalizeKeyPart(value);
      return normalized ? `${prefix}:${normalized}` : null;
    })
    .filter((value): value is string => Boolean(value));

  keys.push(`index:${index}`);
  return keys;
};

const buildItemLookup = (items: unknown[]): Map<string, any> => {
  const lookup = new Map<string, any>();
  items.forEach((item, index) => {
    buildItemKeys(item, index).forEach((key) => {
      if (!lookup.has(key)) {
        lookup.set(key, item);
      }
    });
  });
  return lookup;
};

const findMatchingItem = (item: unknown, index: number, lookup: Map<string, any>): any | null => {
  for (const key of buildItemKeys(item, index)) {
    const match = lookup.get(key);
    if (match) {
      return match;
    }
  }
  return null;
};

const mergeItemWithFallback = (primaryItem: unknown, fallbackItem: unknown): any => {
  if (!isRecord(primaryItem)) {
    return fallbackItem ?? primaryItem;
  }
  if (!isRecord(fallbackItem)) {
    return primaryItem;
  }

  const merged: Record<string, any> = {
    ...fallbackItem,
    ...primaryItem,
  };

  for (const key of ['product', 'variant', 'details', 'metadata']) {
    const nested = mergeNestedRecord(primaryItem[key], fallbackItem[key]);
    if (nested) {
      merged[key] = nested;
    }
  }

  for (const path of ITEM_ARRAY_PATHS) {
    const best = getBestArray(getPathValue(primaryItem, path), getPathValue(fallbackItem, path));
    if (Array.isArray(best) && best.length > 0) {
      setPathValue(merged, path, best);
    }
  }

  return merged;
};

const mergeOrderDataWithFallback = (primaryOrderData: unknown, fallbackOrderData: unknown): unknown => {
  if (!isRecord(primaryOrderData) || !isRecord(fallbackOrderData)) {
    return primaryOrderData;
  }

  const primaryItems = Array.isArray(primaryOrderData.items) ? primaryOrderData.items : [];
  const fallbackItems = Array.isArray(fallbackOrderData.items) ? fallbackOrderData.items : [];
  if (primaryItems.length === 0 && fallbackItems.length === 0) {
    return primaryOrderData;
  }

  const fallbackLookup = buildItemLookup(fallbackItems);
  const mergedItems =
    primaryItems.length > 0
      ? primaryItems.map((item, index) =>
          mergeItemWithFallback(item, findMatchingItem(item, index, fallbackLookup)),
        )
      : fallbackItems;

  return {
    ...fallbackOrderData,
    ...primaryOrderData,
    items: mergedItems,
  };
};

const findCachedSallaOrderForPayload = async (payload: any): Promise<PrismaSallaOrder | null> => {
  const merchantId = normalizeFilterValue(payload?.merchantId) || MERCHANT_ID;
  const orderId = normalizeFilterValue(payload?.orderId);
  const orderNumber = normalizeFilterValue(payload?.orderNumber);

  const filters: Prisma.SallaOrderWhereInput[] = [];
  if (orderId) {
    filters.push({ orderId }, { id: orderId });
  }
  if (orderNumber) {
    filters.push({ orderNumber }, { referenceId: orderNumber }, { orderId: orderNumber });
  }

  if (filters.length === 0) {
    return null;
  }

  return prisma.sallaOrder.findFirst({
    where: {
      merchantId,
      OR: filters,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });
};

const enrichPayloadItemDetails = async (payload: any) => {
  if (!payload?.orderData || !isRecord(payload.orderData)) {
    return payload;
  }

  let orderData: unknown = payload.orderData;
  const cachedOrder = await findCachedSallaOrderForPayload(payload);
  if (cachedOrder?.rawOrder) {
    orderData = mergeOrderDataWithFallback(orderData, cachedOrder.rawOrder);
  }

  if (orderNeedsItemEnrichment(orderData) && payload.orderId) {
    try {
      const merchantId = payload.merchantId || MERCHANT_ID;
      const remoteOrder = await getSallaOrder(merchantId, String(payload.orderId));
      if (remoteOrder) {
        orderData = mergeOrderDataWithFallback(orderData, remoteOrder);
        await upsertSallaOrderFromPayload({
          merchantId,
          merchant_id: merchantId,
          order: {
            ...remoteOrder,
            merchant_id: merchantId,
            merchantId,
          },
        });
      }
    } catch (error) {
      logSearchDebug('Failed to enrich item options from Salla', {
        orderId: payload.orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (orderData === payload.orderData) {
    return payload;
  }

  return {
    ...payload,
    orderData,
  };
};

function buildSallaAssignmentFromRecord(record: PrismaSallaOrder) {
  const placedAt = record.placedAt || record.updatedAtRemote || new Date();
  const orderData = mergeStoredFulfillmentData((record.rawOrder as any) || {
    id: record.orderId,
    reference_id: record.referenceId,
    customer: {
      first_name: record.customerName,
      mobile: record.customerMobile,
      email: record.customerEmail,
      city: record.customerCity,
      country: record.customerCountry,
    },
    payment_status: record.paymentStatus,
    payment_method: record.paymentMethod,
    shipping_method: record.fulfillmentCompany,
    delivery: {
      courier_name: record.fulfillmentCompany,
      tracking_number: record.trackingNumber,
    },
  }, record);

  return {
    id: record.id,
    orderId: record.orderId,
    orderNumber: record.orderNumber || record.referenceId || record.orderId,
    orderData,
    status: record.statusSlug || record.statusName || 'unknown',
    sallaStatus: record.statusSlug,
    assignedUserId: 'salla-system',
    assignedUserName: 'بيانات سلة',
    assignedAt: placedAt.toISOString(),
    startedAt: null,
    completedAt: record.updatedAtRemote ? record.updatedAtRemote.toISOString() : null,
    notes: undefined,
    source: 'salla',
    merchantId: record.merchantId,
    assignmentState: 'new',
  };
}

function buildAssignmentFromRemoteOrder(order: RemoteSallaOrder) {
  const dates = extractDates(order as any);
  const placedAt = dates.created || new Date();
  const updatedAt = dates.updated;
  const merchantId = (order as any)?.merchant_id || MERCHANT_ID;

  return {
    id: String(order.id),
    orderId: String(order.id),
    orderNumber: order.reference_id ? String(order.reference_id) : String(order.id),
    orderData: order,
    status: order.status?.slug || order.status?.name || 'unknown',
    sallaStatus: order.status?.slug,
    assignedUserId: 'salla-system',
    assignedUserName: 'بيانات سلة',
    assignedAt: placedAt.toISOString(),
    startedAt: null,
    completedAt: updatedAt ? updatedAt.toISOString() : null,
    notes: undefined,
    source: 'salla',
    merchantId: String(merchantId),
    assignmentState: 'new',
  };
}

async function syncOrderFromSalla(
  normalizedQueryVariants: Set<string>,
  digitsOnlyQuery: string
): Promise<SyncedOrderResult | null> {
  const remoteOrder = await fetchRemoteOrderFromSalla(normalizedQueryVariants, digitsOnlyQuery);

  if (!remoteOrder) {
    return null;
  }

  const orderWithMerchant: RemoteSallaOrder & Record<string, any> = {
    ...remoteOrder,
    merchant_id: (remoteOrder as any).merchant_id ?? MERCHANT_ID,
    merchantId: (remoteOrder as any).merchantId ?? MERCHANT_ID,
    store: (remoteOrder as any).store ?? { id: MERCHANT_ID },
    store_id: (remoteOrder as any).store_id ?? MERCHANT_ID,
    storeId: (remoteOrder as any).storeId ?? MERCHANT_ID,
  };

  await upsertSallaOrderFromPayload({
    merchantId: MERCHANT_ID,
    merchant_id: MERCHANT_ID,
    order: orderWithMerchant,
  });

  const remoteOrderId =
    typeof orderWithMerchant.id === 'number' || typeof orderWithMerchant.id === 'string'
      ? String(orderWithMerchant.id)
      : null;

  let persisted: PrismaSallaOrder | null = null;

  if (remoteOrderId) {
    persisted = await prisma.sallaOrder.findUnique({
      where: {
        merchantId_orderId: {
          merchantId: MERCHANT_ID,
          orderId: remoteOrderId,
        },
      },
    });
  }

  if (!persisted) {
    const referenceId =
      (orderWithMerchant as any).referenceId ||
      orderWithMerchant.reference_id ||
      null;

    if (referenceId) {
      persisted = await prisma.sallaOrder.findFirst({
        where: {
          merchantId: MERCHANT_ID,
          OR: [{ referenceId }, { orderNumber: referenceId }],
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });
    }
  }

  return { persisted, remote: orderWithMerchant };
}

function isLikelySaudiMobileSearch(digitsOnlyQuery: string): boolean {
  return (
    /^05\d{8}$/.test(digitsOnlyQuery) ||
    /^5\d{8}$/.test(digitsOnlyQuery) ||
    /^9665\d{8}$/.test(digitsOnlyQuery) ||
    /^009665\d{8}$/.test(digitsOnlyQuery)
  );
}

async function syncOrderFromSallaByPhone(phoneVariants: Set<string>): Promise<SyncedOrderResult | null> {
  const contactVariants = Array.from(phoneVariants)
    .map((variant) => variant.trim())
    .filter(Boolean);
  const searchedPhoneKeys = buildPhoneMatchKeys(contactVariants);

  for (const contact of contactVariants) {
    const orders = await findOrdersByCustomerContact(MERCHANT_ID, contact);
    const latestOrder = orders.find((order) => orderMatchesPhone(order, searchedPhoneKeys));
    if (!latestOrder?.id) {
      continue;
    }

    const fullOrder = await getSallaOrder(MERCHANT_ID, String(latestOrder.id));
    const remoteOrder = fullOrder || latestOrder;
    const orderWithMerchant: RemoteSallaOrder & Record<string, any> = {
      ...remoteOrder,
      merchant_id: (remoteOrder as any).merchant_id ?? MERCHANT_ID,
      merchantId: (remoteOrder as any).merchantId ?? MERCHANT_ID,
      store: (remoteOrder as any).store ?? { id: MERCHANT_ID },
      store_id: (remoteOrder as any).store_id ?? MERCHANT_ID,
      storeId: (remoteOrder as any).storeId ?? MERCHANT_ID,
    };

    await upsertSallaOrderFromPayload({
      merchantId: MERCHANT_ID,
      merchant_id: MERCHANT_ID,
      order: orderWithMerchant,
    });

    const persisted = await prisma.sallaOrder.findUnique({
      where: {
        merchantId_orderId: {
          merchantId: MERCHANT_ID,
          orderId: String(latestOrder.id),
        },
      },
    });

    return { persisted, remote: orderWithMerchant };
  }

  return null;
}

function buildPhoneMatchKeys(values: unknown[]): Set<string> {
  const keys = new Set<string>();

  values.forEach((value) => {
    const digits = stringFromValue(value)?.replace(/\D/g, '') || '';
    if (!digits) {
      return;
    }

    keys.add(digits);

    const internationalDigits = digits.startsWith('00966') ? `966${digits.slice(5)}` : digits;
    keys.add(internationalDigits);

    const localMobileDigits = internationalDigits.startsWith('9665') && internationalDigits.length === 12
      ? internationalDigits.slice(3)
      : internationalDigits.startsWith('05') && internationalDigits.length === 10
        ? internationalDigits.slice(1)
        : internationalDigits.startsWith('5') && internationalDigits.length === 9
          ? internationalDigits
          : null;

    if (localMobileDigits) {
      keys.add(localMobileDigits);
      keys.add(`0${localMobileDigits}`);
      keys.add(`966${localMobileDigits}`);
    }
  });

  return keys;
}

function orderMatchesPhone(order: RemoteSallaOrder, searchedPhoneKeys: Set<string>): boolean {
  const customer = (order as any)?.customer || {};
  const mobile = customer.mobile ?? customer.phone ?? (order as any)?.customer_mobile ?? (order as any)?.customer_phone;
  const mobileCode = customer.mobile_code ?? customer.phone_code ?? customer.country_code;
  const candidateKeys = buildPhoneMatchKeys([
    mobile,
    mobileCode && mobile ? `${mobileCode}${mobile}` : null,
  ]);

  for (const key of candidateKeys) {
    if (searchedPhoneKeys.has(key)) {
      return true;
    }
  }

  return false;
}

async function fetchRemoteOrderFromSalla(
  normalizedQueryVariants: Set<string>,
  digitsOnlyQuery: string
): Promise<RemoteSallaOrder | null> {
  const orderIdCandidates = new Set<string>();
  if (digitsOnlyQuery) {
    orderIdCandidates.add(digitsOnlyQuery);
    const withoutLeadingZeros = digitsOnlyQuery.replace(/^0+/, '');
    if (withoutLeadingZeros && withoutLeadingZeros !== digitsOnlyQuery) {
      orderIdCandidates.add(withoutLeadingZeros);
    }
  }

  for (const candidate of orderIdCandidates) {
    if (!candidate) continue;
    const order = await getSallaOrder(MERCHANT_ID, candidate);
    if (order) {
      return order;
    }
  }

  for (const variant of normalizedQueryVariants) {
    const trimmed = variant.trim();
    if (!trimmed) continue;
    const order = await getSallaOrderByReference(MERCHANT_ID, trimmed);
    if (order) {
      return order;
    }
  }

  return null;
}

async function getShipmentInfoForOrder(params: {
  merchantId?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
}) {
  const merchantId = params.merchantId ? String(params.merchantId) : null;
  const orderId = params.orderId ? String(params.orderId) : null;
  const orderNumber = params.orderNumber ? String(params.orderNumber) : null;

  logSearchDebug('Shipment lookup params', { merchantId, orderId, orderNumber });

  // Check local shipments FIRST — they are explicitly created by users and take priority.
  const localOrConditions: Prisma.LocalShipmentWhereInput[] = [];

  if (orderNumber) {
    localOrConditions.push(
      merchantId ? { merchantId, orderNumber } : { orderNumber },
    );
  }

  if (orderId) {
    localOrConditions.push(
      merchantId ? { merchantId, orderId } : { orderId },
    );
  }

  if (orderNumber && merchantId) {
    localOrConditions.push({ orderNumber });
  }

  const localInclude = {
    assignment: {
      include: {
        deliveryAgent: {
          select: { id: true, name: true, username: true },
        },
      },
    },
  };

  const localShipment =
    localOrConditions.length > 0
      ? await prisma.localShipment.findFirst({
          where: { OR: localOrConditions },
          include: localInclude,
          orderBy: { createdAt: 'desc' as const },
        })
      : null;

  if (localShipment) {
    logSearchDebug('Found local shipment', {
      id: localShipment.id,
      trackingNumber: localShipment.trackingNumber,
      orderNumber: localShipment.orderNumber,
      orderId: localShipment.orderId,
      merchantId: localShipment.merchantId,
    });
  }

  if (localShipment) {
    const serialized = serializeLocalShipment(localShipment);
    const agent = localShipment.assignment?.deliveryAgent;
    const deliveryStatus = buildLocalDeliveryStatus(localShipment);
    return {
      id: localShipment.id,
      trackingNumber: localShipment.trackingNumber,
      courierName: 'شحن محلي',
      status: localShipment.status,
      deliveryStatus,
      labelUrl: serialized.labelUrl,
      labelPrinted: serialized.labelPrinted,
      labelPrintedAt: serialized.labelPrintedAt,
      printCount: serialized.printCount,
      updatedAt: localShipment.updatedAt.toISOString(),
      type: 'local',
      localShipmentId: localShipment.id,
      assignedAgentName: agent ? (agent.name || agent.username) : null,
      assignmentStatus: localShipment.assignment?.status || null,
    };
  }

  logSearchDebug('No local shipment found, checking SallaShipment');

  // Fall back to Salla shipments
  const orConditions: Array<{ orderId?: string; orderNumber?: string }> = [];
  if (orderId) {
    orConditions.push({ orderId }, { orderNumber: orderId });
  }
  if (orderNumber) {
    orConditions.push({ orderNumber }, { orderId: orderNumber });
  }

  if (orConditions.length === 0) {
    return null;
  }

  const shipment = await prisma.sallaShipment.findFirst({
    where: {
      ...(merchantId ? { merchantId } : {}),
      OR: orConditions,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (shipment) {
    logSearchDebug('Found SallaShipment', {
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
    });

    const shipmentData = shipment.shipmentData as any;
    const labelUrl =
      shipment.labelUrl ||
      shipmentData?.label_url ||
      shipmentData?.label?.url ||
      (typeof shipmentData?.label === 'string' ? shipmentData.label : null);
    const deliveryStatus = await buildCarrierDeliveryStatus(shipment);

    return {
      id: shipment.id,
      trackingNumber: shipment.trackingNumber,
      courierName: shipment.courierName,
      status: shipment.status,
      courierCode: shipment.courierCode,
      deliveryStatus,
      labelUrl,
      labelPrinted: shipment.labelPrinted,
      labelPrintedAt: shipment.labelPrintedAt ? shipment.labelPrintedAt.toISOString() : null,
      printCount: shipment.printCount,
      updatedAt: shipment.updatedAt.toISOString(),
      type: 'salla',
      localShipmentId: null,
      assignedAgentName: null,
      assignmentStatus: null,
    };
  }

  logSearchDebug('No shipment found');
  return null;
}

function stringFromValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = stringFromValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function formatDeliveryStatus(status: string | null | undefined): string | null {
  const normalized = status?.trim();
  if (!normalized) {
    return null;
  }

  const statusMap: Record<string, string> = {
    pending: 'بانتظار التجهيز',
    assigned: 'تم التعيين للمندوب',
    picked_up: 'تم الاستلام من المستودع',
    in_transit: 'قيد التوصيل',
    delivered: 'تم التسليم',
    failed: 'فشل التسليم',
    cancelled: 'ملغي',
    canceled: 'ملغي',
    returned: 'مرتجع',
    shipped: 'تم الشحن',
    created: 'تم إنشاء الشحنة',
  };

  return statusMap[normalized.toLowerCase()] || normalized;
}

function toDeliveryStatusPayload(params: {
  carrier: 'smsa' | 'ajex' | 'local' | 'other';
  label: string | null;
  code?: string | null;
  description?: string | null;
  city?: string | null;
  timestamp?: string | null;
  updatedAt?: Date | string | null;
  source: string;
}) {
  return {
    carrier: params.carrier,
    label: params.label,
    code: params.code || null,
    description: params.description || null,
    city: params.city || null,
    timestamp: params.timestamp || null,
    updatedAt:
      params.updatedAt instanceof Date
        ? params.updatedAt.toISOString()
        : params.updatedAt || null,
    source: params.source,
  };
}

function buildLocalDeliveryStatus(localShipment: any) {
  const assignmentStatus = formatDeliveryStatus(localShipment.assignment?.status);
  const shipmentStatus = formatDeliveryStatus(localShipment.status);
  const label = assignmentStatus || shipmentStatus || null;

  return toDeliveryStatusPayload({
    carrier: 'local',
    label,
    code: localShipment.assignment?.status || localShipment.status || null,
    description: localShipment.assignment?.failureReason || localShipment.deliveryNotes || localShipment.notes || null,
    timestamp:
      localShipment.assignment?.deliveredAt?.toISOString?.() ||
      localShipment.deliveredAt?.toISOString?.() ||
      localShipment.assignment?.pickedUpAt?.toISOString?.() ||
      localShipment.assignment?.updatedAt?.toISOString?.() ||
      localShipment.updatedAt?.toISOString?.() ||
      null,
    updatedAt: localShipment.updatedAt,
    source: 'local-shipping',
  });
}

function isSmsaShipment(shipment: any) {
  const haystack = [shipment.courierCode, shipment.courierName, shipment.trackingNumber, shipment.awbNumber, shipment.sawb]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes('smsa') || haystack.includes('سمسا');
}

function isAjexShipment(shipment: any) {
  const haystack = [shipment.courierCode, shipment.courierName, shipment.trackingNumber]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes('ajex') || haystack.includes('aj-ex') || haystack.includes('أيجكس') || haystack.includes('ايجكس');
}

async function findSmsaLiveStatusForShipment(shipment: any) {
  const candidates = [
    shipment.trackingNumber,
    shipment.awbNumber,
    shipment.sawb,
    (shipment.shipmentData as any)?.awb,
    (shipment.shipmentData as any)?.AWB,
    (shipment.shipmentData as any)?.tracking_number,
    (shipment.shipmentData as any)?.trackingNumber,
  ]
    .map(stringFromValue)
    .filter(Boolean) as string[];

  if (candidates.length === 0) {
    return null;
  }

  const liveRecord = await prisma.shipment.findFirst({
    where: {
      trackingNumber: { in: Array.from(new Set(candidates)) },
      smsaLiveStatus: { not: Prisma.JsonNull },
    },
    orderBy: { smsaLiveStatusUpdatedAt: 'desc' },
    select: {
      smsaLiveStatus: true,
      smsaLiveStatusUpdatedAt: true,
    },
  });

  if (!liveRecord?.smsaLiveStatus) {
    return null;
  }

  return {
    status: liveRecord.smsaLiveStatus as SmsaLiveStatus,
    updatedAt: liveRecord.smsaLiveStatusUpdatedAt,
  };
}

function extractAjexDeliveryStatus(shipmentData: any) {
  const delivery = shipmentData?.delivery || shipmentData?.shipment || shipmentData?.tracking || shipmentData?.data || {};
  const scans = [
    ...(Array.isArray(shipmentData?.scans) ? shipmentData.scans : []),
    ...(Array.isArray(shipmentData?.events) ? shipmentData.events : []),
    ...(Array.isArray(shipmentData?.tracking_logs) ? shipmentData.tracking_logs : []),
    ...(Array.isArray(delivery?.scans) ? delivery.scans : []),
    ...(Array.isArray(delivery?.events) ? delivery.events : []),
  ];
  const latestScan = scans.length > 0 ? scans[scans.length - 1] : null;

  return {
    status: firstString(
      latestScan?.status,
      latestScan?.status_name,
      latestScan?.description,
      latestScan?.event,
      delivery?.delivery_status,
      delivery?.status,
      delivery?.status_name,
      shipmentData?.delivery_status,
      shipmentData?.status,
      shipmentData?.status_name,
    ),
    code: firstString(latestScan?.code, latestScan?.status_code, delivery?.status_code, shipmentData?.status_code),
    description: firstString(
      latestScan?.description,
      latestScan?.event_description,
      delivery?.description,
      shipmentData?.description,
    ),
    city: firstString(latestScan?.city, latestScan?.location, delivery?.city, shipmentData?.city),
    timestamp: firstString(
      latestScan?.created_at,
      latestScan?.date,
      latestScan?.time,
      latestScan?.timestamp,
      delivery?.updated_at,
      shipmentData?.updated_at,
    ),
  };
}

async function buildCarrierDeliveryStatus(shipment: any) {
  if (isSmsaShipment(shipment)) {
    const liveStatus = await findSmsaLiveStatusForShipment(shipment);
    const status = liveStatus?.status || null;
    const label = resolveMajorSmsaStatus(status) || formatDeliveryStatus(shipment.status);

    return toDeliveryStatusPayload({
      carrier: 'smsa',
      label,
      code: status?.code || null,
      description: status?.description || null,
      city: status?.city || null,
      timestamp: status?.timestamp || null,
      updatedAt: liveStatus?.updatedAt || shipment.updatedAt,
      source: status ? 'smsa-webhook' : 'salla-shipment',
    });
  }

  if (isAjexShipment(shipment)) {
    const ajexStatus = extractAjexDeliveryStatus(shipment.shipmentData as any);
    const label = formatDeliveryStatus(ajexStatus.status) || formatDeliveryStatus(shipment.status);

    return toDeliveryStatusPayload({
      carrier: 'ajex',
      label,
      code: ajexStatus.code,
      description: ajexStatus.description,
      city: ajexStatus.city,
      timestamp: ajexStatus.timestamp,
      updatedAt: shipment.updatedAt,
      source: ajexStatus.status ? 'salla-shipment-data' : 'salla-shipment',
    });
  }

  return toDeliveryStatusPayload({
    carrier: 'other',
    label: formatDeliveryStatus(shipment.status),
    code: shipment.status,
    updatedAt: shipment.updatedAt,
    source: 'salla-shipment',
  });
}
