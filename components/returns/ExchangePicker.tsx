'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Minus, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAX_EXCHANGE_LINE_QUANTITY, MAX_EXCHANGE_LINES } from '@/lib/returns/exchange-settlement';
import type { CatalogProduct, CatalogProductSummary, CatalogSku } from '@/app/lib/returns/exchange-catalog';

export interface ExchangeCartLine {
  productId: string;
  skuId: string;
  name: string;
  variantName: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  maxQuantity: number;
}

interface ExchangePickerProps {
  merchantId: string;
  cart: ExchangeCartLine[];
  onCartChange: (cart: ExchangeCartLine[]) => void;
  formatMoney: (value: number) => string;
}

export function ExchangePicker({ merchantId, cart, onCartChange, formatMoney }: ExchangePickerProps) {
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState<CatalogProductSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openProductId, setOpenProductId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(keywordInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  useEffect(() => {
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
  }, [merchantId, keyword, page]);

  const addLine = (line: ExchangeCartLine) => {
    const existing = cart.find((entry) => entry.skuId === line.skuId);
    if (existing) {
      onCartChange(
        cart.map((entry) =>
          entry.skuId === line.skuId
            ? { ...entry, quantity: Math.min(entry.quantity + line.quantity, entry.maxQuantity) }
            : entry,
        ),
      );
    } else if (cart.length < MAX_EXCHANGE_LINES) {
      onCartChange([...cart, line]);
    }
    setOpenProductId(null);
  };

  const setQuantity = (skuId: string, quantity: number) =>
    onCartChange(
      cart
        .map((entry) => (entry.skuId === skuId ? { ...entry, quantity: Math.max(0, Math.min(quantity, entry.maxQuantity)) } : entry))
        .filter((entry) => entry.quantity > 0),
    );

  return (
    <div className="space-y-4">
      {/* Cart */}
      {cart.length > 0 && (
        <div className="space-y-2 rounded-xl border border-green-200 bg-green-50/60 p-3">
          <p className="text-sm font-semibold text-green-900">البدائل المختارة</p>
          {cart.map((line) => (
            <div key={line.skuId} className="flex items-center gap-3 rounded-lg bg-white p-2">
              {line.imageUrl ? (
                <Image src={line.imageUrl} alt={line.name} width={48} height={48} className="h-12 w-12 rounded-md object-cover" />
              ) : (
                <div className="h-12 w-12 rounded-md bg-gray-100" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{line.name}</p>
                <p className="text-xs text-gray-600">
                  {line.variantName ? `${line.variantName} · ` : ''}
                  {formatMoney(line.unitPrice)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="إنقاص"
                  className="rounded-md border p-1 hover:bg-gray-50"
                  onClick={() => setQuantity(line.skuId, line.quantity - 1)}
                >
                  {line.quantity === 1 ? <Trash2 className="size-3.5 text-red-600" /> : <Minus className="size-3.5" />}
                </button>
                <span className="w-6 text-center text-sm">{line.quantity}</span>
                <button
                  type="button"
                  aria-label="زيادة"
                  disabled={line.quantity >= line.maxQuantity}
                  className="rounded-md border p-1 hover:bg-gray-50 disabled:opacity-40"
                  onClick={() => setQuantity(line.skuId, line.quantity + 1)}
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        <input
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
          placeholder="ابحثي عن فستان، لون، رقم الموديل..."
          className="w-full rounded-lg border py-2.5 pl-3 pr-9 text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => setOpenProductId(product.id)}
            className="overflow-hidden rounded-xl border text-right transition-shadow hover:shadow-md"
          >
            <div className="relative aspect-[3/4] bg-gray-100">
              {product.imageUrl && (
                <Image src={product.imageUrl} alt={product.name} fill sizes="(max-width: 640px) 50vw, 33vw" className="object-cover" />
              )}
            </div>
            <div className="space-y-0.5 p-2">
              <p className="line-clamp-2 text-xs font-medium text-gray-900">{product.name}</p>
              <p className="text-sm font-semibold">
                {formatMoney(product.price)}
                {product.regularPrice > product.price && (
                  <span className="mr-1 text-xs font-normal text-gray-400 line-through">{formatMoney(product.regularPrice)}</span>
                )}
              </p>
            </div>
          </button>
        ))}
      </div>
      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="size-5 animate-spin text-gray-400" />
        </div>
      )}
      {!loading && products.length === 0 && !error && <p className="text-center text-sm text-gray-500">لا توجد منتجات مطابقة</p>}
      {hasMore && !loading && (
        <Button type="button" variant="outline" className="w-full" onClick={() => setPage((value) => value + 1)}>
          عرض المزيد
        </Button>
      )}

      {openProductId && (
        <ProductSheet
          merchantId={merchantId}
          productId={openProductId}
          onClose={() => setOpenProductId(null)}
          onAdd={addLine}
          formatMoney={formatMoney}
          cartFull={cart.length >= MAX_EXCHANGE_LINES}
        />
      )}
    </div>
  );
}

function ProductSheet({
  merchantId,
  productId,
  onClose,
  onAdd,
  formatMoney,
  cartFull,
}: {
  merchantId: string;
  productId: string;
  onClose: () => void;
  onAdd: (line: ExchangeCartLine) => void;
  formatMoney: (value: number) => string;
  cartFull: boolean;
}) {
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);

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

  /** A value is selectable when some in-stock SKU matches it plus the other chosen values. */
  const isValueAvailable = (optionId: string, valueId: string) =>
    Boolean(
      product?.skus.some(
        (sku) =>
          sku.inStock &&
          sku.optionValueIds.includes(valueId) &&
          Object.entries(selection).every(([otherOption, otherValue]) => otherOption === optionId || sku.optionValueIds.includes(otherValue)),
      ),
    );

  const selectedSku: CatalogSku | null = useMemo(() => {
    if (!product) return null;
    if (product.options.length === 0) return product.skus[0] ?? null;
    if (product.options.some((option) => !selection[option.id])) return null;
    return product.skus.find((sku) => product.options.every((option) => sku.optionValueIds.includes(selection[option.id]))) ?? null;
  }, [product, selection]);

  const maxQuantity = selectedSku ? Math.min(MAX_EXCHANGE_LINE_QUANTITY, selectedSku.stock ?? MAX_EXCHANGE_LINE_QUANTITY) : 1;
  const variantName = product && selectedSku
    ? product.options
        .map((option) => option.values.find((value) => value.id === selection[option.id])?.name)
        .filter(Boolean)
        .join(' / ')
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 sm:max-w-md sm:rounded-2xl" dir="rtl">
        <button type="button" onClick={onClose} aria-label="إغلاق" className="absolute left-3 top-3 rounded-full bg-white/90 p-1.5 shadow">
          <X className="size-4" />
        </button>
        {!product && !error && (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-gray-400" />
          </div>
        )}
        {error && <p className="py-10 text-center text-sm text-red-700">{error}</p>}
        {product && (
          <div className="space-y-4">
            {product.images.length > 0 && (
              <div className="space-y-2">
                <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-gray-100">
                  <Image src={product.images[imageIndex]} alt={product.name} fill sizes="400px" className="object-cover" />
                </div>
                {product.images.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto">
                    {product.images.slice(0, 8).map((src, index) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setImageIndex(index)}
                        className={`relative h-14 w-11 shrink-0 overflow-hidden rounded-md border-2 ${index === imageIndex ? 'border-gray-900' : 'border-transparent'}`}
                      >
                        <Image src={src} alt="" fill sizes="44px" className="object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div>
              <h3 className="font-semibold">{product.name}</h3>
              <p className="text-lg font-bold">{formatMoney(selectedSku?.price ?? product.price)}</p>
            </div>

            {product.options.map((option) => (
              <div key={option.id}>
                <p className="mb-1.5 text-sm font-medium">{option.name}</p>
                <div className="flex flex-wrap gap-2">
                  {option.values.map((value) => {
                    const available = isValueAvailable(option.id, value.id);
                    const active = selection[option.id] === value.id;
                    return (
                      <button
                        key={value.id}
                        type="button"
                        disabled={!available}
                        onClick={() => {
                          setSelection((previous) => ({ ...previous, [option.id]: value.id }));
                          setQuantity(1);
                        }}
                        className={`min-w-11 rounded-lg border-2 px-3 py-1.5 text-sm ${
                          active
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : available
                              ? 'border-gray-200 hover:border-gray-400'
                              : 'cursor-not-allowed border-gray-100 text-gray-300 line-through'
                        }`}
                      >
                        {value.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">الكمية</span>
              <div className="flex items-center gap-1">
                <button type="button" className="rounded-md border p-1.5" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="إنقاص">
                  <Minus className="size-3.5" />
                </button>
                <span className="w-8 text-center">{quantity}</span>
                <button
                  type="button"
                  className="rounded-md border p-1.5 disabled:opacity-40"
                  disabled={quantity >= maxQuantity}
                  onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                  aria-label="زيادة"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>

            <Button
              type="button"
              className="w-full py-5"
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
                    : 'غير متوفر'
                  : 'إضافة كبديل'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
