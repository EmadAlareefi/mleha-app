import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPickSql, type QueueContext } from '@/app/lib/order-prep/queue';
import { buildCatalog, productIdsForCategories, type PriorityCatalog } from '@/app/lib/order-prep/priority-catalog';
import {
  DEFAULT_PRIORITY_CONFIG,
  parsePriorityConfig,
  resolvePriority,
  ruleMatchSql,
  ruleState,
  sanitizePriorityConfig,
  type PriorityRule,
} from '@/app/lib/order-prep/priority-rules';
import { normalizeCity, type Destination } from '@/app/lib/order-prep/destination-cache';
import { DEFAULT_PREP_SETTINGS } from '@/app/lib/order-prep/settings';

const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

const rule = (overrides: Partial<PriorityRule>): PriorityRule => ({
  id: 'r1',
  enabled: true,
  effect: 'boost',
  kind: 'shipping_company',
  items: [{ value: 'سمسا', label: 'سمسا' }],
  min: null,
  max: null,
  note: '',
  expiresAt: null,
  activeFrom: null,
  activeTo: null,
  days: [],
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

const NONE = { catalog: null, destinations: null };

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
  assert.deepEqual([clean.rules[0].min, clean.rules[0].max], [100, 500]);
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
        rule({ id: 'low', effect: 'lower', kind: 'price_range', items: [], max: 50 }),
        rule({ id: 'off', enabled: false }),
        rule({ id: 'old', expiresAt: new Date(NOW - 1000).toISOString() }),
        rule({ id: 'cat', kind: 'category', items: [{ value: 'sets', label: 'اطقم' }] }),
        rule({ id: 'ghost', kind: 'category', items: [{ value: 'missing', label: '?' }] }),
        rule({ id: 'ship' }),
      ],
    },
    { catalog, destinations: null },
    NOW,
  );
  assert.deepEqual(resolved.rules.map((r) => r.id), ['cat', 'ship', 'low']);
  assert.deepEqual(resolved.empty, ['ghost']);
  assert.deepEqual(resolved.rules[0].match, { kind: 'products', ids: ['p3'] });
});

test('no rules + oldest first leaves the pick exactly as before', () => {
  const sql = buildPickSql(ctx(resolvePriority(DEFAULT_PRIORITY_CONFIG, NONE, NOW)), { limit: 1 });
  assert.equal(orderByOf(sql.text), 'ORDER BY (hp."id" IS NULL) ASC, s."placedAt" ASC NULLS LAST, s."orderId" ASC');
});

