import assert from 'node:assert/strict';
import test from 'node:test';
import type { Facts, FactRow } from '@/app/lib/analytics/engine';
import { drill } from '@/app/lib/analytics/engine';
import { previousPeriod, resolvePeriod } from '@/app/lib/analytics/period';
import { buildReport, riyadhWeekdayHour, timeBuckets, type ReportInputs } from '@/app/lib/analytics/report';
import { SHIPPING_METRICS } from '@/app/lib/shipping/analytics';

const H = 3600;
// 2026-11-10 is a Tuesday. 12:00 UTC = 15:00 Riyadh.
const NOW = Date.UTC(2026, 10, 10, 12, 0);
const TODAY = resolvePeriod({}, NOW); // Riyadh day starts 2026-11-09 21:00 UTC
const at = (hoursAfterStart: number) => new Date(TODAY.from.getTime() + hoursAfterStart * H * 1000);

const prepRow = (n: number, person: string, metrics: Record<string, number | null>, extra: Partial<FactRow> = {}): FactRow => ({
  orderId: `p${n}`,
  orderNumber: `p${n}`,
  person,
  at: at(10),
  metrics,
  scanMethod: 'scan',
  tags: [],
  timeline: [],
  ...extra,
});
const shipRow = (n: number, person: string, placedToPrinted: number | null, courier = 'SMSA', hour = 11): FactRow => ({
  orderId: `s${n}`,
  orderNumber: `s${n}`,
  person,
  at: at(hour),
  courier,
  metrics: { gap: 120, placedToPrinted, packedToPrinted: 600, labelWait: 30 },
  tags: [],
  timeline: [],
});

function inputs(overrides: Partial<ReportInputs> = {}): ReportInputs {
  const prep: Facts = {
    rows: [
      prepRow(1, 'أحمد', { pack: 120, queue: 10 * H, toLabel: 60, labelToPrint: 600 }),
      prepRow(2, 'أحمد', { pack: 180, queue: 12 * H, toLabel: 60, labelToPrint: 600 }, { scanMethod: 'manual' }),
      prepRow(3, 'سارة', { pack: 4000, queue: 8 * H, toLabel: 60, labelToPrint: 600 }), // a break: kept out of pack stats
    ],
    lists: {
      problems: { label: '', rows: [{ ...prepRow(9, 'أحمد', {}), reason: 'missing_items', at: at(1), resolvedAt: at(3) }] },
      shortages: {
        label: '',
        rows: [
          { ...prepRow(1, 'أحمد', {}), sku: 'A1', itemName: 'ثوب', reason: 'not_found' },
          { ...prepRow(2, 'أحمد', {}), sku: 'A1', itemName: 'ثوب', reason: 'not_found', resolvedAt: at(5) },
          { ...prepRow(3, 'سارة', {}), sku: 'B2', itemName: 'شماغ', reason: 'damaged' },
        ],
      },
      returns: { label: '', rows: [prepRow(1, 'أحمد', {}, { reason: 'wrong_item' }), prepRow(3, 'سارة', {}, { reason: 'size_issue' })] },
      returns_wrong_item: { label: '', rows: [prepRow(1, 'أحمد', {}, { reason: 'wrong_item' })] },
      returns_defective: { label: '', rows: [] },
    },
  };
  const shipping: Facts = {
    rows: [shipRow(1, 'خالد', 5 * H), shipRow(2, 'خالد', 20 * H), shipRow(3, 'خالد', 30 * H, 'Aramex'), shipRow(4, 'خالد', null, 'Aramex')],
    lists: { failed: { label: '', rows: [] } },
  };
  return {
    period: TODAY,
    prep,
    shipping,
    placedHours: [
      { hour: at(9), count: 4 },
      { hour: at(10), count: 3 },
    ],
    sync: { failed: 0, conflict: 0 },
    ...overrides,
  };
}

test('previousPeriod shifts by whole days so the hours line up', () => {
  const prev = previousPeriod(TODAY);
  assert.equal(prev.from.getTime(), TODAY.from.getTime() - 86_400_000);
  assert.equal(prev.to.getTime(), NOW - 86_400_000);
  const week = resolvePeriod({ preset: '7d' }, NOW);
  assert.equal(previousPeriod(week).to.getTime(), week.to.getTime() - 7 * 86_400_000);
  const month = resolvePeriod({ preset: 'month' }, NOW);
  assert.equal(month.from.toISOString(), '2026-10-31T21:00:00.000Z');
  const thirty = resolvePeriod({ preset: '30d' }, NOW);
  assert.equal(Math.round((TODAY.from.getTime() - thirty.from.getTime()) / 86_400_000), 29);
});

test('buckets: hours for one day, Riyadh days otherwise', () => {
  const hours = timeBuckets(TODAY);
  assert.equal(hours.granularity, 'hour');
  assert.equal(hours.count, 24);
  assert.equal(hours.indexOf(at(9.5).getTime()), 9);
  const week = timeBuckets(resolvePeriod({ preset: '7d' }, NOW));
  assert.equal(week.granularity, 'day');
  assert.equal(week.count, 7);
  assert.equal(week.labels[6], '10/11');
});

