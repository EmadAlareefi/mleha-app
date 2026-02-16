'use client';

import { useState, useEffect, useCallback, useMemo, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import AppNavbar from '@/components/AppNavbar';

interface OrderUser {
  id: string;
  username: string;
  name: string;
}

interface OrderAssignment {
  id: string;
  orderId: string;
  orderNumber: string;
  status: string;
  sallaStatus: string | null;
  assignedUserId: string;
  assignedUserName: string;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  orderData: any;
  notes?: string;
  assignmentState?: AssignmentState;
  isHighPriority?: boolean;
  priorityId?: string | null;
  priorityReason?: string | null;
  priorityNotes?: string | null;
  priorityCreatedAt?: string | null;
}

interface StatsByUser {
  userId: string;
  userName: string;
  total: number;
  completed: number;
  underReview: number;
  reservation: number;
}

interface StatsBucket {
  total: number;
  completed: number;
  underReview: number;
  reservation: number;
  shipped: number;
  byUser: StatsByUser[];
}

interface Stats {
  active: StatsBucket;
  today: StatsBucket;
  week: StatsBucket;
  month: StatsBucket;
}

type PerformancePreset = 'today' | 'week' | 'month' | 'custom';

interface PerformanceUserMetrics {
  userId: string;
  userName: string;
  totalAssigned: number;
  totalCompleted: number;
  completionRate: number;
  avgCompletionMs: number | null;
  ordersPerHour: number;
  underReview: number;
  reservation: number;
  active: number;
}

interface PerformanceData {
  range: { from: string; to: string; hoursInRange: number };
  aggregate: Omit<PerformanceUserMetrics, 'userId' | 'userName'>;
  byUser: PerformanceUserMetrics[];
}

type AssignmentState = 'new' | 'assigned';

type PriorityToggleOrder = {
  id: string | null | undefined;
  orderNumber: string | null | undefined;
  assignmentState?: AssignmentState;
  isHighPriority?: boolean;
  priorityId?: string | null;
  customerName?: string | null;
  statusLabel?: string | null;
};

interface LiveSallaOrder {
  id: string | null;
  orderNumber: string | null;
  sequenceNumber?: number | null;
  createdAt: string | null;
  paymentMethod: string | null;
  totalAmount: number | null;
  customerName: string | null;
  itemsCount: number | null;
  statusId: string | null;
  statusSlug: string | null;
  statusLabel: string | null;
  statusParentId: string | null;
  statusParentName: string | null;
  statusGroupKey: string | null;
  assignmentState: AssignmentState;
  assignmentReason: string | null;
  assignmentId: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignmentStatus: string | null;
  isHighPriority?: boolean;
  priorityId?: string | null;
  priorityReason?: string | null;
  priorityNotes?: string | null;
  priorityCreatedAt?: string | null;
}

interface LiveOrdersSummary {
  success?: boolean;
  fetchedAt: string;
  statusFilters?: string[];
  primaryStatusName?: string | null;
  statusDetails?: {
    primaryStatusName: string | null;
    relatedStatuses: Array<{
      id: number;
      name: string;
      slug: string;
      parentId: number | null;
      parentName: string | null;
    }>;
  };
  totals: {
    new: number;
    assigned: number;
  };
  orders: LiveSallaOrder[];
}

const LIVE_STATE_STYLES: Record<
  AssignmentState,
  { label: string; className: string }
> = {
  new: {
    label: 'بانتظار التعيين',
    className: 'bg-gray-100 text-gray-800 border-gray-300',
  },
  assigned: {
    label: 'تم تعيينه',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
};

const NEW_ORDER_STATUS_COLUMNS = [
  {
    id: '449146439',
    fallbackName: 'طلب جديد',
    description: 'بانتظار المراجعة الأولية',
    pillAccentClass: 'border-slate-200',
  },
  {
    id: '1065456688',
    fallbackName: 'تحت المراجعة ع',
    description: 'مراجعة عامة قبل التعيين',
    pillAccentClass: 'border-amber-200',
  },
  {
    id: '1576217163',
    fallbackName: 'تحت المراجعة حجز قطع',
    description: 'بانتظار توفر قطع محددة',
    pillAccentClass: 'border-purple-200',
  },
  {
    id: '1882207425',
    fallbackName: 'تحت المراجعة ا',
    description: 'مراجعة متقدمة من الفريق',
    pillAccentClass: 'border-blue-200',
  },
  {
    id: '2046404155',
    fallbackName: 'غير متوفر (ارجاع مبلغ)',
    description: 'حالات استرداد بسبب عدم توفر المنتج',
    pillAccentClass: 'border-rose-200',
  },
  {
    id: '1956875584',
    fallbackName: 'جاري التحضير',
    description: 'طلبات يتم تجهيزها حالياً من الفريق',
    pillAccentClass: 'border-emerald-200',
  },
] as const;

const NON_REMOVABLE_ASSIGNMENT_STATUSES = new Set(['completed', 'removed', 'released']);

const parseJsonSafely = <T,>(rawBody: string, context: string): T | null => {
  if (!rawBody) {
    return null;
  }
  try {
    return JSON.parse(rawBody) as T;
  } catch (error) {
    console.error(`${context} returned invalid JSON`, error, {
      bodySnippet: rawBody.slice(0, 200),
    });
    return null;
  }
};

const extractValueFromOrderData = (data: any, fieldPaths: string[][]): string | null => {
  if (!data) {
    return null;
  }

  for (const path of fieldPaths) {
    let current: any = data;
    let valid = true;

    for (const key of path) {
      if (current === null || current === undefined) {
        valid = false;
        break;
      }

      if (typeof current !== 'object') {
        valid = false;
        break;
      }

      current = (current as Record<string, unknown>)[key];
    }

    if (!valid || current === null || current === undefined) {
      continue;
    }

    if (typeof current === 'string') {
      const trimmed = current.trim();
      if (trimmed) {
        return trimmed;
      }
      continue;
    }

    if (typeof current === 'number' || typeof current === 'boolean') {
      return String(current);
    }
  }

  return null;
};

const ORDER_CUSTOMER_NAME_PATHS: string[][] = [
  ['customer', 'name'],
  ['customer', 'nickname'],
  ['customer', 'username'],
  ['customer', 'full_name'],
  ['customer', 'display_name'],
  ['customer_name'],
  ['customerName'],
];

const ORDER_CUSTOMER_PHONE_PATHS: string[][] = [
  ['customer', 'mobile'],
  ['customer', 'phone'],
  ['customer', 'mobileNumber'],
  ['customer', 'mobile_number'],
  ['customer', 'contact'],
  ['shipping_address', 'mobile'],
  ['shipping_address', 'phone'],
  ['billing_address', 'mobile'],
  ['billing_address', 'phone'],
];

export default function AdminOrderPrepPage() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated';

  const [assignments, setAssignments] = useState<OrderAssignment[]>([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [users, setUsers] = useState<OrderUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [liveOrders, setLiveOrders] = useState<LiveOrdersSummary | null>(null);
  const [liveOrdersLoading, setLiveOrdersLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [reassignUserId, setReassignUserId] = useState<string>('');
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [priorityUpdatingId, setPriorityUpdatingId] = useState<string | null>(null);
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [orderSearchLoading, setOrderSearchLoading] = useState(false);
  const [orderSearchResult, setOrderSearchResult] = useState<OrderAssignment | null>(null);
  const [orderSearchError, setOrderSearchError] = useState<string | null>(null);
  const [perfPreset, setPerfPreset] = useState<PerformancePreset>('today');
  const [perfCustomFrom, setPerfCustomFrom] = useState('');
  const [perfCustomTo, setPerfCustomTo] = useState('');
  const [perfData, setPerfData] = useState<PerformanceData | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const currentStats = stats?.active ?? null;
  const currentUserStats = currentStats?.byUser ?? [];

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/order-assignments/users');
      const data = await response.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  }, []);

  const loadAssignmentsData = useCallback(async () => {
    setAssignmentsLoading(true);
    try {
      const params = new URLSearchParams({
        timeFilter: 'active',
        statusFilter: 'all',
      });

      const [assignmentsRes, statsRes] = await Promise.all([
        fetch(`/api/admin/order-assignments/list?${params}`),
        fetch(`/api/admin/order-assignments/stats?${params}`),
      ]);

      const assignmentsBody = await assignmentsRes.text();
      const statsBody = await statsRes.text();

      if (!assignmentsRes.ok) {
        console.warn('Failed to load assignments list', {
          status: assignmentsRes.status,
          bodySnippet: assignmentsBody.slice(0, 200),
        });
        setAssignments([]);
        setError('فشل تحميل الطلبات النشطة من الخادم.');
      } else {
        const assignmentsData = parseJsonSafely<{ success?: boolean; assignments?: OrderAssignment[]; error?: string }>(
          assignmentsBody,
          'Admin assignments list',
        );
        if (assignmentsData?.success && Array.isArray(assignmentsData.assignments)) {
          setAssignments(assignmentsData.assignments);
          setError(null);
        } else {
          setAssignments([]);
          setError(assignmentsData?.error || 'تعذر تحميل الطلبات');
        }
      }

      if (!statsRes.ok) {
        console.warn('Failed to load order stats', {
          status: statsRes.status,
          bodySnippet: statsBody.slice(0, 200),
        });
        setStats(null);
      } else {
        const statsData = parseJsonSafely<{ success?: boolean; stats?: Stats }>(statsBody, 'Admin assignments stats');
        if (statsData?.success && statsData.stats) {
          setStats(statsData.stats);
        } else {
          setStats(null);
        }
      }
    } catch (loadError) {
      console.error('Failed to load assignments data:', loadError);
      setError('فشل تحميل بيانات الطلبات');
    } finally {
      setAssignmentsLoading(false);
    }
  }, []);

  const loadLiveOrders = useCallback(async () => {
    setLiveOrdersLoading(true);
    try {
      const response = await fetch('/api/admin/order-assignments/new-orders?limit=300', {
        cache: 'no-store',
      });
      const rawBody = await response.text();
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        console.warn('Failed to load live Salla orders', { status: response.status, bodySnippet: rawBody.slice(0, 200) });
        setLiveOrders(null);
        return;
      }

      if (!rawBody) {
        setLiveOrders(null);
        return;
      }

      const isJsonResponse = contentType.includes('application/json');
      if (!isJsonResponse) {
        console.error('Live Salla orders responded with non-JSON payload', {
          contentType,
          bodySnippet: rawBody.slice(0, 200),
        });
        setError('تعذر قراءة الطلبات الجديدة من سلة، يرجى المحاولة لاحقاً.');
        setLiveOrders(null);
        return;
      }

      let data: LiveOrdersSummary | null = null;
      try {
        data = JSON.parse(rawBody);
      } catch (parseError) {
        console.error('Live Salla orders returned invalid JSON', parseError, {
          bodySnippet: rawBody.slice(0, 200),
        });
        setError('تعذر قراءة الطلبات الجديدة من سلة، يرجى المحاولة لاحقاً.');
        setLiveOrders(null);
        return;
      }

      if (data?.orders) {
        setLiveOrders({
          fetchedAt: data.fetchedAt,
          statusFilters: data.statusFilters,
          primaryStatusName: data.primaryStatusName,
          statusDetails: data.statusDetails,
          totals: data.totals || { new: 0, assigned: 0 },
          orders: data.orders,
        });
      } else {
        setLiveOrders(null);
      }
    } catch (liveError) {
      console.error('Failed to fetch live Salla orders:', liveError);
      setLiveOrders(null);
    } finally {
      setLiveOrdersLoading(false);
    }
  }, []);

  const loadPerformanceMetrics = useCallback(async () => {
    const now = new Date();
    let from: Date;
    let to: Date = now;

    if (perfPreset === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (perfPreset === 'week') {
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (perfPreset === 'month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      if (!perfCustomFrom || !perfCustomTo) return;
      from = new Date(perfCustomFrom);
      to = new Date(perfCustomTo + 'T23:59:59');
    }

    setPerfLoading(true);
    try {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const res = await fetch(`/api/admin/order-assignments/performance?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setPerfData(data);
        }
      }
    } catch (err) {
      console.error('Failed to load performance metrics:', err);
    } finally {
      setPerfLoading(false);
    }
  }, [perfPreset, perfCustomFrom, perfCustomTo]);

  const refreshAll = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setDashboardLoading(true);
      }
      try {
        await Promise.all([loadAssignmentsData(), loadLiveOrders(), loadPerformanceMetrics()]);
        setLastUpdated(new Date());
      } finally {
        if (!options?.silent) {
          setDashboardLoading(false);
        }
        setInitialized(true);
      }
    },
    [loadAssignmentsData, loadLiveOrders, loadPerformanceMetrics],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    loadUsers();
    refreshAll();
  }, [isAuthenticated, loadUsers, refreshAll]);

  useEffect(() => {
    if (!isAuthenticated || !autoRefresh) {
      return;
    }

    const interval = setInterval(() => {
      refreshAll({ silent: true });
    }, 20000);

    return () => clearInterval(interval);
  }, [autoRefresh, isAuthenticated, refreshAll]);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadPerformanceMetrics();
  }, [isAuthenticated, perfPreset, perfCustomFrom, perfCustomTo, loadPerformanceMetrics]);

  const handleTogglePriority = useCallback(
    async (order: PriorityToggleOrder) => {
      const orderId = order.id;
      const identifier = orderId || order.orderNumber;
      if (!identifier || !orderId) {
        alert('لا يمكن تحديد رقم الطلب لإدارة الأولوية.');
        return;
      }
      const assignmentState = order.assignmentState || 'assigned';
      if (assignmentState !== 'new') {
        alert('يمكن تمييز الطلبات غير المعينة فقط كأولوية.');
        return;
      }

      const shouldUpdateSearchResult = (candidate: OrderAssignment | null) => {
        if (!candidate) {
          return false;
        }
        const candidateKeys = [
          candidate.orderId,
          candidate.orderNumber,
          candidate.id,
        ].filter(Boolean);
        const targetKeys = [orderId, order.orderNumber].filter(Boolean);
        return candidateKeys.some((value) => targetKeys.includes(value));
      };

      setPriorityUpdatingId(identifier);
      try {
        if (order.isHighPriority) {
          const query = order.priorityId
            ? `id=${encodeURIComponent(order.priorityId)}`
            : `orderId=${encodeURIComponent(orderId)}`;
          const response = await fetch(`/api/admin/order-assignments/high-priority?${query}`, {
            method: 'DELETE',
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data?.error) {
            throw new Error(data?.error || 'فشل إزالة الطلب من قائمة الأولوية');
          }
          setOrderSearchResult((previous) => {
            if (!previous || !shouldUpdateSearchResult(previous)) {
              return previous;
            }
            return {
              ...previous,
              isHighPriority: false,
              priorityId: null,
              priorityReason: null,
              priorityNotes: null,
              priorityCreatedAt: null,
            };
          });
        } else {
          const response = await fetch('/api/admin/order-assignments/high-priority', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: orderId,
              orderNumber: order.orderNumber || orderId,
              customerName: order.customerName,
              reason: 'تم تحديده من لوحة إدارة التحضير',
              notes: order.statusLabel ? `الحالة الحالية: ${order.statusLabel}` : undefined,
            }),
          });
          const data = await response.json();
          if (!response.ok || data?.error) {
            throw new Error(data?.error || 'فشل حفظ الطلب في قائمة الأولوية');
          }
          setOrderSearchResult((previous) => {
            if (!previous || !shouldUpdateSearchResult(previous)) {
              return previous;
            }
            return {
              ...previous,
              isHighPriority: true,
              priorityId: data.priority?.id || previous.priorityId || null,
              priorityReason: data.priority?.reason || previous.priorityReason || null,
              priorityNotes: data.priority?.notes || previous.priorityNotes || null,
              priorityCreatedAt: data.priority?.createdAt || previous.priorityCreatedAt || null,
            };
          });
        }
        await loadLiveOrders();
      } catch (error) {
        alert(error instanceof Error ? error.message : 'حدث خطأ أثناء تحديث حالة الأولوية');
      } finally {
        setPriorityUpdatingId(null);
      }
    },
    [loadLiveOrders],
  );

  const handleReassign = async () => {
    if (!reassignUserId || selectedOrders.size === 0) {
      alert('الرجاء اختيار مستخدم وطلبات للنقل');
      return;
    }

    try {
      const response = await fetch('/api/admin/order-assignments/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentIds: Array.from(selectedOrders),
          newUserId: reassignUserId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`تم نقل ${data.reassignedCount} طلب بنجاح`);
        setSelectedOrders(new Set());
        setShowReassignModal(false);
        refreshAll({ silent: true });
      } else {
        alert(data.error || 'فشل نقل الطلبات');
      }
    } catch (error) {
      console.error('Reassign error:', error);
      alert('فشل نقل الطلبات');
    }
  };

  const handleReopenOrders = async () => {
    if (selectedOrders.size === 0) {
      alert('الرجاء اختيار طلبات لإعادة فتحها');
      return;
    }

    const confirmed = confirm(
      `هل أنت متأكد من إعادة فتح ${selectedOrders.size} طلب؟\n\nسيتم تغيير حالة الطلبات إلى "طلب جديد" وستكون متاحة للتحضير مرة أخرى.`
    );

    if (!confirmed) return;

    try {
      const response = await fetch('/api/admin/order-assignments/reopen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentIds: Array.from(selectedOrders),
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`تم إعادة فتح ${data.reopenedCount} طلب بنجاح`);
        setSelectedOrders(new Set());
        refreshAll({ silent: true });
      } else {
        alert(data.error || 'فشل إعادة فتح الطلبات');
      }
    } catch (error) {
      console.error('Reopen error:', error);
      alert('فشل إعادة فتح الطلبات');
    }
  };

  const performAssignmentsRemoval = async (options: { assignmentIds?: string[]; orderIds?: string[] }) => {
    const assignmentIds = Array.isArray(options.assignmentIds)
      ? options.assignmentIds.filter((value) => Boolean(value))
      : [];
    const orderIds = Array.isArray(options.orderIds)
      ? options.orderIds.filter((value) => Boolean(value))
      : [];

    if (assignmentIds.length === 0 && orderIds.length === 0) {
      alert('لا يوجد طلبات صالحة لإزالة الارتباط.');
      return false;
    }

    try {
      const response = await fetch('/api/admin/order-assignments/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentIds, orderIds }),
      });

      const data = await response.json();

      if (data.success) {
        alert(data.message || `تم إزالة ${data.removedCount} طلب`);
        await refreshAll({ silent: true });
        return true;
      }

      alert(data.error || 'فشل إزالة الطلبات');
      return false;
    } catch (error) {
      console.error('Remove assignments error:', error);
      alert('فشل إزالة الطلبات');
      return false;
    }
  };

  const handleRemoveAssignments = async () => {
    if (selectedOrders.size === 0) {
      alert('الرجاء اختيار الطلبات التي ترغب في إزالتها من المستخدم الحالي');
      return;
    }

    const confirmed = confirm(
      `سيتم إزالة ${selectedOrders.size} طلب من مستخدميهم الحاليين وإرجاعهم للطابور.\n\nمتابعة؟`
    );

    if (!confirmed) return;

    const success = await performAssignmentsRemoval({ assignmentIds: Array.from(selectedOrders) });
    if (success) {
      setSelectedOrders(new Set());
    }
  };

  const handleRemoveUserAssignments = async (userId: string, userName: string) => {
    const activeAssignments = assignments.filter(
      (assignment) =>
        assignment.assignedUserId === userId &&
        !NON_REMOVABLE_ASSIGNMENT_STATUSES.has((assignment.status || '').toLowerCase()),
    );

    if (activeAssignments.length === 0) {
      alert('لا يوجد طلبات نشطة قابلة للإزالة لهذا المستخدم');
      return;
    }

    const confirmed = confirm(
      `سيتم إزالة ${activeAssignments.length} طلب من المستخدم ${userName}.\n\nهل تريد المتابعة؟`
    );

    if (!confirmed) return;

    await performAssignmentsRemoval({ assignmentIds: activeAssignments.map((assignment) => assignment.id) });
  };

  const handleRemoveSingleAssignment = async ({
    assignmentId,
    orderId,
    orderNumber,
  }: {
    assignmentId?: string | null;
    orderId?: string | null;
    orderNumber?: string | null;
  }) => {
    const trimmedAssignmentId = assignmentId?.trim();
    const trimmedOrderId = orderId?.trim();
    if (!trimmedAssignmentId && !trimmedOrderId) {
      alert('تعذر تحديد الطلب لإزالة الارتباط.');
      return;
    }

    const confirmed = confirm(
      `هل ترغب في إزالة الطلب ${
        orderNumber ? `#${orderNumber}` : trimmedOrderId ? `#${trimmedOrderId}` : ''
      } من المستخدم الحالي؟`,
    );
    if (!confirmed) return;

    await performAssignmentsRemoval({
      assignmentIds: trimmedAssignmentId ? [trimmedAssignmentId] : undefined,
      orderIds: trimmedOrderId ? [trimmedOrderId] : undefined,
    });
  };

  const handleOrderSearch = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedQuery = orderSearchQuery.trim();

      if (!trimmedQuery) {
        setOrderSearchError('يرجى إدخال رقم الطلب أو بيانات البحث الخاصة بالعميل');
        setOrderSearchResult(null);
        return;
      }

      setOrderSearchLoading(true);
      setOrderSearchError(null);

      try {
        const response = await fetch(`/api/order-assignments/search?query=${encodeURIComponent(trimmedQuery)}`, {
          cache: 'no-store',
        });
        const data = await response.json();

        if (!response.ok || !data?.assignment) {
          throw new Error(data?.error || 'تعذر العثور على الطلب');
        }

        setOrderSearchResult(data.assignment as OrderAssignment);
      } catch (searchError) {
        console.error('Order lookup failed:', searchError);
        const message =
          searchError instanceof Error ? searchError.message : 'حدث خطأ أثناء البحث عن الطلب';
        setOrderSearchError(message);
        setOrderSearchResult(null);
      } finally {
        setOrderSearchLoading(false);
      }
    },
    [orderSearchQuery],
  );

  const formatCompletionTime = (ms: number | null) => {
    if (ms === null) return '—';
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes} دقيقة`;
    const hours = Math.floor(minutes / 60);
    const remainMinutes = minutes % 60;
    if (hours < 24) return `${hours} ساعة ${remainMinutes > 0 ? `${remainMinutes} دقيقة` : ''}`.trim();
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    return `${days} يوم ${remainHours > 0 ? `${remainHours} ساعة` : ''}`.trim();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ar-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatAmount = (amount: number | null) => {
    if (typeof amount === 'number' && !Number.isNaN(amount)) {
      return `${amount.toFixed(2)} ر.س`;
    }
    return '—';
  };

  const liveStatusColumns = useMemo(() => {
    return NEW_ORDER_STATUS_COLUMNS.map((column) => {
      const relatedStatuses = liveOrders?.statusDetails?.relatedStatuses || [];
      const statusMeta = relatedStatuses.find((status) => String(status.id) === column.id);
      const resolvedLabel =
        statusMeta?.name ||
        (column.id === NEW_ORDER_STATUS_COLUMNS[0].id
          ? liveOrders?.primaryStatusName || column.fallbackName
          : column.fallbackName);
      const columnOrders =
        liveOrders?.orders?.filter((order) => order.statusId === column.id) || [];
      return {
        ...column,
        label: resolvedLabel || column.fallbackName,
        orders: columnOrders,
      };
    });
  }, [liveOrders]);

  const linkedLiveOrdersCount = useMemo(() => {
    return liveStatusColumns.reduce((total, column) => {
      return (
        total +
        column.orders.filter(
          (order) => order.assignmentState === 'assigned' && (order.assignmentId || order.assignedUserId),
        ).length
      );
    }, 0);
  }, [liveStatusColumns]);

  const handleBulkUnlinkLiveOrders = useCallback(async () => {
    const assignmentIds = new Set<string>();
    const orderIds = new Set<string>();

    liveStatusColumns.forEach((column) => {
      column.orders.forEach((order) => {
        if (order.assignmentState !== 'assigned') {
          return;
        }
        if (order.assignmentId) {
          assignmentIds.add(order.assignmentId);
        } else if (order.id) {
          orderIds.add(order.id);
        }
      });
    });

    if (assignmentIds.size === 0 && orderIds.size === 0) {
      alert('لا يوجد طلبات مرتبطة لإزالتها حالياً.');
      return;
    }

    const confirmed = confirm(
      `سيتم إلغاء ربط ${assignmentIds.size + orderIds.size} طلب من المستخدمين الحاليين.\n\nهل تريد المتابعة؟`,
    );
    if (!confirmed) {
      return;
    }

    await performAssignmentsRemoval({
      assignmentIds: assignmentIds.size > 0 ? Array.from(assignmentIds) : undefined,
      orderIds: orderIds.size > 0 ? Array.from(orderIds) : undefined,
    });
  }, [liveStatusColumns, performAssignmentsRemoval]);

  const liveOrdersTotal = liveStatusColumns.reduce((sum, column) => sum + column.orders.length, 0);
  const liveOrdersTimestamp = liveOrders?.fetchedAt ? new Date(liveOrders.fetchedAt) : null;
  const liveTotals = liveOrders?.totals || { new: 0, assigned: 0 };
  const lastUpdatedLabel = lastUpdated ? formatDate(lastUpdated.toISOString()) : null;
  const isRefreshing = dashboardLoading || assignmentsLoading || liveOrdersLoading;
  const searchedCustomerName = useMemo(() => {
    if (!orderSearchResult?.orderData) {
      return null;
    }
    return extractValueFromOrderData(orderSearchResult.orderData, ORDER_CUSTOMER_NAME_PATHS);
  }, [orderSearchResult]);
  const searchedCustomerPhone = useMemo(() => {
    if (!orderSearchResult?.orderData) {
      return null;
    }
    return extractValueFromOrderData(orderSearchResult.orderData, ORDER_CUSTOMER_PHONE_PATHS);
  }, [orderSearchResult]);
  const searchedItemsCount = useMemo(() => {
    if (!orderSearchResult?.orderData?.items || !Array.isArray(orderSearchResult.orderData.items)) {
      return null;
    }
    return orderSearchResult.orderData.items.length;
  }, [orderSearchResult]);
  const searchPriorityMeta = useMemo(() => {
    if (!orderSearchResult) {
      return null;
    }
    const identifier =
      orderSearchResult.orderId ||
      orderSearchResult.orderNumber ||
      orderSearchResult.id ||
      null;
    const assignmentState = orderSearchResult.assignmentState || 'assigned';
    return {
      identifier,
      assignmentState,
      disabled: assignmentState !== 'new',
      label: orderSearchResult.isHighPriority ? 'أولوية فعّالة' : 'أولوية',
    };
  }, [orderSearchResult]);
  const isSearchPriorityUpdating =
    Boolean(searchPriorityMeta?.identifier) &&
    searchPriorityMeta?.identifier === priorityUpdatingId;

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg">جاري التحميل...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">إدارة طلبات التحضير</h1>
          <Button onClick={() => window.location.href = '/login'} className="w-full">
            تسجيل الدخول
          </Button>
        </Card>
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg text-gray-600">جاري تحميل لوحة التحكم...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar title="إدارة طلبات التحضير" subtitle="لوحة تحكم المسؤول" />

      <div className="w-full px-4 md:px-6 py-6 space-y-6">
          <Card className="p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">لوحة المراقبة المباشرة</h2>
                <p className="text-sm text-gray-500">عرض كل الطلبات النشطة بدون الحاجة للفلاتر</p>
                <p className="text-xs text-gray-400 mt-1">
                  {lastUpdatedLabel ? `آخر تحديث: ${lastUpdatedLabel}` : 'يتم التحميل...'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={autoRefresh ? 'default' : 'outline'}
                  className={autoRefresh ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
                  onClick={() => setAutoRefresh((value) => !value)}
                >
                  {autoRefresh ? 'التحديث التلقائي مفعّل' : 'تشغيل التحديث التلقائي'}
                </Button>
                <Button onClick={() => refreshAll()} disabled={isRefreshing}>
                  {isRefreshing ? 'جاري التحديث...' : 'تحديث الآن'}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">بحث عن عميل عبر رقم الطلب</h3>
              <p className="text-sm text-gray-500">
                أدخل رقم الطلب أو المرجع لمعرفة حالة التعيين والعميل المرتبط به فوراً
              </p>
            </div>
            <form className="flex flex-col gap-3 md:flex-row" onSubmit={handleOrderSearch}>
              <Input
                value={orderSearchQuery}
                onChange={(event) => setOrderSearchQuery(event.target.value)}
                placeholder="مثال: 123456 أو 9665XXXXXX"
                disabled={orderSearchLoading}
                className="flex-1"
                autoComplete="off"
                inputMode="search"
              />
              <Button type="submit" disabled={orderSearchLoading}>
                {orderSearchLoading ? 'جاري البحث...' : 'بحث'}
              </Button>
            </form>
            {orderSearchError && (
              <p className="text-sm text-rose-600">{orderSearchError}</p>
            )}
            {orderSearchResult && (
              <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="text-xs text-gray-500">رقم الطلب</p>
                    <p className="text-lg font-semibold text-gray-900">
                      #{orderSearchResult.orderNumber || orderSearchResult.orderId}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      معرّف التعيين: {orderSearchResult.id}
                    </p>
                  </div>
                  <div className="text-sm text-gray-700 text-right">
                    <p className="text-xs text-gray-500">المسؤول الحالي</p>
                    <p className="font-semibold">
                      {orderSearchResult.assignedUserName || 'غير معين'}
                    </p>
                    {orderSearchResult.assignedAt && (
                      <p className="text-xs text-gray-500 mt-1">
                        منذ {formatDate(orderSearchResult.assignedAt)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 text-sm text-gray-800 md:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <p className="text-xs text-gray-500">اسم العميل</p>
                    <p className="font-medium">{searchedCustomerName || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">رقم العميل</p>
                    <p className="font-medium">{searchedCustomerPhone || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">عدد المنتجات</p>
                    <p className="font-medium">{searchedItemsCount ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">حالة التحضير</p>
                    <p className="font-medium">{orderSearchResult.status || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">حالة سلة</p>
                    <p className="font-medium">{orderSearchResult.sallaStatus || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">آخر نشاط</p>
                    <p className="font-medium">
                      {orderSearchResult.completedAt
                        ? `أُنجز في ${formatDate(orderSearchResult.completedAt)}`
                        : orderSearchResult.startedAt
                          ? `بدأ في ${formatDate(orderSearchResult.startedAt)}`
                          : orderSearchResult.assignedAt
                            ? formatDate(orderSearchResult.assignedAt)
                            : '—'}
                    </p>
                  </div>
                </div>
                {searchPriorityMeta && (
                  <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/70 p-3 text-sm text-amber-900">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">أولوية التحضير</p>
                        <p className="text-[12px] text-amber-800">
                          {searchPriorityMeta.disabled
                            ? 'يمكن تمييز الطلبات غير المعينة فقط كأولوية'
                            : 'حدد الطلب لدفعه إلى مقدمة طابور التحضير'}
                        </p>
                      </div>
                      <label
                        className={`inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/70 px-3 py-1.5 text-[13px] font-medium text-amber-800 shadow-sm transition
                          ${searchPriorityMeta.disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-amber-100'}
                        `}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                          checked={Boolean(orderSearchResult.isHighPriority)}
                          disabled={searchPriorityMeta.disabled || isSearchPriorityUpdating}
                          onChange={() =>
                            handleTogglePriority({
                              id: orderSearchResult.orderId,
                              orderNumber: orderSearchResult.orderNumber,
                              assignmentState: orderSearchResult.assignmentState,
                              isHighPriority: orderSearchResult.isHighPriority,
                              priorityId: orderSearchResult.priorityId,
                              customerName: searchedCustomerName || undefined,
                              statusLabel: orderSearchResult.status,
                            })
                          }
                        />
                        <span>{isSearchPriorityUpdating ? 'جارٍ التحديث...' : searchPriorityMeta.label}</span>
                      </label>
                    </div>
                    {orderSearchResult.isHighPriority && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-white/80 px-3 py-2 text-[12px] text-amber-800">
                        <p className="font-semibold">⚡ طلب مميز</p>
                        <p>{orderSearchResult.priorityReason || 'سيتم دفع الطلب في أول قائمة التحضير.'}</p>
                        {orderSearchResult.priorityCreatedAt && (
                          <p className="text-amber-600/80">
                            تم التفعيل في {formatDate(orderSearchResult.priorityCreatedAt)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {orderSearchResult.notes && (
                  <div className="mt-4 rounded-xl bg-emerald-50/70 px-3 py-2 text-sm text-gray-700">
                    <p className="text-xs text-gray-500 mb-1">ملاحظات</p>
                    <p>{orderSearchResult.notes}</p>
                  </div>
                )}
              </div>
            )}
          </Card>

          {error && (
            <Card className="p-4 border border-rose-200 bg-rose-50 text-rose-800 text-sm">
              {error}
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4">
            <Card className="p-5">
              <p className="text-sm text-gray-500">الطلبات المرتبطة حالياً</p>
              <p className="text-3xl font-bold text-gray-900">{liveOrdersTotal}</p>
              <p className="text-xs text-gray-400 mt-1">عدد الطلبات التي تم تعيينها ويتم العمل عليها الآن</p>
              <p className="text-xs text-gray-500 mt-2">
                بانتظار التعيين: <span className="font-semibold">{liveTotals.new}</span> • مرتبطة بالمستخدمين:{' '}
                <span className="font-semibold">{liveTotals.assigned}</span>
              </p>
              {liveOrdersTimestamp && (
                <p className="text-[11px] text-gray-400 mt-1">
                  تم الجلب من سلة في {formatDate(liveOrdersTimestamp.toISOString())}
                </p>
              )}
            </Card>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">الطلبات المرتبطة في لوحة التحضير</p>
              <p className="text-xs text-gray-500">عدد الطلبات المرتبطة حالياً: {linkedLiveOrdersCount}</p>
            </div>
            <Button
              variant="outline"
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
              onClick={handleBulkUnlinkLiveOrders}
              disabled={linkedLiveOrdersCount === 0}
            >
              الغاء ربط الطلبات
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
            {liveStatusColumns.map((column) => (
              <Card key={column.id} className="p-4 flex flex-col gap-4 border border-slate-100 h-full">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{column.label}</p>
                    <p className="text-xs text-gray-500">{column.description}</p>
                  </div>
                  <span className="text-2xl font-bold text-gray-900">{column.orders.length}</span>
                </div>
                <div className="flex-1 space-y-2 pr-1">
                    {column.orders.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-6">
                        {liveOrdersLoading ? 'جاري التحديث...' : 'لا يوجد طلبات في هذه الحالة'}
                      </p>
                    ) : (
                      column.orders.map((order) => {
                        const priorityIdentifier = order.id || order.orderNumber || '';
                        const isPriorityUpdating = priorityUpdatingId === priorityIdentifier;
                        const priorityDisabled = order.assignmentState !== 'new';
                        const priorityLabel = order.isHighPriority ? 'أولوية فعّالة' : 'أولوية';
                        const cardPriorityClasses = order.isHighPriority
                          ? 'border-amber-300 bg-amber-50/70'
                          : `${column.pillAccentClass} bg-white`;
                        const canRemoveAssignmentLink =
                          Boolean(order.assignmentId) ||
                          (order.assignmentState === 'assigned' && Boolean(order.id));

                        return (
                          <div
                            key={order.id || order.orderNumber}
                            className={`rounded-2xl border shadow-sm p-3 ${cardPriorityClasses}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-semibold text-gray-900 truncate">
                                    #{order.orderNumber || order.id}
                                  </p>
                                  {typeof order.sequenceNumber === 'number' && (
                                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                      ترتيب #{order.sequenceNumber}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500 truncate">
                                  {order.customerName || order.paymentMethod || '—'}
                                </p>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <span
                                  className={`inline-flex items-center px-2 py-1 rounded-full border text-[11px] font-semibold ${LIVE_STATE_STYLES[order.assignmentState]?.className}`}
                                >
                                  {LIVE_STATE_STYLES[order.assignmentState]?.label}
                                </span>
                                <label
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${
                                    order.isHighPriority
                                      ? 'border-amber-300 bg-white/60 text-amber-700'
                                      : 'border-gray-200 text-gray-600'
                                  } ${priorityDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-amber-50'}`}
                                  title={
                                    priorityDisabled
                                      ? 'يمكن تمييز الطلبات غير المعينة فقط كأولوية'
                                      : 'حدد الطلب لدفعه إلى مقدمة طابور التحضير'
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                                    checked={Boolean(order.isHighPriority)}
                                    disabled={priorityDisabled || isPriorityUpdating}
                                    onChange={() => handleTogglePriority(order)}
                                  />
                                  <span>
                                    {isPriorityUpdating ? 'جارٍ التحديث...' : priorityLabel}
                                  </span>
                                </label>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-600">
                              <span>الدفع: {order.paymentMethod || '—'}</span>
                              <span>المبلغ: {formatAmount(order.totalAmount)}</span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
                              {order.assignedUserName ? (
                                <span className="inline-flex items-center gap-1">
                                  مرتبط بـ {order.assignedUserName}
                                  {canRemoveAssignmentLink && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                                      aria-label={`إزالة المستخدم من الطلب #${order.orderNumber || order.id}`}
                                      onClick={() =>
                                        handleRemoveSingleAssignment({
                                          assignmentId: order.assignmentId,
                                          orderId: order.id,
                                          orderNumber: order.orderNumber,
                                        })
                                      }
                                    >
                                      ×
                                    </Button>
                                  )}
                                </span>
                              ) : (
                                <span>غير مرتبط بأي مستخدم</span>
                              )}
                              <span>{order.createdAt ? formatDate(order.createdAt) : '—'}</span>
                            </div>
                            {order.isHighPriority && (
                              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                                <p className="font-semibold">⚡ طلب مميز</p>
                                <p>
                                  {order.priorityReason || 'سيتم دفع الطلب في أول قائمة التحضير.'}
                                </p>
                                {order.priorityCreatedAt && (
                                  <p className="text-amber-600/80">
                                    تم التفعيل في {formatDate(order.priorityCreatedAt)}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
              </Card>
            ))}
          </div>

          {/* Bulk Actions */}
          {selectedOrders.size > 0 && (
            <Card className="p-4 bg-blue-50 border-blue-200">
              <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                <p className="text-sm font-medium text-blue-900">
                  تم اختيار {selectedOrders.size} طلب
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={() => setShowReassignModal(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    📦 نقل للمستخدم
                  </Button>
                  <Button
                    onClick={handleReopenOrders}
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    🔄 إعادة فتح
                  </Button>
                  <Button
                    onClick={handleRemoveAssignments}
                    className="bg-rose-600 hover:bg-rose-700"
                  >
                    🗑️ إزالة من المستخدم
                  </Button>
                  <Button
                    onClick={() => setSelectedOrders(new Set())}
                    variant="outline"
                  >
                    إلغاء التحديد
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Users Performance */}
          <Card className="p-6">
            <div className="flex flex-col gap-4 mb-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">أداء المستخدمين</h3>
                <div className="flex gap-2 flex-wrap">
                  {([
                    ['today', 'اليوم'],
                    ['week', 'هذا الأسبوع'],
                    ['month', 'هذا الشهر'],
                    ['custom', 'فترة مخصصة'],
                  ] as [PerformancePreset, string][]).map(([key, label]) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={perfPreset === key ? 'default' : 'outline'}
                      onClick={() => setPerfPreset(key)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              {perfPreset === 'custom' && (
                <div className="flex gap-3 items-center justify-end">
                  <label className="text-sm text-gray-600">من</label>
                  <Input
                    type="date"
                    value={perfCustomFrom}
                    onChange={(e) => setPerfCustomFrom(e.target.value)}
                    className="w-44"
                  />
                  <label className="text-sm text-gray-600">إلى</label>
                  <Input
                    type="date"
                    value={perfCustomTo}
                    onChange={(e) => setPerfCustomTo(e.target.value)}
                    className="w-44"
                  />
                </div>
              )}
            </div>

            {perfLoading ? (
              <div className="text-center py-8 text-gray-500">جاري تحميل بيانات الأداء...</div>
            ) : !perfData || (perfData.byUser.length === 0) ? (
              <div className="text-center py-8 text-gray-400">لا توجد بيانات أداء لهذه الفترة</div>
            ) : (
              <>
                {/* Aggregate Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold">{perfData.aggregate.totalAssigned}</div>
                    <div className="text-xs text-gray-500">إجمالي المعين</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-green-600">{perfData.aggregate.totalCompleted}</div>
                    <div className="text-xs text-gray-500">المكتمل</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-blue-600">{formatCompletionTime(perfData.aggregate.avgCompletionMs)}</div>
                    <div className="text-xs text-gray-500">متوسط وقت الإنجاز</div>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-amber-600">{perfData.aggregate.ordersPerHour}</div>
                    <div className="text-xs text-gray-500">طلبات / ساعة</div>
                  </div>
                </div>

                {/* Enhanced Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-right pb-3 font-semibold">المستخدم</th>
                        <th className="text-center pb-3 font-semibold">المعين</th>
                        <th className="text-center pb-3 font-semibold">مكتمل</th>
                        <th className="text-center pb-3 font-semibold">متوسط الإنجاز</th>
                        <th className="text-center pb-3 font-semibold">طلبات/ساعة</th>
                        <th className="text-center pb-3 font-semibold">معدل الإنجاز</th>
                        <th className="text-center pb-3 font-semibold">نشط</th>
                        <th className="text-center pb-3 font-semibold">مراجعة</th>
                        <th className="text-center pb-3 font-semibold">حجز</th>
                        <th className="text-center pb-3 font-semibold">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {perfData.byUser.map((u) => (
                        <tr key={u.userId} className="border-b">
                          <td className="py-3 font-medium">{u.userName}</td>
                          <td className="text-center">{u.totalAssigned}</td>
                          <td className="text-center text-green-600 font-semibold">{u.totalCompleted}</td>
                          <td className="text-center text-blue-600">{formatCompletionTime(u.avgCompletionMs)}</td>
                          <td className="text-center text-amber-600">{u.ordersPerHour}</td>
                          <td className="text-center font-semibold">{u.completionRate}%</td>
                          <td className="text-center">{u.active}</td>
                          <td className="text-center text-orange-600">{u.underReview}</td>
                          <td className="text-center text-purple-600">{u.reservation}</td>
                          <td className="text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRemoveUserAssignments(u.userId, u.userName)}
                            >
                              إزالة الارتباطات
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-bold">
                        <td className="py-3">الإجمالي</td>
                        <td className="text-center">{perfData.aggregate.totalAssigned}</td>
                        <td className="text-center text-green-600">{perfData.aggregate.totalCompleted}</td>
                        <td className="text-center text-blue-600">{formatCompletionTime(perfData.aggregate.avgCompletionMs)}</td>
                        <td className="text-center text-amber-600">{perfData.aggregate.ordersPerHour}</td>
                        <td className="text-center">{perfData.aggregate.completionRate}%</td>
                        <td className="text-center">{perfData.aggregate.active}</td>
                        <td className="text-center text-orange-600">{perfData.aggregate.underReview}</td>
                        <td className="text-center text-purple-600">{perfData.aggregate.reservation}</td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </Card>

        </div>

      {/* Reassign Modal */}
      {showReassignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">نقل الطلبات لمستخدم آخر</h3>
            <p className="text-sm text-gray-600 mb-4">
              سيتم نقل {selectedOrders.size} طلب إلى المستخدم المحدد
            </p>

            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">اختر المستخدم</label>
              <select
                value={reassignUserId}
                onChange={(e) => setReassignUserId(e.target.value)}
                className="w-full border rounded-lg p-3"
              >
                <option value="">-- اختر مستخدم --</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} ({user.username})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleReassign}
                disabled={!reassignUserId}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                نقل الطلبات
              </Button>
              <Button
                onClick={() => {
                  setShowReassignModal(false);
                  setReassignUserId('');
                }}
                variant="outline"
                className="flex-1"
              >
                إلغاء
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
