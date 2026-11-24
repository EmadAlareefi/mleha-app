import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPickSql, type QueueContext } from '@/app/lib/order-prep/queue';
import { buildCatalog, productIdsForCategories, type PriorityCatalog } from '@/app/lib/order-prep/priority-catalog';
import {
  DEFAULT_PRIORITY_CONFIG,
  parsePriorityConfig,
  resolvePriority,
  sanitizePriorityConfig,
  type PriorityRule,
} from '@/app/lib/order-prep/priority-rules';
import { DEFAULT_PREP_SETTINGS } from '@/app/lib/order-prep/settings';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

const rule = (overrides: Partial<PriorityRule>): PriorityRule => ({
  id: 'r1',
  enabled: true,
  effect: 'boost',
  kind: 'shipping_company',
  items: [{ value: 'سمسا', label: 'سمسا' }],
  minSar: null,
  maxSar: null,
  note: '',
  expiresAt: null,
  ...overrides,
});

const catalog: PriorityCatalog = {
  at: NOW,
  categories: [
    { id: 'dresses', name: 'فساتين', parentId: null, products: 2 },
    { id: 'evening', name: 'سهرة', parentId: 'dresses', products: 1 },
    { id: 'sets', name: 'اطقم', parentId: null, products: 1 },
  ],
  products: [
    { i: 'p1', n: 'فستان', s: '0001', c: ['dresses'] },
    { i: 'p2', n: 'فستان سهرة', s: '0002', c: ['evening'] },
    { i: 'p3', n: 'طقم', s: '0003', c: ['sets'] },
  ],
};

const ctx = (priority: QueueContext['priority']): QueueContext => ({
  settings: DEFAULT_PREP_SETTINGS,
  promoIds: [],
  violatorIds: [],
  nowMs: NOW,
  priority,
});

const orderByOf = (sql: string) => sql.slice(sql.indexOf('ORDER BY'), sql.indexOf('LIMIT')).replace(/\s+/g, ' ').trim();

test('sanitize drops broken rules and keeps valid ones', () => {
  const clean = sanitizePriorityConfig({
    sort: 'price_desc',
    maxWaitHours: 48,
    rules: [
      { kind: 'nonsense', items: [{ value: 'x' }] },
      { kind: 'category', items: [] }, // nothing to match
      { kind: 'price_range' }, // no bounds
      { kind: 'price_range', minSar: '500', maxSar: '100' }, // swapped
      { kind: 'product', effect: 'lower', items: [{ value: '1' }, { value: '1' }, { value: '' }] },
    ],
  });
  assert.equal(clean.sort, 'price_desc');
  assert.equal(clean.maxWaitHours, 48);
  assert.equal(clean.rules.length, 2);
  assert.deepEqual([clean.rules[0].minSar, clean.rules[0].maxSar], [100, 500]);
  assert.equal(clean.rules[1].effect, 'lower');
  assert.deepEqual(clean.rules[1].items, [{ value: '1', label: '1' }]);
});

test('bad stored JSON falls back to defaults', () => {
  assert.deepEqual(parsePriorityConfig('{oops'), DEFAULT_PRIORITY_CONFIG);
  assert.deepEqual(parsePriorityConfig(null), DEFAULT_PRIORITY_CONFIG);
  assert.equal(sanitizePriorityConfig({ sort: 'sideways', maxWaitHours: -1 }).sort, 'oldest_first');
});

test('a category rule covers its sub-categories', () => {
  assert.deepEqual(productIdsForCategories(['dresses'], catalog).sort(), ['p1', 'p2']);
  assert.deepEqual(productIdsForCategories(['evening'], catalog), ['p2']);
  assert.deepEqual(productIdsForCategories(['dresses'], null), []);
});

