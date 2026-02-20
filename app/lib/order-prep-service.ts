import { Prisma, OrderPrepAssignment } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { fetchSallaWithRetry } from '@/app/lib/fetch-with-retry';
import { getSallaOrderStatuses, getNewOrderStatusFilters } from '@/app/lib/salla-statuses';
import { STATUS_IDS, STATUS_SLUGS } from '@/SALLA_ORDER_STATUSES';
import { updateSallaOrderStatus } from '@/app/lib/salla-order-status';
import {
  extractSallaStatus,
  isOrderStatusEligible,
  isOrderStatusAssignable,
} from '@/app/lib/order-prep-status-guard';
import { updateSallaOrder, type SallaShipToUpdate } from '@/app/lib/salla-api';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';
const FETCH_LIMIT = 40;

const ACTIVE_ASSIGNMENT_STATUSES = new Set(['assigned', 'preparing', 'waiting']);
const DEFAULT_STATUS_FILTERS = ['under_review', '449146439', '566146469'];

export type SerializedOrderPrepAssignment = Omit<
  OrderPrepAssignment,
  'orderData' | 'assignedAt' | 'startedAt' | 'waitingAt' | 'completedAt' | 'cancelledAt' | 'lastStatusUpdateAt'
> & {
  orderData: Prisma.JsonValue;
  assignedAt: string;
  startedAt: string | null;
  waitingAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lastStatusUpdateAt: string;
};

export function serializeAssignment(record: OrderPrepAssignment): SerializedOrderPrepAssignment {
  return {
    id: record.id,
    merchantId: record.merchantId,
    userId: record.userId,
    userName: record.userName,
    orderId: record.orderId,
    orderNumber: record.orderNumber,
    orderReference: record.orderReference,
    orderData: record.orderData,
    status: record.status,
    assignedAt: record.assignedAt.toISOString(),
    startedAt: record.startedAt ? record.startedAt.toISOString() : null,
    waitingAt: record.waitingAt ? record.waitingAt.toISOString() : null,
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    cancelledAt: record.cancelledAt ? record.cancelledAt.toISOString() : null,
    lastStatusUpdateAt: record.lastStatusUpdateAt.toISOString(),
  };
}

export async function getActiveAssignmentsForUser(userId: string): Promise<SerializedOrderPrepAssignment[]> {
  const records = await prisma.orderPrepAssignment.findMany({
    where: {
      userId,
      status: { in: Array.from(ACTIVE_ASSIGNMENT_STATUSES) },
    },
    orderBy: [{ assignedAt: 'asc' }],
  });

  const processedRecords = await Promise.all(records.map((record) => applyPostalPatchIfNeeded(record)));

  return processedRecords.map(serializeAssignment);
}

