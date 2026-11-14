'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  buildReturnFeeQuote,
  getOriginalShippingFee,
  type ReturnFeeQuote,
} from '@/lib/returns/fees';
import { getItemAttributes } from '@/lib/returns/item-attributes';
import { getOrderItemUnitPrice } from '@/lib/returns/item-price';
import { RIBBON_REMOVED_MESSAGE, RIBBON_UNANSWERED_MESSAGE } from '@/lib/returns/protection-ribbon';
import { RETURN_REASONS } from '@/lib/returns/reasons';
import { pieceKey, type PieceType } from '@/lib/returns/pieces';
import { splitRequestFinancials } from '@/lib/returns/request-financials';
import type { PublicPiece } from '@/app/lib/returns/piece-context';
import { planExchangeSettlement } from '@/lib/returns/exchange-settlement';
import { ExchangePicker, type ExchangeCartLine } from './ExchangePicker';

interface OrderItem {
  id: number;
  product_id?: number | string;
  productId?: number | string;
  name?: string;
  sku?: string;
  thumbnail?: string;
  currency?: string;
  images?: { image?: string }[];
  product?: {
    id?: number | string;
    name: string;
    sku?: string;
    price: number;
    thumbnail?: string;
  };
  variant?: {
    id: number;
    name: string;
  };
  quantity: number;
  amounts?: {
    price: { amount: number };
    total: { amount: number };
    price_without_tax?: { amount: number };
    tax?: { amount?: { amount: number } };
    total_discount?: { amount: number };
  };
}

interface Order {
  id: number;
  reference_id: string;
  status: { name: string; slug: string } | string;
  amounts: {
    total: { amount: number; currency: string };
    shipping_cost?: { amount: number; taxable?: boolean; currency?: string };
    shipping_tax?: { amount?: number; currency?: string };
    options_total?: { amount: number; currency?: string };
  };
  items: OrderItem[];
  options?: OrderItem[];
  returnFeeQuotes?: {
    return: ReturnFeeQuote;
    exchange: ReturnFeeQuote;
  };
  returnFeeQuoteError?: string;
}

interface ReturnFormProps {
  order: Order;
  merchantId: string;
  merchantInfo: {
    name: string;
    phone: string;
    address: string;
    city: string;
  };
  windowExpiredProductIds?: string[];
  /** Per-piece rules from /api/returns/check. The server enforces them again on create. */
  pieces?: PublicPiece[] | null;
  /** Echoed back to /api/returns/create as proof the order belongs to this customer. */
  customerMobile?: string;
  onSuccess: (result: any) => void;
}

interface PieceChoice {
  /** true = protection ribbon removed. */
  ribbonRemoved?: boolean;
  type?: PieceType | null;
}

const TYPE_OPTIONS: Array<{ value: PieceType | null; label: string }> = [
  { value: null, label: 'لا شيء' },
  { value: 'return', label: 'استرجاع' },
  { value: 'exchange', label: 'استبدال' },
];

/** Fallback when /api/returns/check did not send pieces: every piece open, the server decides. */
function piecesFromOrder(order: Order): PublicPiece[] {
  return (order.items ?? []).flatMap((item) =>
    Array.from({ length: Math.max(0, item.quantity) }, (_, unitIndex) => ({
      orderItemId: String(item.id),
      unitIndex,
      lineQuantity: item.quantity,
      productId: String(item.product?.id ?? item.product_id ?? item.productId ?? item.id),
      allowedTypes: ['return', 'exchange'] as PieceType[],
      alreadyRequested: false,
    })),
  );
}

