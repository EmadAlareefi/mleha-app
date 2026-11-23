'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardData } from '@/app/lib/order-prep/board';
import type { HourlyThroughput } from '@/app/lib/order-prep/hourly';
import type { ShippingBoardData } from '@/app/lib/shipping/board';
import type { StuckOrdersResult } from '@/app/lib/stuck-orders/types';

const FAST_MS = 15_000;
const STUCK_MS = 60_000;
const HOURLY_MS = 5 * 60_000;
const HISTORY = 40;

type Source<T> = { data: T | null; error: string | null; loading: boolean; at: number | null };

const empty = <T,>(): Source<T> => ({ data: null, error: null, loading: false, at: null });

async function getJson(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) throw new Error(body.error || 'تعذر التحميل');
  return body;
}

/**
 * Polls the three warehouse feeds (prep board, shipping board, stuck orders)
 * while the tab is visible, and keeps a short in-memory history for trend lines.
 */
export function useLiveData(threshold: number) {
  const [board, setBoard] = useState<Source<BoardData>>(empty);
  const [shipping, setShipping] = useState<Source<ShippingBoardData>>(empty);
  const [stuck, setStuck] = useState<Source<StuckOrdersResult>>(empty);
  const [hourly, setHourly] = useState<Source<HourlyThroughput>>(empty);
  const [canManageShipping, setCanManageShipping] = useState(false);
  const [history, setHistory] = useState<{ waiting: number[]; awaitingLabel: number[]; packed: number[] }>({
    waiting: [],
    awaitingLabel: [],
    packed: [],
  });
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  const push = (key: 'waiting' | 'awaitingLabel' | 'packed', value: number) =>
    setHistory((prev) => ({ ...prev, [key]: [...prev[key], value].slice(-HISTORY) }));

  const loadBoard = useCallback(async () => {
    setBoard((prev) => ({ ...prev, loading: true }));
    try {
      const body = await getJson('/api/order-prep/v2/board');
      const data = body.board as BoardData;
      setBoard({ data, error: null, loading: false, at: Date.now() });
      push('waiting', data.stats.waiting);
      push('packed', data.packedToday);
    } catch (err) {
      setBoard((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'تعذر تحميل لوحة التجهيز' }));
    }
  }, []);

  const loadShipping = useCallback(async () => {
    setShipping((prev) => ({ ...prev, loading: true }));
    try {
      const body = await getJson('/api/shipping-v2/board');
      const data = body.board as ShippingBoardData;
      setShipping({ data, error: null, loading: false, at: Date.now() });
      setCanManageShipping(Boolean(body.canManageSettings));
      const s = data.byState;
      push('awaitingLabel', (s.queued ?? 0) + (s.creating ?? 0) + (s.awaiting_label ?? 0));
    } catch (err) {
      setShipping((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'تعذر تحميل لوحة الشحن' }));
    }
  }, []);

  /** `fresh` skips the server's 45 s cache (the manual refresh button). */
  const loadStuck = useCallback(async (fresh = false) => {
    setStuck((prev) => ({ ...prev, loading: true }));
    try {
      const body = await getJson(`/api/admin/stuck-orders?threshold=${thresholdRef.current}${fresh ? '&fresh=1' : ''}`);
      setStuck({ data: body.result as StuckOrdersResult, error: null, loading: false, at: Date.now() });
    } catch (err) {
      setStuck((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'تعذر تحميل الطلبات العالقة' }));
    }
  }, []);

  const loadHourly = useCallback(async () => {
    setHourly((prev) => ({ ...prev, loading: true }));
    try {
      const body = await getJson('/api/order-prep/v2/hourly');
      setHourly({ data: body.hourly as HourlyThroughput, error: null, loading: false, at: Date.now() });
    } catch (err) {
      setHourly((prev) => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'تعذر تحميل الإنتاجية بالساعة' }));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadBoard(), loadShipping(), loadStuck(true), loadHourly()]);
  }, [loadBoard, loadShipping, loadStuck, loadHourly]);
  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;

  useEffect(() => {
    void loadBoard();
    void loadShipping();
    const fast = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadBoard();
      void loadShipping();
    }, FAST_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshAllRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(fast);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadBoard, loadShipping]);

  useEffect(() => {
    void loadStuck();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadStuck();
    }, STUCK_MS);
    return () => window.clearInterval(timer);
  }, [loadStuck, threshold]);

  useEffect(() => {
    void loadHourly();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadHourly();
    }, HOURLY_MS);
    return () => window.clearInterval(timer);
  }, [loadHourly]);

  const lastAt = Math.max(board.at ?? 0, shipping.at ?? 0, stuck.at ?? 0) || null;
  const anyError = board.error || shipping.error || stuck.error;
  const loading = board.loading || shipping.loading || stuck.loading;

  return {
    board,
    shipping,
    stuck,
    hourly,
    canManageShipping,
    history,
    lastAt,
    anyError,
    loading,
    loadBoard,
    loadShipping,
    loadStuck,
    loadHourly,
    refreshAll,
  };
}

export type LiveData = ReturnType<typeof useLiveData>;
