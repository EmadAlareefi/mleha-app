'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface OrderItem {
  id: number;
  product: {
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
  amounts: {
    price: {
      amount: number;
    };
    total: {
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
  };
  amounts: {
    total: {
      amount: number;
      currency: string;
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

export default function ReturnForm({ order, merchantId, merchantInfo, onSuccess }: ReturnFormProps) {
  const [type, setType] = useState<'return' | 'exchange'>('return');
  const [reason, setReason] = useState('');
  const [reasonDetails, setReasonDetails] = useState('');
  const [selectedItems, setSelectedItems] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleItemQuantityChange = (itemId: number, quantity: number) => {
    const newSelectedItems = new Map(selectedItems);
    if (quantity > 0) {
      newSelectedItems.set(itemId, quantity);
    } else {
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

    setLoading(true);

    try {
      const items = Array.from(selectedItems.entries()).map(([itemId, quantity]) => {
        const orderItem = order.items?.find((item: any) => item.id === itemId);
        if (!orderItem) throw new Error('Item not found');

        return {
          productId: (orderItem.product?.id || orderItem.id || itemId).toString(),
          productName: orderItem.product?.name || orderItem.name || 'منتج',
          productSku: orderItem.product?.sku || orderItem.sku,
          variantId: orderItem.variant?.id?.toString(),
          variantName: orderItem.variant?.name,
          quantity,
          price: orderItem.amounts?.price?.amount || orderItem.price || 0,
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
            <span className="font-medium">{order.status?.name || order.status?.slug || order.status}</span>
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
        <div className="space-y-4">
          {order.items?.map((item: any) => (
            <div key={item.id} className="flex items-center gap-4 p-4 border rounded-lg">
              {item.product?.thumbnail && (
                <img
                  src={item.product.thumbnail}
                  alt={item.product?.name || 'Product'}
                  className="w-16 h-16 object-cover rounded"
                />
              )}
              <div className="flex-1">
                <h4 className="font-medium">{item.product?.name || item.name || 'منتج'}</h4>
                {item.variant?.name && (
                  <p className="text-sm text-gray-600">{item.variant.name}</p>
                )}
                <p className="text-sm text-gray-600">
                  السعر: {item.amounts?.price?.amount || item.price || 0} {order.amounts?.total?.currency || 'SAR'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">الكمية:</label>
                <input
                  type="number"
                  min="0"
                  max={item.quantity || 1}
                  value={selectedItems.get(item.id) || 0}
                  onChange={(e) => handleItemQuantityChange(item.id, parseInt(e.target.value) || 0)}
                  className="w-20 px-3 py-2 border rounded-md"
                />
                <span className="text-sm text-gray-500">من {item.quantity || 1}</span>
              </div>
            </div>
          )) || (
            <p className="text-center text-gray-500">لا توجد منتجات في هذا الطلب</p>
          )}
        </div>
      </Card>

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
