'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Lock, NotebookPen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { CONDITION_LABELS } from '@/app/lib/returns/inspection';
import { typeLabel } from '@/app/lib/returns/status';
import { summarizeRequestMoney } from '@/lib/returns/money-summary';
import { cn } from '@/lib/utils';
import { CONDITION_CHIP } from './request-card';
import { Segmented, type SegmentOption } from './segmented';
import type { RequestActions } from './use-request-actions';
import { formatMoney, pieceLabel, RESTOCK_LABELS, type ReturnItem, type ReturnRequest } from './types';

type PieceType = 'return' | 'exchange';
type PieceState = { type: PieceType; refundIncluded: boolean };

const TYPE_OPTIONS: SegmentOption<PieceType>[] = [
  { value: 'return', label: 'استرجاع', tone: 'return' },
  { value: 'exchange', label: 'استبدال', tone: 'exchange' },
];

const ACTIVE_REPLACEMENT = new Set(['pending', 'paid', 'not_required']);

/** Why pieces can't be edited right now, and the step that unlocks them. Mirrors lib/returns/piece-changes.ts. */
export function pieceEditLock(request: ReturnRequest): { message: string; unlock?: 'reopen' | 'cancel-replacement' } | null {
  if (['completed', 'cancelled', 'rejected'].includes(request.status)) {
    return request.status === 'cancelled'
      ? { message: 'الطلب ملغي.' }
      : { message: 'الطلب مغلق. أعيديه للمراجعة لتعديل القطع.', unlock: 'reopen' };
  }
  if (request.processingStatus === 'processing') return { message: 'الطلب قيد المعالجة حالياً.' };
  if (request.refundStatus === 'refunded') return { message: 'تم استرجاع المبلغ للعميل؛ لا يمكن تغيير القطع بعد الاسترجاع.' };
  if (request.refundStatus === 'requested' || request.refundStatus === 'unknown') {
    return { message: 'يوجد استرجاع مالي قيد التنفيذ أو نتيجته غير معروفة.' };
  }
  if (request.exchangePaymentStatus === 'creating' || request.exchangePaymentStatus === 'expiring') {
    return { message: 'يتم إنشاء أو إلغاء الطلب البديل الآن.' };
  }
  if (request.exchangeMode === 'order' && request.exchangeOrderId && ACTIVE_REPLACEMENT.has(request.exchangePaymentStatus || '')) {
    return { message: 'للطلب طلب بديل نشط. ألغيه أولاً (يُسترجع أي فرق دفعه العميل) ثم غيّري القطع.', unlock: 'cancel-replacement' };
  }
  if (request.leftoverCouponCode) return { message: 'أُصدر كوبون الرصيد المتبقي لهذا الطلب.' };
  return null;
}

const baseState = (item: ReturnItem): PieceState => ({
  type: item.type === 'exchange' ? 'exchange' : 'return',
  refundIncluded: item.refundIncluded !== false,
});

interface PiecesSectionProps {
  request: ReturnRequest;
  actions: RequestActions;
}

