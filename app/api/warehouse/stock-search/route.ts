import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import type { ServiceKey } from '@/app/lib/service-definitions';
import { resolveSallaMerchantId } from '@/app/api/salla/products/merchant';
import {
  getSallaProductBySku,
  getSallaProductVariations,
  searchSallaProductsBySku,
  type SallaProductSummary,
  type SallaProductVariation,
} from '@/app/lib/salla-api';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getStatusById } from '@/SALLA_ORDER_STATUSES';

export const runtime = 'nodejs';

const ALLOWED_SERVICES: ServiceKey[] = [
  'warehouse',
  'warehouse-locations',
  'order-prep',
  'search-update-stock',
];
const MAX_PRODUCTS = 5;
const FALLBACK_FETCH_SIZE = 50;
const ACTIVE_REMOTE_ORDER_STATUSES = ['under_review', 'in_progress', 'new', 'new_order'];
const ACTIVE_REMOTE_ORDER_NAMES = [
  'طلب جديد',
  'بإنتظار المراجعة',
  'تحت المراجعة',
  'قيد التنفيذ',
  'جاري التجهيز',
  'جاري التنفيذ',
];
const ACTIVE_WEBHOOK_STATUS_VALUES = [
  ...ACTIVE_REMOTE_ORDER_STATUSES,
  ...ACTIVE_REMOTE_ORDER_NAMES,
  '449146439',
  '566146469',
  '1065456688',
  '1576217163',
  '1882207425',
  '1939592358',
  '1956875584',
];
const WEBHOOK_ORDER_LOOKBACK_DAYS = 30;

type PendingAssignment = {
  orderId: string;
  status: string;
  sallaStatus: string | null;
  orderData: Prisma.JsonValue | null;
};

type PendingOrderSource = {
  orderId: string;
  status: string | null;
  orderData: Prisma.JsonValue | null;
};

