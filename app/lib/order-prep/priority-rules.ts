import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { normalizeE164Phone } from '@/app/lib/phone';
import { getWaitingDestinations, normalizeCity, orderIdsForCities, orderIdsForDestination, type Destination } from './destination-cache';
import { productIdsForCategories, readPriorityCatalog, type PriorityCatalog } from './priority-catalog';
import { placedAtCutoff, toSqlTimestamp } from './riyadh-time';
import { NEW_ORDER_STATUS_ID } from './sync-rules';

/**
 * Supervisor rules for the order the prep queue hands out orders, set on the
 * «الأولويات» tab of the warehouse dashboard.
 *
 * Queue order, top to bottom:
 *   1. «طلب مميز» (HighPriorityOrder) — specific orders, always first.
 *   2. Max-wait guard — orders older than `maxWaitHours`, oldest first, so a
 *      lowered or low-ranked order never waits for days.
 *   3. Rule tier — the first live rule an order matches decides its tier:
 *      «boost» rules in list order, then orders no rule matched, then «lower»
 *      rules in list order. A rule is live when enabled, not expired, and
 *      inside its optional daily time window / weekdays (Riyadh time) — e.g.
 *      «boost SMSA orders 12:00–16:00» ahead of the carrier's pickup.
 *   4. Campaign mode promo lane (PrepSettings.priorityMode), unchanged.
 *   5. `sort` inside the tier (oldest / newest / price high→low / low→high).
 *
 * Stored as one JSON Settings row (no schema change); read through a short
 * in-memory cache so a claim never waits on it.
 */

export type RuleKind =
  | 'category'
  | 'product'
  | 'shipping_company'
  | 'city'
  | 'destination'
  | 'payment_method'
  | 'price_range'
  | 'item_count'
  | 'repeat_customer'
  | 'customer';
export type RuleEffect = 'boost' | 'lower';
export type QueueSort = 'oldest_first' | 'newest_first' | 'price_desc' | 'price_asc';

export type RuleItem = { value: string; label: string };

export type PriorityRule = {
  id: string;
  enabled: boolean;
  effect: RuleEffect;
  kind: RuleKind;
  /** List kinds: category ids, product ids, carrier names, cities, payment methods, mobiles, or one destination. */
  items: RuleItem[];
  /**
   * Range kinds, inclusive, null = open-ended: price_range in SAR,
   * item_count in pieces, repeat_customer in the customer's earlier orders.
   */
  min: number | null;
  max: number | null;
  note: string;
  /** ISO time; the rule stops applying after it. */
  expiresAt: string | null;
  /** Daily window, "HH:MM" Riyadh time; both null = all day. May cross midnight. */
  activeFrom: string | null;
  activeTo: string | null;
  /** Weekdays it applies (0 = Sunday … 6 = Saturday, Riyadh); empty = every day. */
  days: number[];
};

export type PriorityConfig = {
  rules: PriorityRule[];
  sort: QueueSort;
  /** 0 = off. */
  maxWaitHours: number;
  updatedAt: string | null;
  updatedByName: string | null;
};

export const PRIORITY_CONFIG_KEY = 'order_prep.priority_rules';
export const MAX_RULES = 30;
export const MAX_ITEMS_PER_RULE = 300;

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  rules: [],
  sort: 'oldest_first',
  maxWaitHours: 72,
  updatedAt: null,
  updatedByName: null,
};

export const LIST_KINDS: RuleKind[] = ['category', 'product', 'shipping_company', 'city', 'destination', 'payment_method', 'customer'];
export const RANGE_KINDS: RuleKind[] = ['price_range', 'item_count', 'repeat_customer'];
const KINDS: RuleKind[] = [...LIST_KINDS, ...RANGE_KINDS];
const SORTS: QueueSort[] = ['oldest_first', 'newest_first', 'price_desc', 'price_asc'];
const RANGE_LIMIT: Record<string, number> = { price_range: 10_000_000, item_count: 1000, repeat_customer: 10_000 };

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const bound = (value: unknown, kind: RuleKind): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > RANGE_LIMIT[kind]) return null;
  return kind === 'price_range' ? Math.round(parsed * 100) / 100 : Math.floor(parsed);
};

