import { log } from '@/app/lib/logger';
import { finishCancel } from './cancel';
import { isLiveCancelled, type ChangeRow, type EngineDeps } from './engine';
import { processCancelRefund, resolveUnknownRefund } from './refund';
import type { OrderManageSettings } from './settings';

/**
 * Picks up customer changes a request left unfinished (function timeout,
 * crash, Salla outage). It never sends a Salla write whose outcome is
 * unknown; it only reads Salla to learn what happened, releases holds that
 * provably wrote nothing, and runs refunds that were not decided yet.
 */

export interface WorkerStore {
  /** Holds on which no write was ever sent, idle since before `before`. */
  findAbandonedHolds(before: Date): Promise<ChangeRow[]>;
  /** Changes stuck with a write sent but no recorded result, idle since before `before`. */
  findInterruptedWrites(before: Date): Promise<ChangeRow[]>;
  /** Cancels confirmed in Salla whose hold is still on. */
  findUnreleasedCancels(before: Date): Promise<ChangeRow[]>;
  /** Cancels whose write outcome is unknown. */
  findUnknownCancels(): Promise<ChangeRow[]>;
  /** Completed cancels with no refund decision yet. */
  findUndecidedRefunds(): Promise<ChangeRow[]>;
  findUnknownRefunds(): Promise<ChangeRow[]>;
}

export type WorkerSummary = {
  released: number;
  parked: number;
  finished: number;
  confirmed: number;
  refunds: Record<string, number>;
};

const STALE_MS = 2 * 60_000;

export async function runOrderManageWorker(
  deps: EngineDeps,
  store: WorkerStore,
  settings: Pick<OrderManageSettings, 'autoRefundEnabled' | 'autoRefundDailyCapSar'>,
): Promise<WorkerSummary> {
  const summary: WorkerSummary = { released: 0, parked: 0, finished: 0, confirmed: 0, refunds: {} };
  const stale = new Date(deps.now().getTime() - STALE_MS);

  // 1. Held but never written to: nothing happened in Salla, free the order.
  for (const change of await store.findAbandonedHolds(stale)) {
    const released = await deps.updateChange(change.id, { state: 'held', writeStatus: 'none', holdActive: true }, {
      state: 'failed',
      holdActive: false,
      lastError: 'abandoned_before_write',
      completedAt: deps.now(),
      step: { step: 'worker', result: 'released_unwritten' },
    });
    if (released) summary.released += 1;
  }

  // 2. A write was sent and the request died: outcome unknown, for step 4 or staff.
  for (const change of await store.findInterruptedWrites(stale)) {
    const parked = await deps.updateChange(change.id, { state: 'applying', writeStatus: 'requested' }, {
      state: 'needs_staff',
      writeStatus: 'unknown',
      lastError: 'interrupted_during_write',
      step: { step: 'worker', result: 'parked_unknown' },
    });
    if (parked) summary.parked += 1;
  }

  // 3. Cancelled in Salla but still held: finish the mirror update and release.
  for (const change of await store.findUnreleasedCancels(stale)) {
    if (await finishCancel(deps, change).catch(() => false)) summary.finished += 1;
  }

  // 4. Unknown cancels: settled only when Salla itself shows the order cancelled.
  for (const change of await store.findUnknownCancels()) {
    const live = await deps.fetchLive(change.merchantId, change.orderId);
    if (!isLiveCancelled(live)) continue;
    const confirmed = await deps.updateChange(change.id, { state: 'needs_staff', writeStatus: 'unknown' }, {
      state: 'applying',
      writeStatus: 'done',
      lastError: null,
      step: { step: 'worker', result: 'cancel_confirmed_from_salla' },
    });
    if (!confirmed) continue;
    summary.confirmed += 1;
    if (await finishCancel(deps, { ...change, state: 'applying', writeStatus: 'done' }).catch(() => false)) summary.finished += 1;
  }

  // 5. Refunds.
  const count = (key: string) => {
    summary.refunds[key] = (summary.refunds[key] ?? 0) + 1;
  };
  for (const change of await store.findUndecidedRefunds()) {
    try {
      count(await processCancelRefund(deps, change.id, settings));
    } catch (error) {
      log.error('Order-manage refund step failed', { changeId: change.id, error: error instanceof Error ? error.message : error });
      count('error');
    }
  }
  for (const change of await store.findUnknownRefunds()) {
    if ((await resolveUnknownRefund(deps, change.id).catch(() => 'unknown')) === 'refunded') count('confirmed');
  }

  return summary;
}
