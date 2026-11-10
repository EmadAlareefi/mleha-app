'use client';

import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { STAGE_LABELS, type ReturnStage } from '@/lib/returns/workflow';
import type { ReturnRequest } from './types';

interface ReopenPlanView {
  toStage: ReturnStage;
  clearItemIds: string[];
  keptItems: Array<{ id: string; productName: string; variantName: string | null }>;
  inspectionRequired: boolean;
}

interface ReopenDialogProps {
  request: ReturnRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}

/** "إعادة للمراجعة": a reason, an optional re-inspection, and where the request lands. */
export function ReopenDialog({ request, open, onOpenChange, onDone }: ReopenDialogProps) {
  const [reason, setReason] = useState('');
  const [clearInspection, setClearInspection] = useState(false);
  const [plan, setPlan] = useState<ReopenPlanView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const requestId = request?.id ?? null;
  const hasInspected = Boolean(request?.items.some((item) => item.conditionStatus));

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError('');
    setClearInspection(request?.stage === 'ready');
    // Reset only when the dialog opens for a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestId]);

  // Where it will land, for the chosen options (dry run).
  useEffect(() => {
    if (!open || !requestId) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/returns/reopen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: requestId, clearInspection, dryRun: true }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setPlan(null);
          setError(data.error || 'لا يمكن إعادة هذا الطلب للمراجعة');
          return;
        }
        setError('');
        setPlan(data.plan);
        if (data.plan?.inspectionRequired) setClearInspection(true);
      })
      .catch(() => !cancelled && setError('تعذر الاتصال بالخادم'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, requestId, clearInspection]);

  const submit = async () => {
    if (!requestId) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/returns/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: requestId, reason, clearInspection }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر إعادة الطلب للمراجعة');
      onDone(data.message || 'تمت إعادة الطلب للمراجعة.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const reasonOk = reason.trim().length >= 3;

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent dir="rtl" className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="pr-8 text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-5" /> إعادة للمراجعة
          </DialogTitle>
          <DialogDescription>
            طلب #{request?.orderNumber} — يعود الطلب إلى قائمة العمل. لن يتم التراجع عن أي استرجاع مالي أو كوبون أو إرجاع للمخزون
            تم سابقاً، وتتخطى المعالجة القادمة ما تم.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="reopen-reason" className="text-sm font-medium">
              سبب الإعادة <span className="text-red-600">*</span>
            </label>
            <Textarea
              id="reopen-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="مثال: أُغلق بالخطأ، العميلة غيّرت طلبها، الفحص يحتاج مراجعة…"
              disabled={saving}
              maxLength={500}
            />
          </div>

          {hasInspected && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
              <Checkbox
                checked={clearInspection}
                onCheckedChange={(value) => setClearInspection(value === true)}
                disabled={saving || plan?.inspectionRequired}
                className="mt-0.5 size-5"
              />
              <span>
                <span className="font-medium">إعادة فحص القطع في المستودع</span>
                <span className="block text-xs text-muted-foreground">
                  تُمسح نتيجة الفحص ويظهر السبب للمفتش.
                  {plan?.inspectionRequired ? ' مطلوبة للطلبات الجاهزة للمعالجة.' : ''}
                </span>
              </span>
            </label>
          )}

          <div className="rounded-lg border bg-muted/50 p-3 text-sm" aria-live="polite">
            {loading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> جاري التحقق…
              </span>
            ) : plan ? (
              <>
                <p>
                  سينتقل الطلب إلى: <strong>{STAGE_LABELS[plan.toStage]}</strong>
                </p>
                {plan.keptItems.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    تبقى نتيجة فحص القطع التي أُعيدت للمخزون:{' '}
                    {plan.keptItems.map((item) => `${item.productName}${item.variantName ? ` · ${item.variantName}` : ''}`).join('، ')}
                  </p>
                )}
              </>
            ) : null}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={submit} disabled={saving || loading || !plan || !reasonOk} className="h-11 sm:h-9">
            {saving ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            إعادة للمراجعة
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-11 sm:h-9">
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
