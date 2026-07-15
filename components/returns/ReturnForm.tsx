'use client';

import Image from 'next/image';
import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  buildReturnFeeQuote,
  getOriginalShippingFee,
  getOrderOptionsTotal,
  type ReturnFeeQuote,
} from '@/lib/returns/fees';
import { getItemAttributes } from '@/lib/returns/item-attributes';
import { isDiscountedCategory, isOutletCategory } from '@/lib/returns/categories';

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
    product_id?: number | string;
    productId?: number | string;
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
    price: {
      amount: number;
    };
    total: {
      amount: number;
    };
    price_without_tax?: {
      amount: number;
    };
    tax?: {
      amount?: {
        amount: number;
      };
    };
    total_discount?: {
      amount: number;
    };
  };
}

interface Order {
  id: number;
  reference_id: string;
  status: {
    name: string;
    slug: string;
  } | string;
  amounts: {
    total: {
      amount: number;
      currency: string;
    };
    shipping_cost?: {
      amount: number;
      taxable?: boolean;
      currency?: string;
    };
    shipping_tax?: {
      amount?: number;
      currency?: string;
    };
    options_total?: {
      amount: number;
      currency?: string;
    };
  };
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    mobile: string;
    email: string;
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
  onSuccess: (result: any) => void;
}

const RETURN_REASONS = [
  { value: 'defective', label: 'معيب / تالف' },
  { value: 'wrong_item', label: 'منتج خاطئ' },
  { value: 'size_issue', label: 'مشكلة في المقاس' },
  { value: 'changed_mind', label: 'تغيير في الرأي' },
  { value: 'other', label: 'أخرى' },
];
const PRODUCT_OBJECT_ID_KEYS = ['id', 'product_id', 'productId', 'productID'] as const;
const PRODUCT_ID_PROPERTY_KEYS = ['product_id', 'productId', 'productID'] as const;

const normalizeProductIdentifier = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  const str = String(value).trim();
  return str || null;
};

const extractProductIdFromObject = (source?: Record<string, unknown> | null): string | null => {
  if (!source) {
    return null;
  }
  for (const key of PRODUCT_OBJECT_ID_KEYS) {
    const normalized = normalizeProductIdentifier(source[key]);
    if (normalized) {
      return normalized;
    }
  }
  return null;
};

