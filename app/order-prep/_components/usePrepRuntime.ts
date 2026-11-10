'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { ActionError, PrepState } from '@/app/lib/order-prep/types';
import type { PendingAction, PrepEvent, PrepUiState } from './prep-store';

/**
 * Side effects of the packing page: sends queued actions in order (with
 * retries), keeps claims alive, persists the queue, holds a screen wake lock,
 * and preloads the next order's photos.
 */

const HEARTBEAT_MS = 60_000;
const EMPTY_POLL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_STEPS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

type ApiResponse = { success: boolean; state?: PrepState | null; error?: ActionError | string };

async function postJson(url: string, body: unknown): Promise<{ status: number; data: ApiResponse | null }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => null)) as ApiResponse | null;
  return { status: response.status, data };
}

function errorOf(data: ApiResponse | null, fallback: string): ActionError {
  if (data?.error && typeof data.error === 'object') return data.error;
  return { code: 'server', message: typeof data?.error === 'string' ? data.error : fallback };
}

function requestFor(action: PendingAction): { url: string; body: unknown } {
  switch (action.kind) {
    case 'complete':
      return {
        url: `/api/order-prep/v2/assignments/${encodeURIComponent(action.assignmentId)}/complete`,
        body: { orderId: action.orderId, itemChecks: action.itemChecks, scanMethod: action.scanMethod, clientActionId: action.id },
      };
    case 'exception':
      return {
        url: `/api/order-prep/v2/assignments/${encodeURIComponent(action.assignmentId)}/exception`,
        body: { orderId: action.orderId, items: action.items, note: action.note, itemChecks: action.itemChecks, clientActionId: action.id },
      };
    case 'release':
      return { url: '/api/order-prep/v2/release', body: { scope: action.scope, reason: action.reason } };
  }
}

const storageKey = (userId: string) => `order-prep:v2:queue:${userId}`;

function readPersistedQueue(userId: string): PendingAction[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingAction[]) : [];
  } catch {
    return [];
  }
}

function writePersistedQueue(userId: string, queue: PendingAction[]) {
  try {
    if (queue.length === 0) window.localStorage.removeItem(storageKey(userId));
    else window.localStorage.setItem(storageKey(userId), JSON.stringify(queue));
  } catch {
    // Storage blocked: the queue still works for this page load.
  }
}