const clock = (value: unknown): string | null => {
  const match = typeof value === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim()) : null;
  return match ? `${match[1]}:${match[2]}` : null;
};

/** The canonical value of one list item, or '' when it is not usable for this kind. */
function itemValue(kind: RuleKind, raw: string): string {
  switch (kind) {
    case 'customer':
      return normalizeE164Phone(raw);
    case 'city':
      return normalizeCity(raw);
    case 'destination':
      return raw === 'international' || raw === 'domestic' ? raw : '';
    default:
      return raw;
  }
}

function sanitizeRule(raw: unknown, index: number): PriorityRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = KINDS.includes(r.kind as RuleKind) ? (r.kind as RuleKind) : null;
  if (!kind) return null;
  const isRange = RANGE_KINDS.includes(kind);
  const seen = new Set<string>();
  const items: RuleItem[] =
    isRange || !Array.isArray(r.items)
      ? []
      : r.items
          .flatMap((item): RuleItem[] => {
            const entry = item as Record<string, unknown> | null;
            const value = itemValue(kind, text(entry?.value, 120));
            if (!value || seen.has(value)) return [];
            seen.add(value);
            return [{ value, label: text(entry?.label, 160) || value }];
          })
          .slice(0, kind === 'destination' ? 1 : MAX_ITEMS_PER_RULE);
  // minSar/maxSar: the first version of price rules.
  let min = isRange ? bound(r.min ?? r.minSar, kind) : null;
  let max = isRange ? bound(r.max ?? r.maxSar, kind) : null;
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  if (isRange ? min === null && max === null : items.length === 0) return null;
  const expires = typeof r.expiresAt === 'string' && r.expiresAt ? new Date(r.expiresAt) : null;
  let activeFrom = clock(r.activeFrom);
  let activeTo = clock(r.activeTo);
  if (!activeFrom || !activeTo || activeFrom === activeTo) activeFrom = activeTo = null;
  const days = Array.isArray(r.days)
    ? [...new Set(r.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort()
    : [];
  return {
    id: text(r.id, 40) || `r${Date.now().toString(36)}${index}`,
    enabled: r.enabled !== false,
    effect: r.effect === 'lower' ? 'lower' : 'boost',
    kind,
    items,
    min,
    max,
    note: text(r.note, 200),
    expiresAt: expires && Number.isFinite(expires.getTime()) ? expires.toISOString() : null,
    activeFrom,
    activeTo,
    days: days.length === 7 ? [] : days,
  };
}

/** Config from raw input; invalid rules are dropped, invalid fields fall back to defaults. */
export function sanitizePriorityConfig(raw: unknown): Omit<PriorityConfig, 'updatedAt' | 'updatedByName'> {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rules = (Array.isArray(r.rules) ? r.rules : [])
    .slice(0, MAX_RULES)
    .map(sanitizeRule)
    .filter((rule): rule is PriorityRule => rule !== null);
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) rule.id = `${rule.id}-${ids.size}`;
    ids.add(rule.id);
  }
  const hours = Number(r.maxWaitHours);
  return {
    rules,
    sort: SORTS.includes(r.sort as QueueSort) ? (r.sort as QueueSort) : DEFAULT_PRIORITY_CONFIG.sort,
    maxWaitHours: Number.isInteger(hours) && hours >= 0 && hours <= 24 * 30 ? hours : DEFAULT_PRIORITY_CONFIG.maxWaitHours,
  };
}

export function parsePriorityConfig(value: string | null | undefined): PriorityConfig {
  if (!value) return DEFAULT_PRIORITY_CONFIG;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      ...sanitizePriorityConfig(parsed),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      updatedByName: typeof parsed.updatedByName === 'string' ? parsed.updatedByName : null,
    };
  } catch {
    return DEFAULT_PRIORITY_CONFIG;
  }
}

const CACHE_TTL_MS = 10_000;
let cache: { at: number; value: PriorityConfig } | null = null;