export async function assignOldestOrderToUser(user: {
  id: string;
  name?: string | null;
}): Promise<SerializedOrderPrepAssignment | null> {
  if (!user?.id) {
    return null;
  }

  const accessToken = await getSallaAccessToken(MERCHANT_ID);
  if (!accessToken) {
    log.error('Cannot assign order - missing Salla token');
    return null;
  }

  const filters = await resolveStatusFilters();
  const candidateOrders = await fetchCandidateOrders(accessToken, filters);

  if (candidateOrders.length === 0) {
    return null;
  }

  const orderIds = candidateOrders
    .map((order) => extractOrderId(order))
    .filter((id): id is string => Boolean(id));

  if (orderIds.length === 0) {
    return null;
  }

  const [existingAssignments, existingShipments, escalatedOrders] = await Promise.all([
    prisma.orderPrepAssignment.findMany({
      where: { merchantId: MERCHANT_ID, orderId: { in: orderIds } },
      select: { orderId: true },
    }),
    prisma.sallaShipment.findMany({
      where: { merchantId: MERCHANT_ID, orderId: { in: orderIds } },
      select: { orderId: true },
    }),
    prisma.orderPrepEscalation.findMany({
      where: {
        merchantId: MERCHANT_ID,
        orderId: { in: orderIds },
        resolvedAt: null,
      },
      select: { orderId: true },
    }),
  ]);

  const assignedIds = new Set(existingAssignments.map((record) => record.orderId));
  const shippedIds = new Set(existingShipments.map((record) => record.orderId));
  const escalatedIds = new Set(escalatedOrders.map((record) => record.orderId));

  for (const order of candidateOrders) {
    const orderId = extractOrderId(order);
    if (!orderId || assignedIds.has(orderId) || escalatedIds.has(orderId)) {
      continue;
    }

    if (shippedIds.has(orderId)) {
      log.info('Skipping order with existing shipment label', { orderId });
      continue;
    }

    const detail = await fetchOrderDetailWithItems(orderId, accessToken);
    if (!detail) {
      continue;
    }

    const { status, subStatus } = extractSallaStatus(detail);
    if (!isOrderStatusEligible(status, subStatus)) {
      log.info('Skipping Salla order due to ineligible status', {
        orderId,
        statusName: status?.name || status?.label || null,
        subStatusName: subStatus?.name || subStatus?.label || null,
      });
      continue;
    }

    if (!isOrderStatusAssignable(status, subStatus)) {
      log.info('Skipping Salla order due to non-new status', {
        orderId,
        statusId: status?.id || status?.status_id || status?.statusId || null,
        statusName: status?.name || status?.label || status?.name_en || status?.nameEn || null,
        subStatusId: subStatus?.id || subStatus?.status_id || subStatus?.statusId || null,
        subStatusName: subStatus?.name || subStatus?.label || subStatus?.name_en || subStatus?.nameEn || null,
      });
      continue;
    }

    try {
      const assignment = await prisma.orderPrepAssignment.create({
        data: {
          merchantId: MERCHANT_ID,
          userId: user.id,
          userName: user.name || 'المستخدم',
          orderId,
          orderNumber: extractOrderNumber(detail),
          orderReference: extractOrderReference(detail),
          orderData: detail as Prisma.InputJsonValue,
        },
      });

      log.info('Assigned new Salla order to user', {
        userId: user.id,
        orderId,
        orderNumber: assignment.orderNumber,
      });

      const finalAssignment = await applyPostalPatchIfNeeded(assignment);

      return serializeAssignment(finalAssignment);
    } catch (error) {
      const isUniqueViolation =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (isUniqueViolation) {
        log.warn('Order already assigned while creating', { orderId });
        continue;
      }
      log.error('Failed to create order prep assignment', { error, orderId });
    }
  }

  return null;
}

type ItemStatusPayload = {
  index?: number | null;
  sku?: string | null;
  normalizedSku?: string | null;
  name?: string | null;
  status?: string | null;
};