export function PiecesSection({ request, actions }: PiecesSectionProps) {
  const money = summarizeRequestMoney(request);
  const lock = pieceEditLock(request);
  const editable = !lock;
  const [draft, setDraft] = useState<Record<string, PieceState>>({});

  // A fresh copy from the server replaces any unsaved edits.
  useEffect(() => setDraft({}), [request.id, request.updatedAt]);

  const state = (item: ReturnItem) => draft[item.id] ?? baseState(item);
  const dirty = request.items.filter((item) => {
    const next = draft[item.id];
    if (!next) return false;
    const base = baseState(item);
    return next.type !== base.type || (next.type === 'return' && next.refundIncluded !== base.refundIncluded);
  });

  const allType = useMemo(() => {
    const types = new Set(request.items.map((item) => (draft[item.id] ?? baseState(item)).type));
    return types.size === 1 ? [...types][0] : null;
  }, [draft, request.items]);

  const setPiece = (item: ReturnItem, patch: Partial<PieceState>) =>
    setDraft((current) => ({ ...current, [item.id]: { ...(current[item.id] ?? baseState(item)), ...patch } }));

  const setAll = (type: PieceType) =>
    setDraft((current) =>
      Object.fromEntries(request.items.map((item) => [item.id, { ...(current[item.id] ?? baseState(item)), type }])),
    );

  const save = async () => {
    const saved = await actions.changePieces({
      changes: dirty.map((item) => ({ itemId: item.id, type: state(item).type, refundIncluded: state(item).refundIncluded })),
    });
    if (saved) setDraft({});
  };

  const uninspected = request.items.some((item) => !item.conditionStatus);

  return (
    <section aria-labelledby="pieces-title" className="space-y-3 rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="pieces-title" className="font-semibold">
          القطع ({request.items.length})
          <span className="mr-2 text-sm font-normal text-muted-foreground">{typeLabel(money.derivedType)}</span>
        </h3>
        {uninspected && editable && (
          <Button size="sm" variant="ghost" className="h-10 sm:h-8" onClick={() => actions.open('inspector-notes')}>
            <NotebookPen /> ملاحظات للمفتش
          </Button>
        )}
      </div>

      {money.typeMismatch && (
        <p className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          الطلب مسجل «{typeLabel(request.type)}» بينما القطع مسجلة «{typeLabel(money.derivedType)}». اختاري النوع الصحيح ثم احفظي قبل
          المعالجة.
        </p>
      )}

      {lock ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2.5 text-sm text-muted-foreground sm:flex-row sm:items-center">
          <span className="flex flex-1 items-start gap-2">
            <Lock className="mt-0.5 size-4 shrink-0" /> {lock.message}
          </span>
          {lock.unlock === 'reopen' && (
            <Button size="sm" variant="outline" className="h-10 sm:h-8" onClick={() => actions.open('reopen')}>
              إعادة للمراجعة
            </Button>
          )}
          {lock.unlock === 'cancel-replacement' && (
            <Button size="sm" variant="outline" className="h-10 text-red-700 sm:h-8" onClick={() => actions.exchangeAction('cancel')}>
              إلغاء الطلب البديل
            </Button>
          )}
        </div>
      ) : (
        request.items.length > 1 && (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">نوع الطلب كاملاً</span>
            <Segmented
              value={allType}
              options={TYPE_OPTIONS}
              onChange={setAll}
              ariaLabel="نوع كل القطع"
              disabled={actions.busy !== null}
            />
          </div>
        )
      )}

      {request.couponCode && editable && (
        <p className="text-xs text-muted-foreground">
          أُصدر الكوبون {request.couponCode}: تغيير القطع يحذفه أو يعدّل قيمته في سلة، بشرط ألا يكون العميل قد استخدمه.
        </p>
      )}

      <ul className="divide-y rounded-lg border">
        {request.items.map((item) => {
          const current = state(item);
          const changed = dirty.includes(item);
          return (
            <li key={item.id} className={cn('flex gap-3 p-3', changed && 'bg-amber-50/60')}>
              {item.hasDamageImage && (
                <a href={`/api/returns/item-image?itemId=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer" className="shrink-0">
                  <Image
                    src={`/api/returns/item-image?itemId=${encodeURIComponent(item.id)}`}
                    alt="صورة التلف"
                    width={56}
                    height={72}
                    unoptimized
                    className="h-[72px] w-14 rounded-md border border-red-200 object-cover"
                  />
                </a>
              )}
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 font-medium">
                    {item.productName}
                    {item.variantName ? <span className="text-muted-foreground"> · {item.variantName}</span> : null}
                    {pieceLabel(item, request.items) ? (
                      <span className="mr-1 text-xs text-muted-foreground">({pieceLabel(item, request.items)})</span>
                    ) : null}
                  </p>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{formatMoney(item.price, request.currency)}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {editable ? (
                    <Segmented
                      size="sm"
                      value={current.type}
                      options={TYPE_OPTIONS}
                      onChange={(type) => setPiece(item, { type })}
                      ariaLabel={`نوع ${item.productName}`}
                      disabled={actions.busy !== null}
                      className="sm:w-56"
                    />
                  ) : (
                    <Badge className={current.type === 'exchange' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}>
                      {current.type === 'exchange' ? 'استبدال' : 'استرجاع'}
                    </Badge>
                  )}
                  <Badge variant="outline" className={cn(item.conditionStatus && CONDITION_CHIP[item.conditionStatus])}>
                    {item.conditionStatus ? CONDITION_LABELS[item.conditionStatus] : 'لم تُفحص'}
                  </Badge>
                  {item.restockStatus && item.restockStatus !== 'none' && (
                    <Badge variant="outline" className={item.restockStatus === 'failed' ? 'text-red-700' : ''}>
                      {RESTOCK_LABELS[item.restockStatus] || item.restockStatus}
                    </Badge>
                  )}
                </div>

                {current.type === 'return' && (
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-muted-foreground sm:min-h-0">
                    <Switch
                      checked={current.refundIncluded}
                      disabled={!editable || actions.busy !== null}
                      onCheckedChange={(checked) => setPiece(item, { refundIncluded: checked })}
                      aria-label="مشمولة في الاسترجاع المالي"
                    />
                    مشمولة في الاسترجاع المالي
                  </label>
                )}
                {item.conditionNotes?.trim() && (
                  <p className="whitespace-pre-wrap text-xs text-foreground/80">ملاحظات الفحص: {item.conditionNotes}</p>
                )}
                {!item.conditionStatus && item.preInspectionNotes?.trim() && (
                  <p className="whitespace-pre-wrap text-xs text-amber-800">للمفتش: {item.preInspectionNotes}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {dirty.length > 0 && (
        <div className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 shadow-lg sm:flex-row sm:items-center">
          <span className="flex-1 text-sm text-amber-950">
            {dirty.length === 1 ? 'تغيير واحد لم يُحفظ' : `${dirty.length} تغييرات لم تُحفظ`} — ستُعرض المبالغ الجديدة قبل الحفظ.
          </span>
          <div className="flex gap-2">
            <Button className="h-11 flex-1 sm:h-9" onClick={save} disabled={actions.busy !== null}>
              {actions.busy === 'pieces' ? <Loader2 className="animate-spin" /> : null}
              مراجعة وحفظ
            </Button>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setDraft({})} disabled={actions.busy !== null}>
              تراجع
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