export async function getPriorityConfig(options: { fresh?: boolean } = {}): Promise<PriorityConfig> {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const row = await prisma.settings.findUnique({ where: { key: PRIORITY_CONFIG_KEY }, select: { value: true } });
    const value = parsePriorityConfig(row?.value);
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    log.error('Failed to load prep priority rules; using last known or defaults', {
      error: error instanceof Error ? error.message : error,
    });
    return cache?.value ?? DEFAULT_PRIORITY_CONFIG;
  }
}

export type SaveResult = { ok: true; config: PriorityConfig } | { ok: false; conflict: true; config: PriorityConfig };

/**
 * Saves the whole config. `baseUpdatedAt` is the version the editor started
 * from: if someone else saved since, nothing is written and the newer config
 * comes back so the editor can reload it.
 */
export async function savePriorityConfig(
  raw: unknown,
  actor: { name: string },
  baseUpdatedAt: string | null,
): Promise<SaveResult> {
  return prisma.$transaction(async (tx) => {
    // Serialise savers so the version check below cannot race.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PRIORITY_CONFIG_KEY}))`;
    const row = await tx.settings.findUnique({ where: { key: PRIORITY_CONFIG_KEY }, select: { value: true } });
    const current = parsePriorityConfig(row?.value);
    if ((current.updatedAt ?? null) !== (baseUpdatedAt ?? null)) return { ok: false as const, conflict: true as const, config: current };
    const config: PriorityConfig = {
      ...sanitizePriorityConfig(raw),
      updatedAt: new Date().toISOString(),
      updatedByName: actor.name,
    };
    const value = JSON.stringify(config);
    await tx.settings.upsert({
      where: { key: PRIORITY_CONFIG_KEY },
      create: { key: PRIORITY_CONFIG_KEY, value, description: 'Order prep: queue priority rules' },
      update: { value },
    });
    cache = null;
    return { ok: true as const, config };
  });
}

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Riyadh weekday (0 = Sunday) and minute of the day. */
export function riyadhClock(nowMs: number): { day: number; minute: number } {
  const riyadh = new Date(nowMs + RIYADH_OFFSET_MS);
  return { day: riyadh.getUTCDay(), minute: riyadh.getUTCHours() * 60 + riyadh.getUTCMinutes() };
}

const minutesOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export type RuleState = 'live' | 'off' | 'expired' | 'outside_window';

export function ruleState(rule: PriorityRule, nowMs: number): RuleState {
  if (!rule.enabled) return 'off';
  if (rule.expiresAt && new Date(rule.expiresAt).getTime() <= nowMs) return 'expired';
  const { day, minute } = riyadhClock(nowMs);
  if (rule.activeFrom && rule.activeTo) {
    const from = minutesOf(rule.activeFrom);
    const to = minutesOf(rule.activeTo);
    const crossesMidnight = from > to;
    const inside = crossesMidnight ? minute >= from || minute < to : minute >= from && minute < to;
    if (!inside) return 'outside_window';
    // After midnight, an overnight window still belongs to the day it started.
    const windowDay = crossesMidnight && minute < to ? (day + 6) % 7 : day;
    if (rule.days.length > 0 && !rule.days.includes(windowDay)) return 'outside_window';
    return 'live';
  }
  if (rule.days.length > 0 && !rule.days.includes(day)) return 'outside_window';
  return 'live';
}

export const isRuleLive = (rule: PriorityRule, nowMs: number) => ruleState(rule, nowMs) === 'live';

// ---------------------------------------------------------------------------
// Resolution and SQL
// ---------------------------------------------------------------------------

export type RuleMatch =
  | { kind: 'products'; ids: string[] }
  | { kind: 'orders'; ids: string[] }
  | { kind: 'companies'; names: string[] }
  | { kind: 'payments'; methods: string[] }
  | { kind: 'mobiles'; mobiles: string[] }
  | { kind: 'price'; min: number | null; max: number | null }
  | { kind: 'pieces'; min: number | null; max: number | null }
  | { kind: 'previous_orders'; min: number | null; max: number | null };