export default function ReturnForm({ order, merchantId, merchantInfo, pieces, customerMobile, onSuccess }: ReturnFormProps) {
  const [choices, setChoices] = useState<Record<string, PieceChoice>>({});
  const [reason, setReason] = useState('');
  const [reasonDetails, setReasonDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chosenExchangeMode, setExchangeMode] = useState<'order' | 'coupon'>('order');
  // null until /api/returns/exchange/config answers; off = coupon only.
  const [exchangeOrdersEnabled, setExchangeOrdersEnabled] = useState<boolean | null>(null);
  const exchangeMode = exchangeOrdersEnabled ? chosenExchangeMode : 'coupon';
  const [cart, setCart] = useState<ExchangeCartLine[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<Array<{ slug: string; label: string }>>([]);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [redirecting, setRedirecting] = useState(false);

  const orderCurrency = order.returnFeeQuotes?.return?.currency || order.amounts?.total?.currency || 'SAR';
  const returnQuote = order.returnFeeQuotes?.return ?? buildReturnFeeQuote('return', orderCurrency, 1, 'sar');
  const exchangeQuote = order.returnFeeQuotes?.exchange ?? buildReturnFeeQuote('exchange', orderCurrency, 1, 'sar');
  const originalShippingFee = getOriginalShippingFee(order.amounts);
  const exchangeSavings = returnQuote.processingFee - exchangeQuote.processingFee;

  const formatMoney = (value: number, currency = orderCurrency) => {
    const normalized = currency.trim().toUpperCase() || 'SAR';
    return `${value.toFixed(2)} ${normalized === 'SAR' ? 'ر.س' : normalized}`;
  };
  const formatFee = (quote: ReturnFeeQuote) =>
    quote.currency === 'SAR'
      ? formatMoney(quote.processingFee, quote.currency)
      : `${formatMoney(quote.processingFee, quote.currency)} (يعادل ${quote.processingFeeSar.toFixed(2)} ر.س)`;

  const allPieces = useMemo(() => pieces ?? piecesFromOrder(order), [pieces, order]);
  const lines = useMemo(() => {
    const byLine = new Map<string, PublicPiece[]>();
    for (const piece of allPieces) {
      const list = byLine.get(piece.orderItemId) ?? [];
      list.push(piece);
      byLine.set(piece.orderItemId, list);
    }
    return (order.items ?? [])
      .map((item) => ({ item, pieces: byLine.get(String(item.id)) ?? [] }))
      .filter((line) => line.pieces.length > 0);
  }, [allPieces, order]);
  const priceByLine = useMemo(
    () => new Map((order.items ?? []).map((item) => [String(item.id), getOrderItemUnitPrice(item)])),
    [order],
  );

  const setChoice = (key: string, next: PieceChoice) => {
    setChoices((previous) => ({ ...previous, [key]: { ...previous[key], ...next } }));
    setError('');
  };

  const selected = allPieces
    .map((piece) => ({ piece, choice: choices[pieceKey(piece.orderItemId, piece.unitIndex)] }))
    .filter(({ choice }) => choice?.ribbonRemoved === false && (choice.type === 'return' || choice.type === 'exchange'));

  const selectedTypes = new Set(selected.map(({ choice }) => choice!.type));
  const split = splitRequestFinancials({
    pieces: selected.map(({ piece, choice }) => ({
      type: choice!.type as PieceType,
      price: priceByLine.get(piece.orderItemId) ?? 0,
    })),
    originalShipping: originalShippingFee,
    returnProcessingFee: returnQuote.processingFee,
    exchangeProcessingFee: exchangeQuote.processingFee,
  });
  const activeQuote = selectedTypes.has('return') ? returnQuote : exchangeQuote;
  const replacing = selectedTypes.has('exchange') && exchangeMode === 'order';
  const cartTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const settlement = planExchangeSettlement(split.couponAmount, cartTotal);

  useEffect(() => {
    fetch('/api/returns/exchange/config', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setExchangeOrdersEnabled(data ? data.exchangeOrdersEnabled !== false : true))
      .catch(() => setExchangeOrdersEnabled(true));
  }, []);

  useEffect(() => {
    if (!replacing || paymentMethods.length > 0) return;
    fetch(`/api/returns/exchange/payment-methods?merchantId=${encodeURIComponent(merchantId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data?.methods && setPaymentMethods(data.methods))
      .catch(() => undefined);
  }, [replacing, paymentMethods.length, merchantId]);
  const needsDetails = reason === 'other' || reason === 'defective' || reason === 'wrong_item';
  const selectablePieces = allPieces.filter((piece) => piece.allowedTypes.length > 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    const unanswered = selected.length === 0 && selectablePieces.some(
      (piece) => choices[pieceKey(piece.orderItemId, piece.unitIndex)]?.ribbonRemoved === undefined,
    );
    if (selected.length === 0) {
      setError(unanswered ? RIBBON_UNANSWERED_MESSAGE : 'الرجاء اختيار استرجاع أو استبدال لقطعة واحدة على الأقل');
      return;
    }
    if (!reason) {
      setError('الرجاء اختيار السبب');
      return;
    }
    if (needsDetails && !reasonDetails.trim()) {
      setError('الرجاء تقديم تفاصيل السبب');
      return;
    }
    if (order.returnFeeQuoteError) {
      setError(order.returnFeeQuoteError);
      return;
    }
    if (replacing && cart.length === 0) {
      setError('اختاري البدائل التي تريدينها، أو اختاري "كوبون لاستخدامه لاحقاً"');
      return;
    }
    if (replacing && settlement.needsPayment && !paymentMethod) {
      setError('اختاري طريقة دفع الفرق');
      return;
    }

    setLoading(true);
    try {
      // Only identifiers, the per-piece choice and the ribbon answer are sent;
      // the server prices every piece from Salla.
      const response = await fetch('/api/returns/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId,
          orderId: order.id.toString(),
          reason,
          reasonDetails: needsDetails ? reasonDetails : undefined,
          pieces: selected.map(({ piece, choice }) => ({
            orderItemId: piece.orderItemId,
            unitIndex: piece.unitIndex,
            type: choice!.type,
            ribbonRemoved: false,
          })),
          exchange: selectedTypes.has('exchange')
            ? {
                mode: exchangeMode,
                lines: replacing ? cart.map((line) => ({ productId: line.productId, skuId: line.skuId, quantity: line.quantity })) : [],
                paymentMethod: replacing && settlement.needsPayment ? paymentMethod : undefined,
              }
            : undefined,
          customerMobile,
          merchantName: merchantInfo.name,
          merchantPhone: merchantInfo.phone,
          merchantAddress: merchantInfo.address,
          merchantCity: merchantInfo.city,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        // Switched off after the form loaded: fall back to the coupon choice.
        if (data?.errorCode === 'EXCHANGE_ORDERS_DISABLED') setExchangeOrdersEnabled(false);
        throw new Error(data.message || data.error || 'فشل إنشاء الطلب');
      }
      const paymentUrl: string | undefined = data.returnRequest?.exchangeOrder?.paymentUrl;
      if (paymentUrl) {
        // The return is saved; the customer finishes paying the difference on Salla.
        setRedirecting(true);
        window.location.href = paymentUrl;
        return;
      }
      onSuccess(data.returnRequest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Order info */}
      <Card className="p-6">
        <h3 className="mb-4 text-lg font-semibold">معلومات الطلب</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">رقم الطلب:</span>
            <span className="font-medium">{order.reference_id || order.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">حالة الطلب:</span>
            <span className="font-medium">
              {typeof order.status === 'string' ? order.status : order.status?.name || order.status?.slug}
            </span>
          </div>
          {order.amounts?.total?.amount && (
            <div className="flex justify-between">
              <span className="text-gray-600">الإجمالي:</span>
              <span className="font-medium">
                {order.amounts.total.amount} {order.amounts.total.currency || 'SAR'}
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* How it works / fees */}
      <Card className="space-y-3 p-6">
        <h3 className="text-lg font-semibold">اختاري لكل قطعة: استرجاع أو استبدال</h3>
        <p className="text-sm text-gray-600">
          يمكنك استرجاع قطعة واستبدال أخرى في نفس الطلب. تُحسب رسوم شحنة واحدة فقط للطلب.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <span className="block font-medium text-blue-800">استرجاع</span>
            <span className="text-xs text-gray-600">رسوم {formatFee(returnQuote)} — المبلغ يعود لوسيلة الدفع</span>
          </div>
          <div className="relative rounded-lg border border-green-200 bg-green-50 p-3">
            {exchangeSavings > 0 && (
              <span className="absolute -top-2 left-2 whitespace-nowrap rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">
                وفّري {formatMoney(exchangeSavings)}
              </span>
            )}
            <span className="block font-medium text-green-800">استبدال</span>
            <span className="text-xs text-gray-600">رسوم {formatFee(exchangeQuote)} فقط — كوبون بقيمة القطعة</span>
          </div>
        </div>
      </Card>

      {/* Pieces */}
      <Card className="p-6">
        <h3 className="mb-1 text-lg font-semibold">القطع</h3>
        <p className="mb-4 text-sm text-gray-600">
          لكل قطعة: أجيبي عن سؤال شريط الحماية ثم اختاري ما تريدين.
        </p>
        <div className="space-y-4">
          {lines.length === 0 && <p className="text-center text-gray-500">لا توجد منتجات في هذا الطلب</p>}
          {lines.map(({ item, pieces: linePieces }) => {
            const { color, size } = getItemAttributes(item);
            const imageSrc = item.images?.[0]?.image || item.product?.thumbnail || item.thumbnail;
            const name = item.name || item.product?.name || 'منتج';
            const unitPrice = priceByLine.get(String(item.id)) ?? 0;
            return (
              <div key={item.id} className="rounded-xl border">
                <div className="flex items-start gap-3 border-b p-4">
                  {imageSrc ? (
                    <Image src={imageSrc} alt={name} width={64} height={64} sizes="64px" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-gray-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <h4 className="line-clamp-2 font-medium text-gray-900">{name}</h4>
                    <p className="text-sm text-gray-600">
                      {[color && `اللون: ${color}`, size && `المقاس: ${size}`, !color && !size && item.variant?.name]
                        .filter(Boolean)
                        .join(' — ')}
                    </p>
                    <p className="text-sm text-gray-600">سعر القطعة: {formatMoney(unitPrice, item.currency || orderCurrency)}</p>
                  </div>
                </div>

                <div className="divide-y">
                  {linePieces.map((piece) => {
                    const key = pieceKey(piece.orderItemId, piece.unitIndex);
                    const choice = choices[key] ?? {};
                    const label = piece.lineQuantity > 1 ? `القطعة ${piece.unitIndex + 1} من ${piece.lineQuantity}` : 'القطعة';
                    const blocked = piece.allowedTypes.length === 0;
                    return (
                      <div key={key} className={`space-y-3 p-4 ${blocked ? 'bg-gray-50' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{label}</span>
                          {choice.type && choice.ribbonRemoved === false && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                choice.type === 'return' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                              }`}
                            >
                              {choice.type === 'return' ? 'استرجاع' : 'استبدال'}
                            </span>
                          )}
                        </div>

                        {blocked ? (
                          <p className="text-sm text-red-700">{piece.blockedReason || 'هذه القطعة غير قابلة للإرجاع أو الاستبدال'}</p>
                        ) : (
                          <>
                            <fieldset>
                              <legend className="mb-1 text-sm text-gray-700">هل تم إزالة شريط الحماية من الفستان؟</legend>
                              <div className="flex gap-6">
                                {[
                                  { text: 'نعم', removed: true },
                                  { text: 'لا', removed: false },
                                ].map(({ text, removed }) => (
                                  <label key={text} className="flex cursor-pointer items-center gap-2 py-1">
                                    <input
                                      type="radio"
                                      name={`ribbon-${key}`}
                                      checked={choice.ribbonRemoved === removed}
                                      onChange={() => setChoice(key, { ribbonRemoved: removed, type: removed ? null : choice.type ?? null })}
                                    />
                                    {text}
                                  </label>
                                ))}
                              </div>
                            </fieldset>

                            {choice.ribbonRemoved === true && (
                              <p role="status" className="text-sm text-red-700">{RIBBON_REMOVED_MESSAGE}</p>
                            )}

                            {choice.ribbonRemoved === false && (
                              <div>
                                <div role="radiogroup" aria-label={`ماذا تريدين لـ${label}`} className="grid grid-cols-3 gap-2">
                                  {TYPE_OPTIONS.map((option) => {
                                    const allowed = option.value === null || piece.allowedTypes.includes(option.value);
                                    const active = (choice.type ?? null) === option.value;
                                    return (
                                      <button
                                        key={option.label}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        disabled={!allowed}
                                        onClick={() => setChoice(key, { type: option.value })}
                                        className={`rounded-lg border-2 px-2 py-2 text-sm font-medium transition-colors ${
                                          !allowed
                                            ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300'
                                            : active
                                              ? option.value === 'return'
                                                ? 'border-blue-600 bg-blue-50 text-blue-700'
                                                : option.value === 'exchange'
                                                  ? 'border-green-600 bg-green-50 text-green-700'
                                                  : 'border-gray-400 bg-gray-50 text-gray-700'
                                              : 'border-gray-200 hover:border-gray-300'
                                        }`}
                                      >
                                        {option.label}
                                      </button>
                                    );
                                  })}
                                </div>
                                {(piece.exchangeOnlyReason || piece.returnOnlyReason) && (
                                  <p className="mt-2 text-xs font-medium text-amber-700">
                                    {piece.exchangeOnlyReason || piece.returnOnlyReason}
                                  </p>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {selectedTypes.has('exchange') && exchangeOrdersEnabled && (
        <Card className="space-y-4 p-6">
          <h3 className="text-lg font-semibold">كيف تحبين الاستبدال؟</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'order' as const, title: 'اختاري البدائل الآن', hint: 'نجهز طلبك الجديد فوراً' },
              { value: 'coupon' as const, title: 'كوبون لاستخدامه لاحقاً', hint: 'يصلك على الواتساب بعد الفحص' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setExchangeMode(option.value);
                  setError('');
                }}
                className={`rounded-lg border-2 p-3 text-right transition-colors ${
                  exchangeMode === option.value ? 'border-green-600 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="block text-sm font-semibold">{option.title}</span>
                <span className="block text-xs text-gray-600">{option.hint}</span>
              </button>
            ))}
          </div>

          {replacing && (
            <>
              <div className="sticky top-2 z-10 rounded-lg border bg-white/95 p-3 text-sm shadow-sm backdrop-blur">
                <div className="flex justify-between">
                  <span>رصيد الاستبدال</span>
                  <strong className="text-green-700">{formatMoney(split.couponAmount)}</strong>
                </div>
                <div className="flex justify-between">
                  <span>مجموع البدائل</span>
                  <strong>{formatMoney(cartTotal)}</strong>
                </div>
                {cart.length > 0 && (
                  <div className="mt-1 flex justify-between border-t pt-1">
                    {settlement.needsPayment ? (
                      <>
                        <span className="font-semibold">المتبقي للدفع</span>
                        <strong className="text-red-700">{formatMoney(settlement.amountDue)}</strong>
                      </>
                    ) : settlement.leftover > 0 ? (
                      <>
                        <span className="font-semibold">رصيد متبقي يصلك ككوبون</span>
                        <strong className="text-green-700">{formatMoney(settlement.leftover)}</strong>
                      </>
                    ) : (
                      <span className="font-semibold text-green-700">مغطى بالكامل من رصيد الاستبدال</span>
                    )}
                  </div>
                )}
              </div>

              <ExchangePicker merchantId={merchantId} cart={cart} onCartChange={setCart} formatMoney={(value) => formatMoney(value)} />

              {cart.length > 0 && settlement.needsPayment && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">طريقة دفع الفرق ({formatMoney(settlement.amountDue)})</p>
                  <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {paymentMethods.map((method) => (
                      <button
                        key={method.slug}
                        type="button"
                        role="radio"
                        aria-checked={paymentMethod === method.slug}
                        onClick={() => setPaymentMethod(method.slug)}
                        className={`rounded-lg border-2 px-3 py-2 text-sm font-medium ${
                          paymentMethod === method.slug ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {method.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">بعد إرسال الطلب ننقلك لصفحة الدفع الآمنة في المتجر لإكمال دفع الفرق.</p>
                </div>
              )}
              <p className="text-xs text-gray-600">
                الشحن مجاني لطلبك الجديد، ويُشحن بعد وصول القطعة المرتجعة وفحصها.
              </p>
            </>
          )}
        </Card>
      )}

      {order.returnFeeQuoteError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{order.returnFeeQuoteError}</div>
      )}

      {/* Summary */}
      {selected.length > 0 && (
        <Card className="space-y-3 border-blue-200 bg-blue-50 p-6">
          <h3 className="text-lg font-semibold">الملخص</h3>
          {split.returnItemsTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span>قطع الاسترجاع ({selected.filter(({ choice }) => choice!.type === 'return').length}):</span>
              <span className="font-medium">{formatMoney(split.returnItemsTotal)}</span>
            </div>
          )}
          {split.exchangeItemsTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span>قطع الاستبدال ({selected.filter(({ choice }) => choice!.type === 'exchange').length}):</span>
              <span className="font-medium">{formatMoney(split.exchangeItemsTotal)}</span>
            </div>
          )}
          {split.originalShipping > 0 && (
            <div className="flex justify-between text-sm">
              <span>شحن الطلب الأصلي (شامل الضريبة):</span>
              <span className="font-medium">{formatMoney(split.originalShipping)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-red-600">
            <span>رسوم الشحن ({selectedTypes.has('return') ? 'إرجاع' : 'استبدال'}):</span>
            <span>-{formatFee(activeQuote)}</span>
          </div>

          <div className="space-y-2 border-t pt-3">
            {selectedTypes.has('return') && (
              <div className="flex justify-between text-lg font-bold">
                <span>المبلغ المسترد:</span>
                <span className="text-blue-700">{formatMoney(split.refundAmount)}</span>
              </div>
            )}
            {selectedTypes.has('exchange') && (
              <div className="flex justify-between text-lg font-bold">
                <span>{replacing ? 'رصيد الاستبدال:' : 'قيمة كوبون الاستبدال:'}</span>
                <span className="text-green-700">{formatMoney(split.couponAmount)}</span>
              </div>
            )}
          </div>
          {selectedTypes.has('return') && (
            <p className="text-xs text-gray-600">يُرد المبلغ لوسيلة الدفع الأصلية بعد وصول القطع وفحصها.</p>
          )}
          {selectedTypes.has('exchange') && !replacing && (
            <p className="text-xs text-gray-600">يصلك كوبون الاستبدال على الواتساب بعد وصول القطع وفحصها.</p>
          )}
        </Card>
      )}

      {/* Reason */}
      <Card className="p-6">
        <h3 className="mb-4 text-lg font-semibold">السبب</h3>
        <div className="space-y-4">
          <select value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-lg border px-4 py-3" required>
            <option value="">اختر السبب...</option>
            {RETURN_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {needsDetails && (
            <textarea
              value={reasonDetails}
              onChange={(event) => setReasonDetails(event.target.value)}
              placeholder={
                reason === 'defective'
                  ? 'الرجاء وصف العيب أو التلف بالتفصيل...'
                  : reason === 'wrong_item'
                    ? 'الرجاء توضيح المنتج الذي تم استلامه بدلاً من المطلوب...'
                    : 'الرجاء كتابة السبب...'
              }
              className="w-full resize-none rounded-lg border px-4 py-3"
              rows={4}
              required
            />
          )}
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      <Button
        type="submit"
        disabled={loading || redirecting || selected.length === 0 || Boolean(order.returnFeeQuoteError)}
        className="w-full py-6 text-lg"
      >
        {redirecting
          ? 'جاري تحويلك لصفحة الدفع...'
          : loading
          ? 'جاري المعالجة...'
          : selected.length === 0
            ? 'اختاري قطعة واحدة على الأقل'
            : `إرسال الطلب (${selected.length} ${selected.length === 1 ? 'قطعة' : 'قطع'})`}
      </Button>
    </form>
  );
}
