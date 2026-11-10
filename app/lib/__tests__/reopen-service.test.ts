import assert from 'node:assert/strict';
import test from 'node:test';
import { reopenReturnRequest, type ReopenDeps } from '../returns/reopen-service';

type Row = Record<string, any>;

function setup(request: Row, others: Row[] = []) {
  const state = { request: { processingAudit: [], ...request } as Row, calls: { reprice: 0, pickup: [] as any[] } };
  const db: any = {
    returnRequest: {
      async findUnique() {
        return { ...state.request, items: state.request.items.map((item: Row) => ({ ...item })) };
      },
      async findMany() {
        return others;
      },
      async update({ data }: any) {
        Object.assign(state.request, data);
        return state.request;
      },
      async updateMany({ where, data }: any) {
        const ok = Object.entries(where).every(([key, value]) => (state.request[key] ?? null) === value);
        if (!ok) return { count: 0 };
        Object.assign(state.request, data);
        return { count: 1 };
      },
    },
    returnItem: {
      async update({ where, data }: any) {
        Object.assign(state.request.items.find((item: Row) => item.id === where.id), data);
      },
    },
    async $transaction(fn: any) {
      return fn(db);
    },
  };
  const deps: ReopenDeps = {
    db,
    reprice: async () => {
      state.calls.reprice++;
    },
    syncPickup: async (...args) => {
      state.calls.pickup.push(args);
    },
    now: () => new Date('2026-11-10T10:00:00Z'),
  };
  return { state, deps };
}

const completed = {
  id: 'r1',
  merchantId: 'm1',
  orderId: 'o1',
  status: 'completed',
  processingStatus: 'done',
  processingError: null,
  receivedAt: new Date('2026-11-05T10:00:00Z'),
  items: [{ id: 'a', productName: 'فستان', conditionStatus: 'worn', restockStatus: 'skipped', preInspectionNotes: null }],
};

test('reopen needs a reason, writes the audit and resets processing', async () => {
  const { state, deps } = setup(completed);
  const missing = await reopenReturnRequest({ id: 'r1', reason: ' ', actor: 'نورة' }, deps);
  assert.equal(!missing.ok && missing.code, 'REASON_REQUIRED');

  const result = await reopenReturnRequest({ id: 'r1', reason: 'تم الإغلاق بالخطأ', clearInspection: true, actor: 'نورة' }, deps);
  assert.ok(result.ok && result.executed, JSON.stringify(result));
  assert.equal(state.request.status, 'delivered');
  assert.equal(state.request.processingStatus, 'idle');
  assert.equal(state.request.items[0].conditionStatus, null);
  assert.equal(state.request.items[0].restockStatus, 'none');
  assert.match(state.request.items[0].preInspectionNotes, /تم الإغلاق بالخطأ/);
  assert.equal(state.request.processingAudit.at(-1).step, 'reopen');
  assert.equal(state.request.processingAudit.at(-1).details.reason, 'تم الإغلاق بالخطأ');
  assert.equal(state.calls.reprice, 1);
  // Received goods: no pickup booked.
  assert.equal(state.calls.pickup.length, 0);
});

test('a dry run says where it lands and writes nothing', async () => {
  const { state, deps } = setup(completed);
  const result = await reopenReturnRequest({ id: 'r1', reason: '', actor: 'نورة', dryRun: true }, deps);
  assert.ok(result.ok && !result.executed);
  assert.equal(state.request.status, 'completed');
});

test('a request that moved meanwhile is not overwritten', async () => {
  const { state, deps } = setup(completed);
  const findUnique = deps.db.returnRequest.findUnique;
  (deps.db.returnRequest as any).findUnique = async (args: any) => {
    const row = await findUnique(args);
    state.request.processingStatus = 'processing'; // someone claimed it after we read it
    return row;
  };
  const result = await reopenReturnRequest({ id: 'r1', reason: 'سبب', actor: 'نورة' }, deps);
  assert.equal(!result.ok && result.code, 'CHANGED');
});

test('a rejected request whose pieces another active request holds is not reopened', async () => {
  const { deps } = setup(
    { ...completed, status: 'rejected', items: [{ id: 'a', productName: 'فستان', orderItemId: '55', unitIndex: 0 }] },
    [{ orderNumber: '1002', items: [{ orderItemId: '55', unitIndex: 0 }] }],
  );
  const result = await reopenReturnRequest({ id: 'r1', reason: 'سبب', actor: 'نورة' }, deps);
  assert.equal(!result.ok && result.code, 'PIECES_CLAIMED');
});

test('reopened before pickup: the pickup sync runs, guarded against a second booking', async () => {
  const { state, deps } = setup({ ...completed, status: 'rejected', receivedAt: null, items: [{ id: 'a', productName: 'فستان' }] });
  const result = await reopenReturnRequest({ id: 'r1', reason: 'رفض بالخطأ', actor: 'نورة' }, deps);
  assert.ok(result.ok);
  assert.equal(state.request.status, 'pending_review');
  assert.deepEqual(state.calls.pickup, [['r1', { skipIfPickedUp: true }]]);
});
