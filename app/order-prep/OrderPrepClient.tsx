'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useReactToPrint } from 'react-to-print';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import AppNavbar from '@/components/AppNavbar';
import { CommercialInvoice } from '@/components/CommercialInvoice';
import {
  Activity,
  ArrowRight,
  BadgeInfo,
  ClipboardList,
  Download,
  History,
  Loader2,
  MapPin,
  PackageCheck,
  Printer,
  RefreshCcw,
  Search,
  Shield,
  TriangleAlert,
} from 'lucide-react';

interface OrderUser {
  id: string;
  username: string;
  name: string;
  autoAssign: boolean;
}

interface OrderAssignment {
  id: string;
  orderId: string;
  orderNumber: string;
  orderData: any;
  status: string;
  assignedAt: string;
  notes?: string;
  isHighPriority?: boolean;
  highPriorityReason?: string | null;
  highPriorityNotes?: string | null;
  highPriorityMarkedAt?: string | null;
  highPriorityMarkedBy?: string | null;
  hasGiftFlag?: boolean;
  giftFlagReason?: string | null;
  giftFlagNotes?: string | null;
  giftFlagMarkedAt?: string | null;
  giftFlagMarkedBy?: string | null;
}

interface ProductLocation {
  id: string;
  sku: string;
  location: string;
  productName?: string | null;
  notes?: string | null;
  updatedBy?: string | null;
  updatedAt: string;
}

interface ConfirmationState {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
}

interface LoadMyOrdersOptions {
  silent?: boolean;
  showDebugMessage?: boolean;
  preferredOrderNumber?: string | null;
  autoCompleteRetryCount?: number;
}

interface OrderHistoryEntry {
  id: string;
  orderId?: string;
  orderNumber: string;
  orderData: any;
  status: string;
  finishedAt: string | null;
}

const MAX_AUTO_COMPLETE_REFRESHES = 3;

const getCustomerIdentifiersFromOrderData = (orderData: any): { number: string; name: string } => {
  if (!orderData) {
    return { number: '', name: '' };
  }

  const customer = orderData.customer || {};
  const numberCandidates = [
    customer.number,
    customer.customer_number,
    customer.customerNumber,
    orderData.customer_number,
    orderData.customerNumber,
  ];

  for (const candidate of numberCandidates) {
    const value = getStringValue(candidate);
    if (value) {
      return { number: value, name: getStringValue(customer.name) || '' };
    }
  }

  return { number: '', name: getStringValue(customer.name) || '' };
};

const getHistoryStatusMeta = (status: string) => {
  switch (status) {
    case 'completed':
      return { label: 'مكتمل', className: 'bg-green-50 text-green-700 border-green-200' };
    case 'cancelled':
      return { label: 'ملغي', className: 'bg-red-50 text-red-700 border-red-200' };
    case 'removed':
      return { label: 'محذوف', className: 'bg-orange-50 text-orange-700 border-orange-200' };
    default:
      return { label: status || 'غير معروف', className: 'bg-gray-50 text-gray-700 border-gray-200' };
  }
};

const dedupeHistory = (history: OrderHistoryEntry[], limit = 10): OrderHistoryEntry[] => {
  const seen = new Set<string>();
  const unique: OrderHistoryEntry[] = [];

  for (const entry of history) {
    const key = entry.orderId || entry.orderNumber;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entry);
    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
};

const formatHistoryTimestamp = (timestamp: string | null) => {
  if (!timestamp) return 'غير محدد';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'غير محدد';
  return date.toLocaleString('ar-SA', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const sortAssignments = (assignments: OrderAssignment[] = []): OrderAssignment[] => {
  return [...assignments].sort((a, b) => {
    if (a.isHighPriority && !b.isHighPriority) return -1;
    if (!a.isHighPriority && b.isHighPriority) return 1;
    return new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime();
  });
};

const pickNextCurrentOrder = (
  assignments: OrderAssignment[],
  previous: OrderAssignment | null
): OrderAssignment | null => {
  if (assignments.length === 0) {
    return null;
  }

  if (!previous) {
    return assignments[0];
  }

  return assignments.find((assignment) => assignment.id === previous.id) || assignments[0];
};

const parseJsonResponse = async <T = any>(response: Response, context: string): Promise<T> => {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const body = await response.text();
    console.error(`[${context}] Non-JSON response`, {
      status: response.status,
      contentType,
      bodyPreview: body.slice(0, 500),
    });
    throw new Error(`الاستجابة من ${context} ليست بصيغة JSON (الحالة ${response.status})`);
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    console.error(`[${context}] Failed to parse JSON`, error);
    throw error;
  }
};

const getStringValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.label === 'string') return obj.label;
    if (obj.value !== undefined) {
      return getStringValue(obj.value);
    }
    return JSON.stringify(obj);
  }
  return '';
};

const normalizeSku = (value: unknown): string => {
  const stringValue = getStringValue(value);
  if (!stringValue) return '';
  return stringValue.trim().toUpperCase();
};

const generateSkuVariants = (value: unknown): string[] => {
  const normalized = normalizeSku(value);
  if (!normalized) {
    return [];
  }

  const variants = new Set<string>();
  variants.add(normalized);

  const segments = normalized.split(/[^A-Z0-9]+/).filter(Boolean);
  segments.forEach((segment) => variants.add(segment));

  const withoutTrailingLetters = normalized.replace(/[A-Z]+$/g, '');
  if (withoutTrailingLetters && withoutTrailingLetters !== normalized) {
    variants.add(withoutTrailingLetters);
  }

  const withoutTrailingDigits = normalized.replace(/\d+$/g, '');
  if (withoutTrailingDigits && withoutTrailingDigits !== normalized) {
    variants.add(withoutTrailingDigits);
  }

  return Array.from(variants).filter((sku) => sku.length >= 3);
};

const getNumberValue = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (obj.value !== undefined) {
      return getNumberValue(obj.value);
    }
  }
  return 0;
};

const extractHttpUrl = (value: unknown): string | null => {
  if (!value) return null;
  let candidate: string | null = null;

  if (typeof value === 'string') {
    candidate = value;
  } else if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    candidate =
      (typeof obj.url === 'string' && obj.url) ||
      (typeof obj.href === 'string' && obj.href) ||
      (typeof obj.link === 'string' && obj.link) ||
      (typeof obj.value === 'string' && obj.value) ||
      null;
  }

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (trimmed && /^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
  }

  return null;
};

const findUrlInsideText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
};

const getLabelUrlFromOrderData = (orderData: any): string | null => {
  if (!orderData || typeof orderData !== 'object') {
    return null;
  }

  const shipping = (orderData as any)?.shipping || {};
  const delivery = (orderData as any)?.delivery || {};
  const shipments = Array.isArray((orderData as any)?.shipments) ? (orderData as any).shipments : [];
  const shippingShipments = Array.isArray(shipping?.shipments) ? shipping.shipments : [];

  const candidateValues: unknown[] = [
    delivery?.label_url,
    delivery?.labelUrl,
    delivery?.label?.url,
    delivery?.label,
    shipping?.label_url,
    shipping?.labelUrl,
    shipping?.label?.url,
    shipping?.label,
    shipping?.shipment?.label_url,
    shipping?.shipment?.labelUrl,
    shipping?.shipment?.label?.url,
    shipping?.shipment?.label,
  ];

  shipments.forEach((shipment: any) => {
    candidateValues.push(
      shipment?.label_url,
      shipment?.labelUrl,
      shipment?.label?.url,
      shipment?.label,
    );
  });

  shippingShipments.forEach((shipment: any) => {
    candidateValues.push(
      shipment?.label_url,
      shipment?.labelUrl,
      shipment?.label?.url,
      shipment?.label,
    );
  });

  for (const candidate of candidateValues) {
    const url = extractHttpUrl(candidate);
    if (url) {
      return url;
    }
  }

  const notesUrl =
    extractHttpUrl((orderData as any)?.notes) ||
    findUrlInsideText((orderData as any)?.notes);
  if (notesUrl) {
    return notesUrl;
  }

  return null;
};