export async function updateAssignmentStatus(options: {
  assignmentId: string;
  userId: string;
  targetStatus: 'preparing' | 'waiting' | 'completed';
  skipSallaSync?: boolean;
  itemStatuses?: ItemStatusPayload[];
}): Promise<{
  assignment: SerializedOrderPrepAssignment;
  sallaStatusSynced: boolean;
  sallaError?: string;
  blocked?: boolean;
} | null> {
  const { assignmentId, userId, targetStatus, skipSallaSync, itemStatuses } = options;

  const assignment = await prisma.orderPrepAssignment.findUnique({
    where: { id: assignmentId },
  });

  if (!assignment || assignment.userId !== userId) {
    return null;
  }

  let currentOrderData: Prisma.JsonValue = assignment.orderData;
  if (targetStatus === 'completed') {
    const patchedOrderData = await ensureInternationalPostalCode(assignment);
    if (patchedOrderData) {
      currentOrderData = patchedOrderData;
      assignment.orderData = patchedOrderData;
    }
  }

  const now = new Date();
  const data: Prisma.OrderPrepAssignmentUpdateInput = {
    status: targetStatus,
  };

  if (targetStatus === 'preparing') {
    data.startedAt = assignment.startedAt ?? now;
    data.waitingAt = null;
  } else if (targetStatus === 'waiting') {
    data.waitingAt = now;
  } else if (targetStatus === 'completed') {
    data.completedAt = now;
  }

  const nextSallaStatusId = mapStatusToSalla(targetStatus);
  let sallaStatusSynced = false;
  let sallaError: string | undefined;

  if (nextSallaStatusId && !skipSallaSync) {
    const result = await updateSallaOrderStatus(MERCHANT_ID, assignment.orderId, {
      statusId: nextSallaStatusId,
    });
    sallaStatusSynced = result.success;
    if (!result.success && result.error) {
      sallaError = result.error;
      log.warn('Failed to sync status with Salla', {
        assignmentId,
        orderId: assignment.orderId,
        error: result.error,
      });

      if (targetStatus === 'completed') {
        return {
          assignment: serializeAssignment(assignment),
          sallaStatusSynced: false,
          sallaError: 'تعذر تحديث حالة الطلب في سلة. يرجى المحاولة مرة أخرى.',
          blocked: true,
        };
      }
    } else if (result.success) {
      data.orderData = updateStoredOrderStatus(currentOrderData, targetStatus, itemStatuses);
    }
  } else if (targetStatus === 'completed') {
    data.orderData = updateStoredOrderStatus(currentOrderData, targetStatus, itemStatuses);
  }

  const updated = await prisma.orderPrepAssignment.update({
    where: { id: assignmentId },
    data,
  });

  if (targetStatus === 'completed') {
    await prisma.orderPrepEscalation.updateMany({
      where: {
        merchantId: assignment.merchantId,
        orderId: assignment.orderId,
        resolvedAt: null,
      },
      data: {
        resolvedAt: now,
        resolvedById: assignment.userId,
        resolvedByName: assignment.userName,
      },
    });
  }

  return {
    assignment: serializeAssignment(updated),
    sallaStatusSynced,
    sallaError,
  };
}

function updateStoredOrderStatus(
  orderData: Prisma.JsonValue,
  targetStatus: string,
  itemStatuses?: ItemStatusPayload[],
): Prisma.InputJsonValue {
  if (typeof orderData !== 'object' || orderData === null) {
    return orderData as Prisma.InputJsonValue;
  }

  const statusMap: Record<string, { slug: string; name: string }> = {
    preparing: { slug: STATUS_SLUGS.IN_PROGRESS, name: 'جاري التجهيز' },
    waiting: { slug: STATUS_SLUGS.UNDER_REVIEW, name: 'قيد الانتظار' },
    completed: { slug: STATUS_SLUGS.COMPLETED, name: 'تم التنفيذ' },
  };

  const match = statusMap[targetStatus];
  const normalizedStatuses =
    Array.isArray(itemStatuses) && itemStatuses.length > 0
      ? itemStatuses
          .map((entry, idx) => {
            const rawSku = typeof entry.sku === 'string' ? entry.sku : null;
            const normalized =
              typeof entry.normalizedSku === 'string' && entry.normalizedSku
                ? entry.normalizedSku
                : rawSku
                  ? rawSku.trim().toUpperCase()
                  : null;
            const status =
              entry.status === 'ready' ||
              entry.status === 'comingSoon' ||
              entry.status === 'unavailable'
                ? entry.status
                : null;
            if (!status) {
              return null;
            }
            return {
              index: typeof entry.index === 'number' ? entry.index : idx,
              sku: rawSku,
              normalizedSku: normalized,
              status,
              name: typeof entry.name === 'string' ? entry.name : null,
              recordedAt: new Date().toISOString(),
            };
          })
          .filter(Boolean)
      : null;

  const nextData: Record<string, any> = {
    ...(orderData as Record<string, any>),
  };

  if (match) {
    nextData.status = {
      ...(typeof nextData.status === 'object' ? nextData.status : {}),
      slug: match.slug,
      name: match.name,
    };
  }

  if (normalizedStatuses) {
    nextData.prepItemStatuses = normalizedStatuses;
  }

  return nextData as Prisma.InputJsonValue;
}