test('resolve: boost rules first, disabled / expired skipped, empty categories reported', () => {
  const resolved = resolvePriority(
    {
      sort: 'oldest_first',
      maxWaitHours: 72,
      rules: [
        rule({ id: 'low', effect: 'lower', kind: 'price_range', items: [], maxSar: 50 }),
        rule({ id: 'off', enabled: false }),
        rule({ id: 'old', expiresAt: new Date(NOW - 1000).toISOString() }),
        rule({ id: 'cat', kind: 'category', items: [{ value: 'sets', label: 'اطقم' }] }),
        rule({ id: 'ghost', kind: 'category', items: [{ value: 'missing', label: '?' }] }),
        rule({ id: 'ship' }),
      ],
    },
    catalog,
    NOW,
  );
  assert.deepEqual(resolved.rules.map((r) => r.id), ['cat', 'ship', 'low']);
  assert.deepEqual(resolved.empty, ['ghost']);
  assert.deepEqual(resolved.rules[0].match, { kind: 'products', ids: ['p3'] });
});

test('no rules + oldest first leaves the pick exactly as before', () => {
  const sql = buildPickSql(ctx(resolvePriority(DEFAULT_PRIORITY_CONFIG, null, NOW)), { limit: 1 });
  assert.equal(orderByOf(sql.text), 'ORDER BY (hp."id" IS NULL) ASC, s."placedAt" ASC NULLS LAST, s."orderId" ASC');
});

test('rules add the max-wait guard and tier after the high-priority flag', () => {
  const priority = resolvePriority(
    { sort: 'oldest_first', maxWaitHours: 72, rules: [rule({ id: 'ship' }), rule({ id: 'cheap', effect: 'lower', kind: 'price_range', items: [], maxSar: 50 })] },
    null,
    NOW,
  );
  const sql = buildPickSql(ctx(priority), { limit: 1 });
  const orderBy = orderByOf(sql.text);
  assert.match(orderBy, /^ORDER BY \(hp\."id" IS NULL\) ASC, \(CASE WHEN \(s\."placedAt" <= \$\d+::timestamp\) THEN 0 ELSE 1 END\) ASC/);
  // boost → 0, unmatched → 1, lower → 2
  assert.match(orderBy, /\(CASE WHEN s\."fulfillmentCompany" = ANY\(\$\d+::text\[\]\) THEN 0 WHEN \(.*<= \$\d+::numeric\) THEN 2 ELSE 1 END\) ASC/);
  assert.match(orderBy, /s\."placedAt" ASC NULLS LAST, s\."orderId" ASC$/);
  assert.ok(sql.values.includes('2026-11-21 12:00:00')); // 72 h guard cutoff
  assert.ok(sql.values.includes(50));
});

test('guard off (0 h) keeps rules but drops the guard', () => {
  const priority = resolvePriority({ sort: 'newest_first', maxWaitHours: 0, rules: [rule({})] }, null, NOW);
  const orderBy = orderByOf(buildPickSql(ctx(priority), { limit: 1 }).text);
  assert.doesNotMatch(orderBy, /timestamp/);
  assert.match(orderBy, /s\."placedAt" DESC NULLS LAST, s\."orderId" ASC$/);
});

test('price sorts use the SAR total, then oldest first', () => {
  for (const [sort, dir] of [['price_desc', 'DESC'], ['price_asc', 'ASC']] as const) {
    const priority = resolvePriority({ sort, maxWaitHours: 0, rules: [] }, null, NOW);
    const orderBy = orderByOf(buildPickSql(ctx(priority), { limit: 1 }).text);
    assert.match(orderBy, new RegExp(`END\\) ${dir} NULLS LAST, s\\."placedAt" ASC NULLS LAST, s\\."orderId" ASC$`));
    assert.match(orderBy, /s\."exchangeRate"->>'rate'/);
  }
});

test('buildCatalog counts products per category and skips deleted ones', () => {
  const built = buildCatalog(
    [
      { id: 1, name: 'a', sku: 'A', status: 'sale', categories: [{ id: '10', name: 'x', parentId: null }] },
      { id: 2, name: 'b', sku: 'B', status: 'deleted', categories: [{ id: '10', name: 'x', parentId: null }] },
      { id: 3, name: 'c', status: 'sale', categories: [{ id: '10', name: 'x', parentId: null }, { id: '11', name: 'y', parentId: '10' }] },
    ],
    NOW,
  );
  assert.equal(built.products.length, 2);
  assert.deepEqual(built.categories.map((c) => [c.id, c.products]), [['10', 2], ['11', 1]]);
});
