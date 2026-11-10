'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, PackagePlus, PackageX, Ticket, Wallet } from 'lucide-react';
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
import { formatMoney, type ProcessPreview, type ReturnRequest } from './types';

interface ProcessDialogProps {
  request: ReturnRequest | null;
  onClose: () => void;
  onDone: (outcome: { completed: boolean; message: string }) => void;
}

export function ProcessDialog({ request, onClose, onDone }: ProcessDialogProps) {
  const [preview, setPreview] = useState<ProcessPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  // A refund already in the Salla history: record it (done by hand) or refund again (a different one).
  const [existingRefundChoice, setExistingRefundChoice] = useState<'none' | 'record' | 'refund_again'>('none');
  const [confirmRestocks, setConfirmRestocks] = useState(false);
  const [alreadyRestocked, setAlreadyRestocked] = useState<string[]>([]);

  // Keyed on the id: the list reloads hand in a new `request` object for the
  // same request, which must not refetch the (Salla-backed) preview.
  const requestId = request?.id ?? null;
  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    setPreview(null);
    setError('');
    setExistingRefundChoice('none');
    setConfirmRestocks(false);
    setAlreadyRestocked([]);
    setLoading(true);
    fetch(`/api/returns/process?returnRequestId=${encodeURIComponent(requestId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تجهيز ملخص المعالجة');
        if (!cancelled) setPreview(data.preview);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'حدث خطأ'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const currency = preview?.amounts.currency || request?.currency || 'SAR';
  const existingRefunds = preview?.refund?.existingRefunds ?? [];
  const unknownRestocks = preview?.restock.filter((line) => line.action === 'unknown') ?? [];
  const blocked =
    !preview ||
    preview.stage !== 'ready' ||
    (existingRefunds.length > 0 && existingRefundChoice === 'none') ||
    (unknownRestocks.length > 0 && !confirmRestocks);

  const run = async () => {
    if (!request) return;
    setRunning(true);
    setError('');
    try {
      const response = await fetch('/api/returns/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: request.id,
          ignoreExistingRefunds: existingRefundChoice === 'refund_again',
          refundAlreadyInSalla: existingRefundChoice === 'record',
          confirmUnknownRestocks: confirmRestocks,
          alreadyRestockedItemIds: alreadyRestocked,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'فشلت المعالجة');
      onDone({
        completed: Boolean(data.completed),
        message: data.completed
          ? `تمت معالجة الطلب #${request.orderNumber} وإغلاقه.`
          : `تمت بعض الخطوات، والطلب يحتاج تدخل: ${(data.blockers || []).join(' • ')}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="pr-8 text-right sm:text-right">
          <DialogTitle>اعتماد ومعالجة الطلب #{request?.orderNumber}</DialogTitle>
          <DialogDescription>راجعي ما سيتم تنفيذه في سلة، ثم اضغطي اعتماد.</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Loader2 className="size-4 animate-spin" /> جاري تجهيز الملخص من سلة...
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            {preview.stage !== 'ready' && (
              <Alert variant="destructive">
                <AlertDescription>{preview.notReadyReason}</AlertDescription>
              </Alert>
            )}

            {/* Refund */}
            {preview.refund && (
              <section className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium">
                    <Wallet className="size-4 text-blue-600" /> استرجاع مالي
                  </span>
                  <span className="text-lg font-bold text-blue-700">{formatMoney(preview.refund.amount, currency)}</span>
                </div>
                {preview.refund.transactionId ? (
                  <p className="mt-1 text-xs text-gray-600">
                    إلى وسيلة الدفع الأصلية{preview.refund.paymentMethod ? ` (${preview.refund.paymentMethod})` : ''} — مبلغ الدفع{' '}
                    {formatMoney(preview.refund.transactionTotal, currency)}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-amber-700">
                    {preview.refund.unavailableReason} سيبقى الطلب بانتظار تأكيد الاسترجاع اليدوي.
                  </p>
                )}
              </section>
            )}

            {/* Coupon */}
            {preview.coupon && (
              <section className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium">
                    <Ticket className="size-4 text-green-600" /> كوبون استبدال
                  </span>
                  <span className="text-lg font-bold text-green-700">{formatMoney(preview.coupon.amount, currency)}</span>
                </div>
                <p className="mt-1 text-xs text-gray-600">
                  {preview.coupon.existingCode
                    ? `تم إنشاء الكوبون مسبقاً: ${preview.coupon.existingCode}`
                    : `يُنشأ في سلة ويُرسل للعميل على الواتساب${preview.amounts.couponSource === 'override' ? ' (قيمة معدّلة يدوياً)' : ''}.`}
                </p>
              </section>
            )}

            {preview.exchangeOrder && (
              <section className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium">
                    <Ticket className="size-4 text-green-600" /> الطلب البديل #{preview.exchangeOrder.orderNumber}
                  </span>
                  <span className="text-sm text-gray-600">
                    {preview.exchangeOrder.paymentStatus === 'pending' ? 'بانتظار الدفع' : 'جاهز للتجهيز'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-600">
                  {preview.exchangeOrder.held ? 'يتحول الطلب البديل إلى «طلب جديد» ليُجهّز ويُشحن' : 'الطلب البديل غير محجوز'}
                  {preview.exchangeOrder.leftover > 0
                    ? ` • يُصدر كوبون بالرصيد المتبقي ${formatMoney(preview.exchangeOrder.leftover, currency)}`
                    : ''}
                </p>
              </section>
            )}

            {/* Restock */}
            <section className="rounded-lg border p-3">
              <p className="mb-2 font-medium">المخزون</p>
              <ul className="space-y-1 text-sm">
                {preview.restock.map((line) => (
                  <li key={line.itemId} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      {line.action === 'unknown' ? (
                        <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                      ) : line.action === 'skip' ? (
                        <PackageX className="size-4 shrink-0 text-gray-400" />
                      ) : (
                        <PackagePlus className="size-4 shrink-0 text-emerald-600" />
                      )}
                      <span className="truncate">
                        {line.productName}
                        {line.variantName ? ` · ${line.variantName}` : ''}
                        {line.quantity > 1 ? ` ×${line.quantity}` : ''}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs ${
                        line.action === 'unknown' ? 'text-amber-700' : line.action === 'skip' ? 'text-gray-500' : 'text-emerald-700'
                      }`}
                    >
                      {line.action === 'restock' ? (
                        <label className="flex cursor-pointer items-center gap-1.5">
                          <Checkbox
                            checked={alreadyRestocked.includes(line.itemId)}
                            onCheckedChange={(value) =>
                              setAlreadyRestocked((prev) =>
                                value === true ? [...prev, line.itemId] : prev.filter((id) => id !== line.itemId),
                              )
                            }
                          />
                          {alreadyRestocked.includes(line.itemId) ? 'أُعيدت يدوياً في سلة' : 'ترجع للمخزون'}
                        </label>
                      ) : line.action === 'done' ? (
                        'تمت إعادتها'
                      ) : (
                        line.reason
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {unknownRestocks.length > 0 && (
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-amber-900">
                  <Checkbox checked={confirmRestocks} onCheckedChange={(value) => setConfirmRestocks(value === true)} />
                  تحققت في سلة أن هذه القطع أُعيدت للمخزون
                </label>
              )}
            </section>

            {preview.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {preview.warnings.map((warning) => (
                  <p key={warning} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {warning}
                  </p>
                ))}
              </div>
            )}

            {existingRefunds.length > 0 && (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                <p className="font-medium text-red-900">استرجاعات مسجلة في سلة لهذا الطلب:</p>
                {existingRefunds.map((refund, index) => (
                  <p key={index} className="text-xs text-red-800">
                    {refund.note}
                    {refund.by ? ` — ${refund.by}` : ''}
                  </p>
                ))}
                <label className="flex cursor-pointer items-center gap-2 pt-1 text-red-900">
                  <Checkbox
                    checked={existingRefundChoice === 'record'}
                    onCheckedChange={(value) => setExistingRefundChoice(value === true ? 'record' : 'none')}
                  />
                  هذا هو استرجاع الطلب، تم من لوحة سلة: سجّله ولا تسترجع مرة أخرى
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-red-900">
                  <Checkbox
                    checked={existingRefundChoice === 'refund_again'}
                    onCheckedChange={(value) => setExistingRefundChoice(value === true ? 'refund_again' : 'none')}
                  />
                  تأكدت أنه استرجاع مختلف، استرجع المبلغ مرة أخرى
                </label>
              </div>
            )}

            <p className="flex items-center gap-2 text-xs text-gray-500">
              <CheckCircle2 className="size-3.5 shrink-0" /> بعد المعالجة تتحول حالة الطلب الأصلي في سلة إلى &quot;مسترجع&quot; ويُغلق الطلب هنا.
            </p>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={run} disabled={blocked || running} className="h-11 bg-emerald-600 hover:bg-emerald-700 sm:h-9">
            {running ? (
              <>
                <Loader2 className="size-4 animate-spin" /> جاري التنفيذ...
              </>
            ) : (
              'اعتماد ومعالجة'
            )}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={running} className="h-11 sm:h-9">
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
