'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type BarcodeDetection = { rawValue?: string };
type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetection[]>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorInstance;
import Link from 'next/link';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CONDITION_DESCRIPTIONS,
  CONDITION_LABELS,
  CONDITION_ORDER,
  ReturnItemCondition,
  summarizeItemConditions,
} from '@/app/lib/returns/inspection';
import { cn } from '@/lib/utils';

interface ReturnRequestItem {
  id: string;
  productId: string;
  productName: string;
  productSku?: string | null;
  variantId?: string | null;
  variantName?: string | null;
  quantity: number;
  price: string | number;
  conditionStatus?: ReturnItemCondition | null;
  conditionNotes?: string | null;
  inspectedBy?: string | null;
  inspectedAt?: string | null;
}

interface InspectableItem extends ReturnRequestItem {
  imageUrl?: string | null;
}

interface ReturnRequestDetails {
  id: string;
  orderId: string;
  orderNumber: string;
  status: string;
  type: 'return' | 'exchange';
  reason: string;
  reasonDetails?: string | null;
  smsaTrackingNumber?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  createdAt: string;
  items: ReturnRequestItem[];
}

interface SallaOrderPreview {
  order_number?: string | number;
  status?: { name?: string; slug?: string };
  customer?: { name?: string; full_name?: string; mobile?: string };
  shipping?: {
    company?: string;
    tracking_number?: string;
  };
  date?: { updated?: string; created?: string };
  items?: SallaOrderLineItem[];
}

interface SallaOrderLineItem {
  id?: string | number;
  name?: string;
  sku?: string;
  product?: {
    id?: string | number;
    name?: string;
    sku?: string;
    thumbnail?: string | null;
    images?: Array<{ url?: string; image?: string; src?: string } | string>;
  };
  product_id?: string | number;
  productId?: string | number;
  productSku?: string;
  variant?: {
    id?: string | number;
    name?: string;
  };
  variant_id?: string | number;
  variantId?: string | number;
  images?: Array<{ url?: string; image?: string; src?: string } | string>;
  files?: Array<{ url?: string; image?: string; src?: string }>;
  codes?: Array<{ url?: string; image?: string; src?: string }>;
  thumbnail?: string | null;
  image?: string | null;
}

const SUMMARY_BADGE_STYLES = {
  success: 'bg-green-50 text-green-800 border-green-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-red-50 text-red-800 border-red-200',
  muted: 'bg-gray-100 text-gray-700 border-gray-200',
};

const CONDITION_BUTTON_CLASSES: Record<
  ReturnItemCondition,
  { active: string; inactive: string }
> = {
  good: {
    active: 'bg-green-600 text-white border-green-600 hover:bg-green-600',
    inactive: 'border-green-200 text-green-700 hover:bg-green-50',
  },
  worn: {
    active: 'bg-amber-500 text-white border-amber-500 hover:bg-amber-500',
    inactive: 'border-amber-200 text-amber-700 hover:bg-amber-50',
  },
  missing_parts: {
    active: 'bg-violet-600 text-white border-violet-600 hover:bg-violet-600',
    inactive: 'border-violet-200 text-violet-700 hover:bg-violet-50',
  },
  damaged: {
    active: 'bg-red-600 text-white border-red-600 hover:bg-red-600',
    inactive: 'border-red-200 text-red-700 hover:bg-red-50',
  },
};

const formatPrice = (value: string | number) => {
  const amount = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(amount)) {
    return `${amount.toFixed(2)} ر.س`;
  }
  return '—';
};

const extractOrderItemImage = (item: SallaOrderLineItem | undefined): string | null => {
  if (!item) {
    return null;
  }

  const directCandidates = [
    item.product?.thumbnail,
    item.thumbnail,
    item.image,
    (item as Record<string, unknown>).featured_image as string | undefined,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  const collections = [
    item.images,
    item.product?.images,
    item.files,
    item.codes,
    (item as Record<string, unknown>).media as Array<any> | undefined,
  ];

  for (const collection of collections) {
    if (!Array.isArray(collection)) {
      continue;
    }
    for (const entry of collection) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry;
      }
      if (entry && typeof entry === 'object') {
        const maybe =
          (entry as any).url ||
          (entry as any).image ||
          (entry as any).src;
        if (typeof maybe === 'string' && maybe.trim()) {
          return maybe;
        }
      }
    }
  }

  return null;
};

