'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { BellRing, CheckCircle2, Loader2, MessageCircle, PackageSearch, Search } from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type {
  SallaPaginationMeta,
  SallaProductSummary,
  SallaProductVariation,
} from '@/app/lib/salla-api';

const PAGE_SIZE = 60;
const DEFAULT_TEMPLATE_ID = 'notify_available';
const DEFAULT_TEMPLATE_LANGUAGE = 'ar';

type AvailabilityRequestRecord = {
  id: string;
  productId: number;
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  variationId?: string | null;
  variationName?: string | null;
  requestedSize?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerEmail?: string | null;
  customerPhone: string;
  notes?: string | null;
  status: 'pending' | 'notified' | 'cancelled';
  requestedBy: string;
  requestedByUser?: string | null;
  notifiedAt?: string | null;
  notifiedBy?: string | null;
  createdAt: string;
  updatedAt?: string;
};

type NewAvailabilityRequestPayload = {
  variationId?: string;
  variationName?: string;
  requestedSize?: string;
  customerFirstName?: string;
  customerLastName?: string;
  customerEmail?: string;
  customerPhone: string;
  notes?: string;
};

type ActionResult = { success: true } | { success: false; error: string };

type AvailabilityStatusFilter = 'all' | AvailabilityRequestRecord['status'];
type SubscriberAvailabilityFilter = 'all' | 'available' | 'unavailable';

type SubscriberProductOption = {
  id: number;
  name: string;
  sku?: string | null;
  sizeSample?: string | null;
};

