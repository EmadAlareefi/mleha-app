'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { MAX_EXCHANGE_LINE_QUANTITY, MAX_EXCHANGE_LINES, planExchangeSettlement } from '@/lib/returns/exchange-settlement';
import type { CatalogProduct, CatalogProductSummary, CatalogSku } from '@/app/lib/returns/exchange-catalog';
import type { ExchangeCartLine } from '@/components/returns/ExchangePicker';
import { buildCalc, type Money } from './model';
import { CalcBox, formatMoney, StepsBar, Thumb } from './ui';

export interface AltSuggestion {
  productId: string;
  name: string;
  imageUrl: string | null;
  currentVariant: string;
}

function CreditBanner({ money, who }: { money: Money; who: string }) {
  return (
    <div className="banner" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ margin: 0 }}>
        <span>رصيد الاستبدال</span>
        <span className="v" style={{ color: 'var(--brand)' }}>
          {formatMoney(money.split.couponAmount, money.currency)}
        </span>
      </div>
      {who && <div className="tiny">{who}</div>}
      <div className="tiny">
        {money.split.originalShipping > 0 && !money.hasReturn
          ? `يشمل شحن الطلب الأصلي ${formatMoney(money.split.originalShipping, money.currency)}، `
          : ''}
        بعد خصم رسوم الشحن {formatMoney(money.split.processingFee, money.currency)}
      </div>
    </div>
  );
}

/* ---------------- 12 / 14: list ---------------- */

