import type { LiveOrderResult } from '@/app/lib/order-prep/salla-live';
import type { HistoryRefund, SallaTransaction } from '@/app/lib/salla-transactions';
import { NEW_ORDER_STATUS_ID, decideVerdicts, type OrderFacts } from '@/app/lib/order-manage/eligibility';
import type { ChangePatch, ChangeRow, ChangeWhere, EngineContext, EngineDeps, Session } from '@/app/lib/order-manage/engine';
import { DEFAULT_ORDER_MANAGE_SETTINGS, type OrderManageSettings } from '@/app/lib/order-manage/settings';
import type { WorkerStore } from '@/app/lib/order-manage/worker';

/** In-memory stand-in for the database and Salla behind the engine. */

export const SETTINGS: OrderManageSettings = {
  ...DEFAULT_ORDER_MANAGE_SETTINGS,
  enabled: true,
  cancelEnabled: true,
  addressEnabled: true,
  swapEnabled: true,
  itemsEnabled: true,
  autoRefundEnabled: true,
};

export const SESSION: Session = { accessId: 'access-1', merchantId: 'm1', orderId: 'o1' };
export const KEY = 'key-0123456789abcdef';

export const FACTS: OrderFacts = {
  statusCustomId: NEW_ORDER_STATUS_ID,
  statusSlug: 'under_review',
  isPendingPayment: false,
  hasPrepClaim: false,
  hasShipment: false,
  hasShippingTask: false,
  hasOpenEscalation: false,
  doNotShip: false,
  promoViolator: false,
  isExchangeOrder: false,
  hasReturnRequest: false,
  changeInFlight: false,
  needsStaff: false,
  completedChanges: 0,
  isInternational: false,
  currency: 'SAR',
  erpSynced: false,
  hasCoupon: false,
  pilotAllowed: true,
};

export const liveNew = (): LiveOrderResult => ({
  kind: 'ok',
  detail: { id: 'o1', status: { id: 566146469, slug: 'under_review', customized: { id: 449146439 } } },
  statusCustomId: NEW_ORDER_STATUS_ID,
  statusName: 'طلب جديد',
});

export const liveCancelled = (): LiveOrderResult => ({
  kind: 'ok',
  detail: { id: 'o1', status: { id: 525144736, slug: 'canceled', customized: { id: 1183362113 } } },
  statusCustomId: '1183362113',
  statusName: 'ملغي',
});

export const liveInProgress = (): LiveOrderResult => ({
  kind: 'ok',
  detail: { id: 'o1', status: { id: 1298199463, slug: 'in_progress', customized: { id: 1956875584 } } },
  statusCustomId: '1956875584',
  statusName: 'جاري التجهيز',
});

export const paidTx = (overrides: Partial<SallaTransaction> = {}): SallaTransaction => ({
  id: 'tx1',
  status: { slug: 'paid' },
  total: { amount: 300, currency: 'SAR' },
  available_actions: ['refund', 'print'],
  payment_method: { slug: 'mada', is_refundable: true, within_refund_period: true },
  ...overrides,
});

export type World = {
  now: Date;
  facts: OrderFacts;
  settings: OrderManageSettings;
  total: number | null;
  changes: ChangeRow[];
  steps: Array<{ changeId: string; step: string; result: string }>;
  /** Mirror status, as the prep queue would see it. */
  mirrorStatus: string;
  /** Someone holds the order in prep: the hold cannot be taken. */
  claimedByPacker: boolean;
  writeAllowed: boolean;
  recentHolds: number;
  /** Returned in order by fetchLive; the last one repeats. */
  live: LiveOrderResult[];
  syncMirrorOk: boolean;
  markMirrorFails: boolean;
  cancel: () => Promise<void>;
  transactions: SallaTransaction[] | Error;
  historyRefunds: HistoryRefund[];
  refund: () => Promise<unknown>;
  autoRefundedToday: number;
  calls: { cancel: number; refund: Array<{ transactionId: string | number; amount: number; currency: string }>; notes: string[]; live: number };
};

export function createWorld(overrides: Partial<World> = {}): World {
  return {
    now: new Date('2026-11-11T12:00:00Z'),
    facts: { ...FACTS },
    settings: { ...SETTINGS },
    total: 300,
    changes: [],
    steps: [],
    mirrorStatus: NEW_ORDER_STATUS_ID,
    claimedByPacker: false,
    writeAllowed: true,
    recentHolds: 0,
    live: [liveNew(), liveCancelled()],
    syncMirrorOk: true,
    markMirrorFails: false,
    cancel: async () => undefined,
    transactions: [paidTx()],
    historyRefunds: [],
    refund: async () => ({ success: true }),
    autoRefundedToday: 0,
    calls: { cancel: 0, refund: [], notes: [], live: 0 },
    ...overrides,
  };
}

