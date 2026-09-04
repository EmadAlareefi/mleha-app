'use client';

import { useEffect, useState } from 'react';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface CouponAmountRequest {
  id: string;
  orderNumber: string;
  totalRefundAmount?: number | string | null;
  returnFee?: number | string | null;
  shippingAmount?: number | string | null;
  currency?: string | null;
  couponCode?: string | null;
  couponAmountOverride?: number | string | null;
  couponAmountOverrideBy?: string | null;
  couponAmountOverrideNote?: string | null;
  items: { quantity: number; price: number | string }[];
}

interface CouponAmountDialogProps {
  request: CouponAmountRequest | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const toNumber = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const currencySuffix = (currency?: string | null) => {
  const normalized = currency?.trim().toUpperCase() || 'SAR';
  return normalized === 'SAR' ? 'ر.س' : normalized;
};

const format = (value: number, currency?: string | null) =>
  `${value.toFixed(2)} ${currencySuffix(currency)}`;

export function CouponAmountDialog({ request, onClose, onSaved }: CouponAmountDialogProps) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [resendNotification, setResendNotification] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) {
      return;
    }
    const current = toNumber(request.couponAmountOverride) ?? toNumber(request.totalRefundAmount);
    setAmount(current != null && current > 0 ? current.toFixed(2) : '');
    setNote(request.couponAmountOverrideNote || '');
    setResendNotification(false);
    setError(null);
  }, [request]);

  if (!request) {
    return null;
  }

  const itemsTotal = request.items.reduce((sum, item) => {
    const price = toNumber(item.price) ?? 0;
    const quantity = Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
    return sum + price * quantity;
  }, 0);
  const shipping = toNumber(request.shippingAmount) ?? 0;
  const fee = toNumber(request.returnFee) ?? 0;
  const calculated = Math.max(0, itemsTotal + shipping - fee);
  const hasCoupon = Boolean(request.couponCode);

  const save = async () => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('يرجى إدخال قيمة أكبر من صفر');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/returns/coupon-amount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: request.id,
          amount: parsed,
          note,
          resendNotification,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'فشل تحديث قيمة الكوبون');
      }

      onSaved(
        data.couponUpdatedInSalla
          ? `تم تحديث قيمة الكوبون ${request.couponCode} في سلة إلى ${format(parsed, request.currency)}`
          : `تم حفظ قيمة الكوبون ${format(parsed, request.currency)}`,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>تعديل قيمة الكوبون</DialogTitle>
          <DialogDescription>
            طلب رقم {request.orderNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">قيمة القطع المرتجعة</span>
              <span>{format(itemsTotal, request.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">الشحن الأصلي</span>
              <span>{format(shipping, request.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">رسوم الاستبدال</span>
              <span>-{format(fee, request.currency)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>القيمة المحسوبة تلقائياً</span>
              <span>{format(calculated, request.currency)}</span>
            </div>
          </div>

          {calculated <= 0 && (
            <Alert>
              <AlertDescription>
                القيمة المحسوبة صفر لأن سلة سجّلت خصم العرض بالكامل على القطعة المستبدلة. أدخل
                القيمة الصحيحة يدوياً للمتابعة.
              </AlertDescription>
            </Alert>
          )}

          <Field>
            <FieldLabel htmlFor="coupon-amount">
              قيمة الكوبون ({currencySuffix(request.currency)})
            </FieldLabel>
            <Input
              id="coupon-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={saving}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="coupon-amount-note">سبب التعديل (اختياري)</FieldLabel>
            <Textarea
              id="coupon-amount-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
            />
          </Field>

          {hasCoupon && (
            <>
              <Alert>
                <AlertDescription>
                  الكوبون {request.couponCode} تم إنشاؤه بالفعل، وسيتم تحديث قيمته في سلة بنفس الرمز.
                </AlertDescription>
              </Alert>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={resendNotification}
                  onCheckedChange={(checked) => setResendNotification(checked === true)}
                  disabled={saving}
                />
                إعادة إرسال رسالة الكوبون على الواتساب
              </label>
            </>
          )}

          {request.couponAmountOverrideBy && (
            <p className="text-xs text-muted-foreground">
              آخر تعديل بواسطة {request.couponAmountOverrideBy}
            </p>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ القيمة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
