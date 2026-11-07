import vm from 'node:vm';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import {
  PROMO_EXCLUDED_ORDER_STATUSES,
  getPromoLimitConfig,
  getPromoProductIds,
} from '@/app/lib/promo-limit';

/**
 * Live view of the 1 SAR promo: which orders carry promo items, which customers
 * went over the one-unit allowance, and whether the storefront blocker is
 * actually installed in the live theme JS (a bad paste there switched it off once).
 */

/** When the promo went live; orders before this are not part of it. */
export function getPromoStartsAt(env: Record<string, string | undefined> = process.env): Date {
  const parsed = env.PROMO_LIMIT_STARTS_AT ? new Date(env.PROMO_LIMIT_STARTS_AT) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date('2026-11-03T00:00:00+03:00');
}

export interface PromoMonitorOrderInput {
  orderId: string;
  referenceId: string | null;
  placedAt: Date | null;
  statusSlug: string | null;
  statusName: string | null;
  customerId: string | null;
  customerName: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
  items: Array<{ name: string | null; sku: string | null; quantity: number }>;
}

export type PromoViolationReason = 'in_order' | 'prior_order';

export interface PromoMonitorOrder extends PromoMonitorOrderInput {
  promoUnits: number;
  /** Promo units this customer already had in earlier active orders. */
  priorUnits: number;
  /** Units over the allowance in this order (0 when within the limit). */
  extraUnits: number;
  violation: boolean;
  reason: PromoViolationReason | null;
  /** Reference of the customer's first promo order, when this one is not it. */
  firstOrderRef: string | null;
  cancelled: boolean;
  customerKey: string;
}

function isCancelled(statusSlug: string | null): boolean {
  return Boolean(statusSlug && PROMO_EXCLUDED_ORDER_STATUSES.includes(statusSlug));
}

function normalizeMobile(value: string | null): string | null {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-9) : null;
}

/**
 * Groups orders by customer the way the guards match them (same customer id,
 * mobile or email), then walks each customer's orders in time order and marks
 * every order that takes them past `maxPerCustomer`. Cancelled orders never use
 * up the allowance.
 */