export type ResolvedRule = { id: string; effect: RuleEffect; match: RuleMatch };

export type ResolvedPriority = {
  /** Live rules that can match something, boost rules first (list order kept). */
  rules: ResolvedRule[];
  sort: QueueSort;
  maxWaitHours: number;
  /** Live rule ids that match nothing (e.g. a category with no products in the snapshot). */
  empty: string[];
};

export const NO_PRIORITY: ResolvedPriority = { rules: [], sort: 'oldest_first', maxWaitHours: 0, empty: [] };

export type ResolveSources = {
  catalog: PriorityCatalog | null;
  destinations: Map<string, Destination> | null;
  /** repeat_customer rules: waiting order ids per `min-max` range (see repeatCustomerKey). */
  repeatCustomers?: Map<string, string[]>;
};

export const repeatCustomerKey = (rule: Pick<PriorityRule, 'min' | 'max'>) => `${rule.min ?? ''}-${rule.max ?? ''}`;

function matchFor(rule: PriorityRule, sources: ResolveSources): RuleMatch | null {
  const values = rule.items.map((item) => item.value);
  switch (rule.kind) {
    case 'product':
      return { kind: 'products', ids: values };
    case 'category':
      return { kind: 'products', ids: productIdsForCategories(values, sources.catalog) };
    case 'shipping_company':
      return { kind: 'companies', names: values };
    case 'payment_method':
      return { kind: 'payments', methods: values };
    case 'customer':
      return { kind: 'mobiles', mobiles: values };
    case 'city':
      return { kind: 'orders', ids: sources.destinations ? orderIdsForCities(sources.destinations, values) : [] };
    case 'destination':
      return {
        kind: 'orders',
        ids: sources.destinations ? orderIdsForDestination(sources.destinations, values[0] === 'international') : [],
      };
    case 'price_range':
      return { kind: 'price', min: rule.min, max: rule.max };
    case 'item_count':
      return { kind: 'pieces', min: rule.min, max: rule.max };
    case 'repeat_customer': {
      // Counting each customer's history is ~0.4 ms an order: done ahead of
      // time (outside the claim lock) when possible, in SQL otherwise.
      const ids = sources.repeatCustomers?.get(repeatCustomerKey(rule));
      return ids ? { kind: 'orders', ids } : { kind: 'previous_orders', min: rule.min, max: rule.max };
    }
  }
}

const isEmptyMatch = (match: RuleMatch) =>
  ('ids' in match && match.ids.length === 0) ||
  ('names' in match && match.names.length === 0) ||
  ('methods' in match && match.methods.length === 0) ||
  ('mobiles' in match && match.mobiles.length === 0);

/** Turns the stored config into what the queue SQL needs. Pure, for tests. */
export function resolvePriority(
  config: Pick<PriorityConfig, 'rules' | 'sort' | 'maxWaitHours'>,
  sources: ResolveSources,
  nowMs: number,
): ResolvedPriority {
  const resolved: ResolvedRule[] = [];
  const empty: string[] = [];
  for (const rule of config.rules) {
    if (!isRuleLive(rule, nowMs)) continue;
    const match = matchFor(rule, sources);
    if (isEmptyMatch(match!)) {
      // City/destination rules simply match no waiting order right now; only
      // a category with no products points at a real problem.
      if (rule.kind === 'category') empty.push(rule.id);
      continue;
    }
    resolved.push({ id: rule.id, effect: rule.effect, match: match! });
  }
  return {
    rules: [...resolved.filter((rule) => rule.effect === 'boost'), ...resolved.filter((rule) => rule.effect === 'lower')],
    sort: config.sort,
    maxWaitHours: config.maxWaitHours,
    empty,
  };
}

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';
const REPEAT_TTL_MS = 60_000;
const repeatCache = new Map<string, { at: number; ids: string[] }>();

