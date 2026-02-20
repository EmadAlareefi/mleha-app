'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorDialog } from '@/components/ui/error-dialog';
import ReturnForm from '@/components/returns/ReturnForm';
import SuccessScreen from '@/components/returns/SuccessScreen';
import { getItemAttributes } from '@/lib/returns/item-attributes';

// Configuration - Replace with your actual merchant info
const MERCHANT_CONFIG = {
  merchantId: process.env.NEXT_PUBLIC_MERCHANT_ID || '1234509876', // Replace with actual merchant ID
  name: process.env.NEXT_PUBLIC_MERCHANT_NAME || 'متجر سلة',
  phone: process.env.NEXT_PUBLIC_MERCHANT_PHONE || '0501234567',
  address: process.env.NEXT_PUBLIC_MERCHANT_ADDRESS || 'شارع الملك فهد، الرياض',
  city: process.env.NEXT_PUBLIC_MERCHANT_CITY || 'الرياض',
};

type Step = 'lookup' | 'existing' | 'form' | 'success';

const DATE_OBJECT_KEYS = ['date', 'datetime', 'value', 'timestamp'] as const;

const isNumericLike = (value: string) => /^-?\d+(\.\d+)?$/.test(value);

const timestampToIso = (timestamp: number): string | undefined => {
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  const normalized = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const normalizeOrderDate = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (isNumericLike(trimmed)) {
      return timestampToIso(Number(trimmed));
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    if (trimmed.includes(' ')) {
      const isoCandidate = trimmed.replace(' ', 'T');
      const fallback = new Date(isoCandidate);
      if (!Number.isNaN(fallback.getTime())) {
        return fallback.toISOString();
      }
    }

    return undefined;
  }

  if (typeof value === 'number') {
    return timestampToIso(value);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }

  if (typeof value === 'object') {
    for (const key of DATE_OBJECT_KEYS) {
      const nestedValue = (value as Record<string, unknown>)[key];
      const normalized = normalizeOrderDate(nestedValue);
      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
};

const SAUDI_COUNTRY_CODES = new Set(['SA', 'SAU', 'KSA']);
const SAUDI_COUNTRY_KEYWORDS_EN = [
  'saudi',
  'saudi arabia',
  'kingdom of saudi arabia',
  'ksa',
];
const SAUDI_COUNTRY_KEYWORDS_AR = [
  'السعودية',
  'السعوديه',
  'المملكة العربية السعودية',
  'المملكه العربيه السعوديه',
];
const COUNTRY_FIELD_KEYS = [
  'country',
  'country_code',
  'countryCode',
  'country_en',
  'country_ar',
  'countryArabic',
  'countryEnglish',
  'country_name',
  'countryName',
  'countryNameEn',
  'countryNameAr',
];

const normalizeCountryString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const str = String(value).trim();
  return str || undefined;
};

const isSaudiCountryValue = (value: unknown): boolean => {
  const str = normalizeCountryString(value);
  if (!str) {
    return false;
  }

  const lettersOnly = str.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (lettersOnly && SAUDI_COUNTRY_CODES.has(lettersOnly)) {
    return true;
  }

  const lower = str.toLowerCase();
  if (SAUDI_COUNTRY_KEYWORDS_EN.some(keyword => lower.includes(keyword))) {
    return true;
  }

  const arabicOnly = str.replace(/[^ء-ي]/g, '');
  if (arabicOnly && SAUDI_COUNTRY_KEYWORDS_AR.some(keyword => arabicOnly.includes(keyword.replace(/\s+/g, '')))) {
    return true;
  }

  return false;
};

const collectCountryCandidates = (source: unknown): string[] => {
  if (!source || typeof source !== 'object') {
    return [];
  }
  const candidates: string[] = [];
  for (const key of COUNTRY_FIELD_KEYS) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) {
      candidates.push(value);
    }
  }
  return candidates;
};

