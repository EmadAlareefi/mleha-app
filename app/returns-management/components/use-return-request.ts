'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReturnRequest } from './types';

/**
 * One request, fetched by id, so the detail stays open and current even when
 * an action moves the request out of the list's tab. `initial` (the list row)
 * renders at once while the fresh copy loads.
 */
export function useReturnRequest(id: string | null, initial?: ReturnRequest | null) {
  const [request, setRequest] = useState<ReturnRequest | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!id) return null;
    const ticket = ++latest.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/returns/list?id=${encodeURIComponent(id)}&limit=1`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر تحميل الطلب');
      const row: ReturnRequest | null = data.data?.[0] ?? null;
      if (ticket === latest.current) {
        setRequest(row);
        if (!row) setError('طلب الإرجاع غير موجود');
      }
      return row;
    } catch (err) {
      if (ticket === latest.current) setError(err instanceof Error ? err.message : 'تعذر تحميل الطلب');
      return null;
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) {
      setRequest(null);
      return;
    }
    setRequest((current) => (current?.id === id ? current : initial?.id === id ? initial : null));
    void reload();
    // `initial` only seeds the first render for this id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reload]);

  return { request, loading, error, reload };
}
