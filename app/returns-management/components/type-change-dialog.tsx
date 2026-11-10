'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { PieceChangePreview } from '@/app/lib/returns/piece-changes-service';
import type { ConfirmKey } from '@/lib/returns/piece-changes';
import { typeLabel } from '@/app/lib/returns/status';
import { cn } from '@/lib/utils';
import { formatMoney, PIECE_TYPE_LABELS } from './types';

export interface PieceChangeDraft {
  setAll?: 'return' | 'exchange';
  changes?: Array<{ itemId: string; type?: string; refundIncluded?: boolean }>;
}

interface TypeChangeDialogProps {
  requestId: string | null;
  orderNumber?: string;
  draft: PieceChangeDraft | null;
  preview: PieceChangePreview | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

const CONFIRM_LABELS: Record<ConfirmKey, string> = {
  coupon: 'تأكدت أن العميل لم يستخدم كوبون الاستبدال',
  policy: 'أؤكد التجاوز عن سياسة المنتج المذكورة أعلاه',
  manualCoupon: 'عدّلت أو حذفت الكوبون من لوحة سلة بنفسي',
};

/** Confirms a return ↔ exchange change: money before / after, the coupon, and the ticks it needs. */
export function TypeChangeDialog({ requestId, orderNumber, draft, preview, onClose, onDone }: TypeChangeDialogProps) {
  const [confirm, setConfirm] = useState<Partial<Record<ConfirmKey, boolean>>>({});
  const [note, setNote] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const open = Boolean(preview && draft && requestId);
  useEffect(() => {
    if (!open) return;
    setConfirm({});
    setNote('');
    setNotifyCustomer(false);
    setError('');
  }, [open, preview]);

  if (!preview || !draft || !requestId) return null;

  const needed = Array.from(new Set(preview.warnings.map((warning) => warning.confirm).filter(Boolean))) as ConfirmKey[];
  const couponBlocked = preview.coupon?.check && !preview.coupon.check.unused;
  const ready = needed.every((key) => confirm[key]) && !couponBlocked;
  const currency = preview.currency;

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/returns/pieces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: requestId, ...draft, confirm, note, notifyCustomer }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر حفظ التغييرات');
      onDone(data.message || 'تم الحفظ.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const moneyRow = (label: string, before: number, after: number, tone: string) =>
    before === after && before === 0 ? null : (
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 py-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground line-through decoration-1">{before !== after ? formatMoney(before, currency) : ''}</span>
        {before !== after ? <ArrowLeft className="size-3.5 text-muted-foreground" /> : <span />}
        <strong className={cn('tabular-nums', tone)}>{formatMoney(after, currency)}</strong>
      </div>
    );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="pr-8 text-right sm:text-right">
          <DialogTitle>تأكيد تغيير القطع</DialogTitle>
          <DialogDescription>
            طلب #{orderNumber} — يصبح الطلب «{typeLabel(preview.after.type)}».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <ul className="space-y-1.5 rounded-lg border p-3">
            {preview.diffs.map((diff) => (
              <li key={diff.itemId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">
                  {diff.productName}
                  {diff.variantName ? ` · ${diff.variantName}` : ''}
                </span>
                {diff.from.type !== diff.to.type ? (
                  <span className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">{PIECE_TYPE_LABELS[diff.from.type]}</span>
                    <ArrowLeft className="size-3" />
                    <span className={diff.to.type === 'exchange' ? 'font-semibold text-emerald-700' : 'font-semibold text-blue-700'}>
                      {PIECE_TYPE_LABELS[diff.to.type]}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {diff.to.refundIncluded ? 'تُضاف إلى الاسترجاع المالي' : 'تُستثنى من الاسترجاع المالي'}
                  </span>
                )}
              </li>
            ))}
          </ul>

          <div className="rounded-lg border bg-muted/40 p-3">
            {moneyRow('الاسترجاع المالي', preview.before.refund, preview.after.refund, 'text-blue-700')}
            {moneyRow('رصيد الاستبدال', preview.before.credit, preview.after.credit, 'text-emerald-700')}
            {moneyRow('الرسوم', preview.before.fee, preview.after.fee, '')}
          </div>

          {preview.coupon && (
            <div
              className={cn(
                'space-y-1 rounded-lg border p-3',
                couponBlocked ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50',
              )}
            >
              <p className="font-medium">
                {preview.coupon.action === 'revoke'
                  ? `يُحذف الكوبون ${preview.coupon.code} من سلة`
                  : `تتغير قيمة الكوبون ${preview.coupon.code} إلى ${formatMoney(preview.coupon.newAmount, currency)}`}
              </p>
              {preview.coupon.check ? (
                <p className={cn('flex items-center gap-1.5 text-xs', couponBlocked ? 'text-red-800' : 'text-emerald-800')}>
                  {couponBlocked ? <XCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
                  {preview.coupon.check.unused ? 'لا يوجد ما يدل على استخدام الكوبون في سلة أو في الطلبات.' : preview.coupon.check.reason}
                </p>
              ) : null}
              {preview.coupon.action === 'update' && !couponBlocked && (
                <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
                  <Checkbox checked={notifyCustomer} onCheckedChange={(value) => setNotifyCustomer(value === true)} />
                  إرسال الكوبون بالقيمة الجديدة للعميل على الواتساب
                </label>
              )}
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-amber-950">
              {preview.warnings
                .filter((warning) => warning.code !== 'COUPON_REVOKE' && warning.code !== 'COUPON_UPDATE')
                .map((warning, index) => (
                  <p key={`${warning.code}-${index}`} className="flex gap-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {warning.message}
                  </p>
                ))}
              {needed.map((key) => (
                <label key={key} className="flex cursor-pointer items-start gap-2 pt-1 text-sm font-medium">
                  <Checkbox
                    checked={confirm[key] === true}
                    onCheckedChange={(value) => setConfirm((current) => ({ ...current, [key]: value === true }))}
                    disabled={saving || (key === 'coupon' && Boolean(couponBlocked))}
                    className="mt-0.5 size-5"
                  />
                  {CONFIRM_LABELS[key]}
                </label>
              ))}
            </div>
          )}

          {preview.dropsExchangeLines && (
            <p className="text-xs text-muted-foreground">تُحذف المنتجات البديلة المحفوظة لأنه لم تبقَ قطع للاستبدال.</p>
          )}

          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="ملاحظة (اختياري): لماذا تغيّر النوع؟"
            maxLength={500}
            disabled={saving}
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={submit} disabled={!ready || saving} className="h-11 sm:h-9">
            {saving ? <Loader2 className="animate-spin" /> : null}
            حفظ التغييرات
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving} className="h-11 sm:h-9">
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
