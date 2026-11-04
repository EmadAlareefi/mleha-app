import assert from 'node:assert/strict';
import test from 'node:test';
import { sortByPrepPriority } from '../order-prep-service';

test('held orders are taken in the order the prep page shows them', () => {
  const sorted = sortByPrepPriority([
    { id: 'a', status: 'assigned', assignedAt: '2026-11-04T08:00:00Z' },
    { id: 'w', status: 'waiting', assignedAt: '2026-11-04T10:00:00Z' },
    { id: 'p2', status: 'preparing', assignedAt: '2026-11-04T09:00:00Z' },
    { id: 'p1', status: 'preparing', assignedAt: '2026-11-04T07:00:00Z' },
    { id: 'a0', status: 'assigned', assignedAt: '2026-11-04T06:00:00Z' },
  ]);
  assert.deepEqual(sorted.map((r) => r.id), ['p1', 'p2', 'w', 'a0', 'a']);
});