function matches(row: ChangeRow, where: ChangeWhere): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as Record<string, unknown>)[key];
    return Array.isArray(expected) ? expected.includes(actual as never) : actual === expected;
  });
}

export function createDeps(world: World): EngineDeps {
  let sequence = 0;
  const context = (): EngineContext => ({
    verdicts: decideVerdicts(world.facts, world.settings),
    settings: world.settings,
    orderNumber: '1001',
    total: world.total,
    currency: 'SAR',
    paymentMethod: 'mada',
    snapshot: { total: world.total },
  });
  return {
    now: () => world.now,
    writeAllowed: () => world.writeAllowed,
    loadContext: async () => context(),
    findChange: async (id) => world.changes.find((row) => row.id === id) ?? null,
    findChangeByKey: async (key) => world.changes.find((row) => row.idempotencyKey === key) ?? null,
    countHoldsSince: async () => world.recentHolds,
    async createHold(input) {
      if (world.claimedByPacker) return null;
      // The partial unique index: one active hold per order.
      if (world.changes.some((row) => row.orderId === input.orderId && row.holdActive)) return null;
      const row: ChangeRow = {
        id: `change-${(sequence += 1)}`,
        merchantId: input.merchantId,
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        kind: input.kind,
        state: 'held',
        holdActive: true,
        idempotencyKey: input.idempotencyKey,
        writeStatus: 'none',
        refundStatus: 'none',
        refundAmount: null,
        refundTransactionId: null,
        currency: input.currency,
        paymentMethod: input.paymentMethod,
        orderTotal: input.orderTotal,
        lastError: null,
        createdAt: world.now,
        updatedAt: world.now,
      };
      world.changes.push(row);
      return { ...row };
    },
    async updateChange(id, where, patch: ChangePatch) {
      const row = world.changes.find((entry) => entry.id === id);
      if (!row || !matches(row, where)) return false;
      // Only the columns the flows read back are kept on the fake row.
      const fields: Partial<ChangeRow> = {};
      for (const key of ['state', 'holdActive', 'writeStatus', 'refundStatus', 'refundAmount', 'refundTransactionId', 'currency', 'lastError'] as const) {
        if (patch[key] !== undefined) Object.assign(fields, { [key]: patch[key] });
      }
      const { step } = patch;
      Object.assign(row, fields, { updatedAt: world.now });
      if (step) world.steps.push({ changeId: id, step: step.step, result: step.result });
      return true;
    },
    async fetchLive() {
      const index = Math.min(world.calls.live, world.live.length - 1);
      world.calls.live += 1;
      return world.live[index];
    },
    async syncMirror(_merchantId, detail) {
      if (!world.syncMirrorOk) return false;
      world.mirrorStatus = String(detail?.status?.customized?.id ?? detail?.status?.id);
      return true;
    },
    async markMirrorCancelled() {
      if (world.markMirrorFails) throw new Error('db down');
      world.mirrorStatus = '1183362113';
    },
    async cancelOrder() {
      world.calls.cancel += 1;
      await world.cancel();
    },
    async addHistoryNote(_merchantId, _orderId, note) {
      world.calls.notes.push(note);
    },
    async listTransactions() {
      if (world.transactions instanceof Error) throw world.transactions;
      return world.transactions;
    },
    findHistoryRefunds: async () => world.historyRefunds,
    async refund(_merchantId, transactionId, amount, currency) {
      world.calls.refund.push({ transactionId, amount, currency });
      return world.refund();
    },
    autoRefundedSince: async () => world.autoRefundedToday,
  };
}

export function createStore(world: World): WorkerStore {
  const pick = (test: (row: ChangeRow) => boolean) => async () => world.changes.filter(test).map((row) => ({ ...row }));
  const idleBefore = (row: ChangeRow, before: Date) => row.updatedAt.getTime() < before.getTime();
  return {
    findAbandonedHolds: async (before) =>
      world.changes.filter((row) => row.state === 'held' && row.writeStatus === 'none' && row.holdActive && idleBefore(row, before)),
    findInterruptedWrites: async (before) =>
      world.changes.filter((row) => row.state === 'applying' && row.writeStatus === 'requested' && idleBefore(row, before)),
    findUnreleasedCancels: async (before) =>
      world.changes.filter((row) => row.kind === 'cancel' && row.writeStatus === 'done' && row.holdActive && idleBefore(row, before)),
    findUnknownCancels: pick((row) => row.kind === 'cancel' && row.state === 'needs_staff' && row.writeStatus === 'unknown'),
    findUndecidedRefunds: pick((row) => row.kind === 'cancel' && row.state === 'completed' && row.writeStatus === 'done' && row.refundStatus === 'none'),
    findUnknownRefunds: pick((row) => row.refundStatus === 'unknown'),
  };
}

/** True while the prep queue could not hand the order to a packer. */
export const isShielded = (world: World) =>
  world.changes.some((row) => row.holdActive) || world.mirrorStatus !== NEW_ORDER_STATUS_ID;