const stringsEqual = (a?: string | number | null, b?: string | number | null) => {
  if (a === undefined || a === null || b === undefined || b === null) {
    return false;
  }
  return String(a).trim() === String(b).trim();
};

const resolveItemImage = (
  item: ReturnRequestItem,
  order: SallaOrderPreview | null
): string | null => {
  if (!order?.items || !Array.isArray(order.items)) {
    return null;
  }

  const orderItems = order.items;
  const productId = item.productId ? String(item.productId) : null;
  const variantId = item.variantId ? String(item.variantId) : null;

  const productMatch = orderItems.find((orderItem) => {
    const orderProductId =
      orderItem.product?.id ??
      orderItem.product_id ??
      orderItem.productId ??
      orderItem.id;
    if (!productId || !orderProductId) {
      return false;
    }
    if (String(orderProductId) !== productId) {
      return false;
    }
    if (!variantId) {
      return true;
    }
    const orderVariantId =
      orderItem.variant?.id ??
      orderItem.variant_id ??
      orderItem.variantId;
    return orderVariantId ? String(orderVariantId) === variantId : false;
  });

  if (productMatch) {
    return extractOrderItemImage(productMatch);
  }

  if (item.productSku) {
    const skuMatch = orderItems.find(
      (orderItem) =>
        stringsEqual(orderItem.product?.sku, item.productSku) ||
        stringsEqual(orderItem.sku, item.productSku)
    );
    if (skuMatch) {
      return extractOrderItemImage(skuMatch);
    }
  }

  const nameMatch = orderItems.find(
    (orderItem) =>
      stringsEqual(orderItem.product?.name, item.productName) ||
      stringsEqual(orderItem.name, item.productName)
  );

  if (nameMatch) {
    return extractOrderItemImage(nameMatch);
  }

  return null;
};

const normalizeInspectableItems = (
  rawItems: ReturnRequestItem[],
  order: SallaOrderPreview | null,
  previousItems?: InspectableItem[]
): InspectableItem[] => {
  const previousImageMap = previousItems
    ? new Map(previousItems.map((item) => [item.id, item.imageUrl ?? null]))
    : null;

  return rawItems.map((item) => ({
    ...item,
    conditionStatus: item.conditionStatus ?? null,
    conditionNotes: item.conditionNotes ?? '',
    imageUrl:
      resolveItemImage(item, order) ??
      (previousImageMap ? previousImageMap.get(item.id) ?? null : null),
  }));
};

