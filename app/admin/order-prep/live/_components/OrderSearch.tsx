'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import type { StuckItem } from '@/app/lib/stuck-orders/types';
import { cn } from '@/lib/utils';
import { CATEGORY_META, formatAge } from '@/app/admin/order-prep/stuck/_components/labels';

/** Find any order (number, waybill, phone, name) and open its journey. Press / to focus. */
export function OrderSearch({ threshold, onOpen }: { threshold: number; onOpen: (orderId: string) => void }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<StuckItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if ((event.key === '/' || event.code === 'Slash') && !event.ctrlKey && !event.metaKey && target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA' && target?.tagName !== 'SELECT') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setItems(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/admin/stuck-orders?threshold=${threshold}&q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const data = await response.json();
        if (!cancelled) setItems(response.ok && data.success ? data.search.items : []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, threshold]);

  const pick = (orderId: string) => {
    setOpen(false);
    onOpen(orderId);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-white/50" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && items && items.length > 0) pick(items[0].orderId);
          if (event.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        placeholder="ابحث عن أي طلب: الرقم، البوليصة، الجوال، الاسم…"
        aria-label="بحث عن طلب"
        className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] pr-9 pl-16 text-sm text-white placeholder:text-white/40 outline-none transition focus:border-[#e8c896]/60 focus:bg-white/[0.12] focus:ring-4 focus:ring-[#e8c896]/15"
      />
      <span className="absolute top-1/2 left-2 flex -translate-y-1/2 items-center gap-1">
        {loading && <Loader2 className="h-4 w-4 animate-spin text-white/60" />}
        {query ? (
          <button type="button" aria-label="مسح" onClick={() => setQuery('')} className="rounded-md p-1 text-white/60 hover:bg-white/10">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="rounded border border-white/20 px-1.5 text-[10px] text-white/50">/</kbd>
        )}
      </span>

      {open && query.trim() && items && (
        <div className="absolute inset-x-0 top-12 z-50 max-h-96 overflow-y-auto rounded-2xl border border-[var(--lv-line)] bg-[var(--lv-card)] p-1.5 text-[var(--lv-ink)] shadow-2xl">
          {items.length === 0 ? (
            <p className="p-4 text-center text-sm text-[var(--lv-muted)]">لم نجد طلباً بهذا البحث</p>
          ) : (
            items.map((item) => {
              const meta = item.diagnosis.category ? CATEGORY_META[item.diagnosis.category] : null;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => pick(item.orderId)}
                  className="flex w-full items-center gap-2.5 rounded-xl p-2 text-right transition hover:bg-[var(--lv-chip)]"
                >
                  <span
                    className={cn(
                      'h-2.5 w-2.5 shrink-0 rounded-full',
                      !item.diagnosis.stuck ? 'bg-emerald-500' : item.diagnosis.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-400',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span dir="ltr" className="font-mono text-sm font-extrabold">
                        #{item.orderNumber ?? item.orderId}
                      </span>
                      {item.kind === 'return' && <span className="rounded-full bg-fuchsia-100 px-1.5 text-[10px] text-fuchsia-700">مرتجع</span>}
                      {item.customerName && <span className="truncate text-xs text-[var(--lv-muted)]">{item.customerName}</span>}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--lv-muted)]">{item.diagnosis.reason}</span>
                  </span>
                  {item.diagnosis.stuck ? (
                    <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold', meta?.chip ?? 'bg-amber-100 text-amber-900')}>
                      {formatAge(item.diagnosis.ageMs)}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">يتحرك</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