/** Waiting («طلب جديد») orders whose customer's earlier-order count is in range; cached a minute. */
async function waitingRepeatCustomerOrders(rule: PriorityRule): Promise<string[]> {
  const key = repeatCustomerKey(rule);
  const hit = repeatCache.get(key);
  if (hit && Date.now() - hit.at < REPEAT_TTL_MS) return hit.ids;
  const rows = await prisma.$queryRaw<Array<{ orderId: string }>>(Prisma.sql`
    SELECT s."orderId" FROM "SallaOrder" s
    WHERE s."merchantId" = ${MERCHANT_ID} AND s."statusCustomId" = ${NEW_ORDER_STATUS_ID}
      AND ${ruleMatchSql({ kind: 'previous_orders', min: rule.min, max: rule.max })}`);
  const ids = rows.map((row) => row.orderId);
  repeatCache.set(key, { at: Date.now(), ids });
  return ids;
}

/**
 * Loads only what the live rules need, before the claim lock is taken: the
 * catalog for categories, destinations for city/destination, and the
 * customer-history lookups for repeat_customer.
 */
export async function loadResolveSources(rules: PriorityRule[], nowMs: number): Promise<ResolveSources> {
  const live = rules.filter((rule) => isRuleLive(rule, nowMs));
  const repeatRules = live.filter((rule) => rule.kind === 'repeat_customer');
  const [catalog, destinations, repeatLists] = await Promise.all([
    live.some((rule) => rule.kind === 'category') ? readPriorityCatalog() : null,
    live.some((rule) => rule.kind === 'city' || rule.kind === 'destination') ? getWaitingDestinations() : null,
    Promise.all(
      repeatRules.map(async (rule) => [repeatCustomerKey(rule), await waitingRepeatCustomerOrders(rule).catch(() => null)] as const),
    ),
  ]);
  const repeatCustomers = new Map<string, string[]>();
  for (const [key, ids] of repeatLists) if (ids) repeatCustomers.set(key, ids);
  return { catalog, destinations, repeatCustomers };
}

/** Saved config, resolved. Any failure falls back to plain ordering rather than blocking packers. */
export async function loadResolvedPriority(nowMs: number): Promise<ResolvedPriority> {
  try {
    const config = await getPriorityConfig();
    if (config.rules.length === 0) return resolvePriority(config, { catalog: null, destinations: null }, nowMs);
    return resolvePriority(config, await loadResolveSources(config.rules, nowMs), nowMs);
  } catch (error) {
    log.error('Failed to resolve prep priority rules; queue falls back to defaults', {
      error: error instanceof Error ? error.message : error,
    });
    return NO_PRIORITY;
  }
}

/**
 * Order total in SAR. Foreign-currency orders carry Salla's per-order rate
 * (SAR per unit); without a usable rate the total is NULL and price rules skip it.
 */
export const SAR_TOTAL_SQL = Prisma.sql`(CASE
  WHEN COALESCE(s."currency", 'SAR') = 'SAR' THEN s."totalAmount"
  WHEN s."exchangeRate"->>'base_currency' = 'SAR' AND (s."exchangeRate"->>'rate') ~ '^[0-9]+([.][0-9]+)?$'
    THEN s."totalAmount" * (s."exchangeRate"->>'rate')::numeric
END)`;

const PIECES_SQL = Prisma.sql`(SELECT COALESCE(sum(qi."quantity"), 0) FROM "SallaOrderItem" qi
  WHERE qi."merchantId" = s."merchantId" AND qi."orderId" = s."orderId")`;

/** The customer's earlier orders, cancelled ones left out. */
const PREVIOUS_ORDERS_SQL = Prisma.sql`(SELECT count(*) FROM "SallaOrder" po
  WHERE po."merchantId" = s."merchantId" AND po."customerId" = s."customerId"
    AND po."placedAt" < s."placedAt" AND po."statusSlug" IS DISTINCT FROM 'canceled')`;

function rangeSql(value: Prisma.Sql, min: number | null, max: number | null): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (min !== null) parts.push(Prisma.sql`${value} >= ${min}::numeric`);
  if (max !== null) parts.push(Prisma.sql`${value} <= ${max}::numeric`);
  return Prisma.sql`(${Prisma.join(parts, ' AND ')})`;
}

