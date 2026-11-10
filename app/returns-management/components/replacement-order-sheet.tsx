'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, PackagePlus, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ExchangePicker, type ExchangeCartLine } from '@/components/returns/ExchangePicker';
import { planExchangeSettlement } from '@/lib/returns/exchange-settlement';
import { cn } from '@/lib/utils';
import { formatMoney, type ReturnRequest } from './types';

interface Quote {
  merchantId: string;
  credit: number;
  currency: string;
  blockers: string[];
}

interface CreatedOrder {
  orderNumber: string;
  amountDue: number;
  leftover: number;
  paymentUrl: string | null;
  notification: { sent: boolean; reason?: string };
  released: boolean;
}

interface ReplacementOrderSheetProps {
  request: ReturnRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after an order was created (the sheet stays open on the result). */
  onCreated: () => void;
}

/**
 * Staff pick the replacement products for an exchange: the app creates the
 * Salla order with the exchange credit applied and WhatsApps the payment link.
 * Once paid it is held until the return passes inspection, then goes to "طلب جديد".
 */
export function ReplacementOrderSheet({ request, open, onOpenChange, onCreated }: ReplacementOrderSheetProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [methods, setMethods] = useState<Array<{ slug: string; label: string }>>([]);
  const [cart, setCart] = useState<ExchangeCartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ order: CreatedOrder; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const requestId = request?.id ?? null;

  useEffect(() => {
    if (!open || !requestId) return;
    let cancelled = false;
    setQuote(null);
    setCart([]);
    setPaymentMethod('');
    setNotifyCustomer(true);
    setError('');
    setResult(null);
    setCopied(false);
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(`/api/returns/exchange-order?returnRequestId=${encodeURIComponent(requestId)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل رصيد الاستبدال');
        if (cancelled) return;
        setQuote({ merchantId: data.merchantId, credit: Number(data.credit) || 0, currency: data.currency || 'SAR', blockers: data.blockers || [] });
        const methodsResponse = await fetch(`/api/returns/exchange/payment-methods?merchantId=${encodeURIComponent(data.merchantId)}`);
        const methodsData = await methodsResponse.json().catch(() => ({}));
        if (!cancelled) setMethods(Array.isArray(methodsData.methods) ? methodsData.methods : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'حدث خطأ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, requestId]);

  const currency = quote?.currency || request?.currency || 'SAR';
  const cartTotal = useMemo(() => cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0), [cart]);
  const settlement = planExchangeSettlement(quote?.credit ?? 0, cartTotal);
  const blocked = Boolean(quote && quote.blockers.length > 0);
  const canCreate =
    !blocked && cart.length > 0 && (quote?.credit ?? 0) > 0 && (!settlement.needsPayment || Boolean(paymentMethod)) && !creating;

  const create = async () => {
    if (!requestId) return;
    setCreating(true);
    setError('');
    try {
      const response = await fetch('/api/returns/exchange-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: requestId,
          action: 'create',
          lines: cart.map((line) => ({ productId: line.productId, skuId: line.skuId, quantity: line.quantity })),
          paymentMethod: settlement.needsPayment ? paymentMethod : null,
          notifyCustomer,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'تعذر إنشاء الطلب البديل');
      setResult({ order: data.order, message: data.message });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => !creating && onOpenChange(next)}>
      <SheetContent
        side="left"
        dir="rtl"
        showCloseButton={false}
        className="flex h-[100dvh] w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <header className="flex items-center gap-3 border-b bg-card/95 px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] backdrop-blur">
          <div className="min-w-0 flex-1">
            <SheetTitle className="flex items-center gap-2 text-base">
              <PackagePlus className="size-5" /> طلب بديل للطلب #{request?.orderNumber}
            </SheetTitle>
            <SheetDescription className="text-xs">
              يُنشأ في سلة برصيد الاستبدال ويُرسل رابط دفع الفرق للعميل. بعد الدفع يُحجز حتى فحص القطعة المرتجعة.
            </SheetDescription>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-10 shrink-0 rounded-full"
            onClick={() => onOpenChange(false)}
            disabled={creating}
            aria-label="إغلاق"
          >
            <X />
          </Button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> جاري تحميل رصيد الاستبدال…
            </p>
          )}

          {result ? (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
              <p className="flex items-center gap-2 text-base font-semibold text-emerald-900">
                <Check className="size-5" /> {result.message}
              </p>
              {result.order.paymentUrl && (
                <div className="space-y-2">
                  <p>
                    المبلغ المطلوب من العميل: <strong>{formatMoney(result.order.amountDue, currency)}</strong>
                  </p>
                  <div className="flex gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border bg-card px-2 py-2 text-xs" dir="ltr">
                      {result.order.paymentUrl}
                    </code>
                    <Button variant="outline" className="h-10 shrink-0" onClick={() => copyLink(result.order.paymentUrl!)}>
                      {copied ? <Check /> : <Copy />} {copied ? 'نُسخ' : 'نسخ الرابط'}
                    </Button>
                  </div>
                </div>
              )}
              {result.order.leftover > 0 && (
                <p className="text-xs text-emerald-900">
                  يبقى رصيد {formatMoney(result.order.leftover, currency)} يُصدر كوبوناً عند معالجة المرتجع.
                </p>
              )}
            </div>
          ) : (
            quote && (
              <>
                <div className="flex items-center justify-between rounded-xl border bg-emerald-50 p-3 text-sm">
                  <span className="text-emerald-900">رصيد الاستبدال</span>
                  <strong className="text-lg text-emerald-800">{formatMoney(quote.credit, currency)}</strong>
                </div>
                {blocked ? (
                  <Alert>
                    <AlertDescription className="space-y-1">
                      {quote.blockers.map((blocker) => (
                        <p key={blocker}>{blocker}</p>
                      ))}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <ExchangePicker
                    merchantId={quote.merchantId}
                    cart={cart}
                    onCartChange={setCart}
                    formatMoney={(value) => formatMoney(value, currency)}
                  />
                )}
              </>
            )
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        {!result && quote && !blocked && (
          <footer className="space-y-3 border-t bg-card/95 p-4 pb-[max(env(safe-area-inset-bottom),16px)] backdrop-blur">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">إجمالي البدائل</dt>
              <dd className="text-left tabular-nums">{formatMoney(cartTotal, currency)}</dd>
              <dt className="text-muted-foreground">من رصيد الاستبدال</dt>
              <dd className="text-left tabular-nums">-{formatMoney(settlement.creditApplied, currency)}</dd>
              {settlement.needsPayment ? (
                <>
                  <dt className="font-semibold">يدفع العميل الفرق (تقريباً)</dt>
                  <dd className="text-left font-semibold tabular-nums text-amber-700">{formatMoney(settlement.amountDue, currency)}</dd>
                </>
              ) : cart.length > 0 ? (
                <>
                  <dt className="font-semibold">مغطى بالرصيد</dt>
                  <dd className="text-left text-xs text-emerald-700">
                    {settlement.leftover > 0 ? `يبقى ${formatMoney(settlement.leftover, currency)} كوبوناً` : 'بدون دفع'}
                  </dd>
                </>
              ) : null}
            </dl>

            {settlement.needsPayment && (
              <div role="radiogroup" aria-label="طريقة دفع الفرق" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(methods.length > 0 ? methods : [{ slug: 'mada', label: 'مدى' }]).map((method) => (
                  <button
                    key={method.slug}
                    type="button"
                    role="radio"
                    aria-checked={paymentMethod === method.slug}
                    onClick={() => setPaymentMethod(method.slug)}
                    className={cn(
                      'min-h-11 rounded-lg border px-2 text-sm font-medium transition-colors sm:min-h-9',
                      paymentMethod === method.slug ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                    )}
                  >
                    {method.label}
                  </button>
                ))}
              </div>
            )}

            {settlement.needsPayment && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={notifyCustomer} onCheckedChange={(value) => setNotifyCustomer(value === true)} className="size-5" />
                إرسال رابط الدفع للعميل على الواتساب
              </label>
            )}

            <Button onClick={create} disabled={!canCreate} className="h-12 w-full text-base">
              {creating ? <Loader2 className="animate-spin" /> : <PackagePlus />}
              إنشاء الطلب البديل
            </Button>
          </footer>
        )}

        {result && (
          <footer className="border-t bg-card/95 p-4 pb-[max(env(safe-area-inset-bottom),16px)]">
            <Button className="h-12 w-full" onClick={() => onOpenChange(false)}>
              تم
            </Button>
          </footer>
        )}
      </SheetContent>
    </Sheet>
  );
}