test('heatmap cells are Riyadh weekday and hour', () => {
  // 2026-11-09 21:30 UTC = Tuesday 00:30 Riyadh.
  assert.deepEqual(riyadhWeekdayHour(Date.UTC(2026, 10, 9, 21, 30)), { weekday: 2, hour: 0 });
});

test('the 24h promise, lead time, and net backlog', () => {
  const report = buildReport(inputs(), null, NOW);
  const kpi = (key: string) => report.kpis.find((entry) => entry.key === key)!;
  // 3 measured, 2 within 24h.
  assert.equal(kpi('onTime').value, 66.7);
  assert.equal(kpi('lead').value, 20 * H);
  assert.equal(kpi('printed').value, 4);
  assert.equal(kpi('placed').value, 7);
  assert.equal(kpi('net').value, 3);
  assert.equal(report.flow.placed[9], 4);
  assert.equal(report.flow.printed[11], 4);
  assert.equal(report.flow.backlog[23], 3);
  // Age buckets around the promise.
  const bucket = (key: string) => report.ageBuckets.find((entry) => entry.key === key)!;
  assert.equal(bucket('lt6').count, 1);
  assert.equal(bucket('12to24').count, 1);
  assert.equal(bucket('24to48').count, 1);
  assert.equal(bucket('24to48').late, true);
});

test('stages: medians per step, breaks left out of packing', () => {
  const report = buildReport(inputs(), null, NOW);
  const stage = (key: string) => report.stages.find((entry) => entry.key === key)!;
  assert.equal(stage('queue').medianSec, 10 * H);
  assert.equal(stage('pack').medianSec, 150);
  assert.equal(stage('pack').count, 2);
  assert.equal(stage('labelToPrint').medianSec, 600);
});

test('team, quality and shortages trace back to people and SKUs', () => {
  const report = buildReport(inputs(), null, NOW);
  const ahmad = report.team.packers.find((row) => row.name === 'أحمد')!;
  assert.equal(ahmad.count, 2);
  assert.equal(ahmad.scanPct, 50);
  assert.equal(ahmad.wrongItems, 1);
  assert.equal(ahmad.shortages, 2);
  assert.equal(report.quality.wrongItem, 1);
  assert.equal(report.quality.wrongPer1000, Math.round((1 / 3) * 1000 * 10) / 10);
  assert.equal(report.quality.byPacker[0].name, 'أحمد');
  assert.equal(report.shortages.count, 3);
  assert.equal(report.shortages.open, 2);
  assert.equal(report.shortages.topSkus[0].sku, 'A1');
  assert.equal(report.shortages.topSkus[0].share, 66.7);
  assert.equal(report.exceptions.count, 1);
  const smsa = report.carriers.find((row) => row.name === 'SMSA')!;
  assert.equal(smsa.onTimePct, 100);
});

test('comparison carries the previous value', () => {
  const previous = inputs({ period: previousPeriod(TODAY), placedHours: [{ hour: at(-14), count: 2 }] });
  const report = buildReport(inputs(), previous, NOW);
  assert.equal(report.kpis.find((entry) => entry.key === 'placed')!.previous, 2);
});

test('insights fire on real problems and stay quiet otherwise', () => {
  const many = (count: number, lead: number) => Array.from({ length: count }, (_, index) => shipRow(index, 'خالد', lead));
  const late = buildReport(inputs({ shipping: { rows: many(20, 40 * H), lists: { failed: { label: '', rows: [] } } } }), null, NOW);
  const sla = late.insights.find((entry) => entry.key === 'sla');
  assert.equal(sla?.tone, 'danger');
  assert.equal(sla?.drill?.filter.subset, 'slow');

  const good = buildReport(inputs({ shipping: { rows: many(20, 2 * H), lists: { failed: { label: '', rows: [] } } } }), null, NOW);
  assert.equal(good.insights.find((entry) => entry.key === 'sla')?.tone, 'good');
  // Danger sorts before good.
  const toneOrder = late.insights.map((entry) => entry.tone);
  assert.equal(toneOrder[0], 'danger');

  // Backlog growing: 60 in, 4 out in one day.
  const growing = buildReport(inputs({ placedHours: [{ hour: at(9), count: 60 }] }), null, NOW);
  assert.ok(growing.insights.some((entry) => entry.key === 'net' && entry.tone === 'warn'));
  // Few placed: no backlog insight.
  assert.ok(!buildReport(inputs(), null, NOW).insights.some((entry) => entry.key === 'net'));
});

test('range drill selects the age bucket', () => {
  const report = buildReport(inputs(), null, NOW);
  const bucket = report.ageBuckets.find((entry) => entry.key === '12to24')!;
  const result = drill(inputs().shipping, SHIPPING_METRICS, bucket.drill.filter);
  assert.deepEqual(result.rows.map((row) => row.orderNumber), ['s2']);
});