export default function ReturnInspectionPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [returnRequest, setReturnRequest] = useState<ReturnRequestDetails | null>(null);
  const [items, setItems] = useState<InspectableItem[]>([]);
  const [sallaOrder, setSallaOrder] = useState<SallaOrderPreview | null>(null);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeDetectorRef = useRef<BarcodeDetectorInstance | null>(null);
  const scanFrameRef = useRef<number | null>(null);

  const inspectionSummary = useMemo(() => summarizeItemConditions(items), [items]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setScannerSupported(
      'BarcodeDetector' in window && typeof (window as any).BarcodeDetector === 'function'
    );
  }, []);

  const stopScanner = () => {
    setScannerActive(false);
    if (scanFrameRef.current) {
      cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  const waitForVideoElement = async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (videoRef.current) {
        return videoRef.current;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('video_not_ready');
  };

  const startScanner = async () => {
    if (!scannerSupported) {
      setScannerError('الكاميرا لا تدعم قراءة الباركود في هذا المتصفح');
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerError('جهازك لا يدعم الوصول إلى الكاميرا من المتصفح الحالي');
        return;
      }
      setScannerError(null);
      const BarcodeDetectorClass = (window as any).BarcodeDetector as BarcodeDetectorConstructor;
      barcodeDetectorRef.current = new BarcodeDetectorClass({
        formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'],
      });
      setScannerActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;

      const videoElement = await waitForVideoElement();
      videoElement.srcObject = stream;
      videoElement.playsInline = true;
      videoElement.muted = true;
      await videoElement.play();

      const scanLoop = async () => {
        if (!barcodeDetectorRef.current || !videoElement || videoElement.readyState < 2) {
          scanFrameRef.current = requestAnimationFrame(scanLoop);
          return;
        }
        try {
          const barcodes = await barcodeDetectorRef.current.detect(videoElement);
          if (barcodes.length > 0) {
            const value = barcodes[0]?.rawValue || '';
            if (value) {
              setQuery(value);
              stopScanner();
              return;
            }
          }
          scanFrameRef.current = requestAnimationFrame(scanLoop);
        } catch (err) {
          console.error('Barcode detection error', err);
          setScannerError('تعذر قراءة الرقم. حاول مرة أخرى');
          stopScanner();
        }
      };
      scanLoop();
    } catch (error) {
      console.error('Camera access failed', error);
      setScannerError('تعذر تشغيل الكاميرا. يرجى السماح بالوصول أو المحاولة لاحقاً');
      stopScanner();
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setError('يرجى إدخال رقم تتبع المرتجع أو رقم الطلب');
      return;
    }

    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const params = new URLSearchParams({ query: query.trim() });
      const response = await fetch(`/api/returns/inspection?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'تعذر العثور على الشحنة');
      }

      setReturnRequest(data.returnRequest);
      const incomingOrder = (data.sallaOrder || null) as SallaOrderPreview | null;
      setSallaOrder(incomingOrder);
      setItems(
        normalizeInspectableItems(
          data.returnRequest.items || [],
          incomingOrder
        )
      );
      setSuccessMessage('تم تحميل بيانات الشحنة بنجاح');
    } catch (err) {
      setReturnRequest(null);
      setItems([]);
      setSallaOrder(null);
      setSuccessMessage(null);
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  const updateItemStatus = (itemId: string, status: ReturnItemCondition | null) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              conditionStatus: status,
            }
          : item
      )
    );
  };

  const updateItemNotes = (itemId: string, notes: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              conditionNotes: notes,
            }
          : item
      )
    );
  };

  const markAll = (status: ReturnItemCondition) => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        conditionStatus: status,
      }))
    );
  };

  const clearAll = () => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        conditionStatus: null,
        conditionNotes: '',
      }))
    );
  };

  const handleSave = async () => {
    if (!returnRequest) {
      setError('يرجى البحث عن شحنة إرجاع أولاً');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/returns/inspection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnRequestId: returnRequest.id,
          items: items.map((item) => ({
            itemId: item.id,
            conditionStatus: item.conditionStatus ?? null,
            conditionNotes: item.conditionNotes?.trim()
              ? item.conditionNotes.trim()
              : null,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'فشل حفظ نتائج الفحص');
      }

      setReturnRequest(data.returnRequest);
      setItems((prev) =>
        normalizeInspectableItems(
          data.returnRequest.items || [],
          sallaOrder,
          prev
        )
      );
      setSuccessMessage('تم حفظ نتائج الفحص، وستظهر في صفحة إدارة الإرجاع كبطاقات حالة');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">فحص المرتجعات الواردة</h1>
            <p className="text-gray-600">
              خصص لكل منتج حالة (سليم، ملبوس، ناقص، تالف) ليتم عرضها فوراً للإدارة.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/returns-management">
              <Button variant="outline">عرض طلبات الإرجاع</Button>
            </Link>
            <Link href="/">
              <Button variant="ghost">← العودة للرئيسية</Button>
            </Link>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={handleLookup} className="flex flex-col gap-3 md:flex-row">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-2">
                رقم التتبع أو رقم الطلب
              </label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="مثال: 600123456 أو #15230"
                disabled={loading}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full md:w-auto" disabled={loading}>
                {loading ? 'جاري البحث...' : 'قراءة الشحنة'}
              </Button>
            </div>
          </form>
        {error && (
          <p className="text-sm text-red-600 mt-3">{error}</p>
        )}
        {successMessage && (
          <p className="text-sm text-green-600 mt-3">{successMessage}</p>
        )}
        <div className="mt-4 flex flex-col gap-2 md:hidden">
          <Button
            type="button"
            variant="outline"
            onClick={scannerActive ? stopScanner : startScanner}
            disabled={!scannerSupported && !scannerActive}
          >
            {scannerActive ? 'إيقاف الكاميرا' : 'قراءة رقم التتبع بالكاميرا'}
          </Button>
          {!scannerSupported && (
            <p className="text-center text-sm text-gray-500">
              الكاميرا غير مدعومة في هذا المتصفح، استخدم الإدخال اليدوي
            </p>
          )}
          {scannerError && (
            <p className="text-center text-sm text-red-600">{scannerError}</p>
          )}
        </div>
      </Card>

        {returnRequest && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>معلومات المرتجع</CardTitle>
                  <CardDescription>تفاصيل الطلب المرتجع والمتابعة</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-gray-700">
                  <p><span className="font-medium">رقم الطلب:</span> #{returnRequest.orderNumber}</p>
                  {returnRequest.smsaTrackingNumber && (
                    <p><span className="font-medium">رقم التتبع:</span> {returnRequest.smsaTrackingNumber}</p>
                  )}
                  <p><span className="font-medium">النوع:</span> {returnRequest.type === 'return' ? 'إرجاع' : 'استبدال'}</p>
                  <p><span className="font-medium">الحالة:</span> {returnRequest.status}</p>
                  <p><span className="font-medium">العميل:</span> {returnRequest.customerName || '-'}</p>
                  <p><span className="font-medium">الهاتف:</span> {returnRequest.customerPhone || '-'}</p>
                  <p><span className="font-medium">السبب:</span> {returnRequest.reason}</p>
                  {returnRequest.reasonDetails && (
                    <p className="text-gray-500">{returnRequest.reasonDetails}</p>
                  )}
                  <p>
                    <span className="font-medium">تاريخ الطلب:</span>{' '}
                    {new Date(returnRequest.createdAt).toLocaleString('ar-SA')}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>بيانات الطلب من سلة</CardTitle>
                  <CardDescription>يتم جلبها مباشرة من واجهة سلة</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-gray-700">
                  <p>
                    <span className="font-medium">الحالة:</span>{' '}
                    {sallaOrder?.status?.name || '—'}
                  </p>
                  <p>
                    <span className="font-medium">العميل:</span>{' '}
                    {sallaOrder?.customer?.name || sallaOrder?.customer?.full_name || '—'}
                  </p>
                  <p>
                    <span className="font-medium">هاتف العميل:</span>{' '}
                    {sallaOrder?.customer?.mobile || '—'}
                  </p>
                  <p>
                    <span className="font-medium">شركة الشحن:</span>{' '}
                    {sallaOrder?.shipping?.company || '—'}
                  </p>
                  <p>
                    <span className="font-medium">رقم التتبع (سلة):</span>{' '}
                    {sallaOrder?.shipping?.tracking_number || '—'}
                  </p>
                  <p>
                    <span className="font-medium">آخر تحديث:</span>{' '}
                    {sallaOrder?.date?.updated
                      ? new Date(sallaOrder.date.updated).toLocaleString('ar-SA')
                      : '—'}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>ملخص حالة الفحص</CardTitle>
                <CardDescription>
                  تظهر هذه النتائج كأوسمة في صفحة إدارة الإرجاع
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {inspectionSummary.badges.map((badge, index) => (
                    <span
                      key={`${badge.label}-${index}`}
                      className={cn(
                        'px-3 py-1 rounded-full text-xs font-medium border',
                        SUMMARY_BADGE_STYLES[badge.tone] || SUMMARY_BADGE_STYLES.muted
                      )}
                    >
                      {badge.label}
                    </span>
                  ))}
                  {inspectionSummary.badges.length === 0 && (
                    <span className="text-sm text-gray-500">لا توجد نتائج للعرض بعد.</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-col gap-3">
                <div>
                  <CardTitle>تفاصيل المنتجات المرتجعة</CardTitle>
                  <CardDescription>حدد حالة كل منتج لتحديث لوحة الإدارة</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" type="button" onClick={() => markAll('good')}>
                    تعيين الكل كسليم
                  </Button>
                  <Button variant="ghost" type="button" onClick={clearAll}>
                    مسح الحالات
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {items.map((item) => (
                  <div key={item.id} className="p-4 border rounded-lg bg-white space-y-3">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex gap-4">
                        <div className="relative w-full max-w-[360px] aspect-[9/16] overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                          {item.imageUrl ? (
                            <Image
                              src={item.imageUrl}
                              alt={item.productName}
                              width={1080}
                              height={1920}
                              className="h-full w-full object-cover"
                              unoptimized
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[11px] text-gray-400">
                              لا توجد صورة
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {item.productName} {item.variantName ? `(${item.variantName})` : ''}
                          </p>
                          <p className="text-sm text-gray-500">
                            SKU: {item.productSku || '—'}
                          </p>
                        </div>
                      </div>
                      <div className="text-sm text-gray-600 md:text-right">
                        <p>الكمية: x{item.quantity}</p>
                        <p>السعر: {formatPrice(item.price)}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {CONDITION_ORDER.map((status) => (
                        <Button
                          key={status}
                          type="button"
                          variant="outline"
                          className={cn(
                            'text-sm',
                            CONDITION_BUTTON_CLASSES[status][
                              item.conditionStatus === status ? 'active' : 'inactive'
                            ]
                          )}
                          onClick={() => updateItemStatus(item.id, status)}
                        >
                          {CONDITION_LABELS[status]}
                        </Button>
                      ))}
                      {item.conditionStatus && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="text-sm text-gray-600"
                          onClick={() => updateItemStatus(item.id, null)}
                        >
                          إزالة التقييم
                        </Button>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        ملاحظات إضافية (اختياري)
                      </label>
                      <textarea
                        value={item.conditionNotes || ''}
                        onChange={(e) => updateItemNotes(item.id, e.target.value)}
                        rows={2}
                        className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="اكتب ملاحظة توضح سبب الحالة المختارة"
                      />
                    </div>

                    {item.conditionStatus && (
                      <p className="text-xs text-gray-500">
                        {CONDITION_DESCRIPTIONS[item.conditionStatus]}
                        {item.inspectedBy && item.inspectedAt && (
                          <>
                            {' '}
                            — آخر تحديث بواسطة {item.inspectedBy} في{' '}
                            {new Date(item.inspectedAt).toLocaleString('ar-SA')}
                          </>
                        )}
                      </p>
                    )}
                  </div>
                ))}

                {items.length === 0 && (
                  <p className="text-center text-gray-500 text-sm">
                    لا توجد منتجات مرتبطة بهذا المرتجع.
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                disabled={saving || items.length === 0}
                onClick={handleSave}
              >
                {saving ? 'جاري الحفظ...' : 'حفظ نتائج الفحص'}
              </Button>
            </div>
          </>
        )}
      </div>
      {scannerActive && (
        <div className="md:hidden fixed inset-0 z-40 flex items-center justify-center bg-black/80 px-4 py-8">
          <div className="w-full max-w-sm rounded-2xl bg-gray-900/90 p-4 text-white shadow-lg">
            <p className="mb-3 text-center text-sm font-medium">
              ضع الباركود داخل الإطار ليتم قراءة رقم التتبع تلقائياً
            </p>
            <div className="relative aspect-video overflow-hidden rounded-xl border border-white/20 bg-black">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                autoPlay
                muted
                playsInline
              />
              <div className="pointer-events-none absolute inset-4 rounded-xl border-2 border-white/70"></div>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="mt-4 w-full border border-white/50 text-white hover:bg-white/10"
              onClick={stopScanner}
            >
              إغلاق
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