function mapStatusToSalla(status: 'preparing' | 'waiting' | 'completed'): number | null {
  switch (status) {
    case 'preparing':
      return STATUS_IDS.IN_PROGRESS ?? null;
    case 'waiting':
      return STATUS_IDS.UNDER_REVIEW ?? null;
    case 'completed':
      return STATUS_IDS.IN_PROGRESS ?? null;
    default:
      return null;
  }
}

const DEFAULT_POSTAL_CODE = '000000';
const SAUDI_COUNTRY_CODES = new Set(['SA', 'SAU', 'KSA']);
const SAUDI_COUNTRY_NAMES = new Set([
  'SAUDIARABIA',
  'SAUDI',
  'SAUDI ARABIA',
  'السعودية',
]);

async function ensureInternationalPostalCode(
  assignment: OrderPrepAssignment,
): Promise<Prisma.JsonValue | null> {
  if (!assignment.merchantId || !assignment.orderId) {
    return null;
  }

  const rawOrderData = assignment.orderData as Prisma.JsonValue;
  if (typeof rawOrderData !== 'object' || rawOrderData === null) {
    return null;
  }

  const orderData = rawOrderData as Record<string, any>;
  const shipping = toRecord(orderData.shipping);
  if (!shipping) {
    return null;
  }
  const shipTo = toRecord(shipping.ship_to ?? shipping.shipTo ?? shipping.receiver);
  if (!shipTo) {
    return null;
  }

  const fallbackAddress = toRecord(orderData.shipping_address);
  if (!isInternationalShipment(shipping, shipTo, fallbackAddress)) {
    return null;
  }

  const postalValue =
    getStringValue(shipTo.postal_code ?? shipTo.postalCode) ??
    getStringValue(fallbackAddress?.postal_code ?? fallbackAddress?.zip_code);

  if (!needsPostalPatch(postalValue)) {
    return null;
  }

  const normalizedPostal = normalizePostalCode(postalValue);
  const shipToPayload = buildShipToUpdatePayload({
    shipTo,
    fallbackAddress,
    postal: normalizedPostal,
  });

  if (!shipToPayload) {
    log.warn('Unable to build ship_to payload for postal patch', {
      assignmentId: assignment.id,
      orderId: assignment.orderId,
    });
    return null;
  }

  const branchId = getNumericId(shipping.branch_id ?? shipping.branch?.id);
  const courierId = getNumericId(
    shipping.courier_id ?? shipping.courier?.id ?? shipping.courierId,
  );
  const payload = {
    delivery_method: getStringValue(shipping.delivery_method) ?? 'shipping',
    branch_id: branchId ?? undefined,
    courier_id: courierId ?? undefined,
    ship_to: shipToPayload,
  };

  const response = await updateSallaOrder(assignment.merchantId, assignment.orderId, payload);
  if (!response || response.success === false) {
    log.warn('Failed to update Salla order postal code', {
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      message: response?.message,
    });
    return null;
  }

  log.info('Patched international shipping postal code', {
    assignmentId: assignment.id,
    orderId: assignment.orderId,
    postalCode: normalizedPostal,
  });

  return cloneOrderDataWithPostal(orderData, normalizedPostal);
}

async function applyPostalPatchIfNeeded(
  assignment: OrderPrepAssignment,
): Promise<OrderPrepAssignment> {
  try {
    const patchedOrderData = await ensureInternationalPostalCode(assignment);
    if (patchedOrderData) {
      const updated = await prisma.orderPrepAssignment.update({
        where: { id: assignment.id },
        data: { orderData: patchedOrderData as Prisma.InputJsonValue },
      });
      return updated;
    }
  } catch (error) {
    log.warn('Failed to auto-patch postal code for assignment', {
      assignmentId: assignment.id,
      orderId: assignment.orderId,
      error,
    });
  }
  return assignment;
}

function toRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, any>;
}

function getStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function getNumericId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object' && value) {
    return getNumericId((value as Record<string, unknown>).id ?? (value as Record<string, unknown>).value);
  }
  return null;
}

function needsPostalPatch(postal: string | null): boolean {
  if (!postal) {
    return true;
  }
  const digits = postal.replace(/\D/g, '');
  return digits.length < 6;
}