export function analyzePromoOrders(orders: PromoMonitorOrderInput[], maxPerCustomer: number): PromoMonitorOrder[] {
  const parent = orders.map((_, index) => index);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const owner = new Map<string, number>();
  orders.forEach((order, index) => {
    const keys = [
      order.customerId ? `id:${order.customerId}` : null,
      normalizeMobile(order.customerMobile) ? `m:${normalizeMobile(order.customerMobile)}` : null,
      order.customerEmail ? `e:${order.customerEmail.trim().toLowerCase()}` : null,
    ].filter((key): key is string => Boolean(key));
    for (const key of keys) {
      const seen = owner.get(key);
      if (seen == null) owner.set(key, index);
      else parent[find(index)] = find(seen);
    }
  });

  const groups = new Map<number, number[]>();
  orders.forEach((_, index) => {
    const root = find(index);
    const list = groups.get(root) ?? [];
    list.push(index);
    groups.set(root, list);
  });

  const result: PromoMonitorOrder[] = new Array(orders.length);
  for (const [root, members] of groups) {
    const sorted = [...members].sort((a, b) => {
      const ta = orders[a].placedAt?.getTime() ?? 0;
      const tb = orders[b].placedAt?.getTime() ?? 0;
      return ta - tb || orders[a].orderId.localeCompare(orders[b].orderId);
    });
    const customerKey = `g${root}`;
    let used = 0;
    let firstRef: string | null = null;
    for (const index of sorted) {
      const order = orders[index];
      const promoUnits = order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const cancelled = isCancelled(order.statusSlug);
      const priorUnits = used;
      let extraUnits = 0;
      let reason: PromoViolationReason | null = null;
      if (!cancelled && promoUnits > 0) {
        extraUnits = Math.max(0, priorUnits + promoUnits - maxPerCustomer);
        if (extraUnits > 0) reason = priorUnits >= maxPerCustomer ? 'prior_order' : 'in_order';
        used += promoUnits;
      }
      const isFirst = !cancelled && promoUnits > 0 && firstRef == null;
      result[index] = {
        ...order,
        promoUnits,
        priorUnits,
        extraUnits,
        violation: extraUnits > 0,
        reason,
        firstOrderRef: isFirst ? null : firstRef,
        cancelled,
        customerKey,
      };
      if (isFirst) firstRef = order.referenceId || order.orderId;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Storefront blocker health
// ---------------------------------------------------------------------------

export type StorefrontBlockerState = 'ok' | 'missing' | 'broken' | 'unreachable';

export interface StorefrontBlockerHealth {
  state: StorefrontBlockerState;
  detail: string;
  scriptUrl: string | null;
  checkedAt: string;
}

const STOREFRONT_URL = 'https://mleha.com/';
const HEALTH_TTL_MS = 60_000;
const HEALTH_WAIT_MS = 3000;
const HEALTH_SETTINGS_KEY = 'promo_limit.storefront_health';
let healthCache: { at: number; value: StorefrontBlockerHealth } | null = null;
let healthInflight: Promise<StorefrontBlockerHealth> | null = null;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MlehaPromoMonitor/1.0)', Accept: 'text/html,*/*' },
    cache: 'no-store',
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** Pure part of the check, given the theme custom JS source. */
export function inspectThemeScript(source: string): { state: 'ok' | 'missing' | 'broken'; detail: string } {
  try {
    // Compile only; nothing runs.
    new vm.Script(source, { filename: 'theme-custom.js' });
  } catch (error) {
    return {
      state: 'broken',
      detail: `ملف JS المخصص في الثيم فيه خطأ ولا يعمل أي كود فيه: ${error instanceof Error ? error.message : 'خطأ غير معروف'}`,
    };
  }
  if (!/promo-limit/.test(source)) {
    return { state: 'missing', detail: 'ملف JS المخصص في الثيم لا يحمّل سكربت حد عرض الريال' };
  }
  return { state: 'ok', detail: 'سكربت حد عرض الريال مثبّت في الثيم والملف سليم' };
}

async function runStorefrontCheck(): Promise<StorefrontBlockerHealth> {
  try {
    const html = await fetchText(STOREFRONT_URL);
    const match = html.match(/https:\/\/cdn\.assets\.salla\.network\/themes\/customization\/[^"'\s]+\.js[^"'\s]*/);
    if (!match) {
      return {
        state: 'missing',
        detail: 'لم يتم العثور على ملف JS مخصص في صفحة المتجر',
        scriptUrl: null,
        checkedAt: new Date().toISOString(),
      };
    }
    const scriptUrl = match[0].replace(/&amp;/g, '&');
    const source = await fetchText(scriptUrl);
    return { ...inspectThemeScript(source), scriptUrl, checkedAt: new Date().toISOString() };
  } catch (error) {
    log.warn('Promo monitor storefront check failed', { error: error instanceof Error ? error.message : error });
    return {
      state: 'unreachable',
      detail: 'تعذر فحص المتجر الآن، سيعاد الفحص تلقائياً',
      scriptUrl: null,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function readPersistedHealth(): Promise<StorefrontBlockerHealth | null> {
  try {
    const row = await prisma.settings.findUnique({ where: { key: HEALTH_SETTINGS_KEY } });
    const parsed = row ? (JSON.parse(row.value) as StorefrontBlockerHealth) : null;
    return parsed?.state && parsed.checkedAt ? parsed : null;
  } catch {
    return null;
  }
}

function refreshStorefrontHealth(): Promise<StorefrontBlockerHealth> {
  if (healthInflight) return healthInflight;
  healthInflight = (async () => {
    try {
      const value = await runStorefrontCheck();
      healthCache = { at: Date.now(), value };
      const json = JSON.stringify(value);
      await prisma.settings
        .upsert({
          where: { key: HEALTH_SETTINGS_KEY },
          create: { key: HEALTH_SETTINGS_KEY, value: json, description: 'Last storefront promo blocker check (promo monitor)' },
          update: { value: json },
        })
        .catch(() => undefined);
      return value;
    } finally {
      healthInflight = null;
    }
  })();
  return healthInflight;
}

/**
 * Storefront blocker status for the monitor. Never makes the page wait on
 * mleha.com: the last result (memory, else the Settings table, so a fresh
 * server instance has one too) is returned at once and re-checked in the
 * background once it is a minute old. Only when no result exists anywhere does
 * it wait for a check, and then for at most HEALTH_WAIT_MS.
 */
export async function checkStorefrontBlocker(options: { force?: boolean } = {}): Promise<StorefrontBlockerHealth> {
  if (options.force) return refreshStorefrontHealth();
  if (!healthCache) {
    const persisted = await readPersistedHealth();
    if (persisted) healthCache = { at: new Date(persisted.checkedAt).getTime(), value: persisted };
  }
  if (healthCache) {
    if (Date.now() - healthCache.at >= HEALTH_TTL_MS) void refreshStorefrontHealth().catch(() => undefined);
    return healthCache.value;
  }
  const pending: StorefrontBlockerHealth = {
    state: 'unreachable',
    detail: 'جاري فحص المتجر لأول مرة…',
    scriptUrl: null,
    checkedAt: new Date().toISOString(),
  };
  return Promise.race([
    refreshStorefrontHealth().catch(() => pending),
    new Promise<StorefrontBlockerHealth>((resolve) => setTimeout(() => resolve(pending), HEALTH_WAIT_MS)),
  ]);
}

// ---------------------------------------------------------------------------
// Snapshot for the dashboard
// ---------------------------------------------------------------------------

export interface PromoMonitorSnapshot {
  enabled: boolean;
  maxPerCustomer: number;
  startsAt: string;
  promoProductCount: number;
  orders: PromoMonitorOrder[];
  /** Orders since the start with no stored line items (can't be checked yet). */
  ordersWithoutItems: number;
  totalOrdersSinceStart: number;
  lastOrderAt: string | null;
}

interface PromoItemRow {
  orderId: string;
  name: string | null;
  sku: string | null;
  quantity: number;
  referenceId: string | null;
  orderNumber: string | null;
  placedAt: Date | null;
  statusSlug: string | null;
  statusName: string | null;
  customerId: string | null;
  customerName: string | null;
  customerMobile: string | null;
  customerEmail: string | null;
}

async function loadPromoOrderInputs(
  merchantId: string,
  promoProductIds: string[],
  startsAt: Date
): Promise<PromoMonitorOrderInput[]> {
  if (promoProductIds.length === 0) return [];
  // One join instead of Prisma's relation filter, which takes several round
  // trips (items, then their orders) and was the slowest part of the page.
  const rows = await prisma.$queryRaw<PromoItemRow[]>`
    SELECT i."orderId", i."name", i."sku", i."quantity",
           o."referenceId", o."orderNumber", o."placedAt", o."statusSlug", o."statusName",
           o."customerId", o."customerName", o."customerMobile", o."customerEmail"
    FROM "SallaOrderItem" i
    JOIN "SallaOrder" o ON o."merchantId" = i."merchantId" AND o."orderId" = i."orderId"
    WHERE i."merchantId" = ${merchantId}
      AND o."placedAt" >= ${startsAt}
      AND i."productId" = ANY(${promoProductIds}::text[])`;
  const items = rows.map((row) => ({
    orderId: row.orderId,
    name: row.name,
    sku: row.sku,
    quantity: Number(row.quantity) || 0,
    order: row,
  }));

  const byOrder = new Map<string, PromoMonitorOrderInput>();
  for (const item of items) {
    let order = byOrder.get(item.orderId);
    if (!order) {
      order = {
        orderId: item.orderId,
        referenceId: item.order.referenceId || item.order.orderNumber,
        placedAt: item.order.placedAt,
        statusSlug: item.order.statusSlug,
        statusName: item.order.statusName,
        customerId: item.order.customerId,
        customerName: item.order.customerName,
        customerMobile: item.order.customerMobile,
        customerEmail: item.order.customerEmail,
        items: [],
      };
      byOrder.set(item.orderId, order);
    }
    order.items.push({ name: item.name, sku: item.sku, quantity: item.quantity });
  }
  return Array.from(byOrder.values());
}

const VIOLATORS_TTL_MS = 60_000;
let violatorsCache: { at: number; merchantId: string; ids: Set<string> } | null = null;
let violatorsInflight: Promise<Set<string>> | null = null;

/**
 * Ids of active orders over the promo limit, from stored order items. Order
 * prep uses it to leave those orders out of the queue without fetching each
 * one from Salla. Stale-while-revalidate: after the first load, callers get the
 * last result at once and it is rebuilt in the background every 60 seconds,
 * so no prep request waits on it. Empty (nothing skipped) only if it has never
 * loaded and the first load fails.
 */
export async function getViolatingPromoOrderIds(merchantId: string): Promise<Set<string>> {
  const cached = violatorsCache?.merchantId === merchantId ? violatorsCache : null;
  if (cached && Date.now() - cached.at < VIOLATORS_TTL_MS) return cached.ids;
  const refresh = refreshViolators(merchantId);
  if (cached) {
    void refresh.catch(() => undefined);
    return cached.ids;
  }
  return refresh;
}

function refreshViolators(merchantId: string): Promise<Set<string>> {
  // Preparers loading at the same time share one rebuild.
  if (violatorsInflight) return violatorsInflight;
  violatorsInflight = (async () => {
    try {
      const config = getPromoLimitConfig();
      if (!config.enabled) return new Set<string>();
      const promoProductIds = await getPromoProductIds(merchantId);
      const orders = analyzePromoOrders(
        await loadPromoOrderInputs(merchantId, promoProductIds, getPromoStartsAt()),
        config.maxPerCustomer
      );
      const ids = new Set(orders.filter((order) => order.violation && !order.cancelled).map((order) => order.orderId));
      violatorsCache = { at: Date.now(), merchantId, ids };
      return ids;
    } catch (error) {
      log.error('Failed to load promo limit violators', { error: error instanceof Error ? error.message : error });
      // Keep skipping the last known set rather than flooding prep with them.
      return violatorsCache?.merchantId === merchantId ? violatorsCache.ids : new Set<string>();
    } finally {
      violatorsInflight = null;
    }
  })();
  return violatorsInflight;
}

const SNAPSHOT_TTL_MS = 10_000;
let snapshotCache: { at: number; merchantId: string; value: PromoMonitorSnapshot } | null = null;
let snapshotInflight: Promise<PromoMonitorSnapshot> | null = null;

/**
 * Snapshot for /promo-monitor. Viewers within 10 seconds of each other (and
 * the page's own 20-second auto-refresh) share one build instead of each
 * running the queries again.
 */
export async function getPromoMonitorSnapshot(merchantId: string): Promise<PromoMonitorSnapshot> {
  if (snapshotCache?.merchantId === merchantId && Date.now() - snapshotCache.at < SNAPSHOT_TTL_MS) {
    return snapshotCache.value;
  }
  if (!snapshotInflight) {
    snapshotInflight = buildPromoMonitorSnapshot(merchantId)
      .then((value) => {
        snapshotCache = { at: Date.now(), merchantId, value };
        return value;
      })
      .finally(() => {
        snapshotInflight = null;
      });
  }
  return snapshotInflight;
}

async function buildPromoMonitorSnapshot(merchantId: string): Promise<PromoMonitorSnapshot> {
  const config = getPromoLimitConfig();
  const startsAt = getPromoStartsAt();
  const base = {
    enabled: config.enabled,
    maxPerCustomer: config.maxPerCustomer,
    startsAt: startsAt.toISOString(),
  };

  const [promoProductIds, totalOrdersSinceStart, ordersWithoutItems, lastOrder] = await Promise.all([
    config.enabled ? getPromoProductIds(merchantId) : Promise.resolve([] as string[]),
    prisma.sallaOrder.count({ where: { merchantId, placedAt: { gte: startsAt } } }),
    prisma.sallaOrder.count({ where: { merchantId, placedAt: { gte: startsAt }, items: { none: {} } } }),
    prisma.sallaOrder.findFirst({
      where: { merchantId },
      orderBy: { placedAt: 'desc' },
      select: { placedAt: true },
    }),
  ]);

  const inputs = await loadPromoOrderInputs(merchantId, promoProductIds, startsAt);

  return {
    ...base,
    promoProductCount: promoProductIds.length,
    orders: analyzePromoOrders(inputs, config.maxPerCustomer),
    ordersWithoutItems,
    totalOrdersSinceStart,
    lastOrderAt: lastOrder?.placedAt ? lastOrder.placedAt.toISOString() : null,
  };
}