function formatCurrency(value: number | null | undefined, currency?: string) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'SAR',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency || ''}`.trim();
  }
}

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDate(value?: string | null) {
  if (!value) {
    return 'غير محدد';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SallaNotifyPage() {
  const router = useRouter();
  const { status } = useSession();
  const [products, setProducts] = useState<SallaProductSummary[]>([]);
  const [pagination, setPagination] = useState<SallaPaginationMeta | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchSku, setSearchSku] = useState('');
  const [skuInput, setSkuInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variationsMap, setVariationsMap] = useState<Record<number, SallaProductVariation[]>>({});
  const [productVariationErrors, setProductVariationErrors] = useState<Record<number, string>>({});
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [variationsGlobalError, setVariationsGlobalError] = useState<string | null>(null);
  const [rowVariationsLoading, setRowVariationsLoading] = useState<Record<number, boolean>>({});
  const [availabilityRequests, setAvailabilityRequests] = useState<
    Record<number, AvailabilityRequestRecord[]>
  >({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [requestStatusFilter, setRequestStatusFilter] = useState<AvailabilityStatusFilter>('all');
  const [showOnlyWithRequests, setShowOnlyWithRequests] = useState(false);
  const [activeTab, setActiveTab] = useState<'products' | 'subscribers'>('products');
  const [allRequests, setAllRequests] = useState<AvailabilityRequestRecord[]>([]);
  const [allRequestsLoading, setAllRequestsLoading] = useState(false);
  const [allRequestsError, setAllRequestsError] = useState<string | null>(null);
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());
  const [subscriberProductSearch, setSubscriberProductSearch] = useState('');
  const [subscriberParentProductFilter, setSubscriberParentProductFilter] = useState('');
  const [subscriberAvailabilityFilter, setSubscriberAvailabilityFilter] =
    useState<SubscriberAvailabilityFilter>('all');
  const [subscriberStockMap, setSubscriberStockMap] = useState<Record<
    number,
    { hasStock: boolean }
  >>({});
  const [subscriberStockLoading, setSubscriberStockLoading] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const variationsRequestId = useRef(0);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    }
  }, [status, router]);

  const fetchProducts = useCallback(
    async (page: number, sku: string) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: page.toString(),
          perPage: PAGE_SIZE.toString(),
        });
        if (sku) {
          params.set('sku', sku);
        }

        const response = await fetch(`/api/salla/products?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحميل منتجات سلة');
        }

        setProducts(Array.isArray(data.products) ? data.products : []);
        setPagination(data.pagination ?? null);
        setMerchantId(typeof data.merchantId === 'string' ? data.merchantId : null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء تحميل المنتجات');
        setProducts([]);
        setPagination(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchVariations = useCallback(
    async (items: SallaProductSummary[]) => {
      if (!items || items.length === 0) {
        setVariationsMap({});
        setProductVariationErrors({});
        setVariationsGlobalError(null);
        setVariationsLoading(false);
        setRowVariationsLoading({});
        return;
      }

      const ids = items.map((item) => item.id);
      const requestId = Date.now();
      variationsRequestId.current = requestId;
      setVariationsLoading(true);
      setVariationsGlobalError(null);
      setProductVariationErrors({});
      setRowVariationsLoading({});

      try {
        const response = await fetch('/api/salla/products/variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productIds: ids }),
        });
        const data = await response.json();

        if (variationsRequestId.current !== requestId) {
          return;
        }

        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحميل متغيرات المنتجات');
        }

        const normalized: Record<number, SallaProductVariation[]> = {};
        Object.entries(data.variations ?? {}).forEach(([key, value]) => {
          const parsed = Number.parseInt(key, 10);
          if (Number.isFinite(parsed)) {
            normalized[parsed] = Array.isArray(value) ? value : [];
          }
        });
        items.forEach((item) => {
          if (!normalized[item.id]) {
            normalized[item.id] = [];
          }
        });

        const perProductErrors: Record<number, string> = {};
        if (Array.isArray(data.failed)) {
          data.failed.forEach((entry: { productId?: number; message?: string }) => {
            if (!entry || typeof entry.productId !== 'number') {
              return;
            }
            perProductErrors[entry.productId] =
              entry.message || 'تعذر تحميل متغيرات هذا المنتج من سلة';
          });
        }

        setVariationsMap(normalized);
        setProductVariationErrors(perProductErrors);
        setVariationsGlobalError(null);
      } catch (err) {
        if (variationsRequestId.current !== requestId) {
          return;
        }
        const message =
          err instanceof Error ? err.message : 'تعذر تحميل متغيرات المنتجات';
        setVariationsMap({});
        setProductVariationErrors({});
        setVariationsGlobalError(message);
        setRowVariationsLoading({});
      } finally {
        if (variationsRequestId.current === requestId) {
          setVariationsLoading(false);
        }
      }
    },
    []
  );

  const fetchAvailabilityRequests = useCallback(
    async (productIds: number[], status?: AvailabilityRequestRecord['status']) => {
      if (!productIds || productIds.length === 0) {
        setAvailabilityRequests({});
        return;
      }

      setAvailabilityLoading(true);
      setAvailabilityError(null);

      try {
        const params = new URLSearchParams();
        productIds.forEach((id) => params.append('productId', id.toString()));
        if (status) {
          params.set('status', status);
        }
        const response = await fetch(`/api/salla/availability-requests?${params.toString()}`, {
          cache: 'no-store',
        });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'تعذر تحميل طلبات الإشعار');
      }

      const map: Record<number, AvailabilityRequestRecord[]> = {};
      productIds.forEach((id) => {
        map[id] = [];
      });

      if (Array.isArray(data.requests)) {
        data.requests.forEach((request: AvailabilityRequestRecord) => {
          if (!map[request.productId]) {
            map[request.productId] = [];
          }
          map[request.productId].push(request);
        });
      }

      Object.keys(map).forEach((key) => {
        const id = Number.parseInt(key, 10);
        map[id] = map[id].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });

      setAvailabilityRequests(map);
    } catch (err) {
      setAvailabilityError(
        err instanceof Error ? err.message : 'تعذر تحميل طلبات الإشعار لهذا المنتج'
      );
      setAvailabilityRequests({});
    } finally {
      setAvailabilityLoading(false);
    }
  },
    []
  );

  const fetchAllAvailabilityRequests = useCallback(
    async (status?: AvailabilityRequestRecord['status']) => {
      setAllRequestsLoading(true);
      setAllRequestsError(null);
      try {
        const params = new URLSearchParams();
        if (status) {
          params.set('status', status);
        }
        const response = await fetch(`/api/salla/availability-requests?${params.toString()}`, {
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحميل جميع طلبات الإشعار');
        }
        const list: AvailabilityRequestRecord[] = Array.isArray(data.requests) ? data.requests : [];
        setAllRequests(list);
      } catch (error) {
        setAllRequestsError(
          error instanceof Error ? error.message : 'تعذر تحميل قائمة المشتركين'
        );
        setAllRequests([]);
      } finally {
        setAllRequestsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (status === 'authenticated') {
      fetchProducts(currentPage, searchSku);
    }
  }, [status, currentPage, searchSku, fetchProducts]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    if (products.length === 0) {
      setVariationsMap({});
      setProductVariationErrors({});
      setVariationsGlobalError(null);
      setVariationsLoading(false);
      return;
    }
    fetchVariations(products);
  }, [status, products, fetchVariations]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    if (products.length === 0) {
      setAvailabilityRequests({});
      return;
    }
    const ids = products.map((product) => product.id);
    const statusFilterParam =
      requestStatusFilter === 'all' ? undefined : requestStatusFilter;
    fetchAvailabilityRequests(ids, statusFilterParam);
  }, [status, products, fetchAvailabilityRequests, requestStatusFilter]);

  useEffect(() => {
    if (status !== 'authenticated') {
      return;
    }
    if (activeTab !== 'subscribers') {
      return;
    }
    const statusFilterParam =
      requestStatusFilter === 'all' ? undefined : requestStatusFilter;
    fetchAllAvailabilityRequests(statusFilterParam);
  }, [status, activeTab, requestStatusFilter, fetchAllAvailabilityRequests]);

  const handleRefreshSubscribers = useCallback(() => {
    const statusFilterParam =
      requestStatusFilter === 'all' ? undefined : requestStatusFilter;
    fetchAllAvailabilityRequests(statusFilterParam);
  }, [fetchAllAvailabilityRequests, requestStatusFilter]);

  const visibleProducts = useMemo(() => {
    if (!showOnlyWithRequests) {
      return products;
    }
    const matchesStatus = (request: AvailabilityRequestRecord) =>
      requestStatusFilter === 'all' || request.status === requestStatusFilter;
    return products.filter((product) => {
      const productRequests = availabilityRequests[product.id] ?? [];
      return productRequests.some(matchesStatus);
    });
  }, [products, availabilityRequests, showOnlyWithRequests, requestStatusFilter]);

  const filteredAllRequests = useMemo(() => {
    const statusFiltered =
      requestStatusFilter === 'all'
        ? allRequests
        : allRequests.filter((request) => request.status === requestStatusFilter);
    const productIdFilter =
      subscriberParentProductFilter.length > 0
        ? Number.parseInt(subscriberParentProductFilter, 10)
        : null;
    const parentFiltered =
      productIdFilter && Number.isFinite(productIdFilter)
        ? statusFiltered.filter((request) => request.productId === productIdFilter)
        : statusFiltered;
    const term = subscriberProductSearch.trim().toLowerCase();
    const searchFiltered = term
      ? parentFiltered.filter((request) => {
          const name = request.productName?.toLowerCase() || '';
          const sku = request.productSku?.toLowerCase() || '';
          const variation = request.variationName?.toLowerCase() || '';
          return name.includes(term) || sku.includes(term) || variation.includes(term);
        })
      : parentFiltered;
    if (subscriberAvailabilityFilter === 'available') {
      return searchFiltered.filter((request) => subscriberStockMap[request.productId]?.hasStock);
    }
    if (subscriberAvailabilityFilter === 'unavailable') {
      return searchFiltered.filter((request) => subscriberStockMap[request.productId]?.hasStock === false);
    }
    return searchFiltered;
  }, [
    allRequests,
    requestStatusFilter,
    subscriberParentProductFilter,
    subscriberProductSearch,
    subscriberAvailabilityFilter,
    subscriberStockMap,
  ]);

  useEffect(() => {
    setSelectedRequestIds((prev) => {
      const availableIds = new Set(filteredAllRequests.map((request) => request.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (availableIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [filteredAllRequests]);

  const fetchSubscriberStock = useCallback(
    async (productIds: number[]) => {
      const uniqueIds = Array.from(new Set(productIds)).filter((id) => Number.isFinite(id));
      if (uniqueIds.length === 0) {
        setSubscriberStockMap({});
        return;
      }
      setSubscriberStockLoading(true);
      try {
        const response = await fetch('/api/salla/products/variations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productIds: uniqueIds }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر جلب توفر المنتجات');
        }
        const map: Record<number, { hasStock: boolean }> = {};
        uniqueIds.forEach((id) => {
          const variations: SallaProductVariation[] = Array.isArray(data.variations?.[id])
            ? data.variations[id]
            : [];
          const hasStock = variations.some((variation) => {
            const raw = variation?.availableQuantity;
            const quantity =
              typeof raw === 'number' ? raw : raw != null ? Number(raw) : null;
            return quantity != null && Number.isFinite(quantity) && quantity > 0;
          });
          map[id] = { hasStock };
        });
        setSubscriberStockMap(map);
      } catch (error) {
        console.error('failed to load subscriber stock', error);
        setSubscriberStockMap({});
      } finally {
        setSubscriberStockLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (activeTab !== 'subscribers') {
      return;
    }
    const ids = allRequests.map((request) => request.productId).filter((id) => Number.isFinite(id));
    fetchSubscriberStock(ids);
  }, [activeTab, allRequests, fetchSubscriberStock]);

  const subscriberProductOptions: SubscriberProductOption[] = useMemo(() => {
    const map = new Map<number, SubscriberProductOption>();
    allRequests.forEach((request) => {
      if (!request || typeof request.productId !== 'number') {
        return;
      }
      if (!map.has(request.productId)) {
        const sizeSample = request.requestedSize || request.variationName || '';
        map.set(request.productId, {
          id: request.productId,
          name: request.productName || `#${request.productId}`,
          sku: request.productSku || null,
          sizeSample: sizeSample || null,
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [allRequests]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = skuInput.trim();
    setCurrentPage(1);
    setSearchSku(trimmed);
  };

  const handlePageChange = (direction: 'prev' | 'next') => {
    setCurrentPage((prev) => {
      const totalPages = pagination?.totalPages ?? 1;
      if (direction === 'prev') {
        return Math.max(prev - 1, 1);
      }
      return Math.min(prev + 1, totalPages);
    });
  };

  const handleCreateAvailabilityRequest = useCallback(
    async (
      product: SallaProductSummary,
      payload: NewAvailabilityRequestPayload
    ): Promise<ActionResult> => {
      try {
        const response = await fetch('/api/salla/availability-requests', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            productImageUrl: product.imageUrl,
            merchantId,
            variationId: payload.variationId,
            variationName: payload.variationName,
            requestedSize: payload.requestedSize,
            customerFirstName: payload.customerFirstName,
            customerLastName: payload.customerLastName,
            customerEmail: payload.customerEmail,
            customerPhone: payload.customerPhone,
            notes: payload.notes,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر حفظ طلب الإشعار');
        }
        const created: AvailabilityRequestRecord = data.request;
        setAvailabilityRequests((prev) => {
          const updated = { ...prev };
          const list = updated[product.id] ? [created, ...updated[product.id]] : [created];
          updated[product.id] = list;
          return updated;
        });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'تعذر حفظ طلب الإشعار',
        };
      }
    },
    [merchantId]
  );

  const upsertAvailabilityRequest = useCallback((updated: AvailabilityRequestRecord) => {
    setAvailabilityRequests((prev) => {
      const next = { ...prev };
      const currentList = next[updated.productId] ? [...next[updated.productId]] : [];
      const existingIndex = currentList.findIndex((entry) => entry.id === updated.id);
      if (existingIndex >= 0) {
        currentList[existingIndex] = updated;
      } else {
        currentList.unshift(updated);
      }
      next[updated.productId] = currentList;
      return next;
    });
    setAllRequests((prev) => {
      if (!prev || prev.length === 0) {
        return [updated];
      }
      const index = prev.findIndex((entry) => entry.id === updated.id);
      if (index >= 0) {
        const clone = [...prev];
        clone[index] = updated;
        return clone;
      }
      return [updated, ...prev];
    });
  }, []);

  const handleMarkRequestNotified = useCallback(
    async (requestId: string): Promise<ActionResult> => {
      try {
        const response = await fetch(`/api/salla/availability-requests/${requestId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'notified' }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحديث حالة الطلب');
        }
        const updated: AvailabilityRequestRecord | undefined = data.request;
        if (updated) {
          upsertAvailabilityRequest(updated);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'تعذر تحديث حالة الطلب',
        };
      }
    },
    [upsertAvailabilityRequest]
  );

  const handleSendZokoMessage = useCallback(
    async (requestId: string): Promise<ActionResult> => {
      try {
        const response = await fetch(`/api/salla/availability-requests/${requestId}/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateId: DEFAULT_TEMPLATE_ID,
            templateLanguage: DEFAULT_TEMPLATE_LANGUAGE,
            message: ' ',
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر إرسال رسالة واتساب');
        }
        const updated: AvailabilityRequestRecord | undefined = data.request;
        if (updated) {
          upsertAvailabilityRequest(updated);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'تعذر إرسال رسالة واتساب',
        };
      }
    },
    [upsertAvailabilityRequest]
  );

  const toggleSelectRequest = useCallback((requestId: string) => {
    setSelectedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setSelectedRequestIds(new Set());
        return;
      }
      const ids = filteredAllRequests.map((request) => request.id);
      setSelectedRequestIds(new Set(ids));
    },
    [filteredAllRequests]
  );
  const clearSelection = useCallback(() => {
    setSelectedRequestIds(new Set());
  }, []);

  const handleBulkSend = useCallback(async () => {
    const ids = Array.from(selectedRequestIds);
    if (ids.length === 0) {
      setBulkFeedback({ type: 'error', message: 'اختر عميلين على الأقل قبل إرسال الرسالة.' });
      return;
    }
    setBulkSending(true);
    setBulkFeedback(null);
    try {
      const response = await fetch('/api/salla/availability-requests/bulk-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestIds: ids,
          templateId: DEFAULT_TEMPLATE_ID,
          templateLanguage: DEFAULT_TEMPLATE_LANGUAGE,
          message: ' ',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر إرسال الرسائل');
      }
      const updatedRecords: AvailabilityRequestRecord[] = Array.isArray(data.updatedRequests)
        ? data.updatedRequests
        : [];
      updatedRecords.forEach((record) => upsertAvailabilityRequest(record));
      const sentCount = typeof data.sentCount === 'number' ? data.sentCount : updatedRecords.length;
      const failedCount = typeof data.failedCount === 'number' ? data.failedCount : 0;
      const successIds = Array.isArray(data.results)
        ? data.results
            .filter((entry: { id?: string; success?: boolean }) => entry?.success && entry?.id)
            .map((entry: { id?: string }) => String(entry.id))
        : updatedRecords.map((record) => record.id);
      if (sentCount === 0) {
        throw new Error(data?.error || 'لم يتم إرسال أي رسالة. تأكد من صحة البيانات.');
      }
      if (successIds.length > 0) {
        setSelectedRequestIds((prev) => {
          const next = new Set(prev);
          successIds.forEach((id: string) => next.delete(id));
          return next;
        });
      }
      const messageText =
        failedCount > 0
          ? `تم إرسال ${sentCount} رسائل، وتعذر إرسال ${failedCount} رسائل.`
          : `تم إرسال الرسالة إلى ${sentCount} عميل.`;
      setBulkFeedback({ type: 'success', message: messageText });
      const statusFilterParam =
        requestStatusFilter === 'all' ? undefined : requestStatusFilter;
      if (activeTab === 'subscribers') {
        fetchAllAvailabilityRequests(statusFilterParam);
      }
    } catch (error) {
      setBulkFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'تعذر إرسال الرسائل المحددة',
      });
    } finally {
      setBulkSending(false);
    }
  }, [activeTab, fetchAllAvailabilityRequests, requestStatusFilter, selectedRequestIds, upsertAvailabilityRequest]);

  const refreshVariationsForProduct = useCallback(
    async (productId: number) => {
      if (!productId) {
        return;
      }
      setRowVariationsLoading((prev) => ({ ...prev, [productId]: true }));
      try {
        const response = await fetch('/api/salla/products/variations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ productIds: [productId] }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحديث بيانات المتغير');
        }

        const variations = Array.isArray(data.variations?.[productId])
          ? data.variations[productId]
          : [];

        setVariationsMap((prev) => ({
          ...prev,
          [productId]: variations,
        }));

        setProductVariationErrors((prev) => {
          const next = { ...prev };
          const productError = Array.isArray(data.failed)
            ? data.failed.find((entry: { productId?: number }) => entry.productId === productId)
            : null;
          if (productError) {
            next[productId] =
              (productError as { message?: string }).message ||
              'تعذر تحميل متغيرات هذا المنتج من سلة';
          } else {
            delete next[productId];
          }
          return next;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'تعذر تحديث متغيرات هذا المنتج';
        setProductVariationErrors((prev) => ({
          ...prev,
          [productId]: message,
        }));
      } finally {
        setRowVariationsLoading((prev) => {
          const next = { ...prev };
          delete next[productId];
          return next;
        });
      }
    },
    []
  );

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (status !== 'authenticated') {
    return null;
  }

  const totalPages = pagination?.totalPages ?? 1;
  const totalProducts = pagination?.total ?? products.length;
  const totalSubscribers = filteredAllRequests.length;
  const displayedCount = activeTab === 'products' ? visibleProducts.length : totalSubscribers;
  const summaryLabel =
    activeTab === 'products' ? 'عدد المنتجات المعروضة' : 'عدد المشتركين المعروضين';
  const summarySubtext =
    activeTab === 'products'
      ? `من أصل ${formatNumber(totalProducts)}`
      : `إجمالي السجلات: ${formatNumber(allRequests.length)}`;
  const selectedCount = selectedRequestIds.size;
  const allSelected =
    filteredAllRequests.length > 0 &&
    filteredAllRequests.every((request) => selectedRequestIds.has(request.id));

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50">
      <AppNavbar />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-slate-100 bg-white/95 shadow-xl shadow-slate-200/60">
          <Card className="border-none bg-transparent shadow-none">
            <CardHeader className="space-y-6">
              <div className="flex flex-col gap-4 text-slate-900 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.35em] text-indigo-500">
                    سلة — الفريق التجاري
                  </p>
                  <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-100">
                      <BellRing className="h-6 w-6 text-indigo-600" />
                    </span>
                    ابلغني عند التوفر
                  </h1>
                  <p className="mt-4 text-base text-slate-600">
                    دوّن طلبات العملاء للتواصل معهم فور توفر المقاس المطلوب. هذه الصفحة مخصصة لموظفي
                    المتاجر لتسجيل بيانات “أبلغني”.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant={activeTab === 'products' ? 'default' : 'outline'}
                      className="rounded-2xl px-6 py-3 text-sm"
                      onClick={() => setActiveTab('products')}
                    >
                      عرض المنتجات
                    </Button>
                    <Button
                      type="button"
                      variant={activeTab === 'subscribers' ? 'default' : 'outline'}
                      className="rounded-2xl px-6 py-3 text-sm"
                      onClick={() => setActiveTab('subscribers')}
                    >
                      قائمة المشتركين
                    </Button>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-6 py-4 text-center">
                  <p className="text-sm text-slate-500">{summaryLabel}</p>
                  <p className="text-3xl font-semibold text-slate-900">{formatNumber(displayedCount)}</p>
                  <p className="text-xs text-slate-400">{summarySubtext}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 border-t border-slate-100 pt-6">
              {activeTab === 'products' ? (
                <form
                  onSubmit={handleSearchSubmit}
                  className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-end">
                    <div className="flex-1">
                      <label
                        htmlFor="sku-search"
                        className="mb-2 block text-sm font-medium text-slate-600"
                      >
                        ابحث برمز SKU
                      </label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          id="sku-search"
                          placeholder="مثل: DRESS-XL-RED"
                          value={skuInput}
                          onChange={(event) => setSkuInput(event.target.value)}
                          className="h-12 rounded-2xl border-slate-200 bg-white/80 text-base"
                        />
                        <Button
                          type="submit"
                          className="h-12 rounded-2xl bg-slate-900 text-white hover:bg-slate-800"
                        >
                          <Search className="mr-2 h-4 w-4" />
                          بحث
                        </Button>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        className="flex-1 rounded-2xl border-slate-200"
                        disabled={loading || currentPage === 1}
                        onClick={() => handlePageChange('prev')}
                        type="button"
                      >
                        الصفحة السابقة
                      </Button>
                      <Button
                        className="flex-1 rounded-2xl bg-indigo-600 text-white hover:bg-indigo-500"
                        disabled={loading || currentPage >= totalPages}
                        onClick={() => handlePageChange('next')}
                        type="button"
                      >
                        الصفحة التالية
                      </Button>
                    </div>
                  </div>
                  {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}
                </form>
              ) : (
                <div className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm text-slate-700">
                  <p>اعرض كل المشتركين وحددهم لإرسال رسالة واتساب لهم دفعة واحدة.</p>
                  <p>استخدم فلاتر الحالة أو اسم المنتج لتضييق القائمة.</p>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="request-status-filter"
                    className="mb-2 block text-sm font-medium text-slate-600"
                  >
                    فلترة طلبات “أبلغني”
                  </label>
                  <Select
                    id="request-status-filter"
                    value={requestStatusFilter}
                    onChange={(event) =>
                      setRequestStatusFilter(event.target.value as AvailabilityStatusFilter)
                    }
                    className="h-12 rounded-2xl border-slate-200 bg-white/80 text-sm"
                  >
                    <option value="all">جميع الحالات</option>
                    <option value="pending">بانتظار التوفر</option>
                    <option value="notified">تم إشعار العميل</option>
                    <option value="cancelled">ملغي</option>
                  </Select>
                  <p className="mt-1 text-xs text-slate-500">
                    اختر الحالة التي ترغب في متابعتها مع العملاء.
                  </p>
                </div>
                {activeTab === 'products' && (
                  <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      checked={showOnlyWithRequests}
                      onChange={(event) => setShowOnlyWithRequests(event.target.checked)}
                    />
                    عرض المنتجات التي تحتوي على طلبات مطابقة فقط
                  </label>
                )}
                {activeTab === 'subscribers' && (
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-700">
                <div>
                  <label className="text-xs font-semibold text-slate-600" htmlFor="subscriber-parent-product">
                    اختر المنتج الرئيسي
                  </label>
                  <ParentProductSelect
                    id="subscriber-parent-product"
                    options={subscriberProductOptions}
                    value={subscriberParentProductFilter}
                    onChange={(newValue) => setSubscriberParentProductFilter(newValue)}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    القائمة تعرض فقط المنتجات التي لديها طلبات إشعار نشطة.
                  </p>
                </div>
                    <div>
                      <label
                        htmlFor="subscriber-product-search"
                        className="text-xs font-semibold text-slate-600"
                      >
                        بحث عن منتج أو SKU
                      </label>
                      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                        <Input
                          id="subscriber-product-search"
                          value={subscriberProductSearch}
                          onChange={(event) => setSubscriberProductSearch(event.target.value)}
                          placeholder="أدخل اسم المنتج، SKU، أو اسم المتغير"
                          className="h-11 flex-1 rounded-xl border-slate-200 bg-white/90 text-sm"
                        />
                        {subscriberProductSearch && (
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-11 rounded-xl text-sm"
                            onClick={() => setSubscriberProductSearch('')}
                          >
                            مسح
                          </Button>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600" htmlFor="availability-filter">
                        التوفر في المخزون
                      </label>
                      <Select
                        id="availability-filter"
                        value={subscriberAvailabilityFilter}
                        onChange={(event) =>
                          setSubscriberAvailabilityFilter(event.target.value as SubscriberAvailabilityFilter)
                        }
                        className="mt-1 h-11 rounded-xl border-slate-200 bg-white/90 text-sm"
                      >
                        <option value="all">جميع المشتركين</option>
                        <option value="available">متوفر فقط</option>
                        <option value="unavailable">غير متوفر</option>
                      </Select>
                      <p className="mt-1 text-xs text-slate-500">
                        {subscriberStockLoading
                          ? 'جارٍ التحقق من توفر المنتجات...'
                          : 'يعتمد على آخر تحديث للكمية من سلة.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        {activeTab === 'products' ? (
          <section className="space-y-4">
            {loading && (
              <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-100 bg-white/80 p-6 text-slate-600">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
                <p>جاري تحميل المنتجات من سلة...</p>
              </div>
            )}
            {!loading && products.length === 0 && (
              <Card className="border-slate-100 shadow-none">
                <CardContent className="flex flex-col items-center gap-3 py-10 text-slate-600">
                  <PackageSearch className="h-10 w-10 text-slate-400" />
                  <p>لا توجد منتجات مطابقة لبحثك.</p>
                </CardContent>
              </Card>
            )}

            {!loading && products.length > 0 && visibleProducts.length === 0 && showOnlyWithRequests && (
              <Card className="border-slate-100 shadow-none">
                <CardContent className="flex flex-col items-center gap-3 py-10 text-slate-600">
                  <PackageSearch className="h-10 w-10 text-slate-400" />
                  <p>لا توجد منتجات تحتوي على طلبات مطابقة للترشيح الحالي.</p>
                </CardContent>
              </Card>
            )}

            {visibleProducts.map((product) => (
              <ProductNotifyCard
                key={product.id}
                product={product}
                variations={variationsMap[product.id] ?? []}
                variationError={productVariationErrors[product.id] || variationsGlobalError}
                rowLoading={!!rowVariationsLoading[product.id] || variationsLoading}
                onRefreshVariations={() => refreshVariationsForProduct(product.id)}
                requests={availabilityRequests[product.id] ?? []}
                availabilityLoading={availabilityLoading}
                availabilityError={availabilityError}
                onCreateRequest={handleCreateAvailabilityRequest}
                statusFilter={requestStatusFilter}
                onSendZokoMessage={handleSendZokoMessage}
                onMarkRequestNotified={handleMarkRequestNotified}
              />
            ))}
          </section>
        ) : (
          <section className="space-y-4">
            <Card className="border border-slate-100 shadow-lg shadow-slate-200/40">
              <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-xl text-slate-900">قائمة المشتركين</CardTitle>
                  <CardDescription className="text-sm">
                    تابع جميع طلبات “أبلغني” واختر من تحتاج إلى مراسلتهم.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={handleRefreshSubscribers}
                    disabled={allRequestsLoading}
                  >
                    {allRequestsLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    تحديث القائمة
                  </Button>
                  <span>إجمالي: {formatNumber(filteredAllRequests.length)}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedCount > 0 && (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-emerald-800">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p>
                        سيتم إرسال قالب واتساب الافتراضي إلى{' '}
                        <span className="font-semibold">{selectedCount}</span> من المشتركين المختارين.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
                          onClick={handleBulkSend}
                          disabled={bulkSending}
                        >
                          {bulkSending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <MessageCircle className="mr-2 h-4 w-4" />
                          )}
                          إرسال الرسائل المحددة
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl border-white/50 text-emerald-700"
                          onClick={clearSelection}
                          disabled={bulkSending}
                        >
                          إلغاء التحديد
                        </Button>
                      </div>
                    </div>
                    {bulkFeedback && (
                      <p className={`mt-2 text-xs ${bulkFeedback.type === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
                        {bulkFeedback.message}
                      </p>
                    )}
                  </div>
                )}
                {allRequestsError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {allRequestsError}
                  </div>
                )}
                {allRequestsLoading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                    جاري تحميل المشتركين...
                  </div>
                ) : filteredAllRequests.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-sm text-slate-500">
                    <PackageSearch className="h-10 w-10 text-slate-400" />
                    <p>لا توجد سجلات مطابقة للترشيح الحالي.</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-100">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              checked={allSelected}
                              onChange={(event) => toggleSelectAll(event.target.checked)}
                              aria-label="تحديد الكل"
                            />
                          </TableHead>
                          <TableHead>العميل</TableHead>
                          <TableHead>الطلب</TableHead>
                          <TableHead>الحالة</TableHead>
                          <TableHead>التوفر</TableHead>
                          <TableHead>تاريخ الطلب</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAllRequests.map((request) => {
                          const selected = selectedRequestIds.has(request.id);
                          const fullName = [request.customerFirstName, request.customerLastName]
                            .filter((part) => part && part.trim().length > 0)
                            .join(' ')
                            .trim();
                          const sizeLabel =
                            request.requestedSize || request.variationName || request.productSku || 'غير محدد';
                          const statusLabelMap: Record<AvailabilityRequestRecord['status'], string> = {
                            pending: 'بانتظار التوفر',
                            notified: 'تم إشعار العميل',
                            cancelled: 'ملغي',
                          };
                          const statusClassMap: Record<AvailabilityRequestRecord['status'], string> = {
                            pending: 'bg-amber-50 text-amber-700',
                            notified: 'bg-emerald-50 text-emerald-700',
                            cancelled: 'bg-slate-50 text-slate-600',
                          };
                          const stockInfo = subscriberStockMap[request.productId];
                          const hasStock = stockInfo?.hasStock;
                          return (
                            <TableRow key={request.id} data-state={selected ? 'selected' : undefined}>
                              <TableCell>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                  checked={selected}
                                  onChange={() => toggleSelectRequest(request.id)}
                                />
                              </TableCell>
                              <TableCell>
                                <p className="font-semibold text-slate-900">{fullName || 'عميل'}</p>
                                <p className="text-xs text-slate-500 ltr:font-mono rtl:font-mono">
                                  {request.customerPhone}
                                </p>
                              </TableCell>
                              <TableCell>
                                <p className="text-sm font-semibold text-slate-900">{request.productName}</p>
                                <p className="text-xs text-slate-500">المقاس: {sizeLabel}</p>
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`inline-flex rounded-full px-3 py-0.5 text-xs font-semibold ${statusClassMap[request.status]}`}
                                >
                                  {statusLabelMap[request.status]}
                                </span>
                              </TableCell>
                              <TableCell>
                                {hasStock ? (
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                                    متوفر
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                                    غير متوفر
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <p className="text-xs text-slate-500">
                                  {formatDate(request.createdAt)}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  بواسطة {request.requestedBy || 'فريق سلة'}
                                </p>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </main>
    </div>
  );
}

type ParentProductSelectProps = {
  id?: string;
  options: SubscriberProductOption[];
  value: string;
  onChange: (value: string) => void;
};

function formatSubscriberOptionLabel(option: SubscriberProductOption) {
  const skuPart = option.sku ? ` • ${option.sku}` : '';
  const sizePart = option.sizeSample ? ` • ${option.sizeSample}` : '';
  return `${option.name}${skuPart}${sizePart}`.trim();
}

function ParentProductSelect({ id, options, value, onChange }: ParentProductSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const placeholder = 'جميع المنتجات التي لديها مشتركين';

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return options;
    }
    return options.filter((option) => {
      const combined = `${option.name} ${option.sku || ''} ${option.sizeSample || ''}`.toLowerCase();
      return combined.includes(term);
    });
  }, [options, search]);

  const selectedOption = options.find((option) => String(option.id) === value) ?? null;
  const buttonLabel = selectedOption ? formatSubscriberOptionLabel(selectedOption) : placeholder;

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id={id}
        className="mt-1 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-700"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{buttonLabel}</span>
        <svg
          className="h-4 w-4 text-slate-500"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M5.5 7.5L10 12l4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث باسم المنتج أو SKU"
            className="h-10 rounded-xl border-slate-200 bg-white text-sm"
          />
          <div className="mt-2 max-h-60 overflow-auto">
            <button
              type="button"
              className={`flex w-full flex-col rounded-xl px-3 py-2 text-right text-sm ${
                value === '' ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'
              }`}
              onClick={() => handleSelect('')}
            >
              {placeholder}
            </button>
            {filteredOptions.length === 0 && (
              <p className="px-3 py-2 text-sm text-slate-500">لا توجد نتائج مطابقة.</p>
            )}
            {filteredOptions.map((option) => {
              const label = formatSubscriberOptionLabel(option);
              const selected = String(option.id) === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`flex w-full rounded-xl px-3 py-2 text-right text-sm ${
                    selected ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => handleSelect(String(option.id))}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type ProductNotifyCardProps = {
  product: SallaProductSummary;
  variations: SallaProductVariation[];
  variationError?: string | null;
  rowLoading: boolean;
  onRefreshVariations: () => void;
  requests: AvailabilityRequestRecord[];
  availabilityLoading: boolean;
  availabilityError?: string | null;
  onCreateRequest: (
    product: SallaProductSummary,
    payload: NewAvailabilityRequestPayload
  ) => Promise<ActionResult>;
  statusFilter: AvailabilityStatusFilter;
  onSendZokoMessage: (requestId: string) => Promise<ActionResult>;
  onMarkRequestNotified: (requestId: string) => Promise<ActionResult>;
};

function ProductNotifyCard({
  product,
  variations,
  variationError,
  rowLoading,
  onRefreshVariations,
  requests,
  availabilityLoading,
  availabilityError,
  onCreateRequest,
  statusFilter,
  onSendZokoMessage,
  onMarkRequestNotified,
}: ProductNotifyCardProps) {
  const [form, setForm] = useState({
    variationKey: '',
    customSize: '',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const filteredRequests =
    statusFilter === 'all'
      ? requests
      : requests.filter((request) => request.status === statusFilter);

  useEffect(() => {
    setForm({
      variationKey: '',
      customSize: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      notes: '',
    });
    setFormError(null);
  }, [product.id]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    setFormError(null);

    const trimmedPhone = form.phone.trim();
    if (!trimmedPhone) {
      setFormError('رقم الجوال مطلوب.');
      return;
    }

    const selectedVariation =
      form.variationKey && variations.length > 0
        ? variations.find(
            (variation) => variation.id != null && String(variation.id) === form.variationKey
          )
        : undefined;

    const sizeInput = form.customSize.trim();
    if (!selectedVariation && sizeInput.length === 0) {
      setFormError('يرجى اختيار المقاس أو إدخاله يدوياً.');
      return;
    }

    setSubmitting(true);
    const result = await onCreateRequest(product, {
      variationId:
        selectedVariation && selectedVariation.id != null
          ? String(selectedVariation.id)
          : undefined,
      variationName: selectedVariation?.name,
      requestedSize: sizeInput || selectedVariation?.name,
      customerFirstName: form.firstName.trim() || undefined,
      customerLastName: form.lastName.trim() || undefined,
      customerEmail: form.email.trim() || undefined,
      customerPhone: trimmedPhone,
      notes: form.notes.trim() || undefined,
    });
    setSubmitting(false);

    if (!result.success) {
      setFormError(result.error);
      return;
    }

    setForm({
      variationKey: '',
      customSize: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      notes: '',
    });
  };

  const selectLabel =
    variations.length > 0 ? 'اختر المقاس من المتغيرات (اختياري)' : 'لا يوجد متغيرات لهذا المنتج';

  return (
    <Card className="border border-slate-100 shadow-lg shadow-slate-200/40">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-4">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-20 w-20 rounded-2xl border object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border bg-gray-100 text-sm text-gray-500">
              لا صورة
            </div>
          )}
          <div>
            <CardTitle className="text-xl text-slate-900">{product.name}</CardTitle>
            <CardDescription className="text-sm">
              SKU: <span className="font-semibold text-slate-700">{product.sku || '—'}</span>
            </CardDescription>
            <p className="text-sm text-slate-600">
              السعر: {formatCurrency(product.priceAmount ?? null, product.currency)}
            </p>
            <p className="text-sm text-slate-500">رقم المنتج: #{product.id}</p>
          </div>
        </div>
        <div className="space-y-1 text-right text-sm text-slate-500">
          <p>المتوفر حالياً: {formatNumber(product.availableQuantity ?? null)}</p>
          {product.lastUpdatedAt && (
            <p>آخر تحديث: {formatDate(product.lastUpdatedAt)}</p>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
          <p className="text-sm font-semibold text-slate-900">بيانات إشعار العميل</p>
          <p className="text-xs text-slate-600">أدخل المقاس وبيانات الاتصال لحجز طلب “أبلغني”.</p>
          <form onSubmit={handleSubmit} className="mt-3 space-y-2">
            <div>
              <label className="text-xs text-slate-500">{selectLabel}</label>
              <Select
                disabled={variations.length === 0}
                value={form.variationKey}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, variationKey: event.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {variations.map((variation) => {
                  const rawQuantity =
                    typeof variation.availableQuantity === 'number'
                      ? variation.availableQuantity
                      : variation.availableQuantity != null
                        ? Number(variation.availableQuantity)
                        : null;
                  const quantitySuffix =
                    rawQuantity != null && Number.isFinite(rawQuantity)
                      ? ` - متوفر ${formatNumber(rawQuantity)}`
                      : '';
                  return (
                    <option key={String(variation.id)} value={String(variation.id)}>
                      {variation.name || 'متغير'}
                      {quantitySuffix}
                    </option>
                  );
                })}
              </Select>
            </div>
            <Input
              placeholder="المقاس المطلوب (في حال لم يكن متوفر في القائمة)"
              value={form.customSize}
              onChange={(event) => setForm((prev) => ({ ...prev, customSize: event.target.value }))}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder="الاسم الأول (اختياري)"
                value={form.firstName}
                onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
              />
              <Input
                placeholder="اسم العائلة (اختياري)"
                value={form.lastName}
                onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder="البريد الإلكتروني (اختياري)"
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              />
              <Input
                placeholder="رقم الجوال *"
                type="tel"
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                required
              />
            </div>
            <Input
              placeholder="ملاحظات إضافية (اختياري)"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
            <Button
              type="submit"
              className="flex w-full items-center justify-center gap-2 text-sm"
              disabled={submitting}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <BellRing className="h-4 w-4" />
              <span>حفظ طلب الإشعار</span>
            </Button>
            {formError && <p className="text-xs text-red-600">{formError}</p>}
          </form>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white/60 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">المقاسات والمتغيرات</p>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-slate-200"
              onClick={onRefreshVariations}
              disabled={rowLoading}
            >
              {rowLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              تحديث
            </Button>
          </div>
          {variationError && (
            <p className="mt-2 text-xs text-red-600">{variationError}</p>
          )}
          {!variationError && variations.length === 0 && !rowLoading && (
            <p className="mt-2 text-sm text-slate-500">لا توجد متغيرات متاحة لهذا المنتج.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {variations.map((variation) => {
              const rawQuantity =
                typeof variation.availableQuantity === 'number'
                  ? variation.availableQuantity
                  : variation.availableQuantity != null
                    ? Number(variation.availableQuantity)
                    : null;
              const isLow = rawQuantity == null || rawQuantity <= 0;
              return (
                <div
                  key={String(variation.id)}
                  className={`rounded-xl border px-3 py-2 text-xs ${
                    isLow
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <p className="font-semibold">{variation.name || 'متغير'}</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    الكمية: {rawQuantity != null ? formatNumber(rawQuantity) : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white/70 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">طلبات “أبلغني” المسجلة</p>
            {availabilityLoading && (
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                جاري التحديث
              </span>
            )}
          </div>
          {availabilityError && (
            <p className="mt-2 text-xs text-red-600">تعذر تحميل الإشعارات: {availabilityError}</p>
          )}
          {!availabilityError && filteredRequests.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              {statusFilter === 'all'
                ? 'لم يتم تسجيل أي إشعار لهذا المنتج بعد.'
                : 'لا توجد طلبات بهذه الحالة لهذا المنتج.'}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {filteredRequests.map((request) => (
                <AvailabilityRequestCard
                  key={request.id}
                  request={request}
                  onSendMessage={onSendZokoMessage}
                  onMarkNotified={onMarkRequestNotified}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type AvailabilityRequestCardProps = {
  request: AvailabilityRequestRecord;
  onSendMessage: (requestId: string) => Promise<ActionResult>;
  onMarkNotified: (requestId: string) => Promise<ActionResult>;
};

function AvailabilityRequestCard({
  request,
  onSendMessage,
  onMarkNotified,
}: AvailabilityRequestCardProps) {
  const statusLabelMap: Record<AvailabilityRequestRecord['status'], string> = {
    pending: 'بانتظار التوفر',
    notified: 'تم إشعار العميل',
    cancelled: 'ملغي',
  };
  const statusClassMap: Record<AvailabilityRequestRecord['status'], string> = {
    pending: 'border-amber-200 bg-amber-50 text-amber-700',
    notified: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    cancelled: 'border-slate-200 bg-slate-50 text-slate-600',
  };

  const fullName = [request.customerFirstName, request.customerLastName]
    .filter((part) => part && part.trim().length > 0)
    .join(' ')
    .trim();
  const sizeLabel = request.requestedSize || request.variationName || request.productSku || 'غير محدد';
  const [sending, setSending] = useState(false);
  const [marking, setMarking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleSendMessage = async () => {
    setSending(true);
    setActionError(null);
    setActionSuccess(null);
    const result = await onSendMessage(request.id);
    if (!result.success) {
      setActionError(result.error);
    } else {
      setActionSuccess('تم إرسال رسالة الإشعار عبر زوكو.');
    }
    setSending(false);
  };

  const handleMarkNotified = async () => {
    setMarking(true);
    setActionError(null);
    setActionSuccess(null);
    const result = await onMarkNotified(request.id);
    if (!result.success) {
      setActionError(result.error);
    } else {
      setActionSuccess('تم تعليم الطلب كمُرسَل.');
    }
    setMarking(false);
  };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white/80 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{fullName || 'عميل'}</p>
          <p className="text-xs text-slate-500">المقاس المطلوب: {sizeLabel}</p>
        </div>
        <span
          className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${statusClassMap[request.status]}`}
        >
          {statusLabelMap[request.status]}
        </span>
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-600">
        <p>
          رقم الجوال:{' '}
          <span className="font-semibold text-slate-900 ltr:font-mono rtl:font-mono">
            {request.customerPhone}
          </span>
        </p>
        {request.customerEmail && <p>البريد الإلكتروني: {request.customerEmail}</p>}
        {request.notes && <p className="text-slate-500">ملاحظات: {request.notes}</p>}
        <p>
          أضيف بواسطة {request.requestedBy} بتاريخ {formatDate(request.createdAt)}
        </p>
        {request.status === 'notified' && request.notifiedAt && (
          <p className="text-emerald-700">
            تم إشعار العميل بتاريخ {formatDate(request.notifiedAt)} بواسطة{' '}
            {request.notifiedBy || 'عضو الفريق'}
          </p>
        )}
      </div>
      {request.status === 'pending' && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
            سيتم إرسال قالب واتساب تلقائياً باستخدام صورة ورابط المنتج المسجل في الطلب.
          </div>
          <Button
            type="button"
            className="w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
            onClick={handleSendMessage}
            disabled={sending}
          >
            {sending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="mr-2 h-4 w-4" />
            )}
            إرسال رسالة الإشعار
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-xl border-emerald-200 text-emerald-700"
            onClick={handleMarkNotified}
            disabled={marking}
          >
            {marking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            تعليم كمُرسَل
          </Button>
          {(actionError || actionSuccess) && (
            <p className={`text-xs ${actionError ? 'text-red-600' : 'text-emerald-600'}`}>
              {actionError || actionSuccess}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
