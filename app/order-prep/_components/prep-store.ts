import type {
  ActionError,
  ItemCheck,
  PrepAssignmentView,
  PrepState,
  ProblemItem,
  QueueStats,
} from '@/app/lib/order-prep/types';

/**
 * Client state of the packing page. Actions are applied on screen at once
 * (the next order is already loaded) and queued for the server; the queue is
 * kept in localStorage so a reload or a dead network never loses a pack.
 * Server state is only adopted when nothing is waiting to be sent, so a
 * heartbeat can't undo what the packer just did.
 */

export const UNDO_MS = 5_000;

export type ItemProgressEntry = { checked: number; method: 'scan' | 'manual' };
export type ItemProgress = Record<number, ItemProgressEntry>;

type ActionBase = { id: string; orderId: string; orderNumber: string; notBefore: number; attempts: number; nextTryAt: number };

export type PendingAction =
  | (ActionBase & {
      kind: 'complete';
      assignmentId: string;
      itemChecks: ItemCheck[];
      scanMethod: 'scan' | 'manual';
    })
  | (ActionBase & {
      kind: 'exception';
      assignmentId: string;
      items: ProblemItem[];
      note: string | null;
      itemChecks: ItemCheck[];
    })
  | (ActionBase & { kind: 'release'; scope: 'all' | 'current'; reason: string | null });

export type Banner = { id: string; tone: 'error' | 'warn' | 'info' | 'success'; text: string; sticky?: boolean };

export type Phase = 'idle' | 'starting' | 'packing' | 'empty';

export type PrepUiState = {
  phase: Phase;
  current: PrepAssignmentView | null;
  next: PrepAssignmentView | null;
  stats: QueueStats | null;
  myCompletedToday: number;
  /** Units confirmed per item, keyed by assignment id. */
  progress: Record<string, ItemProgress>;
  queue: PendingAction[];
  inFlightId: string | null;
  undo: {
    actionId: string;
    orderNumber: string;
    previous: { current: PrepAssignmentView; next: PrepAssignmentView | null };
    expiresAt: number;
  } | null;
  lastDone: { orderId: string; orderNumber: string; print: 'idle' | 'sending' | 'ok' | 'failed' } | null;
  banners: Banner[];
  online: boolean;
};

export type PrepEvent =
  | { type: 'SERVER_STATE'; state: PrepState; source: 'claim' | 'heartbeat' | 'action' | 'load' }
  | { type: 'START' }
  | { type: 'START_FAILED'; message: string }
  | { type: 'MARK_ITEM'; assignmentId: string; index: number; method: 'scan' | 'manual'; quantity: number; mode: 'add' | 'fill' | 'clear' }
  | { type: 'DONE'; action: Extract<PendingAction, { kind: 'complete' }>; now: number }
  | { type: 'PROBLEM'; action: Extract<PendingAction, { kind: 'exception' }> }
  | { type: 'RELEASE'; action: Extract<PendingAction, { kind: 'release' }> }
  | { type: 'UNDO'; now: number }
  | { type: 'UNDO_EXPIRED' }
  | { type: 'ACTION_STARTED'; id: string }
  | { type: 'ACTION_SUCCEEDED'; id: string; state: PrepState | null }
  | { type: 'ACTION_RETRY'; id: string; nextTryAt: number }
  | { type: 'ACTION_REJECTED'; id: string; error: ActionError; state: PrepState | null }
  | { type: 'PRINT_STATUS'; orderId: string; status: 'sending' | 'ok' | 'failed' }
  | { type: 'BANNER'; banner: Banner }
  | { type: 'DISMISS_BANNER'; id: string }
  | { type: 'ONLINE'; online: boolean }
  | { type: 'RESTORE_QUEUE'; queue: PendingAction[] };

export function initialPrepState(state: PrepState | null): PrepUiState {
  return {
    phase: state?.current ? 'packing' : 'idle',
    current: state?.current ?? null,
    next: state?.next ?? null,
    stats: state?.stats ?? null,
    myCompletedToday: state?.myCompletedToday ?? 0,
    progress: {},
    queue: [],
    inFlightId: null,
    undo: null,
    lastDone: null,
    banners: [],
    online: true,
  };
}

const withBanner = (state: PrepUiState, banner: Banner): PrepUiState => ({
  ...state,
  banners: [...state.banners.filter((entry) => entry.id !== banner.id), banner].slice(-4),
});

