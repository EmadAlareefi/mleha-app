'use client';

import { useCallback, useEffect, useState } from 'react';

export interface PromoLimitCheck {
  enabled: boolean;
  violation: boolean;
  maxPerCustomer: number;
  promoUnitsInOrder: number;
  promoItems: Array<{ productId: string; name: string | null; sku: string | null; quantity: number }>;
  priorOrders: Array<{ orderId: string; orderNumber: string | null; placedAt: string | null; statusName: string | null; quantity: number }>;
  priorUnits: number;
  message: string | null;
  unavailable?: boolean;
}

/**
 * Checks the order on screen against the 1 SAR promo limit. A violating order
 * stays blocked — there is no override. Once the order is fixed in Salla
 * (extra promo items removed), `recheck`
 * re-reads it and unblocks. The matching API routes enforce the same rule.
 */
export function usePromoLimitCheck(params: { orderId?: string | number | null; merchantId?: string | null; orderData?: unknown }) {
  const { orderId, merchantId, orderData } = params;
  const [check, setCheck] = useState<PromoLimitCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [nonce, setNonce] = useState(0);
  const orderKey = orderId != null ? String(orderId) : '';
  const itemsKey = (() => {
    try {
      return JSON.stringify((orderData as any)?.items?.map((item: any) => [item?.product?.id ?? item?.product_id, item?.quantity]) ?? null);
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    setCheck(null);
    if (!orderKey) return;
    const controller = new AbortController();
    setChecking(true);
    fetch('/api/promo-limit/order-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: orderKey, merchantId, orderData }),
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.success) setCheck(data.check as PromoLimitCheck);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
    // orderData is tracked through itemsKey so a refreshed payload re-checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, merchantId, itemsKey, nonce]);

  const recheck = useCallback(() => setNonce((value) => value + 1), []);

  return {
    check,
    checking,
    recheck,
    violation: Boolean(check?.violation),
    blocked: Boolean(check?.violation),
  };
}

export function PromoLimitAlert({
  check,
  checking,
  onRecheck,
  onSendToReview,
  sendingToReview,
}: {
  check: PromoLimitCheck | null;
  checking?: boolean;
  onRecheck?: () => void;
  /** Order prep only: hand the order back as "under review" so the preparer can move on. */
  onSendToReview?: () => void;
  sendingToReview?: boolean;
}) {
  if (!check?.violation) return null;
  return (
    <div role="alert" dir="rtl" className="rounded-xl border-2 border-red-500 bg-red-50 p-4 text-right shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-lg font-bold text-white">!</span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-base font-bold text-red-800">موقوف: تجاوز حد عرض الريال (قطعة واحدة في الطلب)</p>
          {check.message && <p className="text-sm leading-6 text-red-700">{check.message}</p>}
          {check.promoItems.length > 0 && (
            <ul className="list-disc space-y-0.5 pr-5 text-sm text-red-800">
              {check.promoItems.map((item) => (
                <li key={`${item.productId}-${item.sku}`}>
                  {item.name || 'منتج'} {item.sku ? `(${item.sku})` : ''} × {item.quantity}
                </li>
              ))}
            </ul>
          )}
          {check.priorOrders.length > 0 && (
            <p className="text-sm text-red-800">
              طلبات سابقة من العرض:{' '}
              {check.priorOrders
                .map((order) => `#${order.orderNumber || order.orderId}${order.statusName ? ` (${order.statusName})` : ''}`)
                .join('، ')}
            </p>
          )}
          <p className="text-sm font-semibold text-red-900">
            لا يمكن تحضير أو شحن هذا الطلب حتى يتم تعديله في سلة: حذف قطع العرض الزائدة.
          </p>
          <div className="flex flex-wrap gap-2">
          {onSendToReview && (
            <button
              type="button"
              onClick={onSendToReview}
              disabled={sendingToReview}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {sendingToReview ? 'جاري التحويل…' : 'تحويل الطلب للمراجعة وأخذ طلب آخر'}
            </button>
          )}
          {onRecheck && (
            <button
              type="button"
              onClick={onRecheck}
              disabled={checking}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
            >
              {checking ? 'جاري الفحص…' : 'تم التعديل في سلة — إعادة الفحص'}
            </button>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
