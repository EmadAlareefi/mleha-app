import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { productIdsForCategories, readPriorityCatalog, type PriorityCatalog } from './priority-catalog';
import { placedAtCutoff, toSqlTimestamp } from './riyadh-time';

/**
 * Supervisor rules for the order the prep queue hands out orders, set on the
 * «الأولويات» tab of the warehouse dashboard.
 *
 * Queue order, top to bottom:
 *   1. «طلب مميز» (HighPriorityOrder) — specific orders, always first.
 *   2. Max-wait guard — orders older than `maxWaitHours`, oldest first, so a
 *      lowered or low-ranked order never waits for days.
 *   3. Rule tier — the first enabled rule an order matches decides its tier:
 *      «boost» rules in list order, then orders no rule matched, then «lower»
 *      rules in list order.
 *   4. Campaign mode promo lane (PrepSettings.priorityMode), unchanged.
 *   5. `sort` inside the tier (oldest / newest / price high→low / low→high).
 *
 * Stored as one JSON Settings row (no schema change); read through a short
 * in-memory cache so a claim never waits on it.
 */

export type RuleKind = 'category' | 'shipping_company' | 'product' | 'price_range';
export type RuleEffect = 'boost' | 'lower';
export type QueueSort = 'oldest_first' | 'newest_first' | 'price_desc' | 'price_asc';

export type RuleItem = { value: string; label: string };

export type PriorityRule = {
  id: string;
  enabled: boolean;
  effect: RuleEffect;
  kind: RuleKind;
  /** Category ids, carrier names or product ids, with display labels. Empty for price_range. */
  items: RuleItem[];
  /** price_range only, in SAR, inclusive. Null = open-ended. */
  minSar: number | null;
  maxSar: number | null;
  note: string;
  /** ISO time; the rule stops applying after it. */
  expiresAt: string | null;
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

const KINDS: RuleKind[] = ['category', 'shipping_company', 'product', 'price_range'];
const SORTS: QueueSort[] = ['oldest_first', 'newest_first', 'price_desc', 'price_asc'];

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const money = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000_000 ? Math.round(parsed * 100) / 100 : null;
};

function sanitizeRule(raw: unknown, index: number): PriorityRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = KINDS.includes(r.kind as RuleKind) ? (r.kind as RuleKind) : null;
  if (!kind) return null;
  const seen = new Set<string>();
  const items: RuleItem[] =
    kind === 'price_range' || !Array.isArray(r.items)
      ? []
      : r.items
          .flatMap((item): RuleItem[] => {
            const entry = item as Record<string, unknown> | null;
            const value = text(entry?.value, 120);
            if (!value || seen.has(value)) return [];
            seen.add(value);
            return [{ value, label: text(entry?.label, 160) || value }];
          })
          .slice(0, MAX_ITEMS_PER_RULE);
  let minSar = kind === 'price_range' ? money(r.minSar) : null;
  let maxSar = kind === 'price_range' ? money(r.maxSar) : null;
  if (minSar !== null && maxSar !== null && minSar > maxSar) [minSar, maxSar] = [maxSar, minSar];
  if (kind === 'price_range' ? minSar === null && maxSar === null : items.length === 0) return null;
  const expires = typeof r.expiresAt === 'string' && r.expiresAt ? new Date(r.expiresAt) : null;
  return {
    id: text(r.id, 40) || `r${Date.now().toString(36)}${index}`,
    enabled: r.enabled !== false,
    effect: r.effect === 'lower' ? 'lower' : 'boost',
    kind,
    items,
    minSar,
    maxSar,
    note: text(r.note, 200),
    expiresAt: expires && Number.isFinite(expires.getTime()) ? expires.toISOString() : null,
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
// Resolution and SQL
// ---------------------------------------------------------------------------

export type RuleMatch =
  | { kind: 'products'; ids: string[] }
  | { kind: 'companies'; names: string[] }
  | { kind: 'price'; min: number | null; max: number | null };

export type ResolvedRule = { id: string; effect: RuleEffect; match: RuleMatch };

export type ResolvedPriority = {
  /** Enabled, unexpired rules that can match something, boost rules first (list order kept). */
  rules: ResolvedRule[];
  sort: QueueSort;
  maxWaitHours: number;
  /** Rule ids that are on but match nothing (e.g. a category with no products in the snapshot). */
  empty: string[];
};

export const NO_PRIORITY: ResolvedPriority = { rules: [], sort: 'oldest_first', maxWaitHours: 0, empty: [] };

export function isRuleLive(rule: PriorityRule, nowMs: number): boolean {
  return rule.enabled && !(rule.expiresAt && new Date(rule.expiresAt).getTime() <= nowMs);
}

/** Turns the stored config into what the queue SQL needs. Pure, for tests. */
export function resolvePriority(config: Pick<PriorityConfig, 'rules' | 'sort' | 'maxWaitHours'>, catalog: PriorityCatalog | null, nowMs: number): ResolvedPriority {
  const resolved: ResolvedRule[] = [];
  const empty: string[] = [];
  for (const rule of config.rules) {
    if (!isRuleLive(rule, nowMs)) continue;
    const values = rule.items.map((item) => item.value);
    let match: RuleMatch | null = null;
    if (rule.kind === 'product') match = { kind: 'products', ids: values };
    else if (rule.kind === 'shipping_company') match = { kind: 'companies', names: values };
    else if (rule.kind === 'price_range') match = { kind: 'price', min: rule.minSar, max: rule.maxSar };
    else {
      const ids = productIdsForCategories(values, catalog);
      if (ids.length > 0) match = { kind: 'products', ids };
    }
    if (!match || (match.kind === 'products' && match.ids.length === 0) || (match.kind === 'companies' && match.names.length === 0)) {
      empty.push(rule.id);
      continue;
    }
    resolved.push({ id: rule.id, effect: rule.effect, match });
  }
  return {
    rules: [...resolved.filter((rule) => rule.effect === 'boost'), ...resolved.filter((rule) => rule.effect === 'lower')],
    sort: config.sort,
    maxWaitHours: config.maxWaitHours,
    empty,
  };
}

/** Saved config, resolved; the catalog is only read when a category rule is on. */
export async function loadResolvedPriority(nowMs: number): Promise<ResolvedPriority> {
  try {
    const config = await getPriorityConfig();
    const needsCatalog = config.rules.some((rule) => rule.kind === 'category' && isRuleLive(rule, nowMs));
    const catalog = needsCatalog ? await readPriorityCatalog() : null;
    return resolvePriority(config, catalog, nowMs);
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

export function ruleMatchSql(match: RuleMatch): Prisma.Sql {
  switch (match.kind) {
    case 'products':
      return Prisma.sql`EXISTS (
        SELECT 1 FROM "SallaOrderItem" pi
        WHERE pi."merchantId" = s."merchantId" AND pi."orderId" = s."orderId" AND pi."productId" = ANY(${match.ids}::text[])
      )`;
    case 'companies':
      return Prisma.sql`s."fulfillmentCompany" = ANY(${match.names}::text[])`;
    case 'price': {
      const parts: Prisma.Sql[] = [];
      if (match.min !== null) parts.push(Prisma.sql`${SAR_TOTAL_SQL} >= ${match.min}::numeric`);
      if (match.max !== null) parts.push(Prisma.sql`${SAR_TOTAL_SQL} <= ${match.max}::numeric`);
      return Prisma.sql`(${Prisma.join(parts, ' AND ')})`;
    }
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