export function AltListStep({
  merchantId,
  money,
  who,
  suggestions,
  cart,
  onCart,
  onOpen,
  onUseCoupon,
  onNext,
  onBack,
}: {
  merchantId: string;
  money: Money;
  who: string;
  suggestions: AltSuggestion[];
  cart: ExchangeCartLine[];
  onCart: (cart: ExchangeCartLine[]) => void;
  onOpen: (productId: string) => void;
  onUseCoupon: () => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'same'>(suggestions.length ? 'same' : 'all');
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<CatalogProductSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(keywordInput.trim());
      setPage(1);
      if (keywordInput.trim()) setFilter('all');
    }, 400);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  useEffect(() => {
    if (filter !== 'all') return;
    let cancelled = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ merchantId, page: String(page) });
    if (keyword) params.set('keyword', keyword);
    fetch(`/api/returns/exchange/catalog?${params}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل المنتجات');
        if (cancelled) return;
        setProducts((previous) => (page === 1 ? data.products : [...previous, ...data.products]));
        setHasMore(Boolean(data.hasMore));
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'تعذر تحميل المنتجات'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filter, merchantId, keyword, page]);

  const empty = filter === 'all' && !loading && !error && products.length === 0;
  const clear = () => {
    setKeywordInput('');
    setKeyword('');
    setPage(1);
    setFilter('all');
  };
  const setQuantity = (skuId: string, quantity: number) =>
    onCart(
      cart
        .map((line) => (line.skuId === skuId ? { ...line, quantity: Math.max(0, Math.min(quantity, line.maxQuantity)) } : line))
        .filter((line) => line.quantity > 0),
    );

  return (
    <div className="pad">
      <h1>اختيار البديل</h1>
      <p className="lead">اختيار البديل جزء من تفاصيل طلب الاستبدال.</p>
      <StepsBar on={1} />
      <CreditBanner money={money} who={who} />

      <input
        className="inp"
        style={{ direction: 'rtl' }}
        placeholder="ابحثي عن فستان أو لون أو موديل..."
        value={keywordInput}
        onChange={(event) => setKeywordInput(event.target.value)}
        aria-label="البحث عن بديل"
      />
      <div className="chips">
        {suggestions.length > 0 && (
          <button type="button" className={filter === 'same' ? 'on' : ''} onClick={() => setFilter('same')}>
            نفس الفستان بمقاس آخر
          </button>
        )}
        <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          كل المنتجات
        </button>
      </div>

      {cart.length > 0 && (
        <div className="card">
          <div className="sect brand">البدائل المختارة</div>
          {cart.map((line) => (
            <div key={line.skuId} className="prod" style={{ marginBottom: 10 }}>
              <Thumb src={line.imageUrl} alt={line.name} />
              <div className="info">
                <div className="nm">{line.name}</div>
                {line.variantName && <div className="sz">{line.variantName}</div>}
                <div className="pr">{formatMoney(line.unitPrice, money.currency)}</div>
              </div>
              <div className="qty">
                <button type="button" aria-label="زيادة" disabled={line.quantity >= line.maxQuantity} onClick={() => setQuantity(line.skuId, line.quantity + 1)}>
                  +
                </button>
                <span>{line.quantity}</span>
                <button type="button" aria-label={line.quantity === 1 ? 'حذف' : 'إنقاص'} onClick={() => setQuantity(line.skuId, line.quantity - 1)}>
                  {line.quantity === 1 ? '✕' : '−'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {empty ? (
        <>
          <div className="card">
            <h3 style={{ margin: '6px 0' }}>لا توجد نتائج مطابقة</h3>
            <p className="lead">جرّبي لونًا أو كلمة أخرى، أو أزيلي البحث لعرض خيارات أكثر.</p>
            <button type="button" className="btn" onClick={clear}>
              مسح البحث والفلاتر
            </button>
          </div>
          <div className="sect">لا تجدين البديل المناسب؟</div>
          <p className="lead">يمكنك الرجوع واختيار كوبون لاستخدامه لاحقًا بدلًا من تحديد بديل الآن.</p>
          <button type="button" className="btn ghost" onClick={onUseCoupon}>
            اختيار كوبون بدلًا من منتج
          </button>
        </>
      ) : (
        <>
          <div className="sect">{filter === 'same' ? 'نفس القطعة بمقاس أو لون آخر' : 'البدائل المتاحة'}</div>
          <div className="alt" style={{ marginTop: 10 }}>
            {filter === 'same'
              ? suggestions.map((suggestion) => (
                  <div key={suggestion.productId} className="it">
                    <div className="im">{suggestion.imageUrl && <Image src={suggestion.imageUrl} alt={suggestion.name} fill sizes="(max-width: 640px) 50vw, 240px" />}</div>
                    <div className="t">{suggestion.name}</div>
                    {suggestion.currentVariant && <div className="tiny" style={{ marginBottom: 8 }}>عندك الآن: {suggestion.currentVariant}</div>}
                    <button type="button" className="btn" onClick={() => onOpen(suggestion.productId)}>
                      اختيار المقاس
                    </button>
                  </div>
                ))
              : products.map((product) => (
                  <div key={product.id} className="it">
                    <div className="im">{product.imageUrl && <Image src={product.imageUrl} alt={product.name} fill sizes="(max-width: 640px) 50vw, 240px" />}</div>
                    <div className="t">{product.name}</div>
                    <div className="p">
                      {formatMoney(product.price, money.currency)}
                      {product.regularPrice > product.price && <s>{formatMoney(product.regularPrice, money.currency)}</s>}
                    </div>
                    <button type="button" className="btn" onClick={() => onOpen(product.id)}>
                      اختيار المقاس
                    </button>
                  </div>
                ))}
          </div>
          {filter === 'all' && loading && (
            <div className="tiny" style={{ textAlign: 'center', padding: 16 }}>
              <span className="spin" />
              جارٍ تحميل المنتجات...
            </div>
          )}
          {filter === 'all' && error && <div className="err-t">{error}</div>}
          {filter === 'all' && hasMore && !loading && (
            <button type="button" className="btn ghost" onClick={() => setPage((value) => value + 1)}>
              عرض المزيد
            </button>
          )}
          <div className="tiny" style={{ margin: '14px 0 6px' }}>
            {cart.length ? 'تم اختيار بديل.' : 'لم يتم اختيار بديل بعد.'}
          </div>
          <button type="button" className="btn" disabled={!cart.length} onClick={onNext}>
            {cart.length ? 'متابعة لمراجعة الطلب' : 'اختاري بديلًا للمتابعة'}
          </button>
        </>
      )}
      <button type="button" className="btn ghost" onClick={onBack}>
        الرجوع إلى تفاصيل الطلب
      </button>
    </div>
  );
}

/* ---------------- 13: product detail ---------------- */

export function AltDetailStep({
  merchantId,
  productId,
  money,
  who,
  cart,
  onAdd,
  onBack,
}: {
  merchantId: string;
  productId: string;
  money: Money;
  who: string;
  cart: ExchangeCartLine[];
  onAdd: (line: ExchangeCartLine) => void;
  onBack: () => void;
}) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const cartFull = cart.length >= MAX_EXCHANGE_LINES;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/returns/exchange/product/${productId}?merchantId=${encodeURIComponent(merchantId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل المنتج');
        if (!cancelled) setProduct(data.product);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'تعذر تحميل المنتج'));
    return () => {
      cancelled = true;
    };
  }, [merchantId, productId]);

  const isValueAvailable = (optionId: string, valueId: string) =>
    Boolean(
      product?.skus.some(
        (sku) =>
          sku.inStock &&
          sku.optionValueIds.includes(valueId) &&
          Object.entries(selection).every(([other, value]) => other === optionId || sku.optionValueIds.includes(value)),
      ),
    );

  const selectedSku: CatalogSku | null = useMemo(() => {
    if (!product) return null;
    if (product.options.length === 0) return product.skus[0] ?? null;
    if (product.options.some((option) => !selection[option.id])) return null;
    return product.skus.find((sku) => product.options.every((option) => sku.optionValueIds.includes(selection[option.id]))) ?? null;
  }, [product, selection]);

  const maxQuantity = selectedSku ? Math.min(MAX_EXCHANGE_LINE_QUANTITY, selectedSku.stock ?? MAX_EXCHANGE_LINE_QUANTITY) : 1;
  const variantName =
    product && selectedSku
      ? product.options
          .map((option) => option.values.find((value) => value.id === selection[option.id])?.name)
          .filter(Boolean)
          .join(' / ')
      : '';
  const unavailable = product?.options.flatMap((option) =>
    option.values.filter((value) => !isValueAvailable(option.id, value.id)).map((value) => value.name),
  );

  // Preview the money as if this line were already in the cart.
  const previewTotal = money.cartTotal + (selectedSku ? selectedSku.price * quantity : 0);
  const previewMoney: Money = {
    ...money,
    cartTotal: previewTotal,
    settlement: planExchangeSettlement(money.split.couponAmount, previewTotal),
  };

  return (
    <div className="pad">
      <h1>تفاصيل البديل</h1>
      <p className="lead">اختيار البديل جزء من تفاصيل طلب الاستبدال.</p>
      <StepsBar on={1} />
      <CreditBanner money={money} who={who} />

      {!product && !error && (
        <div className="card tiny" style={{ textAlign: 'center', padding: 40 }}>
          <span className="spin" />
          جارٍ تحميل المنتج...
        </div>
      )}
      {error && (
        <div className="banner">
          <p>{error}</p>
        </div>
      )}

      {product && (
        <>
          <div className="card">
            {product.images.length > 0 && (
              <>
                <div className="gallery">
                  <Image src={product.images[imageIndex]} alt={product.name} fill sizes="(max-width: 760px) 100vw, 700px" />
                </div>
                {product.images.length > 1 && (
                  <div className="thumbs">
                    {product.images.slice(0, 8).map((src, index) => (
                      <button key={src} type="button" className={index === imageIndex ? 'on' : ''} onClick={() => setImageIndex(index)} aria-label={`صورة ${index + 1}`}>
                        <Image src={src} alt="" fill sizes="48px" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            <div style={{ fontSize: 18, fontWeight: 700 }}>{product.name}</div>
            <div style={{ fontSize: 22, color: 'var(--brand)', fontWeight: 800, margin: '6px 0' }}>
              {formatMoney(selectedSku?.price ?? product.price, money.currency)}
            </div>

            {product.options.map((option) => (
              <div key={option.id}>
                <div className="f">اختاري {option.name}</div>
                <div className="sizes">
                  {option.values.map((value) => {
                    const available = isValueAvailable(option.id, value.id);
                    return (
                      <button
                        key={value.id}
                        type="button"
                        className={`${available ? '' : 'off'} ${selection[option.id] === value.id ? 'on' : ''}`}
                        aria-disabled={!available}
                        onClick={() => {
                          if (!available) return;
                          setSelection((previous) => ({ ...previous, [option.id]: value.id }));
                          setQuantity(1);
                        }}
                      >
                        {value.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {unavailable && unavailable.length > 0 && <div className="tiny">الخيارات المشطوبة غير متوفرة حاليًا.</div>}

            <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
              <span>الكمية</span>
              <div className="qty">
                <button type="button" aria-label="زيادة" disabled={quantity >= maxQuantity} onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}>
                  +
                </button>
                <span className="v">{quantity}</span>
                <button type="button" aria-label="إنقاص" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                  −
                </button>
              </div>
            </div>
          </div>

          <CalcBox calc={buildCalc(previewMoney)} currency={money.currency} />
          <div className="tiny" style={{ margin: '-4px 0 12px' }}>
            ستراجعين ملخص الطلب قبل إتمام أي دفع.
          </div>
          <button
            type="button"
            className="btn"
            disabled={!selectedSku || !selectedSku.inStock || cartFull}
            onClick={() =>
              selectedSku &&
              onAdd({
                productId: product.id,
                skuId: selectedSku.id,
                name: product.name,
                variantName,
                imageUrl: product.imageUrl,
                unitPrice: selectedSku.price,
                quantity,
                maxQuantity,
              })
            }
          >
            {cartFull
              ? `الحد الأقصى ${MAX_EXCHANGE_LINES} منتجات`
              : !selectedSku
                ? product.options.length > 0
                  ? `اختاري ${product.options.map((option) => option.name).join(' و')}`
                  : 'غير متوفر حاليًا'
                : 'إضافة البديل ومراجعة الطلب'}
          </button>
        </>
      )}
      <button type="button" className="btn ghost" onClick={onBack}>
        الرجوع إلى البدائل
      </button>
    </div>
  );
}