function pruneProgress(progress: Record<string, ItemProgress>, keep: Array<PrepAssignmentView | null>) {
  const ids = new Set(keep.filter(Boolean).map((view) => view!.assignmentId));
  return Object.fromEntries(Object.entries(progress).filter(([id]) => ids.has(id)));
}

/** Adopts the server's view of the packer's orders. */
function adopt(state: PrepUiState, server: PrepState, source: 'claim' | 'heartbeat' | 'action' | 'load'): PrepUiState {
  let next: PrepUiState = {
    ...state,
    stats: server.stats,
    myCompletedToday: Math.max(server.myCompletedToday, 0),
  };
  if (state.queue.length > 0 || state.inFlightId) return next; // local view is ahead

  const previous = state.current;
  const lost =
    previous &&
    server.current?.order.orderId !== previous.order.orderId &&
    server.next?.order.orderId !== previous.order.orderId;
  if (lost && source === 'heartbeat') {
    next = withBanner(next, {
      id: `lost-${previous.order.orderId}`,
      tone: 'warn',
      sticky: true,
      text: `الطلب #${previous.order.orderNumber} لم يعد معك (انتهت المهلة أو تغيّرت حالته). أعد القطعة لمكانها.`,
    });
  }

  const phase: Phase =
    server.current ? 'packing' : state.phase === 'idle' && source !== 'claim' ? 'idle' : 'empty';
  return {
    ...next,
    phase,
    current: server.current,
    next: server.next,
    progress: pruneProgress(state.progress, [server.current, server.next]),
  };
}

function swapToNext(state: PrepUiState): Pick<PrepUiState, 'current' | 'next' | 'phase'> {
  return { current: state.next, next: null, phase: 'packing' };
}