test('rules add the max-wait guard and tier after the high-priority flag', () => {
  const priority = resolvePriority(
    { sort: 'oldest_first', maxWaitHours: 72, rules: [rule({ id: 'ship' }), rule({ id: 'cheap', effect: 'lower', kind: 'price_range', items: [], max: 50 })] },
    NONE,
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
  const priority = resolvePriority({ sort: 'newest_first', maxWaitHours: 0, rules: [rule({})] }, NONE, NOW);
  const orderBy = orderByOf(buildPickSql(ctx(priority), { limit: 1 }).text);
  assert.doesNotMatch(orderBy, /timestamp/);
  assert.match(orderBy, /s\."placedAt" DESC NULLS LAST, s\."orderId" ASC$/);
});

test('price sorts use the SAR total, then oldest first', () => {
  for (const [sort, dir] of [['price_desc', 'DESC'], ['price_asc', 'ASC']] as const) {
    const priority = resolvePriority({ sort, maxWaitHours: 0, rules: [] }, NONE, NOW);
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

test('legacy price rules (minSar/maxSar) still load', () => {
  const clean = sanitizePriorityConfig({ rules: [{ kind: 'price_range', minSar: 200, maxSar: null }] });
  assert.deepEqual([clean.rules[0].min, clean.rules[0].max], [200, null]);
});

test('new kinds: values are normalised and invalid ones dropped', () => {
  const clean = sanitizePriorityConfig({
    rules: [
      { kind: 'customer', items: [{ value: '0551234567' }, { value: '+966551234567' }, { value: 'abc' }] },
      { kind: 'city', items: [{ value: ' جدة ' }, { value: 'جده' }] },
      { kind: 'destination', items: [{ value: 'moon' }, { value: 'international' }, { value: 'domestic' }] },
      { kind: 'item_count', min: 1, max: 1.7 },
      { kind: 'repeat_customer', max: 0 },
      { kind: 'payment_method', items: [{ value: 'mada' }] },
    ],
  });
  assert.deepEqual(clean.rules.map((r) => r.kind), ['customer', 'city', 'destination', 'item_count', 'repeat_customer', 'payment_method']);
  assert.deepEqual(clean.rules[0].items.map((i) => i.value), ['+966551234567']);
  assert.deepEqual(clean.rules[1].items.map((i) => i.value), [normalizeCity('جدة')]);
  assert.deepEqual(clean.rules[2].items.map((i) => i.value), ['international']);
  assert.deepEqual([clean.rules[3].min, clean.rules[3].max], [1, 1]);
  assert.deepEqual([clean.rules[4].min, clean.rules[4].max], [null, 0]);
});

test('city and destination rules resolve to the waiting orders that ship there', () => {
  const destinations = new Map<string, Destination>([
    ['o1', { city: normalizeCity('جدة'), international: false }],
    ['o2', { city: normalizeCity('دبي'), international: true }],
    ['o3', { city: normalizeCity('الرياض'), international: false }],
  ]);
  const resolved = resolvePriority(
    {
      sort: 'oldest_first',
      maxWaitHours: 0,
      rules: [
        rule({ id: 'jed', kind: 'city', items: [{ value: normalizeCity('جده'), label: 'جدة' }] }),
        rule({ id: 'intl', kind: 'destination', effect: 'lower', items: [{ value: 'international', label: '' }] }),
        rule({ id: 'none', kind: 'city', items: [{ value: 'تبوك', label: 'تبوك' }] }),
      ],
    },
    { catalog: null, destinations },
    NOW,
  );
  assert.deepEqual(resolved.rules.map((r) => [r.id, r.match]), [
    ['jed', { kind: 'orders', ids: ['o1'] }],
    ['intl', { kind: 'orders', ids: ['o2'] }],
  ]);
  assert.deepEqual(resolved.empty, []); // a city with no waiting orders is normal, not a warning
});

test('item count, repeat customer, payment and mobiles SQL', () => {
  const pieces = ruleMatchSql({ kind: 'pieces', min: 1, max: 1 }).text.replace(/\s+/g, ' ');
  assert.match(pieces, /sum\(qi\."quantity"\), 0\) FROM "SallaOrderItem" qi .* >= \$1::numeric AND .* <= \$2::numeric/);
  const previous = ruleMatchSql({ kind: 'previous_orders', min: null, max: 0 }).text.replace(/\s+/g, ' ');
  assert.match(previous, /s\."customerId" IS NOT NULL AND/);
  assert.match(previous, /po\."placedAt" < s\."placedAt" AND po\."statusSlug" IS DISTINCT FROM 'canceled'/);
  assert.match(ruleMatchSql({ kind: 'payments', methods: ['mada'] }).text, /s\."paymentMethod" = ANY/);
  assert.match(ruleMatchSql({ kind: 'mobiles', mobiles: ['+966551234567'] }).text, /s\."customerMobile" = ANY/);
});

test('time windows and weekdays use Riyadh time', () => {
  // NOW = Tue 2026-11-24 12:00 UTC = 15:00 Riyadh (Tuesday = 2)
  const at = (overrides: Partial<PriorityRule>) => ruleState(rule(overrides), NOW);
  assert.equal(at({ activeFrom: '12:00', activeTo: '16:00' }), 'live');
  assert.equal(at({ activeFrom: '15:30', activeTo: '16:00' }), 'outside_window');
  assert.equal(at({ activeFrom: '12:00', activeTo: '16:00', days: [0, 1] }), 'outside_window');
  assert.equal(at({ days: [2] }), 'live');
  assert.equal(at({ enabled: false }), 'off');
  // Overnight window 22:00–02:00, checked at 01:00 Riyadh on Wednesday: belongs to Tuesday.
  const wedOneAm = Date.UTC(2026, 10, 24, 22, 0, 0);
  assert.equal(ruleState(rule({ activeFrom: '22:00', activeTo: '02:00', days: [2] }), wedOneAm), 'live');
  assert.equal(ruleState(rule({ activeFrom: '22:00', activeTo: '02:00', days: [3] }), wedOneAm), 'outside_window');
  // Same start and end means no window.
  assert.deepEqual(
    [sanitizePriorityConfig({ rules: [{ kind: 'product', items: [{ value: '1' }], activeFrom: '10:00', activeTo: '10:00' }] }).rules[0].activeFrom],
    [null],
  );
});

test('city names match across common spellings', () => {
  assert.equal(normalizeCity('جدة'), normalizeCity(' جده '));
  assert.equal(normalizeCity('الأحساء'), normalizeCity('الاحساء'));
  assert.equal(normalizeCity('Jeddah'), normalizeCity('JEDDAH'));
});