function normalizePostalCode(postal: string | null): string {
  const digits = postal ? postal.replace(/\D/g, '') : '';
  if (!digits) {
    return DEFAULT_POSTAL_CODE;
  }
  if (digits.length >= 6) {
    return digits;
  }
  return digits.padEnd(6, '0');
}

function buildShipToUpdatePayload(options: {
  shipTo: Record<string, any>;
  fallbackAddress: Record<string, any> | null;
  postal: string;
}): SallaShipToUpdate | null {
  const { shipTo, fallbackAddress, postal } = options;
  const countryId = getNumericId(shipTo.country ?? shipTo.country_id);
  const cityId = getNumericId(shipTo.city ?? shipTo.city_id);
  const districtId = getNumericId(shipTo.district ?? shipTo.district_id);
  const block =
    getStringValue(shipTo.block) ??
    getStringValue(shipTo.district_name) ??
    getStringValue(fallbackAddress?.district);
  const streetNumber =
    getStringValue(shipTo.street_number ?? shipTo.street) ??
    getStringValue(fallbackAddress?.street_number) ??
    '0';
  const addressLine =
    getStringValue(shipTo.address_line ?? shipTo.address) ??
    getStringValue(fallbackAddress?.street_address ?? fallbackAddress?.address);

  if (!countryId || !cityId || !districtId || !block || !addressLine) {
    return null;
  }

  const payload: SallaShipToUpdate = {
    country: countryId,
    city: cityId,
    district: districtId,
    block,
    street_number: streetNumber,
    address_line: addressLine,
    postal_code: postal,
  };

  const shortAddress = getStringValue(shipTo.short_address ?? shipTo.shortAddress);
  if (shortAddress) {
    payload.short_address = shortAddress;
  }
  const buildingNumber =
    getStringValue(shipTo.building_number ?? shipTo.buildingNumber) ??
    getStringValue(fallbackAddress?.building_number);
  if (buildingNumber) {
    payload.building_number = buildingNumber;
  }
  const additionalNumber =
    getStringValue(shipTo.additional_number ?? shipTo.additionalNumber) ??
    getStringValue(fallbackAddress?.additional_number);
  if (additionalNumber) {
    payload.additional_number = additionalNumber;
  }
  const formattedAddress =
    getStringValue(shipTo.address) ??
    getStringValue(fallbackAddress?.address) ??
    getStringValue(fallbackAddress?.street_address);
  if (formattedAddress) {
    payload.address = formattedAddress;
  }

  const geo = getGeoCoordinates(
    shipTo.geo_coordinates ?? shipTo.geoCoordinates ?? fallbackAddress?.geo_coordinates,
  );
  if (geo) {
    payload.geo_coordinates = geo;
  }

  return payload;
}

function getGeoCoordinates(value: unknown): { lat: number; lng: number } | undefined {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return getGeoCoordinates(parsed);
    } catch {
      return undefined;
    }
  }
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  const lat = Number(record.lat ?? record.latitude);
  const lng = Number(record.lng ?? record.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return undefined;
  }
  return { lat, lng };
}

function isInternationalShipment(
  shipping: Record<string, any>,
  shipTo: Record<string, any>,
  fallbackAddress: Record<string, any> | null,
): boolean {
  if (typeof shipping.is_international === 'boolean') {
    return shipping.is_international;
  }

  const countryCandidates = [
    getStringValue(shipTo.country_code ?? shipTo.countryCode),
    getStringValue(fallbackAddress?.country_code),
  ];
  if (
    countryCandidates
      .map((value) => normalizeCountryValue(value))
      .some((value) => value && SAUDI_COUNTRY_CODES.has(value))
  ) {
    return false;
  }

  const countryNames = [
    getStringValue(shipTo.country_name ?? shipTo.countryName),
    getStringValue(fallbackAddress?.country),
  ];
  if (
    countryNames
      .map((value) => normalizeCountryValue(value))
      .some((value) => value && SAUDI_COUNTRY_NAMES.has(value))
  ) {
    return false;
  }

  return true;
}

function normalizeCountryValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return value.replace(/\s+/g, '').toUpperCase();
}

function cloneOrderDataWithPostal(
  orderData: Record<string, any>,
  postal: string,
): Prisma.JsonValue {
  const cloned = JSON.parse(JSON.stringify(orderData));
  if (cloned?.shipping?.ship_to) {
    cloned.shipping.ship_to.postal_code = postal;
  }
  if (cloned?.shipping?.receiver) {
    cloned.shipping.receiver.postal_code = postal;
  }
  if (cloned?.shipping_address) {
    cloned.shipping_address.postal_code = postal;
  }
  return cloned;
}

async function resolveStatusFilters(): Promise<string[]> {
  try {
    const statuses = await getSallaOrderStatuses(MERCHANT_ID);
    const { queryValues } = getNewOrderStatusFilters(statuses);
    if (queryValues.length > 0) {
      return queryValues;
    }
    return DEFAULT_STATUS_FILTERS;
  } catch (error) {
    log.error('Failed to resolve new order statuses', { error });
    return DEFAULT_STATUS_FILTERS;
  }
}

async function fetchCandidateOrders(accessToken: string, filters: string[]) {
  const seen = new Set<string>();
  const orders: any[] = [];

  for (const filter of filters) {
    let page = 1;
    let totalPages: number | null = null;

    while (true) {
      const url = `${SALLA_API_BASE}/orders?status=${encodeURIComponent(
        filter
      )}&per_page=${FETCH_LIMIT}&page=${page}&sort_by=created_at-asc`;
      try {
        const response = await fetchSallaWithRetry(url, accessToken);
        if (!response.ok) {
          const errorText = await response.text();
          log.warn('Failed to fetch Salla orders for filter', { filter, page, error: errorText });
          break;
        }
        const data = await response.json();
        const rows = Array.isArray(data.data) ? data.data : [];
        rows.forEach((order: any) => {
          const key = extractOrderId(order) || order?.reference_id || order?.id;
          if (!key || seen.has(String(key))) {
            return;
          }
          seen.add(String(key));
          orders.push(order);
        });

        totalPages = totalPages ?? getTotalPagesFromPagination(data.pagination);
        const reachedLastPage =
          (typeof totalPages === 'number' && page >= totalPages) ||
          rows.length === 0;
        if (reachedLastPage) {
          break;
        }
        page += 1;
      } catch (error) {
        log.error('Error fetching orders from Salla', { filter, page, error });
        break;
      }
    }
  }

  return orders.sort((a, b) => getOrderTimestamp(a) - getOrderTimestamp(b));
}

async function fetchOrderDetailWithItems(orderId: string, accessToken: string) {
  try {
    const detailUrl = `${SALLA_API_BASE}/orders/${orderId}`;
    const response = await fetchSallaWithRetry(detailUrl, accessToken);
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      log.warn('Failed to fetch order detail from Salla', { orderId, error: errorText });
      return null;
    }
    const data = await response.json();
    const detail = data.data || {};

    try {
      const itemsUrl = `${SALLA_API_BASE}/orders/items?order_id=${orderId}`;
      const itemsResponse = await fetchSallaWithRetry(itemsUrl, accessToken);
      if (itemsResponse.ok) {
        const itemsData = await itemsResponse.json();
        detail.items = Array.isArray(itemsData.data) ? itemsData.data : detail.items;
      }
    } catch (itemsError) {
      log.warn('Failed to fetch order items', { orderId, error: itemsError });
    }

    await attachProductLocations(detail);
    return detail;
  } catch (error) {
    log.error('Unexpected error while fetching order detail', { orderId, error });
    return null;
  }
}