type StockSearchResult = {
  product: Pick<
    SallaProductSummary,
    'id' | 'name' | 'sku' | 'imageUrl' | 'lastUpdatedAt' | 'availableQuantity'
  > & {
    location?: {
      sku: string;
      location: string;
      updatedAt: string;
      updatedBy?: string | null;
    } | null;
  };
  variations: Array<{
    id: string;
    name: string;
    sku?: string;
    barcode?: string | null;
    sallaStock: number;
    pendingQuantity: number;
  }>;
};

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !hasServiceAccess(session, ALLOWED_SERVICES)) {
    return NextResponse.json(
      { error: 'ليس لديك صلاحية لاستخدام أداة تحديث المخزون' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const skuInput = typeof body?.sku === 'string' ? body.sku.trim() : '';
    const merchantHint = typeof body?.merchantId === 'string' ? body.merchantId.trim() : undefined;

    if (!skuInput) {
      return NextResponse.json({ error: 'يرجى إدخال رمز SKU أو الباركود للبحث' }, { status: 400 });
    }

    const resolved = await resolveSallaMerchantId(merchantHint);
    if (!resolved.merchantId) {
      return NextResponse.json(
        { error: resolved.error || 'لا يوجد متجر مرتبط بسلة حالياً.' },
        { status: merchantHint ? 404 : 503 }
      );
    }

    const primaryProduct = await getSallaProductBySku(resolved.merchantId, skuInput).catch(
      () => null
    );

    let products: SallaProductSummary[] = [];
    if (primaryProduct) {
      products = [primaryProduct];
    } else {
      products = await searchSallaProductsBySku(resolved.merchantId, skuInput, {
        perPage: FALLBACK_FETCH_SIZE,
        maxResults: MAX_PRODUCTS,
      });
    }

    if (!products.length) {
      return NextResponse.json({
        success: true,
        merchantId: resolved.merchantId,
        results: [],
      });
    }

    const trimmedProducts = products.slice(0, MAX_PRODUCTS);
    const productVariations = await loadProductVariations(resolved.merchantId, trimmedProducts);
    const parentSkuSet = new Set(
      trimmedProducts
        .map((product) => normalizeSku(product.sku))
        .filter((sku): sku is string => Boolean(sku))
    );

    const parentLocationRecords = parentSkuSet.size
      ? await prisma.sallaProductLocation.findMany({
          where: { sku: { in: Array.from(parentSkuSet) } },
        })
      : [];

    const variantSkuEntries = collectVariantSkuEntries(trimmedProducts);
    const pendingMap = variantSkuEntries.keys.length
      ? await loadPendingQuantities(resolved.merchantId, variantSkuEntries)
      : {};

    const results: StockSearchResult[] = trimmedProducts.map((product) => {
      const normalizedParentSku = normalizeSku(product.sku);
      const locationRecord =
        normalizedParentSku &&
        parentLocationRecords.find((record) => record.sku === normalizedParentSku);

      const variationsSource: SallaProductVariation[] =
        productVariations[product.id] && productVariations[product.id]!.length > 0
          ? productVariations[product.id]!
          : (product.variations && product.variations.length > 0
              ? product.variations
              : [
                  {
                    id: product.id,
                    name: product.name,
                    sku: product.sku,
                    availableQuantity: product.availableQuantity ?? null,
                    barcode: undefined,
                  },
                ]) as SallaProductVariation[];

      const variations = variationsSource.map((variation) => {
        const normalizedSku = normalizeSku(variation.sku);
        const pendingQuantity = normalizedSku ? pendingMap[normalizedSku] ?? 0 : 0;
        return {
          id: String(variation.id ?? variation.sku ?? product.id),
          name: variation.name || `متغير ${variation.id ?? variation.sku ?? ''}`,
          sku: variation.sku || undefined,
          barcode: variation.barcode || null,
          sallaStock: sanitizeQuantity(variation.availableQuantity),
          pendingQuantity,
        };
      });

      return {
        product: {
          id: product.id,
          name: product.name,
          sku: product.sku,
          imageUrl: product.imageUrl,
          lastUpdatedAt: product.lastUpdatedAt ?? null,
          availableQuantity: product.availableQuantity ?? null,
          location: locationRecord
            ? {
                sku: locationRecord.sku,
                location: locationRecord.location,
                updatedAt: locationRecord.updatedAt.toISOString(),
                updatedBy: locationRecord.updatedBy,
              }
            : null,
        },
        variations,
      };
    });

    return NextResponse.json({
      success: true,
      merchantId: resolved.merchantId,
      results,
    });
  } catch (error) {
    log.error('Failed to search stock for SKU', { error });
    return NextResponse.json(
      { error: 'تعذر تحميل بيانات المنتج. حاول مرة أخرى لاحقاً.' },
      { status: 500 }
    );
  }
}

function normalizeSku(input: unknown) {
  if (typeof input !== 'string') {
    return '';
  }
  const trimmed = input.trim();
  return trimmed ? trimmed.toUpperCase() : '';
}

function sanitizeQuantity(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return 0;
}

function collectVariantSkuEntries(products: SallaProductSummary[]) {
  const keys: string[] = [];
  const entries: Array<{ sku: string; tokens: Set<string> }> = [];

  products.forEach((product) => {
    const variations = Array.isArray(product.variations) ? product.variations : [];
    if (variations.length === 0 && product.sku) {
      const normalized = normalizeSku(product.sku);
      if (normalized) {
        keys.push(normalized);
        entries.push({ sku: normalized, tokens: new Set(generateSkuVariants(normalized)) });
      }
      return;
    }

    variations.forEach((variation) => {
      const normalized = normalizeSku(variation.sku);
      if (!normalized) {
        return;
      }
      if (!keys.includes(normalized)) {
        keys.push(normalized);
        entries.push({ sku: normalized, tokens: new Set(generateSkuVariants(normalized)) });
      }
    });
  });

  return { keys, entries };
}

async function loadPendingQuantities(merchantId: string, entrySet: {
  keys: string[];
  entries: Array<{ sku: string; tokens: Set<string> }>;
}) {
  const result: Record<string, number> = {};

  const [assignments, syncedOrders, webhookOrders] = await Promise.all([
    prisma.orderAssignment.findMany({
      where: {
        merchantId,
        status: { in: ['assigned', 'preparing'] },
        removedAt: null,
      },
      select: {
        orderId: true,
        status: true,
        sallaStatus: true,
        orderData: true,
      },
    }),
    prisma.sallaOrder.findMany({
      where: {
        merchantId,
        OR: [
          { statusSlug: { in: ACTIVE_REMOTE_ORDER_STATUSES } },
          { statusName: { in: ACTIVE_REMOTE_ORDER_NAMES } },
        ],
      },
      select: {
        orderId: true,
        statusSlug: true,
        rawOrder: true,
      },
    }),
    loadMatchingWebhookOrders(merchantId, entrySet).catch((error) => {
      log.warn('Failed to load pending orders from recent Salla webhooks', { error });
      return [];
    }),
  ]);

  const ordersById = new Map<string, Prisma.JsonValue | null>();

  assignments.forEach((assignment) => {
    if (!shouldCountAssignment(assignment)) {
      return;
    }
    ordersById.set(assignment.orderId, assignment.orderData);
  });

  syncedOrders.forEach((order) => {
    if (ordersById.has(order.orderId) || !shouldCountRemoteOrder(order.statusSlug, order.rawOrder)) {
      return;
    }
    ordersById.set(order.orderId, order.rawOrder);
  });

  webhookOrders.forEach((order) => {
    if (ordersById.has(order.orderId) || !shouldCountRemoteOrder(order.status, order.orderData)) {
      return;
    }
    ordersById.set(order.orderId, order.orderData);
  });

  ordersById.forEach((orderData) => {
    const items = extractOrderItems(orderData);
    items.forEach((item: any) => {
      const normalizedSku = normalizeSku(
        item?.sku ?? item?.product?.sku ?? item?.variant?.sku ?? item?.product_sku
      );
      if (!normalizedSku) {
        return;
      }
      const variantKey = findMatchingSku(normalizedSku, entrySet.entries);
      if (!variantKey) {
        return;
      }
      const quantity = sanitizeQuantity(item?.quantity ?? item?.qty ?? item?.count);
      if (quantity <= 0) {
        return;
      }
      result[variantKey] = (result[variantKey] || 0) + quantity;
    });
  });

  return result;
}

async function loadMatchingWebhookOrders(
  merchantId: string,
  entrySet: {
    keys: string[];
    entries: Array<{ sku: string; tokens: Set<string> }>;
  }
): Promise<PendingOrderSource[]> {
  const cutoff = new Date(Date.now() - WEBHOOK_ORDER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const latestActiveOrders = await prisma.$queryRaw<
    Array<{ orderId: string; status: string | null }>
  >(Prisma.sql`
    SELECT latest."orderId", latest."status"
    FROM (
      SELECT DISTINCT ON ("orderId") "orderId", "status", "receivedAt"
      FROM "WebhookEvent"
      WHERE "orderId" IS NOT NULL
        AND "receivedAt" >= ${cutoff}
      ORDER BY "orderId", "receivedAt" DESC
    ) latest
    WHERE LOWER(latest."status") IN (${Prisma.join(ACTIVE_WEBHOOK_STATUS_VALUES)})
  `);
  const orderIds = latestActiveOrders.map((order) => order.orderId).filter(Boolean);

  if (orderIds.length === 0) {
    return [];
  }

  const events = await prisma.webhookEvent.findMany({
    where: { orderId: { in: orderIds } },
    orderBy: { receivedAt: 'desc' },
    select: {
      orderId: true,
      status: true,
      rawPayload: true,
    },
  });
  const matchingPayloadByOrderId = new Map<string, Prisma.JsonValue>();

  events.forEach((event) => {
    if (!event.orderId || extractMerchantId(event.rawPayload) !== merchantId) {
      return;
    }
    if (
      !matchingPayloadByOrderId.has(event.orderId) &&
      extractOrderItems(event.rawPayload).some((item: any) => {
        const sku = normalizeSku(
          item?.sku ?? item?.product?.sku ?? item?.variant?.sku ?? item?.product_sku
        );
        return Boolean(sku && findMatchingSku(sku, entrySet.entries));
      })
    ) {
      matchingPayloadByOrderId.set(event.orderId, event.rawPayload);
    }
  });

  return latestActiveOrders.flatMap((order) => {
    const orderData = matchingPayloadByOrderId.get(order.orderId);
    if (!orderData) {
      return [];
    }
    return [{ orderId: order.orderId, status: order.status, orderData }];
  });
}

function extractOrderItems(orderData: Prisma.JsonValue | null): unknown[] {
  if (!orderData || typeof orderData !== 'object') {
    return [];
  }

  const payload = orderData as Record<string, any>;
  const data = unwrapOrderPayload(payload);
  const candidates = [data.items, data.order_items, data.products, data.lines].filter(Array.isArray);

  if (candidates.length > 0) {
    return candidates[0] as unknown[];
  }

  return [];
}

function unwrapOrderPayload(payload: Record<string, any>): Record<string, any> {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  return data.order && typeof data.order === 'object' ? data.order : data;
}

function extractMerchantId(orderData: Prisma.JsonValue | null): string | null {
  if (!orderData || typeof orderData !== 'object') {
    return null;
  }
  const payload = orderData as Record<string, any>;
  const order = unwrapOrderPayload(payload);
  const candidates = [
    payload.merchant,
    payload.merchant_id,
    payload.merchantId,
    order.merchant,
    order.merchant_id,
    order.merchantId,
    order.store?.id,
    order.store_id,
    order.storeId,
  ];
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return null;
}

function shouldCountAssignment(assignment: PendingAssignment): boolean {
  if (!assignment) {
    return false;
  }

  const pendingStatuses = new Set(['assigned', 'preparing']);
  if (pendingStatuses.has((assignment.status || '').toLowerCase())) {
    return true;
  }

  const slug = extractStatusSlug(assignment.sallaStatus, assignment.orderData);
  if (!slug) {
    return false;
  }

  return slug === 'in_progress' || slug === 'under_review' || slug === 'new' || slug === 'new_order';
}

function shouldCountRemoteOrder(
  rawStatus: string | null,
  orderData: Prisma.JsonValue | null
): boolean {
  const slug = extractStatusSlug(rawStatus, orderData);
  return Boolean(slug && ACTIVE_REMOTE_ORDER_STATUSES.includes(slug));
}

function extractStatusSlug(
  rawStatus: string | null,
  orderData: Prisma.JsonValue | null
): string | null {
  if (rawStatus) {
    const value = rawStatus.toString().trim();
    if (!value) {
      return null;
    }
    if (/^\d+$/.test(value)) {
      const status = getStatusById(Number.parseInt(value, 10));
      return status?.slug || null;
    }
    if (ARABIC_STATUS_TO_SLUG[value]) {
      return ARABIC_STATUS_TO_SLUG[value];
    }
    return value.toLowerCase();
  }

  if (!orderData || typeof orderData !== 'object') {
    return null;
  }

  const payload = unwrapOrderPayload(orderData as Record<string, any>);
  const status = payload.status || payload.order_status || null;
  const slugSources = [
    payload.statusSlug,
    payload.status_slug,
    payload.slug,
    status?.slug,
    status?.status,
    status?.code,
  ];

  for (const source of slugSources) {
    if (typeof source === 'string' && source.trim().length > 0) {
      return source.trim().toLowerCase();
    }
  }

  const idSources = [payload.statusId, payload.status_id, status?.id];
  for (const id of idSources) {
    if (typeof id === 'number' && Number.isFinite(id)) {
      const entry = getStatusById(id);
      if (entry?.slug) {
        return entry.slug;
      }
    }
    if (typeof id === 'string' && /^\d+$/.test(id.trim())) {
      const entry = getStatusById(Number.parseInt(id.trim(), 10));
      if (entry?.slug) {
        return entry.slug;
      }
    }
  }

  const nameSources = [
    payload.statusName,
    payload.status_name,
    payload.statusLabel,
    payload.status_label,
    status?.name,
    status?.title,
  ];

  for (const source of nameSources) {
    if (typeof source === 'string') {
      const normalized = source.trim();
      if (!normalized) {
        continue;
      }
      if (ARABIC_STATUS_TO_SLUG[normalized]) {
        return ARABIC_STATUS_TO_SLUG[normalized];
      }
    }
  }

  return null;
}

const ARABIC_STATUS_TO_SLUG: Record<string, string> = {
  'طلب جديد': 'under_review',
  'بإنتظار المراجعة': 'under_review',
  'تحت المراجعة': 'under_review',
  'قيد التنفيذ': 'in_progress',
  'جاري التجهيز': 'in_progress',
  'جاري التنفيذ': 'in_progress',
};

function generateSkuVariants(value: string): string[] {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return [];
  }

  const variants = new Set<string>();
  variants.add(normalized);

  normalized
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .forEach((segment) => variants.add(segment));

  const withoutTrailingLetters = normalized.replace(/[A-Z]+$/g, '');
  if (withoutTrailingLetters && withoutTrailingLetters !== normalized) {
    variants.add(withoutTrailingLetters);
  }

  const withoutTrailingDigits = normalized.replace(/\d+$/g, '');
  if (withoutTrailingDigits && withoutTrailingDigits !== normalized) {
    variants.add(withoutTrailingDigits);
  }

  return Array.from(variants).filter((sku) => sku.length >= 3);
}

function findMatchingSku(
  candidate: string,
  entries: Array<{ sku: string; tokens: Set<string> }>
): string | null {
  for (const entry of entries) {
    if (entry.sku === candidate) {
      return entry.sku;
    }
  }

  let bestMatch: { sku: string; score: number } | null = null;
  for (const entry of entries) {
    if (candidate.includes(entry.sku) || entry.sku.includes(candidate)) {
      const score = Math.min(entry.sku.length, candidate.length);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { sku: entry.sku, score };
      }
      continue;
    }

    for (const token of entry.tokens) {
      if (!token) {
        continue;
      }
      if (token === candidate || candidate.includes(token) || token.includes(candidate)) {
        const score = token.length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { sku: entry.sku, score };
        }
        break;
      }
    }
  }

  return bestMatch ? bestMatch.sku : null;
}

async function loadProductVariations(
  merchantId: string,
  products: SallaProductSummary[]
): Promise<Record<number, SallaProductVariation[]>> {
  const result: Record<number, SallaProductVariation[]> = {};

  await Promise.all(
    products.map(async (product) => {
      if (!product?.id) {
        return;
      }
      try {
        const entries = await getSallaProductVariations(merchantId, product.id.toString());
        result[product.id] = Array.isArray(entries) ? entries : [];
      } catch (error) {
        log.error('Failed to load product variations for stock search', {
          merchantId,
          productId: product.id,
          error,
        });
      }
    })
  );

  return result;
}
