'use client';

import { useEffect, useState } from 'react';

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
 * Checks the order on screen against the 1 SAR promo limit. `blocked` stays
 * true until a staff member explicitly acknowledges the warning; the matching
 * API routes enforce the same rule server-side.
 */
export function usePromoLimitCheck(params: { orderId?: string | number | null; merchantId?: string | null; orderData?: unknown }) {
  const { orderId, merchantId, orderData } = params;
  const [check, setCheck] = useState<PromoLimitCheck | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const orderKey = orderId != null ? String(orderId) : '';
  const itemsKey = (() => {
    try {
      return JSON.stringify((orderData as any)?.items?.map((item: any) => [item?.product?.id ?? item?.product_id, item?.quantity]) ?? null);
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    setAcknowledged(false);
    setCheck(null);
    if (!orderKey) return;
    const controller = new AbortController();
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
      .catch(() => undefined);
    return () => controller.abort();
    // orderData is tracked through itemsKey so a refreshed payload re-checks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey, merchantId, itemsKey]);

  return {
    check,
    acknowledged,
    setAcknowledged,
    violation: Boolean(check?.violation),
    blocked: Boolean(check?.violation) && !acknowledged,
  };
}

export function PromoLimitAlert({
  check,
  acknowledged,
  onAcknowledgedChange,
}: {
  check: PromoLimitCheck | null;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
}) {
  if (!check?.violation) return null;
  return (
    <div role="alert" dir="rtl" className="rounded-xl border-2 border-red-500 bg-red-50 p-4 text-right shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-lg font-bold text-white">!</span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-base font-bold text-red-800">تجاوز حد عرض الريال (قطعة واحدة لكل عميل)</p>
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
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm font-semibold text-red-900">
            <input
              type="checkbox"
              className="h-4 w-4 accent-red-600"
              checked={acknowledged}
              onChange={(event) => onAcknowledgedChange(event.target.checked)}
            />
            راجعت الطلب مع المسؤول وأؤكد المتابعة
          </label>
        </div>
      </div>
    </div>
  );
}