const getOrderItemProductId = (item?: OrderItem | null): string | null => {
  if (!item) {
    return null;
  }

  const fromProduct = extractProductIdFromObject(item.product as Record<string, unknown> | undefined);
  if (fromProduct) {
    return fromProduct;
  }

  const itemRecord = item as unknown as Record<string, unknown>;
  for (const key of PRODUCT_ID_PROPERTY_KEYS) {
    const normalized = normalizeProductIdentifier(itemRecord[key]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const getOrderItemProductIdWithFallback = (item: OrderItem, fallback?: number | string): string => {
  const resolved = getOrderItemProductId(item);
  if (resolved) {
    return resolved;
  }

  const fallbackValue = normalizeProductIdentifier(fallback ?? item.id);
  return fallbackValue ?? String(item.id);
};

export default function ReturnForm({ order, merchantId, merchantInfo, windowExpiredProductIds, onSuccess }: ReturnFormProps) {
  const [type, setType] = useState<'return' | 'exchange'>('return');
  const [reason, setReason] = useState('');
  const [reasonDetails, setReasonDetails] = useState('');
  const [selectedItems, setSelectedItems] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [itemCategories, setItemCategories] = useState<Record<string, string>>({});
  const [discountedCategoryProducts, setDiscountedCategoryProducts] = useState<Record<string, boolean>>({});
  const [outletCategoryProducts, setOutletCategoryProducts] = useState<Record<string, boolean>>({});
  const orderCurrency = order.returnFeeQuotes?.return?.currency || order.amounts?.total?.currency || 'SAR';
  const fallbackReturnQuote = buildReturnFeeQuote('return', orderCurrency, 1, 'sar');
  const fallbackExchangeQuote = buildReturnFeeQuote('exchange', orderCurrency, 1, 'sar');
  const returnQuote = order.returnFeeQuotes?.return ?? fallbackReturnQuote;
  const exchangeQuote = order.returnFeeQuotes?.exchange ?? fallbackExchangeQuote;
  const activeQuote = type === 'exchange' ? exchangeQuote : returnQuote;
  // Paid order options such as packaging are shown in the customer-paid total,
  // then deducted as non-refundable alongside the two shipment-leg fees.
  const originalShippingFee = getOriginalShippingFee(order.amounts);
  const orderOptionsTotal = getOrderOptionsTotal(order.options);
  const shipmentLegFee = activeQuote.shipmentLegFee;
  const appliedProcessingFee = activeQuote.processingFee;
  const returnTypeFee = returnQuote.processingFee;
  const exchangeTypeFee = exchangeQuote.processingFee;
  const exchangeSavings = returnTypeFee - exchangeTypeFee;
  const formatMoney = (value: number, currency = orderCurrency) => {
    const normalizedCurrency = currency.trim().toUpperCase() || 'SAR';
    const suffix = normalizedCurrency === 'SAR' ? 'ر.س' : normalizedCurrency;
    return `${value.toFixed(2)} ${suffix}`;
  };
  const formatFeeQuote = (value: number, quote: ReturnFeeQuote, sarEquivalent?: number) => {
    const formatted = formatMoney(value, quote.currency);
    if (quote.currency === 'SAR') {
      return formatted;
    }
    const equivalent = sarEquivalent ?? quote.processingFeeSar;
    return `${formatted} (يعادل ${equivalent.toFixed(2)} ر.س)`;
  };
  const getNumericValue = (value: unknown): number => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };
  const getItemDiscountAmount = (item?: OrderItem) =>
    item ? getNumericValue(item.amounts?.total_discount?.amount) : 0;
  const calculateItemPrice = (item?: OrderItem) => {
    if (!item) return 0;
    const priceWithoutTax = getNumericValue(item.amounts?.price_without_tax?.amount);
    const taxAmount = getNumericValue(item.amounts?.tax?.amount?.amount);
    const discountAmount = getItemDiscountAmount(item);
    return priceWithoutTax + taxAmount - discountAmount;
  };
  const discountedCategoryItemIds = useMemo(() => {
    const ids = new Set<number>();
    order.items?.forEach((item) => {
      const productId = getOrderItemProductId(item);
      if (!productId) {
        return;
      }
      const categoryName = itemCategories[productId];
      const isDiscountedProduct =
        discountedCategoryProducts[productId] || isDiscountedCategory(categoryName);
      if (isDiscountedProduct) {
        ids.add(item.id);
      }
    });
    return ids;
  }, [order, itemCategories, discountedCategoryProducts]);
  const outletCategoryItemIds = useMemo(() => {
    const ids = new Set<number>();
    order.items?.forEach((item) => {
      const productId = getOrderItemProductId(item);
      if (!productId) {
        return;
      }
      const categoryName = itemCategories[productId];
      const isOutletProduct = outletCategoryProducts[productId] || isOutletCategory(categoryName);
      if (isOutletProduct) {
        ids.add(item.id);
      }
    });
    return ids;
  }, [order, itemCategories, outletCategoryProducts]);
  // Items whose own return window has already expired (e.g. evening dresses past 24h while the
  // rest of the order is still within the 3-day window). Computed server-side in /api/returns/check.
  const windowExpiredItemIds = useMemo(() => {
    const expiredProductIds = new Set(windowExpiredProductIds ?? []);
    const ids = new Set<number>();
    if (expiredProductIds.size === 0) {
      return ids;
    }
    order.items?.forEach((item) => {
      const productId = getOrderItemProductId(item);
      if (productId && expiredProductIds.has(productId)) {
        ids.add(item.id);
      }
    });
    return ids;
  }, [order, windowExpiredProductIds]);

  // Fetch categories for all items
  useEffect(() => {
    const fetchCategories = async () => {
      if (!order.items || order.items.length === 0) {
        setItemCategories({});
        setDiscountedCategoryProducts({});
        setOutletCategoryProducts({});
        return;
      }

      const categories: Record<string, string> = {};
      const discountedCategories: Record<string, boolean> = {};
      const outletCategories: Record<string, boolean> = {};
      const productIds = new Set<string>();

      // Get unique product IDs
      order.items.forEach((item: OrderItem) => {
        const productId = getOrderItemProductId(item);
        if (productId) {
          productIds.add(productId);
        }
      });

      if (productIds.size === 0) {
        setItemCategories({});
        setDiscountedCategoryProducts({});
        setOutletCategoryProducts({});
        return;
      }

      // Fetch categories for all products
      await Promise.all(
        Array.from(productIds).map(async (productId) => {
          try {
            const response = await fetch(
              `/api/products/category?merchantId=${merchantId}&productId=${productId}`
            );
            if (response.ok) {
              const data = await response.json();
              const availableCategories: string[] = [];
              if (Array.isArray(data.categories)) {
                for (const categoryEntry of data.categories) {
                  if (categoryEntry?.name && typeof categoryEntry.name === 'string') {
                    const normalized = categoryEntry.name.trim();
                    if (normalized) {
                      availableCategories.push(normalized);
                    }
                  }
                }
              }
              if (data.category && typeof data.category === 'string') {
                const normalizedCategory = data.category.trim();
                if (normalizedCategory && !availableCategories.includes(normalizedCategory)) {
                  availableCategories.push(normalizedCategory);
                }
              }
              const hasDiscountedCategory = availableCategories.some(isDiscountedCategory);
              if (hasDiscountedCategory) {
                discountedCategories[productId] = true;
              }
              const hasOutletCategory = availableCategories.some(isOutletCategory);
              if (hasOutletCategory) {
                outletCategories[productId] = true;
              }
              if (data.category && typeof data.category === 'string') {
                const normalizedCategory = data.category.trim();
                if (normalizedCategory) {
                  categories[productId] = normalizedCategory;
                }
              } else if (availableCategories[0]) {
                categories[productId] = availableCategories[0];
              }
            }
          } catch (err) {
            console.error(`Failed to fetch category for product ${productId}`, err);
          }
        })
      );

      setItemCategories(categories);
      setDiscountedCategoryProducts(discountedCategories);
      setOutletCategoryProducts(outletCategories);
    };

    fetchCategories();
  }, [order, merchantId]);

  useEffect(() => {
    if (type !== 'return' || selectedItems.size === 0) {
      return;
    }
    const nextSelectedItems = new Map(selectedItems);
    let changed = false;
    for (const itemId of selectedItems.keys()) {
      if (outletCategoryItemIds.has(itemId)) {
        nextSelectedItems.delete(itemId);
        changed = true;
      }
    }
    if (changed) {
      setSelectedItems(nextSelectedItems);
    }
  }, [type, selectedItems, outletCategoryItemIds]);

  const handleItemClick = (itemId: number, maxQuantity: number) => {
    if (
      discountedCategoryItemIds.has(itemId) ||
      windowExpiredItemIds.has(itemId) ||
      (type === 'return' && outletCategoryItemIds.has(itemId))
    ) {
      return;
    }
    const newSelectedItems = new Map(selectedItems);
    const currentQuantity = selectedItems.get(itemId) || 0;

    if (currentQuantity === 0) {
      // If not selected, select with quantity 1
      newSelectedItems.set(itemId, 1);
    } else if (currentQuantity < maxQuantity) {
      // If selected but not at max, increment
      newSelectedItems.set(itemId, currentQuantity + 1);
    } else {
      // If at max quantity, deselect
      newSelectedItems.delete(itemId);
    }
    setSelectedItems(newSelectedItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (selectedItems.size === 0) {
      setError('الرجاء اختيار منتج واحد على الأقل');
      return;
    }

    if (!reason) {
      setError('الرجاء اختيار سبب الإرجاع');
      return;
    }

    if ((reason === 'other' || reason === 'defective' || reason === 'wrong_item') && !reasonDetails.trim()) {
      setError('الرجاء تقديم تفاصيل السبب');
      return;
    }

    if (order.returnFeeQuoteError) {
      setError(order.returnFeeQuoteError);
      return;
    }

    for (const itemId of selectedItems.keys()) {
      if (discountedCategoryItemIds.has(itemId)) {
        setError('لا يمكن إرجاع أو استبدال المنتجات ضمن فئات التخفيضات.');
        return;
      }
      if (windowExpiredItemIds.has(itemId)) {
        setError('انتهت مدة إرجاع فساتين السهرة (24 ساعة من وقت التسليم).');
        return;
      }
      if (type === 'return' && outletCategoryItemIds.has(itemId)) {
        setError('منتجات اوتليت مليحة متاحة للاستبدال فقط.');
        return;
      }
    }

    setLoading(true);

    try {
      const items = Array.from(selectedItems.entries()).map(([itemId, quantity]) => {
        const orderItem = order.items?.find((item) => item.id === itemId);
        if (!orderItem) throw new Error('Item not found');

        // Safely extract product ID with fallbacks
        const productId = getOrderItemProductIdWithFallback(orderItem, itemId);
        const variantId = orderItem.variant?.id;

        // Calculate price: (price without tax + tax) - discount
        const price = calculateItemPrice(orderItem);

        return {
          productId,
          productName: orderItem.name || orderItem.product?.name || 'منتج',
          productSku: orderItem.sku || orderItem.product?.sku,
          variantId: variantId ? String(variantId) : undefined,
          variantName: orderItem.variant?.name,
          quantity,
          price: Number(price) || 0,
        };
      });

      const response = await fetch('/api/returns/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          merchantId,
          orderId: order.id.toString(),
          type,
          reason,
          reasonDetails: (reason === 'other' || reason === 'defective' || reason === 'wrong_item') ? reasonDetails : undefined,
          items,
          merchantName: merchantInfo.name,
          merchantPhone: merchantInfo.phone,
          merchantAddress: merchantInfo.address,
          merchantCity: merchantInfo.city,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'فشل إنشاء طلب الإرجاع');
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
      {/* Order Info */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">معلومات الطلب</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">رقم الطلب:</span>
            <span className="font-medium">{order.reference_id || order.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">حالة الطلب:</span>
            <span className="font-medium">
              {typeof order.status === 'string' ? order.status : (order.status?.name || order.status?.slug)}
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

      {/* Return Type */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">نوع الطلب</h3>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setType('return')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 transition-colors ${
              type === 'return'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className="block font-medium">إرجاع</span>
            <span className="block text-xs text-gray-500 mt-1">
              رسوم {formatFeeQuote(returnTypeFee, returnQuote, returnQuote.processingFeeSar)}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setType('exchange')}
            className={`relative flex-1 py-3 px-4 rounded-lg border-2 transition-colors ${
              type === 'exchange'
                ? 'border-green-600 bg-green-50 text-green-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">
              وفّر {formatMoney(exchangeSavings)} + شحن مجاني
            </span>
            <span className="block font-medium">استبدال</span>
            <span className="block text-xs text-gray-500 mt-1">
              رسوم {formatFeeQuote(exchangeTypeFee, exchangeQuote, exchangeQuote.processingFeeSar)} فقط
            </span>
          </button>
        </div>
      </Card>

      {/* Select Items */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">اختر المنتجات</h3>
        <p className="text-sm text-gray-600 mb-4">انقر على المنتج لتحديده. انقر مرة أخرى لزيادة الكمية أو إلغاء التحديد.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {order.items && order.items.length > 0 ? (
            order.items.map((item: OrderItem, index: number) => {
              const selectedQuantity = selectedItems.get(item.id) || 0;
              const isSelected = selectedQuantity > 0;
              const maxQuantity = item.quantity || 1;
              const productIdForCategory = getOrderItemProductId(item);
              const category = productIdForCategory ? itemCategories[productIdForCategory] : undefined;
              const isDiscountedProduct = productIdForCategory
                ? discountedCategoryProducts[productIdForCategory]
                : false;
              const isOutletProduct = productIdForCategory
                ? outletCategoryProducts[productIdForCategory]
                : false;
              const isDiscountedCategoryItem =
                isDiscountedProduct || isDiscountedCategory(category) || discountedCategoryItemIds.has(item.id);
              const isOutletCategoryItem =
                isOutletProduct || isOutletCategory(category) || outletCategoryItemIds.has(item.id);
              const isExchangeOnlyUnavailable = type === 'return' && isOutletCategoryItem;
              const isWindowExpiredItem = windowExpiredItemIds.has(item.id);
              const isItemDisabled =
                isDiscountedCategoryItem || isExchangeOnlyUnavailable || isWindowExpiredItem;
              const { color, size } = getItemAttributes(item);
              const imageSrc = item.images?.[0]?.image || item.product?.thumbnail || item.thumbnail;

              // Calculate price: (price without tax + tax) - discount
              const itemPrice = calculateItemPrice(item);

              return (
	                <button
	                  key={`item-${item.id}-${index}`}
	                  type="button"
	                  onClick={() => handleItemClick(item.id, maxQuantity)}
	                  disabled={isItemDisabled}
	                  className={`relative flex items-start gap-4 p-4 border-2 rounded-lg text-right transition-all hover:shadow-md ${
	                    isItemDisabled
	                      ? 'border-gray-200 bg-gray-100 opacity-60 cursor-not-allowed'
	                      : isSelected
	                      ? 'border-blue-600 bg-blue-50'
	                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* Product Image */}
                  {imageSrc ? (
                    <Image
                      src={imageSrc}
                      alt={item.name || item.product?.name || 'Product'}
                      width={80}
                      height={80}
                      sizes="80px"
                      className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
                    />
                  ) : (
                    <div className="w-20 h-20 bg-gray-200 rounded-lg flex-shrink-0 flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                    </div>
                  )}

                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 mb-1 line-clamp-2">
                      {item.name || item.product?.name || 'منتج'}
                    </h4>
                    {category && (
                      <div className="mb-2">
                        <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-md">
                          {category}
                        </span>
                      </div>
                    )}
                    {item.sku && (
                      <p className="text-xs text-gray-500 mb-1">SKU: {item.sku}</p>
                    )}
                    {(color || size) && (
                      <div className="flex flex-wrap gap-2 mb-2 text-xs text-gray-600">
                        {color && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-3 py-1 text-purple-800">
                            <span className="text-gray-500">اللون:</span>
                            <span className="font-medium text-gray-900">{color}</span>
                          </span>
                        )}
                        {size && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">
                            <span className="text-gray-500">المقاس:</span>
                            <span className="font-medium text-gray-900">{size}</span>
                          </span>
                        )}
                      </div>
                    )}
                    {item.variant?.name && (
                      <p className="text-sm text-gray-600 mb-1">{item.variant.name}</p>
                    )}
	                    <p className="text-sm text-gray-600 mb-2">
	                      السعر: {formatMoney(Number(itemPrice), item.currency || orderCurrency)}
	                    </p>
	                    {isDiscountedCategoryItem && (
	                      <p className="text-xs text-red-600 font-medium">
	                        هذا المنتج ضمن فئات التخفيضات ولا يمكن إرجاعه أو استبداله
	                      </p>
	                    )}
                    {isExchangeOnlyUnavailable && (
                      <p className="text-xs text-amber-700 font-medium">
                        هذا المنتج متاح للاستبدال فقط
                      </p>
                    )}
                    {isWindowExpiredItem && (
                      <p className="text-xs text-red-600 font-medium">
                        انتهت مدة إرجاع فساتين السهرة (24 ساعة من وقت التسليم)
                      </p>
                    )}
                    <p className="text-xs text-gray-500">
                      الكمية المتوفرة: {maxQuantity}
                    </p>
                  </div>

                  {/* Selection Badge */}
                  {isSelected && (
                    <div className="absolute top-2 left-2 bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm shadow-lg">
                      {selectedQuantity}
                    </div>
                  )}
                </button>
              );
            })
          ) : (
            <p className="text-center text-gray-500 col-span-full">لا توجد منتجات في هذا الطلب</p>
          )}
        </div>
      </Card>

      {order.returnFeeQuoteError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {order.returnFeeQuoteError}
        </div>
      )}

      {/* Financial Summary */}
      {selectedItems.size > 0 && (
        <Card className="p-6 bg-blue-50 border-blue-200">
          <h3 className="text-lg font-semibold mb-4">ملخص المبلغ المسترد</h3>
          <div className="space-y-3">
            {(() => {
              const itemsTotal = Array.from(selectedItems.entries()).reduce((sum, [itemId, quantity]) => {
                const item = order.items?.find((i) => i.id === itemId);
                if (!item) return sum;

                const itemPrice = calculateItemPrice(item);

                return sum + (itemPrice * quantity);
              }, 0);

              const orderTotal = itemsTotal + originalShippingFee + orderOptionsTotal;
              const finalRefund = Math.max(
                0,
                orderTotal - orderOptionsTotal - appliedProcessingFee,
              );
              const isExchange = type === 'exchange';
              const returnLegLabel = isExchange ? 'رسوم شحنة الاستبدال:' : 'رسوم شحنة الاسترجاع:';

              return (
                <>
                  <div className="flex justify-between text-sm">
                    <span>إجمالي المنتجات:</span>
                    <span className="font-medium">{formatMoney(itemsTotal)}</span>
                  </div>

                  {originalShippingFee > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>شحن الطلب الأصلي (شامل الضريبة):</span>
                      <span className="font-medium">{formatMoney(originalShippingFee)}</span>
                    </div>
                  )}

                  {orderOptionsTotal > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>خيارات الطلب المدفوعة (شامل الضريبة):</span>
                      <span className="font-medium">{formatMoney(orderOptionsTotal)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-sm border-t pt-3">
                    <span className="font-medium">الإجمالي:</span>
                    <span className="font-semibold">{formatMoney(orderTotal)}</span>
                  </div>

                  {orderOptionsTotal > 0 && (
                    <div className="flex justify-between text-sm text-red-600">
                      <span>خيارات الطلب غير المستردة (مثل التغليف):</span>
                      <span>-{formatMoney(orderOptionsTotal)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-sm text-red-600">
                    <span>رسوم الشحنة الأساسية:</span>
                    <span>-{formatFeeQuote(shipmentLegFee, activeQuote, activeQuote.shipmentLegFeeSar)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-red-600">
                    <span>{returnLegLabel}</span>
                    <span>
                      -{formatFeeQuote(
                        activeQuote.returnShipmentFee,
                        activeQuote,
                        activeQuote.shipmentLegFeeSar,
                      )}
                    </span>
                  </div>

                  {isExchange && (
                    <p className="text-xs text-green-700 bg-green-50 rounded-md px-2 py-1">
                      كوبون الاستبدال يمنحك شحن مجاني للطلب الجديد 🎁
                    </p>
                  )}

                  <div className="border-t pt-3 mt-3">
                    <div className="flex justify-between text-lg font-bold">
                      <span>{isExchange ? 'قيمة كوبون الاستبدال:' : 'المبلغ المسترد:'}</span>
                      <span className="text-green-600">{formatMoney(finalRefund)}</span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </Card>
      )}

      {/* Reason */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">سبب {type === 'return' ? 'الإرجاع' : 'الاستبدال'}</h3>
        <div className="space-y-4">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-4 py-3 border rounded-lg"
            required
          >
            <option value="">اختر السبب...</option>
            {RETURN_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          {(reason === 'other' || reason === 'defective' || reason === 'wrong_item') && (
            <textarea
              value={reasonDetails}
              onChange={(e) => setReasonDetails(e.target.value)}
              placeholder={
                reason === 'defective'
                  ? 'الرجاء وصف العيب أو التلف بالتفصيل...'
                  : reason === 'wrong_item'
                    ? 'الرجاء توضيح المنتج الذي تم استلامه بدلاً من المطلوب...'
                    : 'الرجاء كتابة السبب...'
              }
              className="w-full px-4 py-3 border rounded-lg resize-none"
              rows={4}
              required
            />
          )}
        </div>
      </Card>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={loading || Boolean(order.returnFeeQuoteError)}
        className="w-full py-6 text-lg"
      >
        {loading ? 'جاري المعالجة...' : `إرسال طلب ${type === 'return' ? 'الإرجاع' : 'الاستبدال'}`}
      </Button>
    </form>
  );
}
