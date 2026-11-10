'use client';

import { useEffect, useState } from 'react';
import { Loader2, TicketX } from 'lucide-react';
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
import { formatMoney, type ReturnRequest } from './types';

interface RevokeCouponDialogProps {
  request: ReturnRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}

/** Deletes an unused exchange coupon so the credit can become a replacement order or a refund. */
export function RevokeCouponDialog({ request, open, onOpenChange, onDone }: RevokeCouponDialogProps) {
  const [confirmUnused, setConfirmUnused] = useState(false);
  const [confirmManual, setConfirmManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setConfirmUnused(false);
    setConfirmManual(false);
    setError('');
  }, [open]);

  if (!request) return null;
  const manual = !request.couponId;

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/returns/exchange-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: request.id,
          action: 'revoke_coupon',
          confirmUnused,
          confirmManualDeleted: confirmManual,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر إلغاء الكوبون');
      onDone(data.message || 'تم إلغاء الكوبون.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="pr-8 text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            <TicketX className="size-5" /> إلغاء كوبون الاستبدال
          </DialogTitle>
          <DialogDescription>
            الكوبون <code className="rounded bg-muted px-1">{request.couponCode}</code>
            {request.couponAmount ? ` بقيمة ${formatMoney(request.couponAmount, request.currency)}` : ''}. يُسمح بإلغائه فقط إذا لم
            يستخدمه العميل؛ يتحقق النظام من إحصائيات سلة ومن طلبات المتجر قبل الحذف.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <Checkbox checked={confirmUnused} onCheckedChange={(value) => setConfirmUnused(value === true)} className="mt-0.5 size-5" />
            تأكدت أن العميل لم يستخدم الكوبون
          </label>
          {manual && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Checkbox checked={confirmManual} onCheckedChange={(value) => setConfirmManual(value === true)} className="mt-0.5 size-5" />
              الكوبون أُدخل يدوياً: حذفته من لوحة سلة بنفسي
            </label>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            variant="destructive"
            onClick={submit}
            disabled={saving || !confirmUnused || (manual && !confirmManual)}
            className="h-11 sm:h-9"
          >
            {saving ? <Loader2 className="animate-spin" /> : null}
            إلغاء الكوبون
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11 sm:h-9">
            رجوع
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