const ACTION_BUTTON_BASE = 'w-full py-3 text-sm sm:py-4 sm:text-base rounded-2xl';

export default function OrderPrepPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = (session?.user as any)?.role;
  const roles = ((session?.user as any)?.roles || [role]) as string[];
  const isOrdersUser = roles.includes('orders');
  const [user, setUser] = useState<OrderUser | null>(null);

  const [assignments, setAssignments] = useState<OrderAssignment[]>([]);
  const [currentOrder, setCurrentOrder] = useState<OrderAssignment | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [refreshingItems, setRefreshingItems] = useState(false);
  const [printingOrderNumber, setPrintingOrderNumber] = useState(false);
  const [shipmentInfo, setShipmentInfo] = useState<{
    trackingNumber: string;
    courierName: string;
    labelPrinted?: boolean;
    labelUrl?: string | null;
    printedAt?: string | null;
  } | null>(null);
  const [shipmentError, setShipmentError] = useState<string | null>(null);
  const [movingToReview, setMovingToReview] = useState(false);
  const [movingToReservation, setMovingToReservation] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugData, setDebugData] = useState<any>(null);
  const [productLocations, setProductLocations] = useState<Record<string, ProductLocation>>({});
  const [loadingProductLocations, setLoadingProductLocations] = useState(false);
  const [productLocationError, setProductLocationError] = useState<string | null>(null);
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationState | null>(null);
  const [requestedOrderNumber, setRequestedOrderNumber] = useState<string | null>(null);
  const [recentHistory, setRecentHistory] = useState<OrderHistoryEntry[]>([]);
  const [loadingRecentHistory, setLoadingRecentHistory] = useState(false);
  const [recentHistoryError, setRecentHistoryError] = useState<string | null>(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const commercialInvoiceRef = useRef<HTMLDivElement>(null);
  const openConfirmationDialog = (config: ConfirmationState) => {
    setConfirmationDialog(config);
  };
  const handleConfirmDialog = () => {
    if (!confirmationDialog) return;
    const actionToRun = confirmationDialog.onConfirm;
    setConfirmationDialog(null);
    actionToRun();
  };
  const handleCancelDialog = () => setConfirmationDialog(null);
  const currentOrderSkus = useMemo(() => {
    if (!currentOrder?.orderData?.items || !Array.isArray(currentOrder.orderData.items)) {
      return [] as string[];
    }

    const variants = new Set<string>();

    currentOrder.orderData.items.forEach((item: any) => {
      generateSkuVariants(item?.sku).forEach((variant) => variants.add(variant));
    });

    return Array.from(variants);
  }, [currentOrder]);

  const getLocationForSku = useCallback(
    (sku: unknown): ProductLocation | undefined => {
      const normalizedSku = normalizeSku(sku);
      if (!normalizedSku) {
        return undefined;
      }

      const directMatch = productLocations[normalizedSku];
      if (directMatch) {
        return directMatch;
      }

      let bestMatch: ProductLocation | undefined;
      let bestMatchLength = 0;

      for (const location of Object.values(productLocations)) {
        const locationSku = normalizeSku(location?.sku);
        if (!locationSku) {
          continue;
        }

        if (normalizedSku.includes(locationSku) || locationSku.includes(normalizedSku)) {
          if (!bestMatch || locationSku.length > bestMatchLength) {
            bestMatch = location;
            bestMatchLength = locationSku.length;
          }
        }
      }

      return bestMatch;
    },
    [productLocations]
  );

  // Load user from session
  useEffect(() => {
    if (session?.user && isOrdersUser) {
      const sessionUser = session.user as any;
      setUser({
        id: sessionUser.id,
        username: sessionUser.username,
        name: sessionUser.name,
        autoAssign: sessionUser.orderUserData?.autoAssign || false,
      });
    }
  }, [session, isOrdersUser]);

  useEffect(() => {
    const orderParam = searchParams.get('order');
    setRequestedOrderNumber(orderParam);
  }, [searchParams]);

  // Reset shipment info when changing orders
  useEffect(() => {
    setShipmentInfo(null);
  }, [currentOrder?.id]);

  const locationSummary = useMemo(() => {
    if (
      loadingProductLocations ||
      !currentOrder?.orderData?.items ||
      !Array.isArray(currentOrder.orderData.items)
    ) {
      return [];
    }

    const summaryMap = new Map<
      string,
      {
        locationLabel: string;
        items: { sku: string; name: string; quantity: number }[];
      }
    >();

    currentOrder.orderData.items.forEach((item: any) => {
      const normalizedSku = normalizeSku(item?.sku);
      if (!normalizedSku) {
        return;
      }
      const locationInfo = getLocationForSku(normalizedSku);
      const locationKey = locationInfo?.location || 'NO_LOCATION';
      const locationLabel = locationInfo?.location || 'غير مسجل';
      if (!summaryMap.has(locationKey)) {
        summaryMap.set(locationKey, { locationLabel, items: [] });
      }
      const entry = summaryMap.get(locationKey);
      if (entry) {
        entry.items.push({
          sku: normalizedSku,
          name: getStringValue(item?.name) || normalizedSku,
          quantity: Number(item?.quantity) || 0,
        });
      }
    });

    return Array.from(summaryMap.entries())
      .map(([key, value]) => ({
        key,
        locationLabel: value.locationLabel,
        totalQuantity: value.items.reduce((sum, item) => sum + (item.quantity || 0), 0),
        items: value.items,
      }))
      .sort((a, b) => {
        if (a.key === 'NO_LOCATION') return 1;
        if (b.key === 'NO_LOCATION') return -1;
        return a.locationLabel.localeCompare(b.locationLabel, 'ar');
      });
  }, [currentOrder, getLocationForSku, loadingProductLocations]);

useEffect(() => {
    let cancelled = false;

    if (currentOrderSkus.length === 0) {
      setProductLocations({});
      setProductLocationError(null);
      setLoadingProductLocations(false);
      return () => {
        cancelled = true;
      };
    }

    const fetchLocations = async () => {
      setProductLocations({});
      setLoadingProductLocations(true);
      setProductLocationError(null);
      try {
        const response = await fetch('/api/order-prep/product-locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skus: currentOrderSkus }),
        });

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          if (!cancelled) {
            setProductLocationError('تعذر قراءة بيانات مواقع المنتجات، حاول لاحقاً');
          }
          return;
        }

        const data = await parseJsonResponse(response, 'POST /api/order-prep/product-locations').catch(
          (error) => {
            console.warn('Failed to parse product locations response', error);
            if (!cancelled) {
              setProductLocationError('تعذر قراءة بيانات مواقع المنتجات، حاول لاحقاً');
            }
            return null;
          }
        );

        if (!data) {
          return;
        }

        if (!response.ok || !data.success) {
          if (!cancelled) {
            setProductLocationError(data?.error || 'تعذر تحميل مواقع المنتجات');
          }
          return;
        }

        if (!data.locations || !Array.isArray(data.locations)) {
          if (!cancelled) {
            setProductLocationError('الاستجابة لا تحتوي على بيانات مواقع صالحة');
          }
          return;
        }

        const map: Record<string, ProductLocation> = {};
        data.locations.forEach((location: ProductLocation) => {
          const normalizedSku = normalizeSku(location?.sku);
          if (normalizedSku) {
            map[normalizedSku] = location;
          }
        });

        if (!cancelled) {
          setProductLocations(map);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'تعذر تحميل مواقع المنتجات';
        console.error('Failed to load product locations', error);
        if (!cancelled) {
          setProductLocations({});
          setProductLocationError(message);
        }
      } finally {
        if (!cancelled) {
          setLoadingProductLocations(false);
        }
      }
    };

    fetchLocations();

    return () => {
      cancelled = true;
    };
  }, [currentOrderSkus]);

  const loadRecentHistory = useCallback(async () => {
    if (!user) return;
    setLoadingRecentHistory(true);
    setRecentHistoryError(null);

    try {
      const response = await fetch(
        `/api/order-history/user?userId=${user.id}&limit=30&ts=${Date.now()}`,
        { cache: 'no-store' }
      );
      const data = await parseJsonResponse(response, 'GET /api/order-history/user');

      if (data.success && Array.isArray(data.history)) {
        setRecentHistory(dedupeHistory(data.history));
      } else {
        setRecentHistoryError(data.error || 'فشل تحميل سجل الطلبات');
      }
    } catch (error) {
      console.error('Failed to load recent history:', error);
      setRecentHistoryError('تعذر تحميل سجل الطلبات الأخيرة');
    } finally {
      setLoadingRecentHistory(false);
    }
  }, [user]);

  const loadMyOrders = useCallback(
    async (autoAssignIfEmpty = false, options: LoadMyOrdersOptions = {}) => {
      if (!user) return;

      const {
        silent = false,
        showDebugMessage = false,
        preferredOrderNumber = requestedOrderNumber,
        autoCompleteRetryCount = 0,
      } = options;

      if (!silent) {
        setLoadingOrders(true);
      }

      if (showDebugMessage) {
        setDebugInfo('⏳ جاري تحديث الطلبات...');
      }

      const fetchAssignmentsSnapshot = async () => {
        const response = await fetch(
          `/api/order-assignments/my-orders?userId=${user.id}&ts=${Date.now()}`,
          { cache: 'no-store' }
        );
        const data = await parseJsonResponse(response, 'GET /api/order-assignments/my-orders');
        if (!data.success) {
          throw new Error(data.error || 'فشل تحميل الطلبات');
        }
        return {
          assignments: sortAssignments(Array.isArray(data.assignments) ? data.assignments : []),
          autoCompletedAssignments: Array.isArray(data.autoCompletedAssignments)
            ? data.autoCompletedAssignments
            : [],
        };
      };

      try {
        await fetch('/api/order-assignments/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id }),
          cache: 'no-store',
        });

        let assignmentsSnapshotResult = await fetchAssignmentsSnapshot();
        let assignmentsSnapshot = assignmentsSnapshotResult.assignments;
        let autoCompletedAssignments = assignmentsSnapshotResult.autoCompletedAssignments;

        if (assignmentsSnapshot.length === 0 && autoAssignIfEmpty) {
          const autoAssignResponse = await fetch('/api/order-assignments/auto-assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id }),
            cache: 'no-store',
          });
          const autoAssignData = await parseJsonResponse(autoAssignResponse, 'POST /api/order-assignments/auto-assign');

          if (autoAssignData.success) {
            if (autoAssignData.assigned > 0) {
              if (showDebugMessage) {
                setDebugInfo(`✅ تم تعيين ${autoAssignData.assigned} طلب جديد`);
              }
              assignmentsSnapshotResult = await fetchAssignmentsSnapshot();
              assignmentsSnapshot = assignmentsSnapshotResult.assignments;
              autoCompletedAssignments = assignmentsSnapshotResult.autoCompletedAssignments;
            } else if (showDebugMessage) {
              setDebugInfo(`ℹ️ ${autoAssignData.message || 'لا توجد طلبات جديدة'}`);
            }
          } else if (showDebugMessage) {
            setDebugInfo(`❌ خطأ: ${autoAssignData.error || 'فشل تعيين الطلبات'}`);
          }
        } else if (showDebugMessage) {
          setDebugInfo(
            assignmentsSnapshot.length > 0
              ? '✅ تم تحديث الطلب الحالي'
              : 'ℹ️ لا توجد طلبات للتحضير'
          );
        }

        const completedDueToLabels =
          Array.isArray(autoCompletedAssignments) && autoCompletedAssignments.length > 0;
        const shouldForceAutoAssign =
          completedDueToLabels &&
          assignmentsSnapshot.length === 0 &&
          !autoAssignIfEmpty &&
          autoCompleteRetryCount < MAX_AUTO_COMPLETE_REFRESHES;

        if (shouldForceAutoAssign) {
          if (showDebugMessage) {
            setDebugInfo('♻️ تم تحديث الطلبات بسبب شحنات مكتملة في سلة');
          }
          await loadMyOrders(true, {
            ...options,
            silent: false,
            showDebugMessage: true,
            autoCompleteRetryCount: autoCompleteRetryCount + 1,
          });
          return;
        }

        setAssignments(assignmentsSnapshot);
        setCurrentOrder((previous) => {
          if (preferredOrderNumber) {
            const match = assignmentsSnapshot.find(
              (assignment) =>
                assignment.orderNumber === preferredOrderNumber ||
                assignment.orderId === preferredOrderNumber
            );
            if (match) {
              return match;
            }
          }
          return pickNextCurrentOrder(assignmentsSnapshot, previous);
        });
        setLastRefreshTime(new Date());
      } catch (error) {
        console.error('Failed to load orders:', error);
        if (showDebugMessage) {
          const message = error instanceof Error ? error.message : 'خطأ غير معروف';
          setDebugInfo(`❌ خطأ في الاتصال: ${message}`);
        }
      } finally {
        if (!silent) {
          setLoadingOrders(false);
        }
      }
    },
    [user, requestedOrderNumber]
  );

  const autoAssignOrders = useCallback(
    (options?: LoadMyOrdersOptions) => loadMyOrders(true, options),
    [loadMyOrders]
  );

  useEffect(() => {
    if (user) {
      // Load orders and auto-assign if empty (regardless of autoAssign setting)
      // This ensures every user gets the oldest unassigned order when accessing the page
      loadMyOrders(true);
    }
  }, [user, loadMyOrders]);

  useEffect(() => {
    if (showHistoryPanel && recentHistory.length === 0) {
      loadRecentHistory();
    }
  }, [showHistoryPanel, recentHistory.length, loadRecentHistory]);

  const handleStartPreparation = async () => {
    if (!currentOrder) return;

    try {
      const response = await fetch('/api/order-assignments/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
          status: 'preparing',
          updateSalla: false, // Status already set to processing during assignment
        }),
      });

      const data = await parseJsonResponse(response, 'POST /api/order-assignments/update-status');

      if (data.success) {
        loadMyOrders();
      }
    } catch (error) {
      alert('فشل بدء التحضير');
    }
  };

  const handleCompleteOrder = async () => {
    if (!currentOrder) return;

    try {
      const response = await fetch('/api/order-assignments/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
        }),
      });

      const data = await parseJsonResponse(response, 'POST /api/order-assignments/complete');

      if (data.success) {
        // Clear current order
        setCurrentOrder(null);

        // Always load orders with auto-assign enabled
        // This ensures the user gets the oldest unassigned order automatically
        await loadMyOrders(true);
        if (showHistoryPanel) {
          await loadRecentHistory();
        }
      } else {
        const errorMsg = data.details ? `${data.error}\n\nتفاصيل: ${data.details}` : data.error;
        console.error('Complete order error:', data);
        alert(errorMsg || 'فشل إكمال الطلب');
      }
    } catch (error) {
      console.error('Complete order exception:', error);
      alert('فشل إكمال الطلب');
    }
  };

  const handleSkipOrder = () => {
    const nextOrder = assignments.find(a => a.id !== currentOrder?.id);
    setCurrentOrder(nextOrder || null);
  };

  const handleRefreshItems = async () => {
    if (!currentOrder) return;

    setRefreshingItems(true);
    try {
      const response = await fetch('/api/order-assignments/refresh-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: currentOrder.id }),
      });

      const data = await parseJsonResponse(response, 'POST /api/order-assignments/refresh-items');

      if (data.success) {
        // Reload orders to get the updated data
        await loadMyOrders();
        alert(`تم تحديث المنتجات بنجاح - عدد المنتجات: ${data.itemsCount}`);
      } else {
        alert(data.error || 'فشل تحديث المنتجات');
      }
    } catch (error) {
      alert('فشل تحديث المنتجات');
    } finally {
      setRefreshingItems(false);
    }
  };

  const handleOpenHistoryOrder = async (history: OrderHistoryEntry) => {
    try {
      setDebugInfo(`⏳ جاري إعادة فتح الطلب #${history.orderNumber}...`);
      const response = await fetch('/api/order-assignments/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: history.orderNumber,
        }),
      });

      const data = await parseJsonResponse(response, 'POST /api/order-assignments/reopen');

      if (data.success) {
        setRequestedOrderNumber(history.orderNumber);
        await loadMyOrders(true, {
          preferredOrderNumber: history.orderNumber,
          showDebugMessage: true,
        });
        router.push(`/order-prep?order=${encodeURIComponent(history.orderNumber)}`);
        setShowHistoryPanel(false);
        setDebugInfo(`✅ تم فتح الطلب #${history.orderNumber} بنجاح`);
      } else {
        alert(data.error || 'فشل إعادة فتح الطلب');
      }
    } catch (error) {
      console.error('Failed to reopen history order:', error);
      alert('فشل إعادة فتح الطلب. حاول مرة أخرى.');
    }
  };

  const handlePrintOrderNumber = async () => {
    if (!currentOrder) return;

    setPrintingOrderNumber(true);
    try {
      const response = await fetch('/api/order-prep/print-order-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: currentOrder.orderNumber,
          orderId: currentOrder.orderId,
          printDate: new Date().toLocaleDateString('en-GB'),
        }),
      });

      const data = await parseJsonResponse(response, 'POST /api/order-prep/print-order-number');

      if (!response.ok || !data.success) {
        const errorMsg = data.error || 'فشل إرسال رقم الطلب للطابعة';
        alert(errorMsg);
        return;
      }
      setDebugInfo(data.message || 'تم إرسال رقم الطلب للطابعة');
    } catch (error) {
      console.error('Order number print exception:', error);
      alert('فشل إرسال رقم الطلب للطابعة');
    } finally {
      setPrintingOrderNumber(false);
    }
  };

  const handleGoToNewOrder = async () => {
    if (!currentOrder) return;

    try {
      // Complete current order (move to history)
      const response = await fetch('/api/order-assignments/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Clear current order
        setCurrentOrder(null);

        // Always load orders with auto-assign enabled
        // This ensures the user gets the oldest unassigned order automatically
        await loadMyOrders(true);
        if (showHistoryPanel) {
          await loadRecentHistory();
        }
      } else {
        const errorMsg = data.details ? `${data.error}\n\nتفاصيل: ${data.details}` : data.error;
        console.error('Complete order error:', data);
        alert(errorMsg || 'فشل الانتقال للطلب التالي');
      }
    } catch (error) {
      console.error('Go to new order exception:', error);
      alert('فشل الانتقال للطلب التالي');
    }
  };

  const handleMoveToUnderReview = async () => {
    if (!currentOrder) return;

    setMovingToReview(true);
    try {
      // Update status to "تحت المراجعة" (ID: 1065456688)
      const updateResponse = await fetch('/api/order-assignments/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
          status: 'under_review',
          updateSalla: true,
          sallaStatus: '1065456688', // تحت المراجعة status ID
        }),
      });

      const updateData = await parseJsonResponse(updateResponse, 'POST /api/order-assignments/update-status');

      if (!updateData.success) {
        alert(updateData.error || 'فشل تحديث حالة الطلب');
        return;
      }

      // Complete the order (move to history)
      const completeResponse = await fetch('/api/order-assignments/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
        }),
      });

      const completeData = await parseJsonResponse(completeResponse, 'POST /api/order-assignments/complete');

      if (completeData.success) {
        // Clear current order and load next
        setCurrentOrder(null);
        await loadMyOrders(true);
        if (showHistoryPanel) {
          await loadRecentHistory();
        }
      } else {
        const errorMsg = completeData.details ? `${completeData.error}\n\nتفاصيل: ${completeData.details}` : completeData.error;
        alert(errorMsg || 'فشل الانتقال للطلب التالي');
      }
    } catch (error) {
      console.error('Move to under review exception:', error);
      alert('فشل تحديث حالة الطلب');
    } finally {
      setMovingToReview(false);
    }
  };

  const handleMoveToReservation = async () => {
    if (!currentOrder) return;

    setMovingToReservation(true);
    try {
      // Update status to "تحت المراجعة حجز قطع" (ID: 1576217163)
      const updateResponse = await fetch('/api/order-assignments/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
          status: 'under_review_reservation',
          updateSalla: true,
          sallaStatus: '1576217163', // تحت المراجعة حجز قطع status ID
        }),
      });

      const updateData = await parseJsonResponse(updateResponse, 'POST /api/order-assignments/update-status');

      if (!updateData.success) {
        alert(updateData.error || 'فشل تحديث حالة الطلب');
        return;
      }

      // Complete the order (move to history)
      const completeResponse = await fetch('/api/order-assignments/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
        }),
      });

      const completeData = await parseJsonResponse(completeResponse, 'POST /api/order-assignments/complete');

      if (completeData.success) {
        // Clear current order and load next
        setCurrentOrder(null);
        await loadMyOrders(true);
        if (showHistoryPanel) {
          await loadRecentHistory();
        }
      } else {
        const errorMsg = completeData.details ? `${completeData.error}\n\nتفاصيل: ${completeData.details}` : completeData.error;
        alert(errorMsg || 'فشل الانتقال للطلب التالي');
      }
    } catch (error) {
      console.error('Move to reservation exception:', error);
      alert('فشل تحديث حالة الطلب');
    } finally {
      setMovingToReservation(false);
    }
  };

  const loadDebugInfo = async () => {
    if (!user) return;

    try {
      const response = await fetch(`/api/order-assignments/debug?userId=${user.id}`);
      const data = await parseJsonResponse(response, 'GET /api/order-assignments/debug');

      if (data.success) {
        setDebugData(data.debug);
        setShowDebugPanel(true);
      } else {
        alert(data.error || 'فشل جلب معلومات التشخيص');
      }
    } catch (error) {
      console.error('Failed to load debug info:', error);
      alert('فشل جلب معلومات التشخيص');
    }
  };

  const printCommercialInvoice = useReactToPrint({
    contentRef: commercialInvoiceRef,
  });

  const handlePrintCommercialInvoice = () => {
    if (!commercialInvoiceRef.current) {
      alert('خطأ: الفاتورة غير متاحة للطباعة');
      return;
    }

    try {
      printCommercialInvoice?.();
    } catch (error) {
      console.error('Print error:', error);
      alert('حدث خطأ أثناء محاولة الطباعة، جرّب مرة أخرى.');
    }
  };

  // Show loading while checking session
  if (status === 'loading') {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900">
      <div className="rounded-3xl border border-white/10 bg-white/90 px-8 py-6 text-center shadow-2xl shadow-slate-900/40">
        <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-indigo-600" />
        <p className="text-lg font-semibold text-slate-900">جاري تحميل حساب التحضير...</p>
      </div>
    </div>
  );
  }

  // If not authenticated or not an order user, show message
  if (!session || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4">
        <Card className="w-full max-w-md rounded-3xl border border-white/10 bg-white/95 p-10 text-center shadow-2xl shadow-slate-900/40">
          <Shield className="mx-auto mb-4 h-10 w-10 text-indigo-600" />
          <h1 className="text-2xl font-semibold text-slate-900">تحضير الطلبات</h1>
          <p className="mt-2 text-sm text-slate-600">
            يجب تسجيل الدخول كمستخدم طلبات للوصول إلى هذه الصفحة.
          </p>
          <Button onClick={() => (window.location.href = '/login')} className="mt-6 w-full rounded-2xl">
            تسجيل الدخول
          </Button>
        </Card>
      </div>
    );
  }

  if (!isOrdersUser) {
    return (
      <div className="flex min-h-screen.items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 px-4 text-center">
        <Card className="max-w-md rounded-3xl border border-white/10 bg-white/95 p-10 shadow-2xl shadow-slate-900/40">
          <TriangleAlert className="mx-auto mb-4 h-10 w-10 text-amber-500" />
          <p className="text-lg font-semibold text-slate-900">
            ليس لديك صلاحية للوصول إلى لوحة تحضير الطلبات.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <AppNavbar
        title="لوحة تحضير الطلبات"
        subtitle={`مرحباً، ${user.name}`}
        collapseOnMobile
      />

      <div className="w-full">
        <div className="w-full max-w-7xl mx-auto px-4 md:px-6 pt-8 pb-32 md:pb-40">
          <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
            <Card className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/90 p-8 shadow-xl shadow-indigo-100/60">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-slate-50" />
              <div className="relative z-10 flex flex-wrap items-center justify-between gap-6">
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-slate-400">حالتك الآن</p>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-900">طلبك الحالي</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {currentOrder ? `#${currentOrder.orderNumber || 'غير معروف'}` : 'لا يوجد طلب محدد حالياً'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => autoAssignOrders({ showDebugMessage: true })}
                    disabled={loadingOrders}
                    className="rounded-2xl bg-indigo-600 px-6 py-5 text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-700"
                  >
                    <RefreshCcw className="h-4 w-4" />
                    {loadingOrders ? 'جاري التحديث...' : 'تحديث الطلبات'}
                  </Button>
                  <Button
                    onClick={() => setShowHistoryPanel((prev) => !prev)}
                    variant="outline"
                    className="rounded-2xl border-slate-200 px-6 py-5 text-slate-600 hover:text-slate-900"
                  >
                    {showHistoryPanel ? 'إخفاء الطلبات السابقة' : 'عرض الطلبات السابقة'}
                  </Button>
                </div>
              </div>
              {lastRefreshTime && (
                <p className="relative z-10 mt-4 text-xs text-slate-500">
                  آخر تحديث: {lastRefreshTime.toLocaleTimeString('ar-SA')}
                </p>
              )}
              {debugInfo && (
                <div className="relative z-10 mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  {debugInfo}
                </div>
              )}
            </Card>

            <Card className="rounded-3xl border border-white/60 bg-white/90 p-8 shadow-xl shadow-indigo-100/60">
              <div className="flex items-center gap-3 text-slate-600">
                <ClipboardList className="h-5 w-5 text-indigo-500" />
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-slate-400">سجلات الطلبات</p>
                  <p className="text-lg font-semibold text-slate-900">{assignments.length} طلب نشط</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-500">
                اجمع الطلبات حسب الأولوية ثم اعتمد على ملخص الأماكن لمعرفة مواقع المنتجات المسجلة.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center">
                  <p className="text-xs uppercase tracking-wide text-slate-400">الطلبات</p>
                  <p className="text-2xl font-bold text-slate-900">{assignments.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-center">
                  <p className="text-xs uppercase tracking-wide text-slate-400">التاريخ</p>
                  <p className="text-2xl font-bold text-slate-900">{recentHistory.length}</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Debug Panel */}
          {showDebugPanel && debugData && (
            <Card className="w-full rounded-3xl border border-amber-200 bg-amber-50/60 p-6 mb-6 shadow">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-amber-900 flex items-center gap-2">
                  <BadgeInfo className="h-5 w-5" /> معلومات التشخيص
                </h3>
                <button
                  onClick={() => setShowDebugPanel(false)}
                  className="text-amber-500 hover:text-amber-700"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4 text-sm">
                {/* Status Config */}
                <div className="bg-white p-3 rounded-2xl border border-yellow-300">
                  <h4 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-yellow-500" /> إعدادات الحالة
                  </h4>
                  <div className="space-y-1 text-gray-700">
                    <p><strong>الحالة المطلوبة:</strong> {debugData.statusConfig.statusName} ({debugData.statusConfig.statusSlug})</p>
                    <p><strong>معرف الحالة:</strong> {debugData.statusConfig.statusId}</p>
                  </div>
                </div>

                {/* Orders in Salla */}
                <div className="bg-white p-3 rounded-2xl border border-yellow-300">
                  <h4 className="font-bold text-gray-800 mb-2 flex items-center gap-2">
                    <Search className="h-4 w-4 text-yellow-500" /> الطلبات في سلة
                  </h4>
                  <div className="space-y-1 text-gray-700">
                    <p><strong>إجمالي الطلبات بهذه الحالة:</strong> {debugData.ordersInSalla.total}</p>
                    <p><strong>المتاحة للتعيين:</strong> <span className="text-green-600 font-bold">{debugData.ordersInSalla.available}</span></p>
                    <p><strong>معينة بالفعل:</strong> <span className="text-red-600">{debugData.ordersInSalla.alreadyAssigned}</span></p>
                  </div>
                </div>

                {/* User Assignments */}
                <div className="bg-white p-3 rounded-2xl border border-yellow-300">
                  <h4 className="font-bold text-gray-800 mb-2 flex.items-center gap-2">
                    <PackageCheck className="h-4 w-4 text-yellow-500" /> تعييناتك
                  </h4>
                  <div className="space-y-1 text-gray-700">
                    <p><strong>الطلبات النشطة لديك:</strong> {debugData.assignments.userActiveAssignments}</p>
                    <p><strong>يمكنك استلام طلب جديد:</strong> {debugData.assignments.canAssignMore ? '✅ نعم' : '❌ لا (لديك طلب نشط)'}</p>
                    <p><strong>التعيين التلقائي:</strong> {debugData.user.autoAssign ? 'مفعل' : 'معطل'}</p>
                  </div>
                </div>

                {/* Sample Available Orders */}
                {debugData.sampleOrders.length > 0 && (
                  <div className="bg-white p-3 rounded-2xl border border-yellow-300">
                    <h4 className="flex items-center gap-2 font-bold text-gray-800 mb-2">
                      <History className="h-4 w-4 text-yellow-500" /> أمثلة الطلبات المتاحة (أول 5)
                    </h4>
                    <div className="space-y-2">
                      {debugData.sampleOrders.map((order: any, idx: number) => (
                        <div key={idx} className="p-2 bg-gray-50 rounded text-xs">
                          <p><strong>رقم الطلب:</strong> {order.orderNumber}</p>
                          <p><strong>طريقة الدفع:</strong> {order.paymentMethod}</p>
                          <p><strong>التاريخ:</strong> {new Date(order.createdAt).toLocaleString('ar-SA')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Diagnosis */}
                <div className="bg-blue-50 p-3 rounded border-2 border-blue-400">
                  <h4 className="font-bold text-blue-900 mb-2">💡 التشخيص</h4>
                  <div className="text-sm text-blue-800">
                    {debugData.ordersInSalla.available === 0 && debugData.ordersInSalla.total === 0 && (
                      <p>❌ لا توجد طلبات في سلة بحالة &quot;{debugData.statusConfig.statusName}&quot;. تأكد من وجود طلبات جديدة في متجرك.</p>
                    )}
                    {debugData.ordersInSalla.available === 0 && debugData.ordersInSalla.total > 0 && (
                      <p>⚠️ جميع الطلبات معينة بالفعل. انتظر طلبات جديدة أو تأكد من إكمال الطلبات الحالية.</p>
                    )}
                    {debugData.ordersInSalla.available > 0 && !debugData.assignments.canAssignMore && (
                      <p>⚠️ يوجد {debugData.ordersInSalla.available} طلب متاح ولكن لديك طلب نشط. أكمل الطلب الحالي أولاً.</p>
                    )}
                    {debugData.ordersInSalla.available > 0 && debugData.assignments.canAssignMore && (
                      <p>✅ يوجد {debugData.ordersInSalla.available} طلب متاح ويمكنك استلام طلب جديد. انقر على &quot;تحديث الطلبات&quot;.</p>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {showHistoryPanel && (
            <Card className="w-full mb-6 rounded-3xl border border-white/60 bg-white p-6 shadow">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">آخر 10 طلبات قمت بتحضيرها</h3>
                  <p className="text-sm text-gray-500">
                    اختر أي طلب لإعادة فتحه والعمل عليه مجدداً.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={loadRecentHistory}
                  disabled={loadingRecentHistory}
                >
                  {loadingRecentHistory ? 'جاري التحديث...' : 'تحديث السجل'}
                </Button>
              </div>

              {recentHistoryError && (
                <p className="mt-3 text-sm text-red-600">{recentHistoryError}</p>
              )}

              <div className="mt-4 border border-gray-200 rounded-lg divide-y divide-gray-200 bg-gray-50">
                {loadingRecentHistory && recentHistory.length === 0 && (
                  <div className="p-4 text-center text-sm text-gray-500">جاري تحميل السجل...</div>
                )}

                {!loadingRecentHistory && recentHistory.length === 0 && !recentHistoryError && (
                  <div className="p-4 text-center text-sm text-gray-500">
                    لا يوجد سجل طلبات مكتملة بعد.
                  </div>
                )}

                {recentHistory.map((history) => {
                  const { number, name } = getCustomerIdentifiersFromOrderData(history.orderData);
                  const { label, className } = getHistoryStatusMeta(history.status);
                  return (
                    <div
                      key={history.id}
                      className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenHistoryOrder(history)}
                        className="text-left"
                      >
                        <p className="text-base font-semibold text-blue-700 underline decoration-dotted underline-offset-2 hover:text-blue-900">
                          طلب #{history.orderNumber}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatHistoryTimestamp(history.finishedAt)}
                        </p>
                      </button>
                      <div className="flex flex-col gap-1 text-sm text-gray-600 sm:text-right">
                        {name && (
                          <span>
                            العميل:{' '}
                            <span className="font-semibold text-gray-900">{name}</span>
                          </span>
                        )}
                        {number && (
                          <span className="text-xs text-gray-500">
                            رقم العميل:{' '}
                            <span className="font-medium text-gray-900">{number}</span>
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold ${className}`}
                        >
                          {label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Stats */}
          {assignments.length > 0 && (
            <Card className="w-full rounded-3xl border border-white/60 bg-white/95 p-6 mb-6 text-center shadow">
              <p className="text-sm text-slate-500">الطلبات النشطة</p>
              <p className="text-4xl font-bold text-indigo-600">{assignments.length}</p>
            </Card>
          )}

          {loadingOrders ? (
            <div className="w-full text-center py-12 text-slate-600">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-indigo-500 mb-4" />
              <p>جاري تحميل الطلبات...</p>
            </div>
          ) : !currentOrder ? (
            <Card className="w-full rounded-3xl border border-dashed border-slate-200 bg-white/95 p-8 md:p-12 text-center shadow">
              <div className="mb-6">
                <Search className="mx-auto mb-4 h-16 w-16 text-slate-300" />
                <p className="text-xl text-gray-600 mb-2">لا توجد طلبات للتحضير حالياً</p>
                <p className="text-sm text-gray-500 mb-4">
                  انقر على زر &quot;تحديث الطلبات&quot; أعلاه للبحث عن طلبات جديدة متى ما احتجت ذلك.
                </p>
              </div>
              <Button
                onClick={() => autoAssignOrders({ showDebugMessage: true })}
                disabled={loadingOrders}
                className="rounded-2xl bg-indigo-600 px-6 py-5 text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-700"
              >
                {loadingOrders ? 'جاري البحث...' : 'البحث عن طلبات جديدة'}
              </Button>
            </Card>
          ) : (
            <div className="w-full">
              {/* Order Header */}
              <Card className="mb-6 rounded-3xl border border-white/60 bg-white/95 p-6 shadow">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold flex flex-wrap items-center gap-3">
                    <span>طلب #{currentOrder.orderNumber}</span>
                    {currentOrder.isHighPriority && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-800">
                        ⚡ أولوية قصوى
                      </span>
                    )}
                  </h2>
                  <p className="text-gray-600 mt-1">
                    {getStringValue(currentOrder.orderData?.customer?.first_name)}{' '}
                    {getStringValue(currentOrder.orderData?.customer?.last_name)}
                  </p>
                  {(() => {
                    const location = getStringValue(currentOrder.orderData?.customer?.location);
                    const city = getStringValue(currentOrder.orderData?.customer?.city);
                    if (!location && !city) return null;
                    return (
                      <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                        <MapPin className="h-4 w-4 text-indigo-500" />
                        <span>
                          {location && `${location} - `}
                          {city}
                        </span>
                      </p>
                    );
                  })()}
                  {(() => {
                    const notesText = getStringValue(currentOrder.orderData?.notes);
                    if (!notesText) return null;
                    return (
                      <p className="mt-2 flex items-center gap-2 text-sm font-medium text-amber-600">
                        <BadgeInfo className="h-4 w-4" />
                        <span>ملاحظات: {notesText}</span>
                      </p>
                    );
                  })()}

                  {currentOrder.isHighPriority && (
                    <div className="mt-4 rounded-3xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4 shadow-inner">
                      <div className="flex items-center gap-2 text-orange-800 font-bold">
                        <span>⚡ طلب عالي الأولوية</span>
                      </div>
                      {currentOrder.highPriorityReason && (
                        <p className="text-sm text-orange-700 mt-2">
                          السبب: {currentOrder.highPriorityReason}
                        </p>
                      )}
                      {currentOrder.highPriorityNotes && (
                        <p className="text-sm text-orange-700 mt-1">
                          ملاحظات داخلية: {currentOrder.highPriorityNotes}
                        </p>
                      )}
                      {currentOrder.highPriorityMarkedBy && currentOrder.highPriorityMarkedAt && (
                        <p className="text-xs text-orange-600 mt-2">
                          تم التحديد بواسطة {currentOrder.highPriorityMarkedBy} في{' '}
                          {new Date(currentOrder.highPriorityMarkedAt).toLocaleString('ar-SA')}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Order Tags - Prominent Display */}
                  {currentOrder.orderData?.tags && currentOrder.orderData.tags.length > 0 && (
                    <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                        </svg>
                        <h3 className="text-sm font-bold text-blue-900">علامات الطلب (Tags)</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {currentOrder.orderData.tags.map((tag: any, idx: number) => {
                          const tagLabel = typeof tag === 'string' ? tag : getStringValue(tag?.name ?? tag?.value ?? tag);
                          return (
                            <span
                              key={idx}
                              className="inline-flex items-center px-4 py-2 rounded-full text-sm font-bold bg-blue-600 text-white shadow-md border-2 border-blue-700"
                            >
                              🏷️ {tagLabel}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* International Order Alert */}
              {(() => {
                const countryValue = currentOrder.orderData?.customer?.country
                  || currentOrder.orderData?.shipping_address?.country
                  || currentOrder.orderData?.billing_address?.country;
                const country = getStringValue(countryValue);

                // List of Saudi Arabia country codes (case-insensitive)
                const saudiCodes = ['SA', 'SAU', 'SAUDI ARABIA', 'السعودية', 'المملكة العربية السعودية'];
                const isSaudiOrder = country && saudiCodes.some(code =>
                  country.toUpperCase() === code.toUpperCase()
                );

                // Show alert if order is international (not Saudi Arabia)
                if (country && !isSaudiOrder) {
                  return (
                    <Card className="p-4 md:p-6 mb-4 md:mb-6 bg-red-50 border-2 border-red-500">
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                          <svg className="w-8 h-8 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <div className="flex-1">
                            <h3 className="text-lg md:text-xl font-bold text-red-900">طلب دولي</h3>
                            <p className="text-sm text-red-700 mt-1">الدولة: {country}</p>
                          </div>
                        </div>
                        <Button
                          onClick={handlePrintCommercialInvoice}
                          className={`${ACTION_BUTTON_BASE} bg-blue-600 hover:bg-blue-700`}
                        >
                          🖨️ طباعة فاتورة تجارية (Commercial Invoice)
                        </Button>
                      </div>
                    </Card>
                  );
                }
                return null;
              })()}

              {/* Products and Options */}
              <div className="space-y-3 md:space-y-4">
                {loadingProductLocations && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    جاري تحميل مواقع التخزين للمنتجات...
                  </div>
                )}
                {productLocationError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    ⚠️ {productLocationError}
                  </div>
                )}
                {locationSummary.length > 0 && (
                  <Card className="border-amber-200 bg-amber-50/70">
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-lg font-bold text-amber-900">📦 مواقع سريعة للالتقاط</span>
                        <span className="text-xs text-amber-700">
                          {locationSummary.reduce((sum, block) => sum + block.totalQuantity, 0)} قطعة
                        </span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {locationSummary.map((block) => (
                          <div
                            key={block.key}
                            className={`rounded-lg border p-3 ${block.key === 'NO_LOCATION'
                              ? 'border-gray-200 bg-white'
                              : 'border-amber-200 bg-white/80'}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className={`text-base font-bold ${block.key === 'NO_LOCATION' ? 'text-gray-600' : 'text-amber-900'}`}>
                                {block.key === 'NO_LOCATION' ? 'بدون موقع مسجل' : block.locationLabel}
                              </span>
                              <span className={`text-xs font-semibold ${block.key === 'NO_LOCATION' ? 'text-gray-500' : 'text-amber-700'}`}>
                                ×{block.totalQuantity}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1">
                              {block.items.map((item, itemIdx) => (
                                <div key={`${block.key}-${item.sku}-${itemIdx}`} className="flex items-center justify-between text-xs font-medium text-slate-700">
                                  <span className="font-mono text-sm text-slate-900">{item.sku}</span>
                                  <span className="text-slate-500">×{item.quantity}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>
                )}
                {/* Regular Products */}
                {currentOrder.orderData?.items && currentOrder.orderData.items.length > 0 ? (
                  <>
                    {currentOrder.orderData.items.map((item: any, idx: number) => {
                      const normalizedSku = normalizeSku(item?.sku);
                      const locationInfo = normalizedSku ? getLocationForSku(normalizedSku) : undefined;
                      const skuDisplay = normalizedSku || getStringValue(item?.sku);
                      const locationUpdatedAt = locationInfo?.updatedAt
                        ? new Date(locationInfo.updatedAt).toLocaleString('ar-SA')
                        : null;

                      return (
                        <Card key={`item-${idx}`} className="p-4 md:p-6">
                          <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                            {/* Product Image */}
                            <div className="flex-shrink-0">
                              {(item.thumbnail || item.product_thumbnail || item.product?.thumbnail) ? (
                                <img
                                  src={item.thumbnail || item.product_thumbnail || item.product?.thumbnail}
                                  alt={item.name}
                                  className="w-full md:w-40 md:h-40 object-contain rounded-lg border-2 border-gray-200 bg-white"
                                />
                              ) : (
                                <div className="w-full md:w-40 md:h-40 h-64 bg-gray-100 rounded-lg border-2 border-gray-200 flex items-center justify-center">
                                  <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                              )}
                            </div>

                            {/* Product Details */}
                            <div className="flex-1 space-y-3">
                              <h3 className="text-2xl font-bold text-gray-900">{item.name}</h3>

                              {/* SKU, Quantity, and Location */}
                              <div className="flex flex-wrap gap-2">
                                {skuDisplay && (
                                  <div className="inline-flex items-center gap-2 bg-blue-50 border-2 border-blue-500 px-4 py-3 rounded-lg">
                                    <span className="text-sm font-semibold text-blue-700">SKU:</span>
                                    <span className="text-xl font-bold text-blue-900">{skuDisplay}</span>
                                  </div>
                                )}

                                <div className="inline-flex items-center gap-2 bg-green-50 border-2 border-green-500 px-4 py-3 rounded-lg">
                                  <span className="text-sm font-semibold text-green-700">الكمية:</span>
                                  <span className="text-xl font-bold text-green-900">×{item.quantity}</span>
                                </div>

                                {normalizedSku && (
                                  <div className={`flex flex-col gap-1 rounded-lg border-2 px-4 py-3 ${locationInfo ? 'bg-amber-50 border-amber-500' : 'bg-gray-100 border-dashed border-gray-400'}`}>
                                    <div className="flex items-center gap-2">
                                      <span className={`text-sm font-semibold ${locationInfo ? 'text-amber-700' : 'text-gray-600'}`}>موقع التخزين:</span>
                                      <span className={`text-lg font-bold ${locationInfo ? 'text-amber-900' : 'text-gray-600'}`}>
                                        {locationInfo ? locationInfo.location : 'غير متوفر'}
                                      </span>
                                    </div>
                                    {locationInfo?.notes && (
                                      <p className="text-xs text-amber-700">{locationInfo.notes}</p>
                                    )}
                                    {locationUpdatedAt && (
                                      <p className="text-xs text-amber-600">آخر تحديث: {locationUpdatedAt}</p>
                                    )}
                                    {!locationInfo && !loadingProductLocations && (
                                      <p className="text-xs text-gray-500">سجل الموقع عبر صفحة المستودع لتسهيل تحضير الطلب.</p>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Product Options (Size, Color, etc.) */}
                              {item.options && item.options.length > 0 && (
                                <div className="space-y-2">
                                  {item.options.map((option: any, optIdx: number) => (
                                    <div key={optIdx} className="inline-flex items-center gap-2 bg-purple-50 border border-purple-300 px-3 py-2 rounded-lg mr-2">
                                      <span className="text-sm font-medium text-purple-700">{getStringValue(option.name)}:</span>
                                      <span className="text-sm font-bold text-purple-900">{getStringValue(option.value)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })}

                    {/* Gift Wrapping Alert - Show for paid options, gift SKUs, or manual gift flags */}
                    {(() => {
                      const packagingAmount = getNumberValue(currentOrder.orderData?.amounts?.options_total?.amount);
                      const items = Array.isArray(currentOrder.orderData?.items) ? currentOrder.orderData.items : [];
                      const giftSkuPatterns = ['7571', '6504'];
                      const giftSkuItems = items.filter((item: any) => {
                        const sku = getStringValue(item?.sku).toUpperCase();
                        return sku && giftSkuPatterns.some(pattern => sku.includes(pattern));
                      });
                      const hasManualGiftFlag = Boolean(currentOrder?.hasGiftFlag);
                      const shouldHighlightGiftWrap = packagingAmount > 0 || giftSkuItems.length > 0 || hasManualGiftFlag;

                      if (!shouldHighlightGiftWrap) {
                        return null;
                      }

                      const giftReasonMessage =
                        hasManualGiftFlag
                          ? (currentOrder?.giftFlagReason || 'تم وضع علامة بأن هذا الطلب يحتاج تغليف هدية.')
                          : packagingAmount > 0
                            ? 'هذا الطلب يحتاج إلى تغليف هدية'
                            : 'يحتوي الطلب على منتجات تتطلب تغليف هدية';

                      return (
                        <Card className="p-4 md:p-6 bg-red-50 border-2 border-red-500">
                          <div className="flex items-center gap-3">
                            <svg className="w-8 h-8 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            <div className="flex-1">
                              <h3 className="text-lg md:text-xl font-bold text-red-900">🎁 تغليف هدية</h3>
                              <p className="text-sm text-red-700 mt-1">{giftReasonMessage}</p>
                              {hasManualGiftFlag && currentOrder?.giftFlagNotes && (
                                <p className="text-sm text-red-700 mt-1">ملاحظات إضافية: {currentOrder.giftFlagNotes}</p>
                              )}
                              {giftSkuItems.length > 0 && (
                                <p className="text-sm text-red-700 mt-1">
                                  العناصر: {giftSkuItems.map((item: any) => {
                                    const name = getStringValue(item?.name);
                                    const sku = getStringValue(item?.sku);
                                    return `${name}${sku ? ` (${sku})` : ''}`;
                                  }).join('، ')}
                                </p>
                              )}
                              {hasManualGiftFlag && (
                                <p className="text-xs text-red-600 mt-2">
                                  تم تحديدها بواسطة {currentOrder?.giftFlagMarkedBy || 'فريق المرتجعات'}
                                  {currentOrder?.giftFlagMarkedAt
                                    ? ` في ${formatHistoryTimestamp(currentOrder.giftFlagMarkedAt)}`
                                    : ''}
                                </p>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })()}
                  </>
                ) : (
                  <Card className="p-6 md:p-8 text-center">
                    <p className="text-gray-500 mb-4">لا توجد منتجات في هذا الطلب</p>
                    <Button onClick={handleRefreshItems} disabled={refreshingItems} variant="outline">
                      {refreshingItems ? 'جاري التحديث...' : 'تحديث المنتجات'}
                    </Button>
                  </Card>
                )}
              </div>

              {/* Shipment Info Display */}
              {(shipmentInfo || currentOrder.status === 'shipped') && (
                <Card className="mt-6 p-4 bg-green-50 border-2 border-green-500">
                  <h3 className="text-lg font-bold text-green-900 mb-2">✅ تم إنشاء الشحنة</h3>
                  <div className="space-y-2">
                    {shipmentInfo && (
                      <>
                        <p className="text-sm text-green-800">
                          <strong>رقم التتبع:</strong> {shipmentInfo.trackingNumber}
                        </p>
                        <p className="text-sm text-green-800">
                          <strong>شركة الشحن:</strong> {shipmentInfo.courierName}
                        </p>
                        {shipmentInfo.labelPrinted && (
                          <p className="text-sm text-green-800">
                            <strong>حالة الطباعة:</strong>{' '}
                            {shipmentInfo.printedAt
                              ? `تمت الطباعة ${new Date(shipmentInfo.printedAt).toLocaleString('ar-SA')}`
                              : 'تمت الطباعة'}
                          </p>
                        )}
                        {shipmentInfo.labelUrl && (
                          <a
                            href={shipmentInfo.labelUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-800 underline font-medium"
                          >
                            عرض رابط البوليصة
                          </a>
                        )}
                      </>
                    )}
                    {!shipmentInfo && currentOrder.status === 'shipped' && currentOrder.notes && (
                      <p className="text-sm text-green-800">
                        {currentOrder.notes}
                      </p>
                    )}
                    {!shipmentInfo?.labelPrinted && (
                      <p className="text-sm text-amber-700 mt-2 font-medium">
                        لم يتم إرسال البوليصة للطابعة بعد. اضغط زر &quot;طباعة البوليصة&quot; لإرسالها إلى PrintNode.
                      </p>
                    )}
                    <p className="text-sm text-green-700 mt-2 font-medium">
                      بعد التأكد من الطباعة يمكنك استخدام زر &quot;الانتقال للطلب التالي&quot; لإكمال الطلب الحالي.
                    </p>
                  </div>
                </Card>
              )}
              {shipmentError && (
                <Card className="mt-4 p-4 bg-red-50 border-2 border-red-500">
                  <div className="flex items-start gap-3">
                    <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <h4 className="text-base font-bold text-red-900">فشل إنشاء الشحنة</h4>
                      <p className="text-sm text-red-700 whitespace-pre-line leading-relaxed">{shipmentError}</p>
                    </div>
                  </div>
                </Card>
              )}

              {/* Action Buttons - Fixed at bottom */}
              <div className="mt-8 md:mt-10 md:sticky md:bottom-0 md:z-40 md:-mx-6 md:px-6">
                <div className="rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-white/80 md:rounded-none md:border-x-0 md:border-b-0 md:border-t md:shadow-[0_-12px_30px_rgba(15,23,42,0.12)] md:bg-white/95 md:p-5">
                  {/* Review Status Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      type="button"
                      onClick={() =>
                        openConfirmationDialog({
                          title: 'تأكيد النقل تحت المراجعة',
                          message: 'سيتم نقل الطلب الحالي إلى حالة "تحت المراجعة" وإزالته من قائمتك. هل ترغب بالمتابعة؟',
                          confirmLabel: 'نعم، نقل الطلب',
                          confirmVariant: 'danger',
                          onConfirm: handleMoveToUnderReview,
                        })
                      }
                      disabled={movingToReview || movingToReservation}
                      className={`${ACTION_BUTTON_BASE} flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-orange-200 disabled:opacity-70`}
                    >
                      <ClipboardList className="h-4 w-4" />
                      {movingToReview ? 'جاري النقل...' : 'تحت المراجعة'}
                    </Button>
                    <Button
                      type="button"
                      onClick={() =>
                        openConfirmationDialog({
                          title: 'تأكيد النقل لحجز القطع',
                          message: 'سيتم نقل الطلب الحالي إلى حالة "تحت المراجعة حجز قطع" وإزالته من قائمتك. هل أنت متأكد؟',
                          confirmLabel: 'نعم، نقل الطلب',
                          confirmVariant: 'danger',
                          onConfirm: handleMoveToReservation,
                        })
                      }
                      disabled={movingToReview || movingToReservation}
                      className={`${ACTION_BUTTON_BASE} flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-lg shadow-indigo-200 disabled:opacity-70`}
                    >
                      <PackageCheck className="h-4 w-4" />
                      {movingToReservation ? 'جاري النقل...' : 'تحت المراجعة حجز قطع'}
                    </Button>
                  </div>

                  {/* Main Action Buttons */}
                  <div className="mt-4 flex flex-col sm:flex-row gap-3">
                    {currentOrder.status === 'shipped' ? (
                      // Show "Go to New Order" button when shipment is created
                      <Button
                        type="button"
                        onClick={() =>
                          openConfirmationDialog({
                            title: 'تأكيد الانتقال للطلب التالي',
                            message: 'سيتم إنهاء معالجة هذا الطلب والانتقال مباشرةً للطلب التالي المتاح. تأكد من اكتمال جميع الخطوات قبل المتابعة.',
                            confirmLabel: 'نعم، انتقل للطلب التالي',
                            onConfirm: handleGoToNewOrder,
                          })
                        }
                        className={`${ACTION_BUTTON_BASE} flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-200`}
                      >
                        <ArrowRight className="h-4 w-4" />
                        الانتقال للطلب التالي
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          onClick={() =>
                            openConfirmationDialog({
                              title: 'تأكيد طباعة رقم الطلب',
                              message: 'سيتم إرسال رقم الطلب الحالي مباشرةً إلى PrintNode للطباعة على الطابعة المخصصة.',
                              confirmLabel: 'نعم، اطبع الرقم',
                              onConfirm: handlePrintOrderNumber,
                            })
                          }
                          disabled={printingOrderNumber}
                          className={`${ACTION_BUTTON_BASE} flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-lg shadow-indigo-200 disabled:opacity-70`}
                        >
                          <Printer className="h-4 w-4" />
                          {printingOrderNumber ? 'جاري إرسال الرقم...' : 'طباعة رقم الطلب'}
                        </Button>
                        <Button
                          type="button"
                          onClick={() =>
                            openConfirmationDialog({
                              title: 'تأكيد إنهاء الطلب',
                              message: 'سيتم إنهاء الطلب الحالي وإزالته من قائمتك. تأكد من مراجعة الطلب بالكامل قبل الإنهاء.',
                              confirmLabel: 'نعم، إنهاء الطلب',
                              confirmVariant: 'danger',
                              onConfirm: handleCompleteOrder,
                            })
                          }
                          className={`${ACTION_BUTTON_BASE} flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-200`}
                        >
                          <Shield className="h-4 w-4" />
                          إنهاء الطلب
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      <ConfirmationDialog
        open={Boolean(confirmationDialog)}
        title={confirmationDialog?.title || ''}
        message={confirmationDialog?.message || ''}
        confirmLabel={confirmationDialog?.confirmLabel}
        confirmVariant={confirmationDialog?.confirmVariant}
        onConfirm={handleConfirmDialog}
        onCancel={handleCancelDialog}
      />

      {/* Hidden Commercial Invoice for Printing */}
      {currentOrder && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            width: 0,
            height: 0,
            overflow: 'hidden',
            opacity: 0,
            pointerEvents: 'none',
          }}
        >
          <CommercialInvoice
            ref={commercialInvoiceRef}
            orderData={currentOrder.orderData}
            orderNumber={currentOrder.orderNumber}
          />
        </div>
      )}
    </div>
  );
}