function extractOrderId(order: any): string | null {
  const candidates = [
    order?.id,
    order?.order_id,
    order?.orderId,
    order?.reference_id,
    order?.referenceId,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const normalized = String(candidate).trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractOrderNumber(order: any): string | null {
  const candidates = [
    order?.reference_id,
    order?.referenceId,
    order?.order_number,
    order?.orderNumber,
    order?.id,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const normalized = String(candidate).trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function getTotalPagesFromPagination(meta?: any): number | null {
  if (!meta || typeof meta !== 'object') {
    return null;
  }

  if (typeof meta.total_pages === 'number') {
    return meta.total_pages;
  }
  if (typeof meta.totalPages === 'number') {
    return meta.totalPages;
  }

  const total = typeof meta.total === 'number' ? meta.total : meta.count;
  const perPage = typeof meta.per_page === 'number' ? meta.per_page : meta.perPage;

  if (typeof total === 'number' && typeof perPage === 'number' && perPage > 0) {
    return Math.ceil(total / perPage);
  }

  return null;
}

function extractOrderReference(order: any): string | null {
  const candidates = [order?.reference_id, order?.referenceId, order?.id];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const normalized = String(candidate).trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function getOrderTimestamp(order: any): number {
  const candidates = [
    order?.date?.created,
    order?.date?.updated,
    order?.created_at,
    order?.createdAt,
    order?.updated_at,
    order?.updatedAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return 0;
}

export async function attachProductLocations(detail: any) {
  if (!detail || typeof detail !== 'object') {
    return detail;
  }

  const items = Array.isArray(detail.items) ? detail.items : [];
  if (items.length === 0) {
    return detail;
  }

  const skuSet = new Set<string>();
  const productIdSet = new Set<string>();

  const normalizeSku = (value: unknown): string | null => {
    if (!value) return null;
    const normalized = String(value).trim();
    return normalized || null;
  };

  items.forEach((item: any) => {
    const sku =
      normalizeSku(item?.sku) ||
      normalizeSku(item?.product?.sku) ||
      normalizeSku(item?.variant?.sku) ||
      null;
    if (sku) {
      skuSet.add(sku.toLowerCase());
      item.normalizedSku = sku;
    }

    const productId =
      normalizeSku(item?.product_id) ||
      normalizeSku(item?.product?.id) ||
      normalizeSku(item?.product?.product_id) ||
      null;
    if (productId) {
      productIdSet.add(productId);
      item.normalizedProductId = productId;
    }
  });

  if (skuSet.size === 0 && productIdSet.size === 0) {
    return detail;
  }

  const locations = await prisma.sallaProductLocation.findMany({
    where: {
      OR: [
        skuSet.size > 0
          ? {
              sku: {
                in: Array.from(skuSet),
                mode: 'insensitive',
              },
            }
          : undefined,
        productIdSet.size > 0
          ? {
              productId: {
                in: Array.from(productIdSet),
              },
            }
          : undefined,
      ].filter(Boolean) as Prisma.SallaProductLocationWhereInput[],
    },
    select: {
      sku: true,
      productId: true,
      location: true,
      notes: true,
    },
  });

  const bySkuKey = new Map<string, typeof locations[number][]>();
  const skuKeys: string[] = [];
  locations
    .filter((location) => location.sku)
    .forEach((location) => {
      const normalized = location.sku!.toLowerCase();
      if (!bySkuKey.has(normalized)) {
        bySkuKey.set(normalized, []);
        skuKeys.push(normalized);
      }
      bySkuKey.get(normalized)!.push(location);
    });
  skuKeys.sort((a, b) => b.length - a.length);
  const byProductId = new Map(
    locations
      .filter((location) => location.productId)
      .map((location) => [location.productId!, location]),
  );

  items.forEach((item: any) => {
    const skuKey = (item.normalizedSku as string | undefined)?.toLowerCase() || null;
    const productIdKey = item.normalizedProductId as string | undefined;

    let match: typeof locations[number] | undefined;
    if (skuKey) {
      match = bySkuKey.get(skuKey)?.[0];
      if (!match) {
        const prefix = skuKeys.find((key) => skuKey!.startsWith(key));
        if (prefix) {
          match = bySkuKey.get(prefix)?.[0];
        }
      }
    }
    if (!match && productIdKey) {
      match = byProductId.get(productIdKey);
    }

    if (match) {
      item.inventoryLocation = match.location;
      item.inventoryNotes = match.notes || null;
    }
  });

  return detail;
}
