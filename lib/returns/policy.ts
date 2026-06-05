import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSallaProduct, type SallaOrderItem } from '@/app/lib/salla-api';
import { extractOrderDate } from '@/lib/returns/order-date';
import {
  EVENING_DRESS_CATEGORY,
  isEveningDressCategory,
  isDiscountedCategory,
  normalizeCategoryName,
} from '@/lib/returns/categories';

const EPSILON_DAYS = 0.001; // ~1.5 minutes tolerance
const EVENING_DRESS_WINDOW_HOURS = 24;
const DEFAULT_RETURN_WINDOW_DAYS = 3;
const HOUR_MS = 1000 * 60 * 60;
const DAY_MS = HOUR_MS * 24;

type AnyRecord = Record<string, any>;

export interface ReturnWindowPolicy {
  categoryName: string;
  windowHours: number;
  message: string;
}

export interface ReturnWindowEvaluation {
  eligible: boolean;
  policy: ReturnWindowPolicy;
  deliveryDate: Date;
  deliveryDateSource: string;
  elapsedHours: number;
  daysSinceDelivery: number;
}

export const getReturnWindowPolicy = (categoryNames: string[]): ReturnWindowPolicy => {
  if (categoryNames.some(isEveningDressCategory)) {
    return {
      categoryName: EVENING_DRESS_CATEGORY,
      windowHours: EVENING_DRESS_WINDOW_HOURS,
      message: 'لقد تجاوز الطلب مدة 24 ساعة من وقت وصول الشحنة للعميل. لا يمكن إنشاء طلب إرجاع أو استبدال لفساتين السهرات.',
    };
  }

  return {
    categoryName: 'other',
    windowHours: DEFAULT_RETURN_WINDOW_DAYS * 24,
    message: 'لقد تجاوز الطلب مدة 3 أيام من وقت وصول الشحنة للعميل. لا يمكن إنشاء طلب إرجاع أو استبدال.',
  };
};

const normalizeDateValue = (value: unknown): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const normalized = value > 1e12 ? value : value * 1000;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return normalizeDateValue(Number(trimmed));
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
    const fallback = new Date(trimmed.replace(' ', 'T'));
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  if (typeof value === 'object') {
    const record = value as AnyRecord;
    for (const key of ['date', 'datetime', 'value', 'timestamp']) {
      const nested = normalizeDateValue(record[key]);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
};

const getNestedValue = (source: AnyRecord | null | undefined, path: string): unknown => {
  if (!source) {
    return undefined;
  }
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    return (current as AnyRecord)[key];
  }, source);
};

const getDeliveryDateFromRecord = (
  source: AnyRecord | null | undefined,
  prefix: string
): { date: Date; source: string } | null => {
  const candidates = [
    'deliveredAt',
    'delivered_at',
    'deliveredDate',
    'delivered_date',
    'deliveryDate',
    'delivery_date',
    'date.delivered',
    'date.delivery',
    'status.delivered_at',
    'status.deliveredAt',
  ];

  for (const candidate of candidates) {
    const date = normalizeDateValue(getNestedValue(source, candidate));
    if (date) {
      return { date, source: `${prefix}.${candidate}` };
    }
  }

  return null;
};

const isDeliveredScan = (scan: AnyRecord): boolean => {
  const values = [
    scan.ScanType,
    scan.scanType,
    scan.code,
    scan.status,
    scan.ScanDescription,
    scan.scanDescription,
    scan.description,
  ]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).trim().toLowerCase());

  return values.some(
    (value) =>
      value === 'dl' ||
      value === 'delivered' ||
      value.includes('delivered') ||
      value.includes('تم التوصيل') ||
      value.includes('تسليم')
  );
};

const extractScanDate = (scan: AnyRecord): Date | null =>
  normalizeDateValue(
    scan.ScanDateTime ??
      scan.scanDateTime ??
      scan.timestamp ??
      scan.date ??
      scan.datetime ??
      scan.created_at ??
      scan.createdAt
  );

const collectScanArrays = (source: unknown, arrays: AnyRecord[][] = []): AnyRecord[][] => {
  if (!source || typeof source !== 'object') {
    return arrays;
  }

  if (Array.isArray(source)) {
    if (source.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))) {
      arrays.push(source as AnyRecord[]);
    }
    source.forEach((entry) => collectScanArrays(entry, arrays));
    return arrays;
  }

  const record = source as AnyRecord;
  for (const key of ['Scans', 'scans', 'TrackingLogs', 'trackingHistory', 'history', 'TrackingHistory']) {
    if (Array.isArray(record[key])) {
      arrays.push(record[key] as AnyRecord[]);
    }
  }

  return arrays;
};

const getDeliveryDateFromShipmentData = (
  shipmentData: Prisma.JsonValue | null | undefined
): { date: Date; source: string } | null => {
  const direct = getDeliveryDateFromRecord(shipmentData as AnyRecord | null | undefined, 'shipmentData');
  if (direct) {
    return direct;
  }

  const deliveredScans = collectScanArrays(shipmentData)
    .flat()
    .filter(isDeliveredScan)
    .map((scan) => extractScanDate(scan))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime());

  return deliveredScans[0]
    ? { date: deliveredScans[0], source: 'shipmentData.deliveredScan' }
    : null;
};