const isInternationalOrder = (order: any): boolean => {
  if (!order || typeof order !== 'object') {
    return false;
  }

  const addressCandidates: string[] = [
    ...collectCountryCandidates(order.shipping_address),
    ...collectCountryCandidates(order.shipping?.pickup_address),
    ...collectCountryCandidates(order.shipping),
    ...collectCountryCandidates(order.billing_address),
  ];

  const fallbackCandidates: string[] = [];
  if (order.customer && typeof order.customer === 'object') {
    fallbackCandidates.push(
      order.customer.country,
      order.customer.country_en,
      order.customer.country_ar,
    );
  }

  const candidateValues = addressCandidates.length > 0 ? addressCandidates : fallbackCandidates;

  for (const candidate of candidateValues) {
    if (!candidate) {
      continue;
    }

    if (isSaudiCountryValue(candidate)) {
      return false;
    }

    const normalized = normalizeCountryString(candidate);
    if (normalized) {
      return true;
    }
  }

  return false;
};

const normalizeStatusString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const isDeliveredStatus = (status: unknown): boolean => {
  if (!status) {
    return false;
  }

  const candidates: string[] = [];
  if (typeof status === 'string') {
    candidates.push(status);
  } else if (typeof status === 'object' && status !== null) {
    const statusRecord = status as Record<string, unknown>;
    if (typeof statusRecord.name === 'string') {
      candidates.push(statusRecord.name);
    }
    if (typeof statusRecord.slug === 'string') {
      candidates.push(statusRecord.slug);
    }
    if (typeof statusRecord.status === 'string') {
      candidates.push(statusRecord.status);
    }
  }

  return candidates.some(candidate => {
    const normalized = normalizeStatusString(candidate);
    if (!normalized) {
      return false;
    }
    const lower = normalized.toLowerCase();
    return normalized === 'تم التوصيل' || lower === 'delivered';
  });
};

const getOrderStatusLabel = (status: unknown): string | undefined => {
  if (typeof status === 'string') {
    return normalizeStatusString(status);
  }
  if (status && typeof status === 'object') {
    const statusRecord = status as Record<string, unknown>;
    const name = normalizeStatusString(statusRecord.name);
    if (name) {
      return name;
    }
    const slug = normalizeStatusString(statusRecord.slug);
    if (slug) {
      return slug;
    }
  }
  return undefined;
};

