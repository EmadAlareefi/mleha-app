'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented, type SegmentOption } from './segmented';
import { formatDate, OVERRIDE_SCOPE_LABELS, type OverrideScope } from './types';

interface ReturnWindowOverride {
  id: string;
  orderId: string;
  orderNumber?: string | null;
  scope: OverrideScope;
  note?: string | null;
  createdBy: string;
  createdAt: string;
}

const SCOPE_OPTIONS: SegmentOption<OverrideScope>[] = [
  { value: 'both', label: 'الاثنين' },
  { value: 'exchange', label: 'استبدال فقط', tone: 'exchange' },
  { value: 'return', label: 'إرجاع فقط', tone: 'return' },
];

const SCOPE_BADGE: Record<OverrideScope, string> = {
  both: 'bg-violet-100 text-violet-800',
  exchange: 'bg-emerald-100 text-emerald-800',
  return: 'bg-blue-100 text-blue-800',
};

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1234509876';

interface WindowOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill the order (opened from a request). */
  defaultOrderNumber?: string;
  onChanged?: () => void;
}

/**
 * استثناء مدة الإرجاع: lets one order past the 24h / 3-day window, for return,
 * exchange or both. Other return rules still apply.
 */
export function WindowOverrideDialog({ open, onOpenChange, defaultOrderNumber, onChanged }: WindowOverrideDialogProps) {
  const [overrides, setOverrides] = useState<ReturnWindowOverride[]>([]);
  const [orderNumber, setOrderNumber] = useState('');
  const [scope, setScope] = useState<OverrideScope>('both');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/returns/window-overrides');
    const data = await response.json().catch(() => ({}));
    if (response.ok) setOverrides(data.overrides || []);
  }, []);

  useEffect(() => {
    if (!open) return;
    setOrderNumber(defaultOrderNumber || '');
    setScope('both');
    setNote('');
    setMessage(null);
    void load();
  }, [open, defaultOrderNumber, load]);

  const send = async (key: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown, success: (data: any) => string) => {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch('/api/returns/window-overrides', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر تنفيذ الإجراء');
      setMessage({ text: success(data) });
      await load();
      onChanged?.();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'تعذر تنفيذ الإجراء', error: true });
    } finally {
      setBusy(null);
    }
  };

  const normalized = orderNumber.trim().replace(/^#/, '');
  const existing = overrides.find((override) => override.orderNumber === normalized);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-8 text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" /> استثناء مدة الإرجاع
          </DialogTitle>
          <DialogDescription>
            يسمح لطلب محدد بتجاوز حد 24 ساعة أو 3 أيام، للإرجاع أو الاستبدال أو الاثنين. تبقى بقية شروط الإرجاع مطبقة.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3 rounded-xl border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">رقم الطلب في سلة</span>
                <Input
                  value={orderNumber}
                  onChange={(event) => setOrderNumber(event.target.value)}
                  placeholder="مثال: 298112233"
                  inputMode="numeric"
                  dir="ltr"
                  className="h-11 text-right sm:h-9"
                  disabled={Boolean(busy)}
                />
              </label>
              <div className="space-y-1.5 text-sm">
                <span className="font-medium">يسمح بـ</span>
                <Segmented value={scope} options={SCOPE_OPTIONS} onChange={setScope} ariaLabel="نوع الاستثناء" disabled={Boolean(busy)} />
              </div>
            </div>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="سبب الاستثناء (اختياري)"
              maxLength={300}
              className="h-11 sm:h-9"
              disabled={Boolean(busy)}
            />
            <Button
              className="h-11 w-full sm:h-9 sm:w-auto"
              disabled={Boolean(busy) || !normalized}
              onClick={() =>
                send('add', 'POST', { merchantId: MERCHANT_ID, orderNumber: normalized, scope, note }, (data) => {
                  setOrderNumber('');
                  setNote('');
                  return `الطلب #${data.override?.orderNumber || normalized}: ${OVERRIDE_SCOPE_LABELS[scope]} بعد انتهاء المدة.`;
                })
              }
            >
              {busy === 'add' ? <Loader2 className="animate-spin" /> : null}
              {existing ? 'تحديث الاستثناء' : 'إضافة الاستثناء'}
            </Button>
          </section>

          {message && (
            <p role="status" className={message.error ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}>
              {message.text}
            </p>
          )}

          {overrides.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">الاستثناءات النشطة ({overrides.length})</h3>
              <ul className="space-y-2">
                {overrides.map((override) => (
                  <li key={override.id} className="space-y-2 rounded-xl border p-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <strong dir="ltr">#{override.orderNumber || override.orderId}</strong>
                      <Badge className={SCOPE_BADGE[override.scope] || SCOPE_BADGE.both}>
                        {OVERRIDE_SCOPE_LABELS[override.scope] || OVERRIDE_SCOPE_LABELS.both}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {override.createdBy} • {formatDate(override.createdAt)}
                      </span>
                    </div>
                    {override.note && <p className="text-xs text-muted-foreground">{override.note}</p>}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Segmented
                        size="sm"
                        value={override.scope}
                        options={SCOPE_OPTIONS}
                        ariaLabel={`نوع استثناء الطلب ${override.orderNumber || override.orderId}`}
                        disabled={Boolean(busy)}
                        onChange={(next) =>
                          send(`scope:${override.id}`, 'PATCH', { id: override.id, scope: next }, () => `تم التحديث: ${OVERRIDE_SCOPE_LABELS[next]}.`)
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 text-red-700 sm:h-8 sm:ms-auto"
                        disabled={Boolean(busy)}
                        onClick={() => send(`del:${override.id}`, 'DELETE', { id: override.id }, () => 'تم إلغاء الاستثناء.')}
                      >
                        {busy === `del:${override.id}` ? <Loader2 className="animate-spin" /> : null}
                        إلغاء الاستثناء
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
