'use client';

import { useState } from 'react';
import { ChevronDown, History, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Movement {
  carrier: 'smsa' | 'ajex';
  code: string | null;
  label: string | null;
  description: string | null;
  failureReason: string | null;
  city: string | null;
  at: string | null;
  atRaw: string | null;
}

const CARRIER_LABELS: Record<Movement['carrier'], string> = { smsa: 'سمسا', ajex: 'ايجكس' };

const timeFormatter = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  timeZone: 'Asia/Riyadh',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const formatAt = (movement: Movement) =>
  movement.at ? timeFormatter.format(new Date(movement.at)) : movement.atRaw || '—';

/**
 * Collapsible carrier movement log (SMSA scans / AJEX callbacks) for one
 * tracking number. Loads on first open so lists and dialogs stay light.
 */
export function CarrierMovementLog({ trackingNumber, className }: { trackingNumber: string | null | undefined; className?: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<
    { status: 'idle' | 'loading' } | { status: 'error' } | { status: 'ready'; movements: Movement[] }
  >({ status: 'idle' });

  const tracking = trackingNumber?.trim();
  if (!tracking) return null;

  const load = async () => {
    setState({ status: 'loading' });
    try {
      const response = await fetch(`/api/carrier-movements?trackingNumber=${encodeURIComponent(tracking)}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      setState({ status: 'ready', movements: Array.isArray(data.movements) ? data.movements : [] });
    } catch {
      setState({ status: 'error' });
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && (state.status === 'idle' || state.status === 'error')) void load();
  };

  // Newest first: the latest movement is what staff look for.
  const movements = state.status === 'ready' ? [...state.movements].reverse() : [];

  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-slate-700"
      >
        <span className="flex items-center gap-2">
          <History className="h-4 w-4 text-indigo-500" />
          سجل الحركات
          {state.status === 'ready' && <span className="text-xs font-normal text-slate-500">({state.movements.length})</span>}
        </span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-slate-100 px-3 py-2">
          {state.status === 'loading' && (
            <p className="flex items-center gap-2 py-2 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> جاري التحميل…
            </p>
          )}
          {state.status === 'error' && (
            <p className="py-2 text-xs text-red-600">
              تعذر تحميل سجل الحركات.{' '}
              <button type="button" onClick={() => void load()} className="underline">
                إعادة المحاولة
              </button>
            </p>
          )}
          {state.status === 'ready' && movements.length === 0 && (
            <p className="py-2 text-xs text-slate-500">لا توجد حركات من شركة الشحن حتى الآن.</p>
          )}
          {movements.length > 0 && (
            <ol className="max-h-72 space-y-2 overflow-y-auto py-1">
              {movements.map((movement, index) => (
                <li
                  key={`${movement.at ?? movement.atRaw}-${movement.code}-${index}`}
                  className="relative border-s-2 border-slate-200 ps-3 first:border-indigo-400"
                >
                  <p className="text-sm font-medium text-slate-800">
                    {movement.label || movement.description || movement.code || '—'}
                  </p>
                  {movement.description && movement.description !== movement.label && (
                    <p dir="auto" className="text-xs text-slate-500">{movement.description}</p>
                  )}
                  {movement.failureReason && (
                    <p dir="auto" className="text-xs text-red-600">{movement.failureReason}</p>
                  )}
                  <p className="text-xs text-slate-500">
                    {[CARRIER_LABELS[movement.carrier], movement.city, formatAt(movement)].filter(Boolean).join(' • ')}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export default CarrierMovementLog;
