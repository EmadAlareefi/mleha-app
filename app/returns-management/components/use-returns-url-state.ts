'use client';

import { useCallback, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { isQueueTab, type QueueTab } from '@/app/lib/returns/stage-filters';

export type TypeFilter = 'all' | 'return' | 'exchange';

export interface ReturnsUrlState {
  queue: QueueTab;
  type: TypeFilter;
  q: string;
  page: number;
  /** Only requests whose return shipment is missing. */
  missing: boolean;
  /** The request open in the detail sheet. */
  open: string | null;
}

const DEFAULTS: ReturnsUrlState = { queue: 'ready', type: 'all', q: '', page: 1, missing: false, open: null };

/**
 * The list's filters and the open request live in the URL, so a refresh keeps
 * them and the phone's back button closes the detail instead of leaving the page.
 */
export function useReturnsUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // The detail was opened from this page (pushed): closing goes back in history.
  const openedHere = useRef(false);

  const state = useMemo<ReturnsUrlState>(() => {
    const queue = params.get('queue');
    const type = params.get('type');
    return {
      queue: isQueueTab(queue) ? queue : DEFAULTS.queue,
      type: type === 'return' || type === 'exchange' ? type : 'all',
      q: params.get('q') || '',
      page: Math.max(1, Number(params.get('page')) || 1),
      missing: params.get('missing') === '1',
      open: params.get('open') || null,
    };
  }, [params]);

  const navigate = useCallback(
    (patch: Partial<ReturnsUrlState>, mode: 'replace' | 'push' = 'replace') => {
      const next = new URLSearchParams(params.toString());
      const set = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key));
      if ('queue' in patch) set('queue', patch.queue && patch.queue !== DEFAULTS.queue ? patch.queue : null);
      if ('type' in patch) set('type', patch.type && patch.type !== 'all' ? patch.type : null);
      if ('q' in patch) set('q', patch.q?.trim() || null);
      if ('page' in patch) set('page', patch.page && patch.page > 1 ? String(patch.page) : null);
      if ('missing' in patch) set('missing', patch.missing ? '1' : null);
      if ('open' in patch) set('open', patch.open || null);
      const query = next.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (mode === 'push') router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [params, pathname, router],
  );

  const openRequest = useCallback(
    (id: string) => {
      openedHere.current = true;
      navigate({ open: id }, 'push');
    },
    [navigate],
  );

  const closeRequest = useCallback(() => {
    if (openedHere.current) {
      openedHere.current = false;
      router.back();
    } else {
      navigate({ open: null });
    }
  }, [navigate, router]);

  return { state, navigate, openRequest, closeRequest };
}