export function ruleMatchSql(match: RuleMatch): Prisma.Sql {
  switch (match.kind) {
    case 'products':
      return Prisma.sql`EXISTS (
        SELECT 1 FROM "SallaOrderItem" pi
        WHERE pi."merchantId" = s."merchantId" AND pi."orderId" = s."orderId" AND pi."productId" = ANY(${match.ids}::text[])
      )`;
    case 'orders':
      return Prisma.sql`s."orderId" = ANY(${match.ids}::text[])`;
    case 'companies':
      return Prisma.sql`s."fulfillmentCompany" = ANY(${match.names}::text[])`;
    case 'payments':
      return Prisma.sql`s."paymentMethod" = ANY(${match.methods}::text[])`;
    case 'mobiles':
      return Prisma.sql`s."customerMobile" = ANY(${match.mobiles}::text[])`;
    case 'price':
      return rangeSql(SAR_TOTAL_SQL, match.min, match.max);
    case 'pieces':
      return rangeSql(PIECES_SQL, match.min, match.max);
    case 'previous_orders':
      return Prisma.sql`(s."customerId" IS NOT NULL AND ${rangeSql(PREVIOUS_ORDERS_SQL, match.min, match.max)})`;
  }
}

/** Tier of an order: index of its first matching rule; unmatched sit between boost and lower rules. */
export function ruleTierSql(priority: ResolvedPriority): Prisma.Sql | null {
  if (priority.rules.length === 0) return null;
  const boosts = priority.rules.filter((rule) => rule.effect === 'boost').length;
  const whens = priority.rules.map((rule, index) => {
    const tier = rule.effect === 'boost' ? index : index + 1; // lower rules start after the unmatched tier
    return Prisma.sql`WHEN ${ruleMatchSql(rule.match)} THEN ${Prisma.raw(String(tier))}`;
  });
  return Prisma.sql`(CASE ${Prisma.join(whens, ' ')} ELSE ${Prisma.raw(String(boosts))} END)`;
}

/** The max-wait guard is only worth its cost when rules or the sort could hold an old order back. */
export function guardActive(priority: ResolvedPriority): boolean {
  return priority.maxWaitHours > 0 && (priority.rules.length > 0 || priority.sort !== 'oldest_first');
}

export function agedSql(priority: ResolvedPriority, nowMs: number): Prisma.Sql {
  return Prisma.sql`(s."placedAt" <= ${toSqlTimestamp(placedAtCutoff(priority.maxWaitHours, nowMs))}::timestamp)`;
}

/** ORDER BY pieces that go before the campaign promo lane. Ends with a comma when not empty. */
export function priorityHeadSql(priority: ResolvedPriority, nowMs: number): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (guardActive(priority)) {
    const aged = agedSql(priority, nowMs);
    parts.push(Prisma.sql`(CASE WHEN ${aged} THEN 0 ELSE 1 END) ASC`);
    parts.push(Prisma.sql`(CASE WHEN ${aged} THEN s."placedAt" END) ASC NULLS LAST`);
  }
  const tier = ruleTierSql(priority);
  if (tier) parts.push(Prisma.sql`${tier} ASC`);
  return parts.length ? Prisma.sql`${Prisma.join(parts, ', ')},` : Prisma.empty;
}

/** ORDER BY pieces for the sort inside a tier (before the orderId tie-break). */
export function prioritySortSql(sort: QueueSort): Prisma.Sql {
  switch (sort) {
    case 'newest_first':
      return Prisma.sql`s."placedAt" DESC NULLS LAST`;
    case 'price_desc':
      return Prisma.sql`${SAR_TOTAL_SQL} DESC NULLS LAST, s."placedAt" ASC NULLS LAST`;
    case 'price_asc':
      return Prisma.sql`${SAR_TOTAL_SQL} ASC NULLS LAST, s."placedAt" ASC NULLS LAST`;
    default:
      return Prisma.sql`s."placedAt" ASC NULLS LAST`;
  }
}
