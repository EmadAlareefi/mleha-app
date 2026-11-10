'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Undo2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { OUTCOME_LABELS, PROBLEM_REASON_LABELS, decideProblemOutcome } from '@/app/lib/order-prep/problem-rules';
import type { PrepAssignmentView, ProblemItem, ProblemReason } from '@/app/lib/order-prep/types';
import { cn } from '@/lib/utils';

const REASONS: ProblemReason[] = ['not_found', 'damaged', 'coming_soon', 'other'];

/**
 * One sheet for every "can't pack this" case. The packer marks the affected
 * items and a reason; the sheet says what will happen before they confirm.
 */
export function ProblemSheet({
  open,
  view,
  onClose,
  onSubmit,
  onReturnToQueue,
}: {
  open: boolean;
  view: PrepAssignmentView | null;
  onClose: () => void;
  onSubmit: (items: ProblemItem[], note: string | null) => void;
  onReturnToQueue: () => void;
}) {
  const items = useMemo(() => view?.order.items ?? [], [view]);
  const [reasons, setReasons] = useState<Record<number, ProblemReason>>({});
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    // A single-line order needs no item choice: the line is the problem.
    setReasons(items.length === 1 ? { [items[0].index]: 'not_found' } : {});
    setNote('');
  }, [open, items]);

  const problems: ProblemItem[] = items
    .filter((item) => reasons[item.index])
    .map((item) => ({ index: item.index, sku: item.sku, name: item.name, reason: reasons[item.index] }));
  const outcome = decideProblemOutcome(items.length, problems);
  const needsNote = problems.some((item) => item.reason === 'other');
  const canSubmit = problems.length > 0 && (!needsNote || note.trim().length > 0);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-2xl pb-[max(env(safe-area-inset-bottom),16px)]">
        <SheetHeader className="text-right">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5 text-amber-600" /> مشكلة في الطلب
          </SheetTitle>
          <SheetDescription>حدّد القطعة وسبب المشكلة.</SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4">
          {items.map((item) => {
            const selected = reasons[item.index];
            return (
              <div key={item.key} className={cn('rounded-xl border-2 p-3', selected ? 'border-amber-500 bg-amber-50' : 'border-border bg-card')}>
                {items.length > 1 && (
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{item.name}</span>
                    <span dir="ltr" className="text-xs font-mono text-muted-foreground">
                      {item.size ? `${item.size} · ` : ''}
                      {item.location ?? ''}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {REASONS.map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() =>
                        setReasons((prev) => {
                          const next = { ...prev };
                          if (next[item.index] === reason && items.length > 1) delete next[item.index];
                          else next[item.index] = reason;
                          return next;
                        })
                      }
                      className={cn(
                        'h-12 rounded-lg border text-sm font-bold',
                        selected === reason ? 'border-amber-600 bg-amber-500 text-white' : 'bg-background text-foreground',
                      )}
                    >
                      {PROBLEM_REASON_LABELS[reason]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={400}
            rows={2}
            placeholder={needsNote ? 'اكتب المشكلة (مطلوب)' : 'ملاحظة للمشرف (اختياري)'}
            className="w-full rounded-xl border bg-background p-3 text-sm"
          />

          {outcome && (
            <p className="rounded-xl bg-muted p-3 text-sm font-semibold text-foreground">{OUTCOME_LABELS[outcome]}</p>
          )}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(problems, note.trim() || null)}
            className="h-14 w-full rounded-xl bg-amber-600 text-lg font-bold text-white disabled:opacity-50"
          >
            تأكيد
          </button>
          <button
            type="button"
            onClick={onReturnToQueue}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold text-foreground"
          >
            <Undo2 className="h-4 w-4" /> لا مشكلة في القطع — أرجع الطلب للقائمة
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