export default function ReturnsPage() {
  const [step, setStep] = useState<Step>('lookup');
  const [orderNumber, setOrderNumber] = useState('');
  const [order, setOrder] = useState<any>(null);
  const [returnRequest, setReturnRequest] = useState<any>(null);
  const [existingReturns, setExistingReturns] = useState<any[]>([]);
  const [canCreateNew, setCanCreateNew] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorDialogOpen, setErrorDialogOpen] = useState(false);
  const [errorDetails, setErrorDetails] = useState<{
    title?: string;
    message: string;
    description?: string;
    variant?: 'error' | 'warning' | 'info';
  } | null>(null);
  const [itemCategories, setItemCategories] = useState<Record<string, string>>({});

  const continueWithManualReturn = (message?: string, description?: string) => {
    setErrorDetails({
      title: 'تعذر التحقق من الطلب',
      message: message || 'تعذر التحقق من صلاحية الإرجاع بشكل تلقائي.',
      description:
        description ||
        'يمكنك متابعة تقديم طلب الإرجاع وسيقوم فريق الدعم بمراجعته يدويًا.',
      variant: 'warning',
    });
    setErrorDialogOpen(true);
    setExistingReturns([]);
    setCanCreateNew(true);
    setStep('form');
  };

  const fetchItemCategories = async (returns: any[]) => {
    const categories: Record<string, string> = {};

    // Get all unique product IDs from all return items
    const productIds = new Set<string>();
    returns.forEach(ret => {
      ret.items.forEach((item: any) => {
        productIds.add(item.productId);
      });
    });

    // Fetch categories for all products
    await Promise.all(
      Array.from(productIds).map(async (productId) => {
        try {
          const response = await fetch(
            `/api/products/category?merchantId=${MERCHANT_CONFIG.merchantId}&productId=${productId}`
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

  const handleLookupOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setErrorDialogOpen(false);
    setErrorDetails(null);
    setLoading(true);

    try {
      // First, lookup the order
      const orderResponse = await fetch(
        `/api/orders/lookup?merchantId=${MERCHANT_CONFIG.merchantId}&orderNumber=${encodeURIComponent(orderNumber)}`
      );

      const orderData = await orderResponse.json();

      if (!orderResponse.ok) {
        const errorMessage = orderData.error || 'فشل في العثور على الطلب';
        setErrorDetails({
          title: 'لم يتم العثور على الطلب',
          message: errorMessage,
          description: 'يرجى التحقق من رقم الطلب والمحاولة مرة أخرى. يمكنك العثور على رقم الطلب في رسالة التأكيد المرسلة إليك عبر البريد الإلكتروني أو الرسائل النصية.',
          variant: 'error',
        });
        setErrorDialogOpen(true);
        setLoading(false);
        return;
      }

      if (isInternationalOrder(orderData.order)) {
        setErrorDetails({
          title: 'طلب دولي',
          message: 'الطلبات الدولية خارج السعودية غير قابلة للإرجاع أو الاستبدال.',
          variant: 'error',
        });
        setErrorDialogOpen(true);
        setLoading(false);
        return;
      }

      const orderStatusLabel = getOrderStatusLabel(orderData.order?.status);
      if (!isDeliveredStatus(orderData.order?.status)) {
        setErrorDetails({
          title: 'الطلب غير مؤهل للإرجاع',
          message: 'يمكن تقديم طلب الإرجاع فقط بعد توصيل الطلب.',
          description: orderStatusLabel
            ? `حالة الطلب الحالية: ${orderStatusLabel}`
            : undefined,
          variant: 'error',
        });
        setErrorDialogOpen(true);
        setLoading(false);
        return;
      }

      setOrder(orderData.order);

      // Debug: Log the full order structure to see what fields are available
      console.log('Full order data received:', orderData.order);
      console.log('All possible date fields:', {
        'date.updated': orderData.order.date?.updated,
        'date.created': orderData.order.date?.created,
        'updated_at': orderData.order.updated_at,
        'created_at': orderData.order.created_at,
        'updatedAt': orderData.order.updatedAt,
        'createdAt': orderData.order.createdAt,
        'updatedAtRemote': orderData.order.updatedAtRemote,
        'placedAt': orderData.order.placedAt,
      });

      // Check if there are existing return requests for this order
      // Priority: Use updatedAt (most recent activity), fallback to created date
      // Try multiple possible field locations based on different API response structures
      let orderUpdatedAtRaw =
        orderData.order.date?.updated ||      // Salla API: date.updated (ISO string or object)
        orderData.order.date?.created ||      // Salla API: date.created (fallback)
        orderData.order.updated_at ||         // Snake case variation
        orderData.order.created_at ||         // Snake case created
        orderData.order.updatedAt ||          // Camel case updatedAt
        orderData.order.createdAt ||          // Camel case createdAt
        orderData.order.updatedAtRemote ||    // Database field
        orderData.order.placedAt;             // Database placedAt field

      const orderUpdatedAt = normalizeOrderDate(orderUpdatedAtRaw);

      if (typeof orderUpdatedAtRaw === 'object' && orderUpdatedAtRaw !== null) {
        console.log('Date is an object, extracted:', {
          originalObject: orderUpdatedAtRaw,
          extractedDate: orderUpdatedAt,
        });
      } else {
        console.log('Date normalization result:', {
          rawValue: orderUpdatedAtRaw,
          rawType: typeof orderUpdatedAtRaw,
          normalizedDate: orderUpdatedAt,
        });
      }

      // Log which date field was used (helps debug date extraction issues)
      const dateSource = orderData.order.date?.updated
        ? 'date.updated'
        : orderData.order.date?.created
        ? 'date.created'
        : orderData.order.updated_at
        ? 'updated_at'
        : orderData.order.created_at
        ? 'created_at'
        : orderData.order.updatedAt
        ? 'updatedAt'
        : orderData.order.createdAt
        ? 'createdAt'
        : orderData.order.updatedAtRemote
        ? 'updatedAtRemote'
        : orderData.order.placedAt
        ? 'placedAt'
        : 'none';

      console.log('Return eligibility check:', {
        orderId: orderData.order.id,
        dateSource,
        dateValue: orderUpdatedAt,
      });

      // Validate date before proceeding
      if (!orderUpdatedAt) {
        console.error('No date found for return validation', {
          orderId: orderData.order.id,
          orderData: orderData.order,
        });

        setErrorDetails({
          title: 'خطأ في التحقق من الطلب',
          message: 'لا يمكن التحقق من تاريخ الطلب',
          description: 'لم نتمكن من العثور على تاريخ الطلب. يرجى الاتصال بالدعم.',
          variant: 'error',
        });
        setErrorDialogOpen(true);
        setLoading(false);
        return;
      }

      const checkUrl = new URL('/api/returns/check', window.location.origin);
      checkUrl.searchParams.set('merchantId', MERCHANT_CONFIG.merchantId);
      checkUrl.searchParams.set('orderId', orderData.order.id.toString());
      checkUrl.searchParams.set('orderUpdatedAt', orderUpdatedAt);

      let returnsResponse: Response;
      let returnsData: any;
      try {
        returnsResponse = await fetch(checkUrl.toString());
        returnsData = await returnsResponse.json();
      } catch (returnsError) {
        console.error('Failed to check return eligibility', returnsError);
        continueWithManualReturn(
          'حدث خطأ أثناء التحقق من حالة الطلب.',
          'سنقوم بمراجعة طلب الإرجاع يدويًا بمجرد استلامه.'
        );
        return;
      }

      // Handle return period expiration and date validation errors
      if (!returnsResponse.ok) {
        if (returnsData.errorCode === 'RETURN_PERIOD_EXPIRED') {
          setErrorDetails({
            title: 'انتهت مدة الإرجاع',
            message: returnsData.message || returnsData.error,
            description: returnsData.daysSinceUpdate
              ? `مرت ${returnsData.daysSinceUpdate} يوم على آخر تحديث للطلب. الحد الأقصى المسموح به هو 8 أيام.`
              : undefined,
            variant: 'error',
          });
          setErrorDialogOpen(true);
          setLoading(false);
          return;
        }

        continueWithManualReturn(
          returnsData.message || returnsData.error || 'تعذر التحقق من حالة الطلب.',
          'يمكنك متابعة تقديم الطلب وسيتم مراجعته يدويًا.'
        );
        return;
      }

      // Store whether new requests can be created
      setCanCreateNew(returnsData.canCreateNew !== false);

      if (returnsData.hasExistingReturns && returnsData.returns.length > 0) {
        setExistingReturns(returnsData.returns);
        // Fetch categories for all items
        await fetchItemCategories(returnsData.returns);
        setStep('existing');
      } else {
        setStep('form');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setErrorDetails({
        title: 'حدث خطأ',
        message: errorMessage,
        description: 'حدث خطأ أثناء البحث عن الطلب. يرجى المحاولة مرة أخرى.',
        variant: 'error',
      });
      setErrorDialogOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleReturnSuccess = (request: any) => {
    setReturnRequest(request);
    setStep('success');
  };

  const handleReset = () => {
    setStep('lookup');
    setOrderNumber('');
    setOrder(null);
    setReturnRequest(null);
    setExistingReturns([]);
    setCanCreateNew(true);
    setError('');
  };

  const handleCancelReturn = async (returnId: string) => {
    if (!confirm('هل أنت متأكد من إلغاء طلب الإرجاع؟')) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/returns/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          returnRequestId: returnId,
          merchantId: MERCHANT_CONFIG.merchantId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'فشل إلغاء طلب الإرجاع');
      }

      // Remove the cancelled return from the list
      setExistingReturns(prev => prev.filter(ret => ret.id !== returnId));

      // If no more returns, go to form
      if (existingReturns.length === 1) {
        setStep('form');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
      setErrorDetails({
        title: 'خطأ في الإلغاء',
        message: errorMessage,
        description: 'لم نتمكن من إلغاء طلب الإرجاع. يرجى المحاولة مرة أخرى.',
        variant: 'error',
      });
      setErrorDialogOpen(true);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewReturn = () => {
    setStep('form');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">طلب إرجاع أو استبدال</h1>
          <p className="text-gray-600">
            يرجى إدخال رقم الطلب للبدء في عملية الإرجاع أو الاستبدال
          </p>
        </div>

        {/* Step 1: Order Lookup */}
        {step === 'lookup' && (
          <Card className="p-8">
            <form onSubmit={handleLookupOrder} className="space-y-6">
              <div>
                <label htmlFor="orderNumber" className="block text-sm font-medium mb-2">
                  رقم الطلب
                </label>
                <input
                  id="orderNumber"
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="مثال: 251263484"
                  className="w-full px-4 py-3 border rounded-lg text-lg"
                  required
                  disabled={loading}
                />
                <p className="text-sm text-gray-500 mt-2">
                  يمكنك العثور على رقم الطلب في رسالة التأكيد المرسلة إليك عبر البريد الإلكتروني
                </p>
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading || !orderNumber.trim()}
                className="w-full py-6 text-lg"
              >
                {loading ? 'جاري البحث...' : 'البحث عن الطلب'}
              </Button>
            </form>

            {/* Info Box */}
            <div className="mt-8 pt-6 border-t">
              <h3 className="font-semibold mb-2">شروط الإرجاع والاستبدال:</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                <li>يتم الاسترجاع والاستبدال خلال (24) ساعة فقط لفساتين السهرات من تاريخ استلام الطلبية.</li>
                <li>يتم الاسترجاع خلال (8) أيام للفساتين غير فساتين السهرة من تاريخ استلام الطلبية.</li>
                <li>يتم الاستبدال خلال (7) أيام من تاريخ استلام الطلبية.</li>
              </ul>
            </div>
          </Card>
        )}

        {/* Step 2: Existing Returns */}
        {step === 'existing' && existingReturns.length > 0 && (
          <div>
            <Button
              variant="outline"
              onClick={handleReset}
              className="mb-4"
            >
              ← العودة للبحث
            </Button>

            <Card className="p-6 mb-6">
              <h2 className="text-2xl font-bold mb-4">طلبات إرجاع موجودة</h2>
              <p className="text-gray-600 mb-6">
                يوجد بالفعل طلب إرجاع أو استبدال لهذا الطلب
              </p>

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 mb-4">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {existingReturns.map((returnReq) => (
                  <Card key={returnReq.id} className="p-6 border-2">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold">
                            {returnReq.type === 'return' ? 'طلب إرجاع' : 'طلب استبدال'}
                          </h3>
                          <span
                            className={`px-3 py-1 rounded-full text-sm font-medium ${
                              returnReq.status === 'pending_review'
                                ? 'bg-yellow-100 text-yellow-800'
                                : returnReq.status === 'approved'
                                ? 'bg-green-100 text-green-800'
                                : returnReq.status === 'completed'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {returnReq.status === 'pending_review'
                              ? 'قيد المراجعة'
                              : returnReq.status === 'approved'
                              ? 'تمت الموافقة'
                              : returnReq.status === 'completed'
                              ? 'مكتمل'
                              : returnReq.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-1">
                          التاريخ: {new Date(returnReq.createdAt).toLocaleDateString('ar-SA')}
                        </p>
                        {returnReq.smsaTrackingNumber && (
                          <div className="mb-2">
                            <p className="text-sm font-medium text-gray-700">رقم الشحنة:</p>
                            <p className="text-lg font-mono font-bold text-blue-600">
                              {returnReq.smsaTrackingNumber}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="border-t pt-4 mt-4">
                      <h4 className="font-medium mb-2">المنتجات:</h4>
                      <div className="space-y-3">
                        {returnReq.items.map((item: any) => {
                          const { color, size } = getItemAttributes(item);
                          return (
                            <div key={item.id} className="bg-gray-50 p-3 rounded-lg">
                              <div className="flex justify-between items-start mb-1">
                                <span className="font-medium">{item.productName}</span>
                                <span className="text-gray-600 text-sm">الكمية: {item.quantity}</span>
                              </div>
                              {item.productSku && (
                                <p className="text-xs text-gray-500 mb-1">SKU: {item.productSku}</p>
                              )}
                              {(color || size) && (
                                <div className="flex flex-wrap gap-2 mt-1 mb-1 text-xs text-gray-600">
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
                              {item.variantName && !color && !size && (
                                <p className="text-xs text-gray-500 mb-1">{item.variantName}</p>
                              )}
                              {itemCategories[item.productId] && (
                                <div className="flex items-center gap-2 mt-2">
                                  <span className="text-xs text-gray-500">التصنيف:</span>
                                  <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-md">
                                    {itemCategories[item.productId]}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {returnReq.totalRefundAmount && (
                      <div className="border-t pt-4 mt-4">
                        <div className="flex justify-between">
                          <span className="font-medium">المبلغ المتوقع للإرجاع:</span>
                          <span className="font-bold text-lg">
                            {Number(returnReq.totalRefundAmount).toFixed(2)} ر.س
                          </span>
                        </div>
                      </div>
                    )}

                    {['pending_review', 'approved'].includes(returnReq.status) && (
                      <div className="border-t pt-4 mt-4">
                        <Button
                          variant="outline"
                          onClick={() => handleCancelReturn(returnReq.id)}
                          disabled={loading}
                          className="w-full text-red-600 border-red-300 hover:bg-red-50"
                        >
                          {loading ? 'جاري الإلغاء...' : 'إلغاء طلب الإرجاع'}
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>

              {canCreateNew && (
                <div className="mt-6 pt-6 border-t">
                  <Button
                    onClick={handleCreateNewReturn}
                    className="w-full"
                    variant="outline"
                  >
                    إنشاء طلب إرجاع جديد
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Step 3: Return Form */}
        {step === 'form' && order && (
          <div>
            <Button
              variant="outline"
              onClick={handleReset}
              className="mb-4"
            >
              ← العودة للبحث
            </Button>
            <ReturnForm
              order={order}
              merchantId={MERCHANT_CONFIG.merchantId}
              merchantInfo={{
                name: MERCHANT_CONFIG.name,
                phone: MERCHANT_CONFIG.phone,
                address: MERCHANT_CONFIG.address,
                city: MERCHANT_CONFIG.city,
              }}
              onSuccess={handleReturnSuccess}
            />
          </div>
        )}

        {/* Step 4: Success Screen */}
        {step === 'success' && returnRequest && (
          <SuccessScreen
            returnRequest={returnRequest}
            onReset={handleReset}
          />
        )}

        {/* Error Dialog */}
        {errorDetails && (
          <ErrorDialog
            open={errorDialogOpen}
            onClose={() => {
              setErrorDialogOpen(false);
              setErrorDetails(null);
            }}
            title={errorDetails.title}
            message={errorDetails.message}
            description={errorDetails.description}
            variant={errorDetails.variant}
          />
        )}
      </div>
    </div>
  );
}
