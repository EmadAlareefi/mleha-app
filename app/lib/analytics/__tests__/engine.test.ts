import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketsFor, drill, peopleFor, type Facts, type FactRow, type MetricDef } from '@/app/lib/analytics/engine';

const DEF: MetricDef = { key: 'pack', label: 'وقت التجهيز', breakSec: 1800, slowSec: 300 };
const row = (orderNumber: string, person: string, pack: number | null, scan = false, minute = 0): FactRow => ({
  orderId: orderNumber,
  orderNumber,
  person,
  at: new Date(Date.UTC(2026, 10, 10, 10, minute)),
  metrics: { pack },
  scanMethod: scan ? 'scan' : 'manual',
  tags: [],
  timeline: [],
});
const facts: Facts = {
  rows: [row('1', 'A', 60, true, 1), row('2', 'A', 400, false, 2), row('3', 'B', 120, false, 3), row('4', 'B', 4000, false, 4), row('5', 'B', null, false, 5)],
  lists: { problems: { label: 'مشاكل', rows: [row('9', 'A', null)] } },
};

test('drill: all, slow, breaks, bucket, person, list', () => {
  assert.equal(drill(facts, [DEF], { metric: 'pack', subset: 'all' }).count, 5);
  const slow = drill(facts, [DEF], { metric: 'pack', subset: 'slow' });
  assert.deepEqual(slow.rows.map((entry) => entry.orderNumber), ['2']);
  assert.deepEqual(drill(facts, [DEF], { metric: 'pack', subset: 'breaks' }).rows.map((entry) => entry.orderNumber), ['4']);
  // Buckets are [from, to): exactly 2:00 belongs to "2–3".
  assert.deepEqual(drill(facts, [DEF], { metric: 'pack', subset: 'bucket', bucket: '2to3' }).rows.map((entry) => entry.orderNumber), ['3']);
  assert.deepEqual(drill(facts, [DEF], { metric: 'pack', subset: 'bucket', bucket: '1to2' }).rows.map((entry) => entry.orderNumber), ['1']);
  assert.equal(drill(facts, [DEF], { metric: 'pack', person: 'A' }).count, 2);
  assert.equal(drill(facts, [DEF], { metric: 'pack', subset: 'scanned' }).count, 1);
  assert.equal(drill(facts, [DEF], { metric: 'problems' }).count, 1);
  assert.equal(drill(facts, [DEF], { metric: 'pack', subset: 'measured' }).count, 4);
});

test('drill: longest first, breaks flagged, unmeasured last; averages leave breaks out', () => {
  const result = drill(facts, [DEF], { metric: 'pack', subset: 'all' });
  assert.deepEqual(result.rows.map((entry) => entry.orderNumber), ['4', '2', '3', '1', '5']);
  assert.equal(result.rows[0].isBreak, true);
  assert.equal(result.avgSec, (60 + 400 + 120) / 3);
  const byTime = drill(facts, [DEF], { metric: 'pack' }, { sort: 'time' });
  assert.equal(byTime.rows[0].orderNumber, '5');
});

test('buckets and people', () => {
  const buckets = Object.fromEntries(bucketsFor(facts.rows, DEF).map((bucket) => [bucket.key, bucket.count]));
  assert.equal(buckets['1to2'], 1);
  assert.equal(buckets['2to3'], 1);
  assert.equal(buckets['5to10'], 1);
  assert.equal(buckets.break, 1);
  const people = peopleFor(facts.rows, DEF, { withScan: true });
  const a = people.find((person) => person.name === 'A')!;
  assert.equal(a.count, 2);
  assert.equal(a.scanPct, 50);
  assert.equal(a.avgSec, 230);
  const b = people.find((person) => person.name === 'B')!;
  assert.equal(b.breaks, 1);
  assert.equal(b.perHour, 30); // one 2-minute order of real work → 30/h
});