export function prepReducer(state: PrepUiState, event: PrepEvent): PrepUiState {
  switch (event.type) {
    case 'SERVER_STATE':
      return adopt(state, event.state, event.source);

    case 'START':
      return { ...state, phase: 'starting' };

    case 'START_FAILED':
      return withBanner({ ...state, phase: state.current ? 'packing' : 'idle' }, {
        id: 'start',
        tone: 'error',
        text: event.message,
      });

    case 'MARK_ITEM': {
      const items = { ...(state.progress[event.assignmentId] ?? {}) };
      const entry = items[event.index] ?? { checked: 0, method: event.method };
      const checked =
        event.mode === 'clear'
          ? 0
          : event.mode === 'fill'
            ? event.quantity
            : Math.min(event.quantity, entry.checked + 1);
      // A line counts as scanned only if every unit was scanned.
      const method = event.method === 'manual' || entry.method === 'manual' ? 'manual' : 'scan';
      items[event.index] = { checked, method: event.mode === 'clear' ? event.method : method };
      return { ...state, progress: { ...state.progress, [event.assignmentId]: items } };
    }

    case 'DONE': {
      if (!state.current || state.current.assignmentId !== event.action.assignmentId) return state;
      return {
        ...state,
        ...swapToNext(state),
        queue: [...state.queue, event.action],
        undo: {
          actionId: event.action.id,
          orderNumber: event.action.orderNumber,
          previous: { current: state.current, next: state.next },
          expiresAt: event.now + UNDO_MS,
        },
        lastDone: { orderId: event.action.orderId, orderNumber: event.action.orderNumber, print: 'idle' },
        myCompletedToday: state.myCompletedToday + 1,
      };
    }

    case 'PROBLEM': {
      if (!state.current || state.current.assignmentId !== event.action.assignmentId) return state;
      return { ...state, ...swapToNext(state), queue: [...state.queue, event.action], undo: null };
    }

    case 'RELEASE': {
      const queue = [...state.queue, event.action];
      if (event.action.scope === 'all') {
        return { ...state, phase: 'idle', current: null, next: null, queue, undo: null };
      }
      return { ...state, ...swapToNext(state), queue, undo: null };
    }

    case 'UNDO': {
      const undo = state.undo;
      if (!undo || event.now > undo.expiresAt || state.inFlightId === undo.actionId) return state;
      if (!state.queue.some((action) => action.id === undo.actionId)) return { ...state, undo: null };
      // The order that moved up goes back to being next (it was never started on the server).
      const restoredNext = undo.previous.next ?? state.current;
      return {
        ...state,
        phase: 'packing',
        current: undo.previous.current,
        next: restoredNext,
        queue: state.queue.filter((action) => action.id !== undo.actionId),
        undo: null,
        lastDone: null,
        myCompletedToday: Math.max(0, state.myCompletedToday - 1),
      };
    }

    case 'UNDO_EXPIRED':
      return state.undo ? { ...state, undo: null } : state;

    case 'ACTION_STARTED':
      return {
        ...state,
        inFlightId: event.id,
        undo: state.undo?.actionId === event.id ? null : state.undo,
      };

    case 'ACTION_SUCCEEDED': {
      const queue = state.queue.filter((action) => action.id !== event.id);
      const cleared: PrepUiState = { ...state, queue, inFlightId: null };
      return event.state ? adopt(cleared, event.state, 'action') : cleared;
    }

    case 'ACTION_RETRY':
      return {
        ...state,
        inFlightId: null,
        queue: state.queue.map((action) =>
          action.id === event.id ? { ...action, attempts: action.attempts + 1, nextTryAt: event.nextTryAt } : action,
        ),
      };

    case 'ACTION_REJECTED': {
      const action = state.queue.find((entry) => entry.id === event.id);
      const queue = state.queue.filter((entry) => entry.id !== event.id);
      let next: PrepUiState = { ...state, queue, inFlightId: null };
      if (action) {
        const verb = action.kind === 'complete' ? 'لم يُسجَّل إنهاء' : action.kind === 'exception' ? 'لم تُسجَّل مشكلة' : 'لم يُرجَع';
        next = withBanner(next, {
          id: `rejected-${action.id}`,
          tone: 'error',
          sticky: true,
          text: `${verb} الطلب #${action.orderNumber}: ${event.error.message}`,
        });
      }
      return event.state ? adopt(next, event.state, 'action') : next;
    }

    case 'PRINT_STATUS':
      return state.lastDone?.orderId === event.orderId
        ? { ...state, lastDone: { ...state.lastDone, print: event.status } }
        : state;

    case 'BANNER':
      return withBanner(state, event.banner);

    case 'DISMISS_BANNER':
      return { ...state, banners: state.banners.filter((banner) => banner.id !== event.id) };

    case 'ONLINE':
      if (state.online === event.online) return state;
      return {
        ...state,
        online: event.online,
        // Back online: retry waiting actions now instead of after their backoff.
        queue: event.online ? state.queue.map((action) => ({ ...action, nextTryAt: 0 })) : state.queue,
      };

    case 'RESTORE_QUEUE': {
      if (event.queue.length === 0) return state;
      // After a reload the undo window is gone: send everything now, in order.
      const restored = event.queue.map((action) => ({ ...action, notBefore: 0, nextTryAt: 0 }));
      const known = new Set(state.queue.map((action) => action.id));
      return { ...state, queue: [...state.queue, ...restored.filter((action) => !known.has(action.id))] };
    }

    default:
      return state;
  }
}

/** Item checks to send with Done, and whether every unit was scanned. */
export function summarizeChecks(
  view: PrepAssignmentView,
  progress: ItemProgress | undefined,
  confirmAllManually: boolean,
): { itemChecks: ItemCheck[]; scanMethod: 'scan' | 'manual' } {
  const itemChecks = view.order.items.map((item) => {
    const entry = progress?.[item.index];
    const checked = confirmAllManually ? item.quantity : Math.min(item.quantity, entry?.checked ?? 0);
    const method: 'scan' | 'manual' = entry && entry.method === 'scan' && entry.checked >= item.quantity ? 'scan' : 'manual';
    return { index: item.index, sku: item.sku, checked, method };
  });
  const scanMethod = itemChecks.length > 0 && itemChecks.every((check) => check.method === 'scan') ? 'scan' : 'manual';
  return { itemChecks, scanMethod };
}

/** True when every unit of every line has been confirmed. */
export function allUnitsChecked(view: PrepAssignmentView, progress: ItemProgress | undefined): boolean {
  return view.order.items.every((item) => (progress?.[item.index]?.checked ?? 0) >= item.quantity);
}

/** Done needs per-unit confirmation unless the order is a single line of one unit. */
export function needsItemChecks(view: PrepAssignmentView): boolean {
  return view.order.items.length > 1 || view.order.items.some((item) => item.quantity > 1);
}
