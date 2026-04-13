'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Search,
  Plus,
  Trash2,
  RefreshCcw,
  Truck,
  PackageSearch,
  FileText,
  X,
} from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SallaOrder } from '@/app/lib/salla-api';
import type {
  ManualSmsaShipmentItemInput,
  ManualSmsaShipmentRecord,
} from '@/app/lib/manual-smsa/types';

const DEFAULT_MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '';
const DEFAULT_ITEM_WEIGHT = 0.5;

type DraftShipmentItem = ManualSmsaShipmentItemInput & {
  clientKey: string;
};

type Feedback = {
  type: 'success' | 'error';
  message: string;
};

const formatCurrency = (value: number | null | undefined, currency?: string) => {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }

  try {
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: currency || 'SAR',
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || ''}`.trim();
  }
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('ar-SA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const safeNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const detectCodAmountFromOrder = (order: SallaOrder): number | null => {
  const paymentMethodRaw =
    (order as any)?.payment_method ||
    (order as any)?.payment_method_label ||
    (order as any)?.payment?.method ||
    '';
  const amount = safeNumber((order as any)?.amounts?.total?.amount);
  if (!amount) return null;

  const method = typeof paymentMethodRaw === 'string' ? paymentMethodRaw.toLowerCase() : '';
  if (!method) return null;

  const isCod =
    method.includes('cod') ||
    method.includes('cash on delivery') ||
    method.includes('collect') ||
    method.includes('الدفع عند الاستلام');

  return isCod ? amount : null;
};

const buildDraftItemsFromOrder = (order: SallaOrder): DraftShipmentItem[] => {
  const items = Array.isArray(order.items) ? order.items : [];
  return items.map((item, index) => {
    const clientKey =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${index}`;
    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const totalAmount =
      safeNumber((item.amounts?.total?.amount as unknown as number) ?? null) ?? 0;
    const unitPrice = quantity > 0 ? Number((totalAmount / quantity).toFixed(2)) : totalAmount;
    const skuCandidate =
      item.sku ||
      (item.product?.sku ?? null) ||
      ((item.codes && item.codes[0]?.value) || null);
    const baseWeight = safeNumber(item.weight) ?? DEFAULT_ITEM_WEIGHT;

    return {
      clientKey,
      id: item.id,
      productId: item.product?.id ?? item.id,
      variantId: item.variant?.id,
      name: item.name || item.product?.name || `منتج ${item.id}`,
      sku: skuCandidate,
      quantity,
      price: unitPrice,
      weight: baseWeight,
      source: 'order',
    };
  });
};

const buildAddressSummary = (order: SallaOrder | null): string[] => {
  if (!order) return [];
  const shippingAddress = ((order as any)?.shipping_address as Record<string, any>) || {};
  const pickupAddress = (order.shipping?.pickup_address as Record<string, any>) || {};
  const source =
    shippingAddress && Object.keys(shippingAddress).length > 0 ? shippingAddress : pickupAddress;

  const parts: string[] = [];
  if (source.street_address) parts.push(source.street_address);
  if (source.district) parts.push(source.district);
  if (source.city) parts.push(source.city);
  if (source.postal_code) parts.push(`الرمز: ${source.postal_code}`);

  if (parts.length === 0) {
    const fallbackCity = order.customer?.city || '—';
    parts.push(`${fallbackCity} - ${order.customer?.mobile || ''}`.trim());
  }

  return parts;
};

