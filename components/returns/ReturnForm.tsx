'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getEffectiveReturnFee } from '@/lib/returns/fees';
import { getShippingTotal } from '@/lib/returns/shipping';

interface OrderItem {
  id: number;
  name?: string;
  sku?: string;
  thumbnail?: string;
  currency?: string;
  images?: { image?: string }[];
  product?: {
    id: number;
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
  };
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    mobile: string;
    email: string;
  };
  items: OrderItem[];
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
  onSuccess: (result: any) => void;
}

const RETURN_REASONS = [
  { value: 'defective', label: 'معيب / تالف' },
  { value: 'wrong_item', label: 'منتج خاطئ' },
  { value: 'size_issue', label: 'مشكلة في المقاس' },
  { value: 'changed_mind', label: 'تغيير في الرأي' },
  { value: 'other', label: 'أخرى' },
];
const SALE_CATEGORY_NAME = 'التخفيضات';

export default function ReturnForm({ order, merchantId, merchantInfo, onSuccess }: ReturnFormProps) {
  const [type, setType] = useState<'return' | 'exchange'>('return');
  const [reason, setReason] = useState('');
  const [reasonDetails, setReasonDetails] = useState('');
  const [selectedItems, setSelectedItems] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [returnFee, setReturnFee] = useState(0);
  const [itemCategories, setItemCategories] = useState<Record<string, string>>({});
  const shippingTotal = getShippingTotal(order.amounts?.shipping_cost, order.amounts?.shipping_tax);
  const appliedReturnFee = getEffectiveReturnFee(returnFee, shippingTotal);
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
  const discountedItemIds = useMemo(() => {
    const ids = new Set<number>();
    order.items?.forEach((item) => {
      if (getItemDiscountAmount(item) > 0) {
        ids.add(item.id);
      }
    });
    return ids;
  }, [order]);
  const saleCategoryItemIds = useMemo(() => {
    const ids = new Set<number>();
    order.items?.forEach((item) => {
      const productId = String(item.product?.id ?? item.id);
      const categoryName = itemCategories[productId];
      if (categoryName?.trim() === SALE_CATEGORY_NAME) {
        ids.add(item.id);
      }
    });
    return ids;
  }, [order, itemCategories]);

  // Load return fee setting on mount
  useEffect(() => {
    const loadReturnConfig = async () => {
      try {
        const response = await fetch('/api/returns/config');
        if (!response.ok) {
          throw new Error(`Config request failed: ${response.status}`);
        }

        const data = await response.json();
        if (typeof data.returnFee === 'number' && !Number.isNaN(data.returnFee)) {
          setReturnFee(data.returnFee);
        }
      } catch (err) {
        console.error('Failed to load return config:', err);
      }
    };

    loadReturnConfig();
  }, []);

  // Fetch categories for all items
  useEffect(() => {
    const fetchCategories = async () => {
      if (!order.items || order.items.length === 0) return;

      const categories: Record<string, string> = {};
      const productIds = new Set<string>();

      // Get unique product IDs
      order.items.forEach((item: any) => {
        const productId = item.product?.id ?? item.id;
        if (productId) {
          productIds.add(String(productId));
        }
      });

      // Fetch categories for all products
      await Promise.all(
        Array.from(productIds).map(async (productId) => {
          try {
            const response = await fetch(
              `/api/products/category?merchantId=${merchantId}&productId=${productId}`
            );
            if (response.ok) {
              const data = await response.json();
              if (data.category) {
                categories[productId] = data.category;
              }
            }
          } catch (err) {
            console.error(`Failed to fetch category for product ${productId}`, err);
          }
        })
      );

      setItemCategories(categories);
    };

    fetchCategories();
  }, [order, merchantId]);

  const handleItemClick = (itemId: number, maxQuantity: number) => {
    if (type === 'return' && (discountedItemIds.has(itemId) || saleCategoryItemIds.has(itemId))) {
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

    if (reason === 'other' && !reasonDetails.trim()) {
      setError('الرجاء تقديم تفاصيل السبب');
      return;
    }

    if (type === 'return') {
      for (const itemId of selectedItems.keys()) {
        if (discountedItemIds.has(itemId) || saleCategoryItemIds.has(itemId)) {
          setError('لا يمكن إرجاع المنتجات المخفضة أو ضمن فئة التخفيضات. يمكنك فقط طلب استبدال لها.');
          return;
        }
      }
    }

    setLoading(true);

    try {
      const items = Array.from(selectedItems.entries()).map(([itemId, quantity]) => {
        const orderItem = order.items?.find((item) => item.id === itemId);
        if (!orderItem) throw new Error('Item not found');

        // Safely extract product ID with fallbacks
        const productId = orderItem.product?.id ?? orderItem.id ?? itemId;
        const variantId = orderItem.variant?.id;

        // Calculate price: (price without tax + tax) - discount
        const price = calculateItemPrice(orderItem);

        return {
          productId: String(productId),
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
          reasonDetails: reason === 'other' ? reasonDetails : undefined,
          items,
          merchantName: merchantInfo.name,
          merchantPhone: merchantInfo.phone,
          merchantAddress: merchantInfo.address,
          merchantCity: merchantInfo.city,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل إنشاء طلب الإرجاع');
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
            إرجاع
          </button>
          <button
            type="button"
            onClick={() => setType('exchange')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 transition-colors ${
              type === 'exchange'
                ? 'border-blue-600 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            استبدال
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
              const discountAmount = getItemDiscountAmount(item);
              const isDiscounted = discountAmount > 0;
              const productId = String(item.product?.id ?? item.id);
              const category = itemCategories[productId];
              const isSaleCategory = category?.trim() === SALE_CATEGORY_NAME || saleCategoryItemIds.has(item.id);
              const isNonReturnable = isDiscounted || isSaleCategory;
              const isReturnBlocked = type === 'return' && isNonReturnable;

              // Debug: log the full structure on first render
              if (index === 0 && typeof window !== 'undefined') {
                console.log('Full order item:', item);
                console.log('Item keys:', Object.keys(item));
                console.log('Full order object:', order);
                console.log('Order amounts:', order.amounts);
              }

              // Calculate price: (price without tax + tax) - discount
              const itemPrice = calculateItemPrice(item);

              return (
                <button
                  key={`item-${item.id}-${index}`}
                  type="button"
                  onClick={() => handleItemClick(item.id, maxQuantity)}
                  disabled={isReturnBlocked}
                  className={`relative flex items-start gap-4 p-4 border-2 rounded-lg text-right transition-all hover:shadow-md ${
                    isReturnBlocked
                      ? 'border-gray-200 bg-gray-100 opacity-60 cursor-not-allowed'
                      : isSelected
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* Product Image */}
                  {(item.images?.[0]?.image || item.product?.thumbnail || item.thumbnail) ? (
                    <img
                      src={item.images?.[0]?.image || item.product?.thumbnail || item.thumbnail}
                      alt={item.name || item.product?.name || 'Product'}
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
                    {item.variant?.name && (
                      <p className="text-sm text-gray-600 mb-1">{item.variant.name}</p>
                    )}
                    <p className="text-sm text-gray-600 mb-2">
                      السعر: {Number(itemPrice).toFixed(2)} {item.currency || order.amounts?.total?.currency || 'SAR'}
                    </p>
                    {isDiscounted && (
                      <p className="text-xs text-red-600 font-medium">
                        هذا المنتج مخفض ولا يمكن إرجاعه ويمكن فقط استبداله
                      </p>
                    )}
                    {isSaleCategory && (
                      <p className="text-xs text-red-600 font-medium">
                        هذا المنتج ضمن فئة التخفيضات ولا يمكن إرجاعه ويمكن فقط استبداله
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

              const applicableFee = appliedReturnFee;
              const finalRefund = Math.max(0, itemsTotal - applicableFee);

              return (
                <>
                  <div className="flex justify-between text-sm">
                    <span>إجمالي المنتجات:</span>
                    <span className="font-medium">{itemsTotal.toFixed(2)} ر.س</span>
                  </div>

                  {shippingTotal > 0 && (
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>تكلفة الشحن الأصلية (غير قابلة للاسترداد):</span>
                      <span>-{shippingTotal.toFixed(2)} ر.س</span>
                    </div>
                  )}

                  {applicableFee > 0 && (
                    <div className="flex justify-between text-sm text-red-600">
                      <span>رسوم معالجة الإرجاع:</span>
                      <span>-{applicableFee.toFixed(2)} ر.س</span>
                    </div>
                  )}

                  <div className="border-t pt-3 mt-3">
                    <div className="flex justify-between text-lg font-bold">
                      <span>المبلغ المسترد:</span>
                      <span className="text-green-600">{finalRefund.toFixed(2)} ر.س</span>
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

          {reason === 'other' && (
            <textarea
              value={reasonDetails}
              onChange={(e) => setReasonDetails(e.target.value)}
              placeholder="الرجاء كتابة السبب..."
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
        disabled={loading}
        className="w-full py-6 text-lg"
      >
        {loading ? 'جاري المعالجة...' : `إرسال طلب ${type === 'return' ? 'الإرجاع' : 'الاستبدال'}`}
      </Button>
    </form>
  );
}
