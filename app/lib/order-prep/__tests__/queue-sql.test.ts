import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPickSql, buildStatsSql, type QueueContext } from '@/app/lib/order-prep/queue';
import { DEFAULT_PREP_SETTINGS } from '@/app/lib/order-prep/settings';

const NOW = Date.UTC(2026, 10, 9, 18, 0, 0);

const ctx = (overrides: Partial<QueueContext> = {}): QueueContext => ({
  settings: DEFAULT_PREP_SETTINGS,
  promoIds: ['p1', 'p2'],
  violatorIds: [],
  nowMs: NOW,
  ...overrides,
});

const orderByOf = (sql: string) => sql.slice(sql.indexOf('ORDER BY'), sql.indexOf('LIMIT')).replace(/\s+/g, ' ').trim();

test('oldest-first: high priority, then order date — no constant in ORDER BY', () => {
  const sql = buildPickSql(ctx(), { limit: 2 });
  const orderBy = orderByOf(sql.text);
  assert.equal(orderBy, 'ORDER BY (hp."id" IS NULL) ASC, s."placedAt" ASC NULLS LAST, s."orderId" ASC');
  // Only "طلب جديد", nothing held, shipped, escalated, blocked or over the promo limit.
  assert.match(sql.text, /s\."statusCustomId" = \$\d+/);
  for (const table of ['"OrderPrepAssignment"', '"SallaShipment"', '"OrderPrepEscalation"', '"OrderDoNotShipFlag"']) {
    assert.ok(sql.text.includes(`NOT EXISTS (SELECT 1 FROM ${table}`) || sql.text.includes(`SELECT 1 FROM ${table}`), table);
  }
  assert.ok(sql.values.includes('449146439'));
  assert.ok(sql.values.includes(2));
});

test('campaign mode adds the promo lane with the age cap', () => {
  const sql = buildPickSql(
    ctx({ settings: { ...DEFAULT_PREP_SETTINGS, priorityMode: 'regular_first', promoAgingHours: 48 } }),
    { limit: 1 },
  );
  const orderBy = orderByOf(sql.text);
  assert.match(orderBy, /^ORDER BY \(hp\."id" IS NULL\) ASC, CASE WHEN s\."placedAt" > \$\d+::timestamp/);
  assert.match(orderBy, /THEN 1 ELSE 0 END ASC, s\."placedAt" ASC NULLS LAST/);
  // Cutoff is 48 h before now in the Riyadh-clock convention (18:00Z + 3 h − 48 h).
  assert.ok(sql.values.includes('2026-11-07 21:00:00'));
});

test('campaign mode without any promo products falls back to oldest-first', () => {
  const sql = buildPickSql(
    ctx({ promoIds: [], settings: { ...DEFAULT_PREP_SETTINGS, priorityMode: 'regular_first' } }),
    { limit: 1 },
  );
  assert.doesNotMatch(sql.text, /CASE WHEN/);
});

test('only / exclude narrow the pick', () => {
  const sql = buildPickSql(ctx(), { limit: 1, only: ['a'], exclude: ['b'] });
  assert.match(sql.text, /AND s\."orderId" = ANY\(\$\d+::text\[\]\)/);
  assert.match(sql.text, /AND NOT \(s\."orderId" = ANY\(\$\d+::text\[\]\)\)/);
});

test('stats buckets use Riyadh-clock cutoffs', () => {
  const sql = buildStatsSql(ctx());
  assert.ok(sql.values.includes('2026-11-08 21:00:00')); // 24 h
  assert.ok(sql.values.includes('2026-11-07 21:00:00')); // 48 h
  assert.ok(sql.values.includes('2026-11-05 21:00:00')); // 96 h
});

test('held or unpaid replacement orders from returns never reach a packer', () => {
  const text = buildPickSql(ctx(), { limit: 1 }).text.replace(/\s+/g, ' ');
  assert.match(
    text,
    /AND NOT EXISTS \( SELECT 1 FROM "ReturnRequest" rr WHERE rr\."merchantId" = s\."merchantId" AND rr\."exchangeOrderId" = s\."orderId" AND rr\."exchangeMode" = 'order' AND \(rr\."exchangeOrderHoldActive" = true OR rr\."exchangePaymentStatus" IN \('creating', 'pending', 'expiring'\)\) \)/,
  );
  // A released, fully covered replacement stays "pending payment" in Salla; it is let through.
  assert.match(text, /s\."isPendingPayment" IS NOT TRUE OR EXISTS \( SELECT 1 FROM "ReturnRequest" rp/);
  assert.match(text, /rp\."exchangePaymentStatus" = 'not_required' AND rp\."exchangeOrderHoldActive" = false AND rp\."exchangeOrderReleasedAt" IS NOT NULL/);
  // The same rules feed the board's counts.
  assert.match(buildStatsSql(ctx()).text.replace(/\s+/g, ' '), /FROM "ReturnRequest" rr/);
});