const ManualSmsaClient = () => {
  const router = useRouter();
  const { status } = useSession();
  const [merchantId, setMerchantId] = useState(DEFAULT_MERCHANT_ID);
  const [orderNumberInput, setOrderNumberInput] = useState('');
  const [order, setOrder] = useState<SallaOrder | null>(null);
  const [shipments, setShipments] = useState<ManualSmsaShipmentRecord[]>([]);
  const [draftItems, setDraftItems] = useState<DraftShipmentItem[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(false);
  const [creatingShipment, setCreatingShipment] = useState(false);
  const [skuValue, setSkuValue] = useState('');
  const [skuLookupError, setSkuLookupError] = useState<string | null>(null);
  const [skuLookupLoading, setSkuLookupLoading] = useState(false);
  const [formValues, setFormValues] = useState({
    parcels: '',
    declaredValue: '',
    weight: '',
    codAmount: '',
    contentDescription: '',
  });
  const [itemEditorShipment, setItemEditorShipment] = useState<ManualSmsaShipmentRecord | null>(null);
  const [itemEditorQuantities, setItemEditorQuantities] = useState<Record<number, number>>({});
  const [itemEditorSku, setItemEditorSku] = useState('');
  const [itemEditorSkuQty, setItemEditorSkuQty] = useState('1');
  const [itemEditorError, setItemEditorError] = useState<string | null>(null);
  const [savingItems, setSavingItems] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const addressSummary = useMemo(() => buildAddressSummary(order), [order]);

  const totals = useMemo(() => {
    let quantity = 0;
    let amount = 0;
    let weight = 0;

    draftItems.forEach((item) => {
      const qty = Number(item.quantity) || 0;
      const price = safeNumber(item.price) || 0;
      const lineWeight = safeNumber(item.weight) ?? DEFAULT_ITEM_WEIGHT;
      if (qty > 0) {
        quantity += qty;
        amount += price * qty;
        weight += lineWeight * qty;
      }
    });

    return {
      quantity,
      amount: Number(amount.toFixed(2)),
      weight: Number(weight.toFixed(2)),
    };
  }, [draftItems]);

  const selectedItems = useMemo(() => draftItems.filter((item) => Number(item.quantity) > 0), [draftItems]);

  const stripDraftItems = useCallback((): ManualSmsaShipmentItemInput[] => {
    return draftItems.map((item) => {
      const { clientKey, ...rest } = item;
      void clientKey;
      return rest;
    });
  }, [draftItems]);

  const updateFormWithSuggestions = useCallback(
    (currentOrder: SallaOrder, items: DraftShipmentItem[]) => {
      const quantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      const amount = items.reduce((sum, item) => {
        const qty = Number(item.quantity) || 0;
        const price = safeNumber(item.price) || 0;
        return sum + qty * price;
      }, 0);
      const weight = items.reduce((sum, item) => {
        const qty = Number(item.quantity) || 0;
        const w = safeNumber(item.weight) ?? DEFAULT_ITEM_WEIGHT;
        return sum + qty * w;
      }, 0);
      const codAmount = detectCodAmountFromOrder(currentOrder);

      setFormValues((prev) => ({
        ...prev,
        parcels: quantity > 0 ? String(quantity) : prev.parcels,
        declaredValue: amount > 0 ? amount.toFixed(2) : prev.declaredValue,
        weight: weight > 0 ? weight.toFixed(2) : prev.weight,
        codAmount: codAmount ? codAmount.toFixed(2) : prev.codAmount,
        contentDescription:
          prev.contentDescription ||
          `شحنة إضافية للطلب ${currentOrder.reference_id || currentOrder.order_number || currentOrder.id}`,
      }));
    },
    [],
  );

  const fetchShipments = useCallback(
    async (orderNumber: string, merchant?: string) => {
      if (!orderNumber) return;
      try {
        const params = new URLSearchParams({ orderNumber });
        if (merchant?.trim()) {
          params.set('merchantId', merchant.trim());
        }
        const response = await fetch(`/api/manual-smsa-shipments?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'تعذر تحميل الشحنات اليدوية');
        }
        setShipments(Array.isArray(data.shipments) ? data.shipments : []);
      } catch (error) {
        console.error('Failed to load manual shipments', error);
        setShipments([]);
      }
    },
    [],
  );

  const handleSearch = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!orderNumberInput.trim()) {
        setFeedback({ type: 'error', message: 'يرجى إدخال رقم الطلب من سلة' });
        setOrder(null);
        setShipments([]);
        return;
      }

      const params = new URLSearchParams({
        orderNumber: orderNumberInput.trim(),
      });
      if (merchantId.trim()) {
        params.set('merchantId', merchantId.trim());
      }

      setLoadingOrder(true);
      setFeedback(null);

      try {
        const response = await fetch(`/api/orders/lookup?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok || data.success === false || !data.order) {
          throw new Error(data.error || 'تعذر العثور على الطلب');
        }

        const loadedOrder: SallaOrder = data.order;
        setOrder(loadedOrder);
        const items = buildDraftItemsFromOrder(loadedOrder);
        setDraftItems(items);
        updateFormWithSuggestions(loadedOrder, items);
        setFeedback({ type: 'success', message: `تم تحميل الطلب ${orderNumberInput.trim()}` });
        await fetchShipments(orderNumberInput.trim(), merchantId);
      } catch (error) {
        console.error('Order lookup failed', error);
        setOrder(null);
        setShipments([]);
        setDraftItems([]);
        setFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : 'حدث خطأ أثناء البحث عن الطلب',
        });
      } finally {
        setLoadingOrder(false);
      }
    },
    [fetchShipments, merchantId, orderNumberInput, updateFormWithSuggestions],
  );

  const handleItemChange = useCallback(
    (clientKey: string, field: keyof DraftShipmentItem, value: string) => {
      setDraftItems((prev) =>
        prev.map((item) => {
          if (item.clientKey !== clientKey) return item;

          if (field === 'quantity') {
            const parsed = Number(value);
            const nextQuantity = Number.isNaN(parsed) ? item.quantity : Math.max(0, Math.floor(parsed));
            return { ...item, quantity: nextQuantity };
          }

          if (field === 'price' || field === 'weight') {
            const parsed = Number(value);
            if (Number.isNaN(parsed)) {
              return { ...item, [field]: '' };
            }
            return { ...item, [field]: parsed };
          }

          return { ...item, [field]: value };
        }),
      );
    },
    [],
  );

  const handleRemoveItem = useCallback((clientKey: string) => {
    setDraftItems((prev) => prev.filter((item) => item.clientKey !== clientKey));
  }, []);

  const handleOpenItemEditor = useCallback(
    (shipment: ManualSmsaShipmentRecord) => {
      const defaultQuantities: Record<number, number> = {};
      if (Array.isArray(order?.items)) {
        order.items.forEach((orderItem) => {
          if (typeof orderItem.id === 'number') {
            defaultQuantities[orderItem.id] = 0;
          }
        });
      }
      setItemEditorShipment(shipment);
      setItemEditorQuantities(defaultQuantities);
      setItemEditorSku('');
      setItemEditorSkuQty('1');
      setItemEditorError(null);
    },
    [order],
  );

  const handleCloseItemEditor = useCallback(() => {
    setItemEditorShipment(null);
    setItemEditorError(null);
    setItemEditorSku('');
    setItemEditorSkuQty('1');
    setItemEditorQuantities({});
  }, []);

  const updateItemEditorQuantity = useCallback((itemId: number, value: string) => {
    const parsed = Number(value);
    const nextQuantity = Number.isNaN(parsed) ? 0 : Math.max(0, Math.floor(parsed));
    setItemEditorQuantities((prev) => ({
      ...prev,
      [itemId]: nextQuantity,
    }));
  }, []);

  const handleAddItemsToShipment = useCallback(async () => {
    if (!itemEditorShipment) {
      return;
    }

    const selectedOrderItems = Object.entries(itemEditorQuantities)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({
        id: Number(id),
        quantity: qty,
      }));

    const skuCandidate = itemEditorSku.trim();
    const skuQuantity = Number(itemEditorSkuQty);
    const skuPayload =
      skuCandidate && !Number.isNaN(skuQuantity) && skuQuantity > 0
        ? [{ sku: skuCandidate, quantity: Math.floor(skuQuantity) }]
        : [];

    if (selectedOrderItems.length === 0 && skuPayload.length === 0) {
      setItemEditorError('يرجى اختيار منتج من الطلب أو إدخال SKU قبل الإضافة.');
      return;
    }

    setSavingItems(true);
    setItemEditorError(null);

    try {
      const response = await fetch(`/api/manual-smsa-shipments/${itemEditorShipment.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderItems: selectedOrderItems.length > 0 ? selectedOrderItems : undefined,
          skuItems: skuPayload.length > 0 ? skuPayload : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.success === false || !data.shipment) {
        throw new Error(data.error || 'تعذر إضافة المنتجات لهذه الشحنة');
      }

      setShipments((prev) =>
        prev.map((shipment) => (shipment.id === data.shipment.id ? data.shipment : shipment)),
      );
      handleCloseItemEditor();
    } catch (error) {
      setItemEditorError(
        error instanceof Error ? error.message : 'فشل إضافة المنتجات للشحنة',
      );
    } finally {
      setSavingItems(false);
    }
  }, [
    handleCloseItemEditor,
    itemEditorQuantities,
    itemEditorShipment,
    itemEditorSku,
    itemEditorSkuQty,
  ]);

  const handleSkuLookup = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!skuValue.trim()) {
        setSkuLookupError('يرجى إدخال SKU المنتج');
        return;
      }

      setSkuLookupError(null);
      setSkuLookupLoading(true);
      try {
        const params = new URLSearchParams({
          sku: skuValue.trim(),
          perPage: '1',
        });
        if (merchantId.trim()) {
          params.set('merchantId', merchantId.trim());
        }
        const response = await fetch(`/api/salla/products?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'لم يتم العثور على المنتج المطلوب');
        }

        const product = Array.isArray(data.products) ? data.products[0] : null;
        if (!product) {
          throw new Error('لا يوجد منتج مطابق لهذا الـ SKU');
        }

        const variation =
          Array.isArray(product.variations) &&
          product.variations.find((variant: any) => {
            if (variant.sku) {
              return variant.sku.toString().trim().toLowerCase() === skuValue.trim().toLowerCase();
            }
            return false;
          });

        const clientKey =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`;

        const name =
          variation && variation.name
            ? `${product.name} - ${variation.name}`
            : product.name;
        const price =
          safeNumber(variation?.price?.amount) ??
          safeNumber(product.price?.amount) ??
          safeNumber(product.price) ??
          0;

        setDraftItems((prev) => [
          ...prev,
          {
            clientKey,
            productId: variation?.id ?? product.id,
            variantId: variation?.id ?? null,
            name,
            sku: variation?.sku || product.sku || skuValue.trim(),
            quantity: 1,
            price: price || undefined,
            weight: DEFAULT_ITEM_WEIGHT,
            source: 'manual',
          },
        ]);
        setSkuValue('');
        setSkuLookupError(null);
      } catch (error) {
        setSkuLookupError(
          error instanceof Error ? error.message : 'فشل جلب بيانات المنتج من سلة',
        );
      } finally {
        setSkuLookupLoading(false);
      }
    },
    [merchantId, skuValue],
  );

  const handleCreateShipment = useCallback(async () => {
    if (!order) {
      setFeedback({ type: 'error', message: 'يرجى تحميل الطلب أولاً' });
      return;
    }

    const validItems = selectedItems;
    if (validItems.length === 0) {
      setFeedback({ type: 'error', message: 'يجب اختيار منتج واحد على الأقل للشحنة' });
      return;
    }

    setCreatingShipment(true);
    setFeedback(null);
    try {
      const payload = {
        merchantId: merchantId || undefined,
        orderNumber: orderNumberInput.trim(),
        items: stripDraftItems(),
        parcels: formValues.parcels || undefined,
        declaredValue: formValues.declaredValue || undefined,
        weight: formValues.weight || undefined,
        codAmount: formValues.codAmount || undefined,
        contentDescription: formValues.contentDescription || undefined,
      };

      const response = await fetch('/api/manual-smsa-shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'تعذر إنشاء الشحنة');
      }

      setFeedback({
        type: 'success',
        message: `تم إنشاء شحنة جديدة برقم ${data.shipment?.smsaTrackingNumber || ''}`,
      });
      await fetchShipments(orderNumberInput.trim(), merchantId);
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'فشل إنشاء الشحنة اليدوية',
      });
    } finally {
      setCreatingShipment(false);
    }
  }, [
    fetchShipments,
    formValues.codAmount,
    formValues.contentDescription,
    formValues.declaredValue,
    formValues.parcels,
    formValues.weight,
    merchantId,
    order,
    orderNumberInput,
    selectedItems,
    stripDraftItems,
  ]);

  const handleCancelShipment = useCallback(
    async (shipment: ManualSmsaShipmentRecord) => {
      if (!shipment || shipment.cancelledAt) return;
      const confirmCancel = window.confirm(
        `سيتم طلب إلغاء الشحنة ${shipment.smsaTrackingNumber || shipment.id} من سمسا. هل أنت متأكد؟`,
      );
      if (!confirmCancel) return;

      try {
        const response = await fetch(`/api/manual-smsa-shipments/${shipment.id}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'manual-multi-shipment-page' }),
        });
        const data = await response.json();
        if (!response.ok || data.success === false) {
          throw new Error(data.error || 'تعذر إلغاء الشحنة');
        }
        setShipments((prev) =>
          prev.map((s) => (s.id === shipment.id ? data.shipment : s)),
        );
        setFeedback({
          type: 'success',
          message: data.message || 'تم إلغاء الشحنة بنجاح',
        });
      } catch (error) {
        setFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : 'فشل إلغاء الشحنة',
        });
      }
    },
    [],
  );

  const handleDeleteShipment = useCallback(async (shipment: ManualSmsaShipmentRecord) => {
    if (!shipment.cancelledAt) {
      setFeedback({ type: 'error', message: 'يجب إلغاء الشحنة قبل حذفها' });
      return;
    }
    const confirmDelete = window.confirm('سيتم إزالة هذه الشحنة من السجل، هل ترغب بالمتابعة؟');
    if (!confirmDelete) return;

    try {
      const response = await fetch(`/api/manual-smsa-shipments/${shipment.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'تعذر حذف الشحنة');
      }
      setShipments((prev) => prev.filter((item) => item.id !== shipment.id));
      setFeedback({ type: 'success', message: 'تم حذف الشحنة' });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'فشل حذف الشحنة',
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar />
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl flex items-center gap-2">
              <Truck className="h-5 w-5" />
              إنشاء شحنات SMSA إضافية
            </CardTitle>
            <CardDescription>
              استخدم هذه الصفحة لإنشاء أكثر من شحنة لنفس طلب سلة مع الاحتفاظ بنفس عنوان العميل.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSearch}
              className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end"
            >
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  رقم طلب سلة
                </label>
                <Input
                  value={orderNumberInput}
                  onChange={(e) => setOrderNumberInput(e.target.value)}
                  placeholder="مثال: 123456789"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  معرف التاجر (إن وجد)
                </label>
                <Input
                  value={merchantId}
                  onChange={(e) => setMerchantId(e.target.value)}
                  placeholder="استخدم الافتراضي إن كان الحقل فارغاً"
                />
              </div>
              <Button type="submit" disabled={loadingOrder}>
                {loadingOrder ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    جاري البحث
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    بحث
                  </>
                )}
              </Button>
            </form>
            {feedback && (
              <div
                className={`mt-4 rounded-lg border p-3 text-sm ${
                  feedback.type === 'success'
                    ? 'border-green-200 bg-green-50 text-green-800'
                    : 'border-red-200 bg-red-50 text-red-800'
                }`}
              >
                {feedback.message}
              </div>
            )}
          </CardContent>
        </Card>

        {order && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <PackageSearch className="h-4 w-4" />
                  تفاصيل الطلب
                </CardTitle>
                <CardDescription>معلومات الطلب الأساسي من سلة</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">رقم الطلب:</span>
                  <span className="font-semibold">{order.reference_id || order.order_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">الحالة:</span>
                  <span className="font-semibold">{order.status?.name || order.status?.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">إجمالي الطلب:</span>
                  <span className="font-semibold">
                    {formatCurrency(
                      safeNumber((order as any)?.amounts?.total?.amount) ?? null,
                      order.amounts?.total?.currency,
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">اسم العميل:</span>
                  <span className="font-semibold">{order.customer?.name || order.customer?.full_name}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-gray-600">العنوان:</span>
                  <span className="font-semibold whitespace-pre-line leading-relaxed">
                    {addressSummary.join('\n')}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  إعدادات الشحنة
                </CardTitle>
                <CardDescription>راجع الأوزان والقيم قبل الإرسال</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-600">عدد القطع</label>
                    <Input
                      value={formValues.parcels}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, parcels: e.target.value }))
                      }
                      placeholder={totals.quantity ? totals.quantity.toString() : 'مثال: 2'}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">الوزن الكلي (كجم)</label>
                    <Input
                      value={formValues.weight}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, weight: e.target.value }))
                      }
                      placeholder={totals.weight ? totals.weight.toString() : 'مثال: 1.5'}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-600">القيمة المصرح بها (SAR)</label>
                    <Input
                      value={formValues.declaredValue}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, declaredValue: e.target.value }))
                      }
                      placeholder={totals.amount ? totals.amount.toString() : 'مثال: 350'}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">مبلغ الدفع عند الاستلام (اختياري)</label>
                    <Input
                      value={formValues.codAmount}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, codAmount: e.target.value }))
                      }
                      placeholder="اتركه فارغاً للطلبات المدفوعة مسبقاً"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-600">وصف المحتوى</label>
                  <Input
                    value={formValues.contentDescription}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, contentDescription: e.target.value }))
                    }
                    placeholder="مثال: شحنة تعويض لطلب #123"
                  />
                </div>
                <div className="text-sm text-gray-600">
                  <p>مجموع الكميات المحددة: {totals.quantity || 0} قطعة</p>
                  <p>القيمة المقترحة: {formatCurrency(totals.amount, order.amounts?.total?.currency)}</p>
                  <p>الوزن التقديري: {totals.weight || 0} كجم</p>
                </div>
              </CardContent>
              <CardFooter className="justify-end">
                <Button
                  onClick={handleCreateShipment}
                  disabled={creatingShipment}
                  className="w-full md:w-auto"
                >
                  {creatingShipment ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      جاري إنشاء الشحنة
                    </>
                  ) : (
                    <>
                      <Truck className="mr-2 h-4 w-4" />
                      إنشاء شحنة SMSA
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}

        {order && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">المنتجات المرسلة في الشحنة الجديدة</CardTitle>
              <CardDescription>
                قم بتعديل الكميات وإضافة منتجات أخرى من سلة إذا لزم الأمر.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-end gap-3">
                <form onSubmit={handleSkuLookup} className="flex-1 flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-600">إضافة منتج عبر SKU</label>
                    <Input
                      value={skuValue}
                      onChange={(e) => setSkuValue(e.target.value)}
                      placeholder="أدخل SKU المنتج لإضافته للشحنة"
                    />
                  </div>
                  <Button type="submit" disabled={skuLookupLoading}>
                    {skuLookupLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                </form>
                {skuLookupError && (
                  <p className="text-sm text-red-600">{skuLookupError}</p>
                )}
              </div>
              <div className="overflow-x-auto border rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100 text-right text-sm text-gray-600">
                    <tr>
                      <th className="px-3 py-2">المنتج</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2 w-24">الكمية</th>
                      <th className="px-3 py-2 w-28">السعر للوحدة</th>
                      <th className="px-3 py-2 w-28">الوزن (كجم)</th>
                      <th className="px-3 py-2 w-16">إزالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-sm">
                    {draftItems.map((item) => (
                      <tr key={item.clientKey} className="bg-white">
                        <td className="px-3 py-2">
                          <div className="font-semibold">{item.name}</div>
                          <div className="text-xs text-gray-500">
                            {item.source === 'order' ? 'من الطلب الأساسي' : 'مضاف يدوياً'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{item.sku || '—'}</td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0}
                            value={item.quantity}
                            onChange={(e) => handleItemChange(item.clientKey, 'quantity', e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.price ?? ''}
                            onChange={(e) => handleItemChange(item.clientKey, 'price', e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.1"
                            value={item.weight ?? ''}
                            onChange={(e) => handleItemChange(item.clientKey, 'weight', e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveItem(item.clientKey)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {draftItems.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-6">
                  لا توجد منتجات محددة حالياً. قم بإعادة تحميل الطلب أو أضف منتجات يدوياً.
                </p>
              )}
            </CardContent>
            <CardFooter className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (!order) return;
                  const items = buildDraftItemsFromOrder(order);
                  setDraftItems(items);
                  updateFormWithSuggestions(order, items);
                }}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                إعادة تحميل منتجات الطلب
              </Button>
            </CardFooter>
          </Card>
        )}

        {order && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">الشحنات اليدوية الحالية</CardTitle>
              <CardDescription>ألغِ أو احذف الشحنات الإضافية المرتبطة بهذا الطلب.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {shipments.length === 0 && (
                <p className="text-gray-500 text-sm">
                  لا توجد شحنات يدوية لهذا الطلب بعد.
                </p>
              )}
              {shipments.map((shipment) => (
                <div
                  key={shipment.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col gap-3"
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <div className="text-sm text-gray-500">رقم التتبع</div>
                      <div className="font-semibold text-lg">
                        {shipment.smsaTrackingNumber || '—'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <span
                        className={`px-3 py-1 rounded-full ${
                          shipment.status === 'cancelled'
                            ? 'bg-red-50 text-red-700 border border-red-100'
                            : shipment.cancelledAt
                              ? 'bg-gray-100 text-gray-700 border border-gray-200'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                        }`}
                      >
                        {shipment.status === 'cancelled'
                          ? 'ملغاة'
                          : shipment.cancelledAt
                            ? 'تم الإلغاء'
                            : 'نشطة'}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                        {formatDateTime(shipment.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="text-sm text-gray-700">
                    <p>القيمة المصرح بها: {formatCurrency(shipment.declaredValue, shipment.currency)}</p>
                    <p>عدد القطع: {shipment.parcels} • الوزن: {shipment.weight || 0} كجم</p>
                    {shipment.codAmount && (
                      <p>تحصيل عند الاستلام: {formatCurrency(shipment.codAmount, shipment.currency)}</p>
                    )}
                    {shipment.smsaLabelDataUrl && (
                      <a
                        href={shipment.smsaLabelDataUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 mt-1"
                      >
                        <FileText className="h-4 w-4" />
                        طباعة بوليصة الشحن
                      </a>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">المنتجات:</div>
                    <ul className="text-sm list-disc list-inside text-gray-700 space-y-1">
                      {shipment.shipmentItems.map((item, idx) => (
                        <li key={`${shipment.id}-${idx}`}>
                          {item.name} — الكمية {item.quantity} — SKU {item.sku || '—'}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleOpenItemEditor(shipment)}
                      disabled={!order}
                    >
                      إضافة منتجات
                    </Button>
                    {!shipment.cancelledAt && (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => handleCancelShipment(shipment)}
                      >
                        إلغاء الشحنة
                      </Button>
                    )}
                    {shipment.cancelledAt && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => handleDeleteShipment(shipment)}
                      >
                        حذف من السجل
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {itemEditorShipment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold">
                  إضافة منتجات للشحنة{' '}
                  {itemEditorShipment.smsaTrackingNumber || itemEditorShipment.id}
                </h3>
                <p className="text-sm text-gray-500">
                  اختر منتجات من الطلب أو أدخل SKU لإبلاغ المستودع بما سيتم شحنه.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseItemEditor}
                className="rounded-full p-2 text-gray-500 hover:text-gray-700"
                aria-label="إغلاق"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[32rem] overflow-y-auto px-6 py-4 space-y-6">
              <div>
                <h4 className="font-medium mb-2">منتجات الطلب</h4>
                {Array.isArray(order?.items) && order.items.length > 0 ? (
                  <div className="space-y-3">
                    {order.items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-3 sm:flex sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="font-semibold text-gray-800">{item.name}</p>
                          <p className="text-sm text-gray-600">
                            SKU: {item.sku || item.product?.sku || '—'}
                          </p>
                        </div>
                        <div className="mt-3 sm:mt-0 sm:w-32">
                          <label className="text-xs text-gray-500">
                            الكمية لهذه الشحنة
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={itemEditorQuantities[item.id] ?? 0}
                            onChange={(e) => updateItemEditorQuantity(item.id, e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">
                    لا توجد بيانات للمنتجات من الطلب الحالي. يمكنك إدخال المنتجات عبر SKU أدناه.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-dashed border-gray-300 p-4 space-y-3">
                <h4 className="font-medium">إضافة منتج عبر SKU</h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                  <div>
                    <label className="text-xs text-gray-500">SKU من سلة</label>
                    <Input
                      value={itemEditorSku}
                      onChange={(e) => setItemEditorSku(e.target.value)}
                      placeholder="مثال: ABC-123"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">الكمية</label>
                    <Input
                      type="number"
                      min={1}
                      value={itemEditorSkuQty}
                      onChange={(e) => setItemEditorSkuQty(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  سيتم التحقق من SKU مباشرة من واجهة سلة قبل إضافته.
                </p>
              </div>

              {itemEditorError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
                  {itemEditorError}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <Button variant="ghost" onClick={handleCloseItemEditor}>
                إلغاء
              </Button>
              <Button onClick={handleAddItemsToShipment} disabled={savingItems}>
                {savingItems ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    جارٍ الإضافة
                  </>
                ) : (
                  'إضافة المنتجات'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManualSmsaClient;