export const resolveReturnDeliveryDate = async (
  merchantId: string,
  order: AnyRecord
): Promise<{ date: Date | null; source?: string; fallbackCandidates?: Record<string, unknown> }> => {
  const orderId = String(order.id ?? '');
  const orderNumber = String(order.reference_id ?? order.order_number ?? order.orderNumber ?? '');

  const localShipment = await prisma.localShipment.findFirst({
    where: {
      merchantId,
      OR: [{ orderId }, { orderNumber }].filter((entry) => Object.values(entry)[0]),
    },
    include: { assignment: true },
    orderBy: { updatedAt: 'desc' },
  });

  const localDeliveryDate =
    getDeliveryDateFromRecord(localShipment?.assignment as AnyRecord | null | undefined, 'localShipment.assignment') ??
    getDeliveryDateFromRecord(localShipment as AnyRecord | null | undefined, 'localShipment') ??
    (localShipment?.status?.toLowerCase() === 'delivered'
      ? { date: localShipment.updatedAt, source: 'localShipment.updatedAt' }
      : null);
  if (localDeliveryDate) {
    return localDeliveryDate;
  }

  const sallaShipment = await prisma.sallaShipment.findFirst({
    where: {
      merchantId,
      OR: [{ orderId }, { orderNumber }].filter((entry) => Object.values(entry)[0]),
    },
    orderBy: { updatedAt: 'desc' },
  });

  const sallaDeliveryDate =
    getDeliveryDateFromShipmentData(sallaShipment?.shipmentData) ??
    (sallaShipment?.status?.toLowerCase() === 'delivered'
      ? { date: sallaShipment.updatedAt, source: 'sallaShipment.updatedAt' }
      : null);
  if (sallaDeliveryDate) {
    return sallaDeliveryDate;
  }

  const orderShipments = Array.isArray(order.shipments) ? order.shipments : [];
  for (const [index, shipment] of orderShipments.entries()) {
    const shipmentDeliveryDate = getDeliveryDateFromRecord(shipment, `order.shipments.${index}`);
    if (shipmentDeliveryDate) {
      return shipmentDeliveryDate;
    }
  }

  const orderDate = extractOrderDate(order);
  return {
    date: orderDate.date,
    source: orderDate.source ? `order.${orderDate.source}` : undefined,
    fallbackCandidates: orderDate.candidates,
  };
};

const getOrderItemProductId = (item: AnyRecord): string | null => {
  const candidates = [
    item.product_id,
    item.productId,
    item.productID,
    item.product?.id,
    item.product?.product_id,
    item.product?.productId,
  ];

  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }

  return null;
};

export const getCategoryNamesForProductIds = async (
  merchantId: string,
  productIds: string[]
): Promise<string[]> => {
  const categoriesByProduct = await getCategoryNamesByProductId(merchantId, productIds);
  return Object.values(categoriesByProduct).flat();
};

export const getCategoryNamesByProductId = async (
  merchantId: string,
  productIds: string[]
): Promise<Record<string, string[]>> => {
  const uniqueProductIds = Array.from(new Set(productIds.filter(Boolean)));
  const entries = await Promise.all(
    uniqueProductIds.map(async (productId) => {
      const product = await getSallaProduct(merchantId, productId);
      const names = new Set<string>();
      const category = normalizeCategoryName(product?.category);
      if (category) {
        names.add(category);
      }
      if (Array.isArray(product?.categories)) {
        product.categories.forEach((entry) => {
          const name = normalizeCategoryName(entry?.name);
          if (name) {
            names.add(name);
          }
        });
      }
      return [productId, Array.from(names)] as const;
    })
  );

  return Object.fromEntries(entries);
};

export const getCategoryNamesForOrderItems = async (
  merchantId: string,
  items: Array<SallaOrderItem | AnyRecord>
): Promise<string[]> => {
  const productIds = items
    .map((item) => getOrderItemProductId(item as AnyRecord))
    .filter((productId): productId is string => Boolean(productId));

  return getCategoryNamesForProductIds(merchantId, productIds);
};

export const getProductIdsForOrderItems = (items: Array<SallaOrderItem | AnyRecord>): string[] =>
  items
    .map((item) => getOrderItemProductId(item as AnyRecord))
    .filter((productId): productId is string => Boolean(productId));

export const getDiscountedProductIds = (categoriesByProductId: Record<string, string[]>): Set<string> => {
  const productIds = new Set<string>();
  Object.entries(categoriesByProductId).forEach(([productId, categoryNames]) => {
    if (categoryNames.some(isDiscountedCategory)) {
      productIds.add(productId);
    }
  });
  return productIds;
};

export const evaluateReturnWindow = (params: {
  categoryNames: string[];
  deliveryDate: Date;
  now?: Date;
}): ReturnWindowEvaluation => {
  const now = params.now ?? new Date();
  const policy = getReturnWindowPolicy(params.categoryNames);
  const elapsedHours = (now.getTime() - params.deliveryDate.getTime()) / HOUR_MS;
  const allowedDays = policy.windowHours / 24;
  const daysSinceDelivery = (now.getTime() - params.deliveryDate.getTime()) / DAY_MS;

  return {
    eligible: daysSinceDelivery <= allowedDays + EPSILON_DAYS,
    policy,
    deliveryDate: params.deliveryDate,
    deliveryDateSource: '',
    elapsedHours,
    daysSinceDelivery,
  };
};