export function usePrepRuntime(state: PrepUiState, dispatch: Dispatch<PrepEvent>, userId: string) {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const restoredRef = useRef(false);
  // Re-runs the action runner when a delayed action becomes due.
  const [runnerTick, setRunnerTick] = useState(0);

  // Restore actions left unsent by a reload, then keep storage in step.
  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true;
      dispatch({ type: 'RESTORE_QUEUE', queue: readPersistedQueue(userId) });
      return;
    }
    writePersistedQueue(userId, state.queue);
  }, [dispatch, state.queue, userId]);

  // Online / offline.
  useEffect(() => {
    const update = () => dispatch({ type: 'ONLINE', online: navigator.onLine });
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [dispatch]);

  const heartbeatSoonRef = useRef<() => void>(() => undefined);

  // The action runner: strictly in order, one at a time.
  useEffect(() => {
    if (state.inFlightId) return;
    const head = state.queue[0];
    if (!head) return;
    const wakeAt = Math.max(head.notBefore, head.nextTryAt);
    const delay = wakeAt - Date.now();
    if (delay > 0) {
      const timer = window.setTimeout(() => setRunnerTick((tick) => tick + 1), delay + 20);
      return () => window.clearTimeout(timer);
    }
    dispatch({ type: 'ACTION_STARTED', id: head.id });
    const { url, body } = requestFor(head);
    void (async () => {
      try {
        const { status, data } = await postJson(url, body);
        if (status >= 200 && status < 300 && data?.success) {
          dispatch({ type: 'ACTION_SUCCEEDED', id: head.id, state: data.state ?? null });
          heartbeatSoonRef.current();
          return;
        }
        if (status === 401) {
          dispatch({
            type: 'BANNER',
            banner: { id: 'session', tone: 'error', sticky: true, text: 'انتهت الجلسة. سجّل الدخول من جديد، وستُرسَل العمليات المعلّقة تلقائياً.' },
          });
          dispatch({ type: 'ACTION_RETRY', id: head.id, nextTryAt: Date.now() + 30_000 });
          return;
        }
        if (status >= 400 && status < 500) {
          dispatch({ type: 'ACTION_REJECTED', id: head.id, error: errorOf(data, 'رُفض الطلب'), state: data?.state ?? null });
          return;
        }
        throw new Error(`HTTP ${status}`);
      } catch {
        const step = RETRY_STEPS_MS[Math.min(head.attempts, RETRY_STEPS_MS.length - 1)];
        dispatch({ type: 'ACTION_RETRY', id: head.id, nextTryAt: Date.now() + step });
      }
    })();
  }, [dispatch, state.inFlightId, state.queue, runnerTick]);

  // Undo window.
  useEffect(() => {
    if (!state.undo) return;
    const timer = window.setTimeout(() => dispatch({ type: 'UNDO_EXPIRED' }), Math.max(0, state.undo.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [dispatch, state.undo]);

  // Heartbeat: renew leases, pick up live-check results and new orders.
  const sendHeartbeat = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase !== 'packing' && current.phase !== 'empty') return;
    if (current.queue.length > 0 || current.inFlightId) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const held = [
      current.current ? { orderId: current.current.order.orderId, slot: 'preparing' } : null,
      current.next ? { orderId: current.next.order.orderId, slot: 'assigned' } : null,
    ].filter(Boolean);
    try {
      const { status, data } = await postJson('/api/order-prep/v2/heartbeat', { held });
      if (status === 401) {
        dispatch({
          type: 'BANNER',
          banner: { id: 'session', tone: 'error', sticky: true, text: 'انتهت الجلسة. سجّل الدخول من جديد.' },
        });
        return;
      }
      if (data?.success && data.state) dispatch({ type: 'SERVER_STATE', state: data.state, source: 'heartbeat' });
    } catch {
      // Offline: the next beat tries again.
    }
  }, [dispatch]);

  useEffect(() => {
    let soonTimer: number | undefined;
    heartbeatSoonRef.current = () => {
      window.clearTimeout(soonTimer);
      soonTimer = window.setTimeout(() => void sendHeartbeat(), 4_000);
    };
    return () => window.clearTimeout(soonTimer);
  }, [sendHeartbeat]);

  useEffect(() => {
    if (state.phase !== 'packing' && state.phase !== 'empty') return;
    const interval = window.setInterval(() => void sendHeartbeat(), state.phase === 'empty' ? EMPTY_POLL_MS : HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sendHeartbeat();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sendHeartbeat, state.phase]);

  // Keep the screen on while packing.
  useEffect(() => {
    if (state.phase !== 'packing' || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const next = await (navigator as any).wakeLock.request('screen');
        if (cancelled) await next.release();
        else lock = next;
      } catch {
        // Battery saver or no permission: the page works without it.
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [state.phase]);

  // Preload the next order's photos so it appears complete on Done.
  const nextImages = state.next?.order.items.map((item) => item.imageUrl).filter(Boolean).join('|') ?? '';
  useEffect(() => {
    if (!nextImages) return;
    nextImages.split('|').forEach((url) => {
      const img = new window.Image();
      img.decoding = 'async';
      img.src = url;
    });
  }, [nextImages]);

  const start = useCallback(async () => {
    dispatch({ type: 'START' });
    try {
      const { status, data } = await postJson('/api/order-prep/v2/claim', {});
      if (status >= 200 && status < 300 && data?.success && data.state) {
        dispatch({ type: 'SERVER_STATE', state: data.state, source: 'claim' });
        return;
      }
      dispatch({ type: 'START_FAILED', message: errorOf(data, 'تعذر بدء التجهيز').message });
    } catch {
      dispatch({ type: 'START_FAILED', message: 'تعذر الاتصال. تحقق من الشبكة وحاول مرة أخرى.' });
    }
  }, [dispatch]);

  const printTicket = useCallback(
    async (orderId: string, orderNumber: string) => {
      dispatch({ type: 'PRINT_STATUS', orderId, status: 'sending' });
      try {
        const { status, data } = await postJson('/api/order-prep/print-order-number', {
          orderNumber,
          orderId,
          printDate: new Date().toISOString(),
        });
        dispatch({ type: 'PRINT_STATUS', orderId, status: status >= 200 && status < 300 && data?.success ? 'ok' : 'failed' });
      } catch {
        dispatch({ type: 'PRINT_STATUS', orderId, status: 'failed' });
      }
    },
    [dispatch],
  );

  return { start, printTicket, sendHeartbeat };
}
