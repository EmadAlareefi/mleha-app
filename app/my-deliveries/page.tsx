'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { MapPin, MessageCircle } from 'lucide-react';

const ADMIN_DELIVERABLE_STATUSES = ['assigned', 'picked_up', 'in_transit'];

interface LocalShipmentMeta {
  paymentMethod?: string | null;
  shipToArabicText?: string | null;
  shipToName?: string | null;
  shipToPhone?: string | null;
  shipToAddressLine?: string | null;
  shipToDistrict?: string | null;
  shipToCity?: string | null;
  shipToPostalCode?: string | null;
  shipToLatitude?: string | number | null;
  shipToLongitude?: string | number | null;
  mapsLink?: string | null;
  shipToLocationText?: string | null;
  shipToLocationCode?: string | null;
  hasExchangeCoupon?: boolean;
  exchangeCouponCode?: string | null;
}

interface LocalShipmentOrderItems {
  items?: unknown[];
  meta?: LocalShipmentMeta | null;
}

interface LocalShipment {
  id: string;
  orderNumber: string;
  trackingNumber: string;
  customerName: string;
  customerPhone: string;
  shippingCity: string;
  shippingAddress: string;
  shippingCountry?: string | null;
  shippingPostcode?: string | null;
  orderTotal: number;
  isCOD: boolean;
  status: string;
  createdAt: string;
  orderItems?: LocalShipmentOrderItems | null;
}

interface CODCollection {
  id: string;
  collectionAmount: number;
  collectedAmount?: number;
  status: string;
}

interface ExchangeRequestInfo {
  id: string;
  status: string;
  orderNumber?: string | null;
  exchangeOrderNumber?: string | null;
}

interface Assignment {
  id: string;
  status: string;
  assignedAt: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  notes?: string;
  shipment: LocalShipment & { codCollection?: CODCollection };
  shipmentDirection?: 'incoming' | 'outgoing';
  exchangeRequest?: ExchangeRequestInfo | null;
  deliveryOtpRequestedAt?: string | null;
  deliveryOtpExpiresAt?: string | null;
  deliveryOtpVerifiedAt?: string | null;
  deliveryOtpAttemptCount?: number | null;
}

interface DeliveryAgentTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'agent_completed' | 'completed' | 'cancelled';
  requestType: string;
  requestedItem?: string | null;
  quantity?: number | null;
  priority?: string | null;
  details?: string | null;
  dueDate?: string | null;
  completionNotes?: string | null;
  createdAt: string;
  createdBy?: {
    id: string;
    name: string;
    username: string;
  } | null;
  createdByName?: string | null;
  createdByUsername?: string | null;
}

type WalletTransactionType =
  | 'SHIPMENT_COMPLETED'
  | 'TASK_COMPLETED'
  | 'PAYOUT'
  | 'ADJUSTMENT';

interface WalletTransaction {
  id: string;
  type: WalletTransactionType;
  amount: number;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

interface WalletStatsSnapshot {
  count: number;
  total: number;
}

interface DeliveryAgentWalletInfo {
  balance: number;
  stats: {
    shipments: WalletStatsSnapshot;
    tasks: WalletStatsSnapshot;
    payouts: WalletStatsSnapshot;
    adjustments: WalletStatsSnapshot;
    totalEarned: number;
    totalPaid: number;
  };
  recentTransactions: WalletTransaction[];
}

const sanitizeAddressSegment = (value?: string | null) => {
  if (!value) return '';
  return value.replace(/^\s*مدينة العميل\s*:\s*/iu, '').trim();
};

const buildStructuredMetaAddress = (shipment: LocalShipment) => {
  const meta = shipment.orderItems?.meta;
  if (!meta) return null;
  const parts = [
    sanitizeAddressSegment(meta.shipToAddressLine),
    sanitizeAddressSegment(meta.shipToDistrict),
    sanitizeAddressSegment(meta.shipToCity || shipment.shippingCity),
  ]
    .filter((part, index, array) => part && array.indexOf(part) === index);

  if (meta.shipToPostalCode) {
    const postal = sanitizeAddressSegment(meta.shipToPostalCode);
    if (postal) {
      parts.push(`الرمز البريدي: ${postal}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
};

const getFullAddressLabel = (shipment: LocalShipment) => {
  const parts: string[] = [];
  const structuredAddress = buildStructuredMetaAddress(shipment);
  if (structuredAddress) {
    parts.push(structuredAddress);
  }

  const metaAddress = shipment.orderItems?.meta?.shipToArabicText?.trim();
  if (metaAddress) {
    parts.push(metaAddress);
  }

  const rawAddress =
    typeof shipment.shippingAddress === 'string' ? shipment.shippingAddress.trim() : '';
  if (rawAddress) {
    parts.push(rawAddress);
  }

  const sanitizedAddress = sanitizeAddressSegment(rawAddress);
  if (sanitizedAddress && sanitizedAddress !== rawAddress) {
    parts.push(sanitizedAddress);
  }

  const shippingCity =
    typeof shipment.shippingCity === 'string' ? shipment.shippingCity.trim() : '';
  if (shippingCity) {
    parts.push(shippingCity);
  }

  const uniqueParts = parts
    .map((part) => part.trim())
    .filter((part, index, array) => part && array.indexOf(part) === index);

  return uniqueParts.join('\n') || 'غير متوفر';
};

const extractMapUrlFromText = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const match = value.match(MAP_URL_PATTERN);
  if (!match || !match[0]) {
    return null;
  }
  const cleaned = match[0].trim().replace(/[),.;]+$/u, '');
  return cleaned || null;
};

const normalizeMapUrl = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('www.')) {
    return `https://${trimmed}`;
  }
  return null;
};

const MAPS_SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query=';
const MAP_URL_PATTERN = /(https?:\/\/[^\s<>()"']+)/i;

const toCoordinateNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const getMapsLink = (shipment: LocalShipment) => {
  const meta = shipment.orderItems?.meta;
  const metaRecord = meta as Record<string, unknown> | undefined;
  const candidateLinks = [
    typeof meta?.mapsLink === 'string' ? meta.mapsLink : null,
    typeof metaRecord?.mapLink === 'string' ? (metaRecord.mapLink as string) : null,
    typeof metaRecord?.maps_link === 'string' ? (metaRecord.maps_link as string) : null,
    typeof metaRecord?.map_link === 'string' ? (metaRecord.map_link as string) : null,
    extractMapUrlFromText(meta?.shipToAddressLine),
    extractMapUrlFromText(meta?.shipToArabicText),
    extractMapUrlFromText(meta?.shipToLocationText),
    extractMapUrlFromText(shipment.shippingAddress),
  ];

  for (const link of candidateLinks) {
    const normalized = normalizeMapUrl(link);
    if (normalized) {
      return normalized;
    }
  }

  const locationCode =
    (typeof meta?.shipToLocationCode === 'string' && meta.shipToLocationCode.trim()) || null;
  if (locationCode) {
    return `${MAPS_SEARCH_BASE}${encodeURIComponent(locationCode)}`;
  }

  const addressCode =
    (typeof metaRecord?.address_code === 'string' && metaRecord.address_code.trim()) ||
    (typeof metaRecord?.addressCode === 'string' && metaRecord.addressCode.trim()) ||
    null;
  if (addressCode) {
    return `${MAPS_SEARCH_BASE}${encodeURIComponent(addressCode)}`;
  }

  const lat =
    toCoordinateNumber(meta?.shipToLatitude) ??
    toCoordinateNumber(metaRecord?.latitude) ??
    toCoordinateNumber(metaRecord?.lat);
  const lng =
    toCoordinateNumber(meta?.shipToLongitude) ??
    toCoordinateNumber(metaRecord?.longitude) ??
    toCoordinateNumber(metaRecord?.lng);

  if (lat !== null && lng !== null) {
    return `${MAPS_SEARCH_BASE}${lat},${lng}`;
  }

  const fullAddressParts = new Set<string>();
  const pushPart = (value?: string | null) => {
    if (!value) return;
    const trimmed = sanitizeAddressSegment(value);
    if (!trimmed) return;
    fullAddressParts.add(trimmed);
  };

  pushPart(meta?.shipToArabicText);
  pushPart(meta?.shipToAddressLine);
  pushPart(meta?.shipToDistrict);
  pushPart(meta?.shipToCity);
  pushPart(shipment.shippingAddress);
  pushPart(shipment.shippingCity);
  pushPart(meta?.shipToPostalCode);
  pushPart(shipment.shippingPostcode);
  if (meta?.shipToName) {
    pushPart(`المستلم: ${meta.shipToName}`);
  }
  if (meta?.shipToPhone || shipment.customerPhone) {
    const phone = meta?.shipToPhone || shipment.customerPhone;
    pushPart(`الهاتف: ${phone}`);
  }
  if (metaRecord?.address_code) {
    pushPart(`رمز العنوان: ${metaRecord.address_code}`);
  }
  if (metaRecord?.address_extra_number) {
    pushPart(`رقم إضافي: ${metaRecord.address_extra_number}`);
  }

  const queryParts = Array.from(fullAddressParts);
  if (queryParts.length === 0) {
    return null;
  }

  return `${MAPS_SEARCH_BASE}${encodeURIComponent(queryParts.join(', '))}`;
};

const getExchangeCouponCode = (shipment: LocalShipment) => {
  const meta = shipment.orderItems?.meta;
  if (!meta) return null;
  const code =
    typeof meta.exchangeCouponCode === 'string' && meta.exchangeCouponCode.trim()
      ? meta.exchangeCouponCode.trim()
      : null;
  if (code) return code;
  return meta.hasExchangeCoupon ? 'EXCHANGE' : null;
};

const hasExchangeCouponFlag = (shipment: LocalShipment) => {
  const meta = shipment.orderItems?.meta;
  if (!meta) return false;
  if (meta.hasExchangeCoupon) return true;
  if (typeof meta.exchangeCouponCode === 'string') {
    const normalized = meta.exchangeCouponCode.trim().toUpperCase();
    return normalized.startsWith('EX');
  }
  return false;
};

const normalizePhoneNumber = (phone: string) => phone.replace(/[^\d]/g, '');

const SAUDI_KEYWORDS = ['saudi', 'ksa', 'السعودية', 'المملكة العربية السعودية'];

const looksLikeSaudiPhoneNumber = (digits: string) => {
  if (!digits) return false;
  let normalized = digits.replace(/^00+/, '');
  if (normalized.startsWith('9665')) {
    return true;
  }
  if (normalized.startsWith('966')) {
    normalized = normalized.slice(3);
  }
  const withoutLeadingZero = normalized.replace(/^0+/, '');
  return withoutLeadingZero.length === 9 && withoutLeadingZero.startsWith('5');
};

const isSaudiShipment = (shipment: LocalShipment) => {
  const normalizedCountry = shipment.shippingCountry?.trim().toLowerCase();
  if (normalizedCountry) {
    if (normalizedCountry === 'sa' || normalizedCountry === 'ksa') {
      return true;
    }
    if (SAUDI_KEYWORDS.some((keyword) => normalizedCountry.includes(keyword))) {
      return true;
    }
  }

  const addressContext = [shipment.shippingAddress, shipment.shippingCity, shipment.orderItems?.meta?.shipToArabicText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (SAUDI_KEYWORDS.some((keyword) => addressContext.includes(keyword))) {
    return true;
  }

  const digits = normalizePhoneNumber(shipment.customerPhone || '');
  return looksLikeSaudiPhoneNumber(digits);
};

const buildWhatsAppMessage = (shipment: LocalShipment) => {
  const nameGreeting = shipment.customerName ? ` مرحبا ${shipment.customerName}` : '';
  const resolvedPaymentMethod =
    shipment.orderItems?.meta?.paymentMethod ||
    (shipment.isCOD ? 'الدفع عند الاستلام' : 'مدى');
  const paymentLine = shipment.isCOD ? `\n🔹طريقة الدفع : ${resolvedPaymentMethod}` : '';

  return `السلام عليكم ورحمة الله وبركاته،${nameGreeting}
معك شركة  مليحة  👗

يوجد لدينا طلب جاهز للتوصيل في جدة، نرجو تكرماً إرسال تفاصيل العنوان ليتم تسليم الطلب.

🔹 رقم الطلب: ${shipment.orderNumber}${paymentLine}`;
};

const formatSaudiPhoneNumber = (digits: string) => {
  if (!digits) return '';
  let normalized = digits.replace(/^00+/, '');
  if (normalized.startsWith('966')) {
    normalized = normalized.slice(3);
  }
  normalized = normalized.replace(/^0+/, '');
  return normalized ? `966${normalized}` : digits;
};

const getWhatsAppPhoneNumber = (shipment: LocalShipment) => {
  const digits = normalizePhoneNumber(shipment.customerPhone || '');
  if (!digits) {
    return null;
  }
  if (isSaudiShipment(shipment)) {
    const saNumber = formatSaudiPhoneNumber(digits);
    return saNumber || digits;
  }
  return digits;
};

const getWhatsAppLink = (shipment: LocalShipment) => {
  const phone = getWhatsAppPhoneNumber(shipment);
  if (!phone) {
    return null;
  }
  const encodedMessage = encodeURIComponent(buildWhatsAppMessage(shipment));
  return `https://wa.me/${phone}?text=${encodedMessage}`;
};

const maskPhoneForDisplay = (value?: string | null) => {
  if (!value) return '';
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length <= 4) return digits;
  const maskedLength = Math.max(digits.length - 4, 2);
  return `${'*'.repeat(maskedLength)}${digits.slice(-4)}`;
};

export default function MyDeliveriesPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const sessionUser = session?.user as any;
  const sessionRoles = Array.isArray(sessionUser?.roles) ? sessionUser.roles : [];
  const sessionServiceKeys = Array.isArray(sessionUser?.serviceKeys) ? sessionUser.serviceKeys : [];
  const isAdminUser =
    sessionRoles.includes('admin') ||
    sessionServiceKeys.includes('admin') ||
    (typeof sessionUser?.role === 'string' && sessionUser.role === 'admin');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [updating, setUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [failureReason, setFailureReason] = useState('');
  const [statusModalError, setStatusModalError] = useState('');
  const [deliveryOtpCode, setDeliveryOtpCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpMaskedPhone, setOtpMaskedPhone] = useState<string | null>(null);
  const [agentTasks, setAgentTasks] = useState<DeliveryAgentTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [tasksError, setTasksError] = useState('');
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});
  const [taskUpdatingId, setTaskUpdatingId] = useState<string | null>(null);
  const [tasksTab, setTasksTab] = useState<'active' | 'completed'>('active');
  const [assignmentsTab, setAssignmentsTab] = useState<'active' | 'completed'>('active');
  const [walletInfo, setWalletInfo] = useState<DeliveryAgentWalletInfo | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState('');
  const [activeTab, setActiveTab] = useState<'shipments' | 'tasks' | 'reports'>('shipments');
  const [adminSelectedAssignmentIds, setAdminSelectedAssignmentIds] = useState<string[]>([]);
  const [adminBulkUpdating, setAdminBulkUpdating] = useState(false);
  const [adminBulkError, setAdminBulkError] = useState('');
  const [refreshingLocationId, setRefreshingLocationId] = useState<string | null>(null);
  const adminSelectableAssignments = useMemo(
    () =>
      assignments.filter((assignment) =>
        ADMIN_DELIVERABLE_STATUSES.includes(assignment.status as string)
      ),
    [assignments]
  );
  const adminSelectionCount = adminSelectedAssignmentIds.length;

  const parseJsonResponse = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    const fallbackText = await response.text();
    const unauthorized =
      response.status === 401 ||
      response.status === 403 ||
      fallbackText.toLowerCase().includes('<!doctype html') ||
      fallbackText.toLowerCase().includes('__next_data__');
    throw new Error(
      unauthorized
        ? 'انتهت صلاحية الجلسة أو تم تسجيل خروجك. يرجى تسجيل الدخول مرة أخرى.'
        : response.ok
          ? 'استجابة غير متوقعة من الخادم، يرجى إعادة المحاولة لاحقاً.'
          : fallbackText || 'تعذر التواصل مع الخادم'
    );
  };

  useEffect(() => {
    fetchAssignments();
    fetchAgentTasks();
    fetchWalletInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAdminUser && adminSelectedAssignmentIds.length > 0) {
      setAdminSelectedAssignmentIds([]);
    }
  }, [isAdminUser, adminSelectedAssignmentIds.length]);

  useEffect(() => {
    if (assignmentsTab !== 'active' && adminSelectedAssignmentIds.length > 0) {
      setAdminSelectedAssignmentIds([]);
    }
  }, [assignmentsTab, adminSelectedAssignmentIds.length]);

  useEffect(() => {
    if (!isAdminUser) {
      return;
    }
    setAdminSelectedAssignmentIds((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const validIds = prev.filter((assignmentId) =>
        assignments.some(
          (assignment) =>
            assignment.id === assignmentId &&
            ADMIN_DELIVERABLE_STATUSES.includes(assignment.status as string)
        )
      );
      return validIds.length === prev.length ? prev : validIds;
    });
  }, [assignments, isAdminUser]);

  const fetchAssignments = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await fetch('/api/shipment-assignments');
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(data?.error || 'فشل في تحميل الشحنات');
      }

      setAssignments(data.assignments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل الشحنات');
    } finally {
      setLoading(false);
    }
  };

  const fetchAgentTasks = async () => {
    try {
      setTasksLoading(true);
      setTasksError('');

      const response = await fetch('/api/delivery-agent-tasks?includeCompleted=true');
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(data?.error || 'فشل في تحميل المهام');
      }

      setAgentTasks(data.tasks || []);
    } catch (err) {
      setTasksError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل المهام');
    } finally {
      setTasksLoading(false);
    }
  };

  const fetchWalletInfo = async () => {
    try {
      setWalletLoading(true);
      setWalletError('');

      const response = await fetch(
        '/api/delivery-agent-wallets?deliveryAgentId=me&includeTransactions=true'
      );
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(data?.error || 'فشل في تحميل المحفظة');
      }

      setWalletInfo(data.wallet || null);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل المحفظة');
    } finally {
      setWalletLoading(false);
    }
  };

  const handleTaskNotesChange = (taskId: string, value: string) => {
    setTaskNotes((prev) => ({ ...prev, [taskId]: value }));
  };

  const handleTaskStatusUpdate = async (taskId: string, status: DeliveryAgentTask['status']) => {
    try {
      setTaskUpdatingId(taskId);
      const payload: Record<string, unknown> = { status };

      if (status === 'completed' || status === 'agent_completed') {
        payload.completionNotes = taskNotes[taskId]?.trim() || undefined;
      }

      const response = await fetch(`/api/delivery-agent-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(data?.error || 'فشل في تحديث المهمة');
      }

      toast({
        title: 'تم تحديث المهمة',
        description: 'تم تعديل حالة المهمة الخاصة بنجاح',
      });

      if (status === 'completed' || status === 'agent_completed') {
        setTaskNotes((prev) => ({ ...prev, [taskId]: '' }));
      }

      await fetchAgentTasks();
      await fetchWalletInfo();
    } catch (err) {
      toast({
        title: 'تعذر تحديث المهمة',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      });
    } finally {
      setTaskUpdatingId(null);
    }
  };

  const resetStatusModalState = () => {
    setSelectedAssignment(null);
    setNewStatus('');
    setDeliveryNotes('');
    setFailureReason('');
    setStatusModalError('');
    setDeliveryOtpCode('');
    setOtpMaskedPhone(null);
  };

  const openStatusModal = (assignment: Assignment, status: string) => {
    setSelectedAssignment(assignment);
    setNewStatus(status);
    setDeliveryNotes('');
    setFailureReason('');
    setStatusModalError('');
    setDeliveryOtpCode('');
    setOtpMaskedPhone(null);
  };

  const handleSendOtp = async () => {
    if (!selectedAssignment) return;

    try {
      setOtpSending(true);
      setStatusModalError('');

      const response = await fetch(`/api/shipment-assignments/${selectedAssignment.id}/otp`, {
        method: 'POST',
      });
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(data?.error || 'تعذر إرسال رمز التحقق');
      }

      toast({
        title: 'تم إرسال رمز التحقق',
        description: `تم إرسال الرمز إلى ${
          data?.maskedPhone ||
          maskPhoneForDisplay(selectedAssignment.shipment.customerPhone) ||
          'رقم العميل'
        }.`,
      });

      setOtpMaskedPhone(
        data?.maskedPhone ||
          maskPhoneForDisplay(selectedAssignment.shipment.customerPhone) ||
          null
      );

      const requestedAt = data?.requestedAt || new Date().toISOString();
      const expiresAt = data?.expiresAt || null;

      setSelectedAssignment((prev) =>
        prev && prev.id === selectedAssignment.id
          ? {
              ...prev,
              deliveryOtpRequestedAt: requestedAt,
              deliveryOtpExpiresAt: expiresAt,
              deliveryOtpAttemptCount: 0,
            }
          : prev
      );

      setAssignments((prev) =>
        prev.map((assignment) =>
          assignment.id === selectedAssignment.id
            ? {
                ...assignment,
                deliveryOtpRequestedAt: requestedAt,
                deliveryOtpExpiresAt: expiresAt,
                deliveryOtpAttemptCount: 0,
              }
            : assignment
        )
      );
    } catch (err) {
      setStatusModalError(err instanceof Error ? err.message : 'تعذر إرسال رمز التحقق');
    } finally {
      setOtpSending(false);
    }
  };

  const toggleAdminAssignmentSelection = (assignmentId: string) => {
    if (!isAdminUser) return;
    const assignment = assignments.find((item) => item.id === assignmentId);
    if (!assignment || !ADMIN_DELIVERABLE_STATUSES.includes(assignment.status as string)) {
      setAdminSelectedAssignmentIds((prev) => prev.filter((id) => id !== assignmentId));
      return;
    }
    setAdminSelectedAssignmentIds((prev) =>
      prev.includes(assignmentId)
        ? prev.filter((id) => id !== assignmentId)
        : [...prev, assignmentId]
    );
  };

  const handleAdminSelectAll = () => {
    if (!isAdminUser) return;
    setAdminSelectedAssignmentIds(adminSelectableAssignments.map((assignment) => assignment.id));
  };

  const handleAdminClearSelection = () => {
    setAdminSelectedAssignmentIds([]);
    setAdminBulkError('');
  };

  const handleAdminBulkDeliver = async () => {
    if (!isAdminUser || adminSelectedAssignmentIds.length === 0) return;

    try {
      setAdminBulkUpdating(true);
      setAdminBulkError('');

      for (const assignmentId of adminSelectedAssignmentIds) {
        const assignment = assignments.find((item) => item.id === assignmentId);
        if (!assignment || !ADMIN_DELIVERABLE_STATUSES.includes(assignment.status as string)) {
          continue;
        }

        const response = await fetch(`/api/shipment-assignments/${assignmentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'delivered' }),
        });
        const data = await parseJsonResponse(response);

        if (!response.ok) {
          throw new Error(
            data?.error ||
              `تعذر تحديث الشحنة رقم ${
                assignment.shipment.orderNumber || assignment.shipment.trackingNumber
              }`
          );
        }
      }

      toast({
        title: 'تم تحديث الشحنات',
        description: 'تم تأكيد تسليم الشحنات المحددة بنجاح.',
      });

      setAdminSelectedAssignmentIds([]);
      await fetchAssignments();
      await fetchWalletInfo();
    } catch (err) {
      setAdminBulkError(err instanceof Error ? err.message : 'تعذر إتمام التحديث الجماعي');
    } finally {
      setAdminBulkUpdating(false);
    }
  };

  const handleRefreshLocation = async (assignmentId: string) => {
    if (!isAdminUser) return;
    const targetAssignment = assignments.find((assignment) => assignment.id === assignmentId);
    if (!targetAssignment) return;
    setRefreshingLocationId(assignmentId);
    try {
      const response = await fetch(
        `/api/local-shipments/${targetAssignment.shipment.id}/refresh-location`,
        { method: 'POST' }
      );
      const data = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.error || 'تعذر تحديث الموقع');
      }

      const { locationText, locationCode, mapsLink } = data;
      setAssignments((prev) =>
        prev.map((assignment) =>
          assignment.id === assignmentId
            ? {
                ...assignment,
                shipment: {
                  ...assignment.shipment,
                  orderItems: {
                    ...(assignment.shipment.orderItems || {}),
                    meta: {
                      ...(assignment.shipment.orderItems?.meta || {}),
                      shipToLocationText: locationText || null,
                      shipToLocationCode: locationCode || null,
                      mapsLink: mapsLink || assignment.shipment.orderItems?.meta?.mapsLink || null,
                    },
                  },
                },
              }
            : assignment
        )
      );

      toast({
        title: 'تم تحديث الموقع',
        description: 'تم جلب بيانات الموقع من سلة.',
      });
    } catch (err) {
      toast({
        title: 'تعذر تحديث الموقع',
        description: err instanceof Error ? err.message : 'حدث خطأ غير متوقع',
        variant: 'destructive',
      });
    } finally {
      setRefreshingLocationId(null);
    }
  };

  const handleUpdateStatus = async () => {
    setStatusModalError('');

    if (!selectedAssignment || !newStatus) {
      setStatusModalError('يرجى اختيار الحالة الجديدة');
      return;
    }

    if (newStatus === 'failed' && !failureReason.trim()) {
      setStatusModalError('يرجى إدخال سبب الفشل');
      return;
    }

    const requiresOtp = newStatus === 'delivered' && !isAdminUser;
    if (requiresOtp && !deliveryOtpCode.trim()) {
      setStatusModalError('يرجى إدخال رمز التحقق المرسل للعميل');
      return;
    }

    try {
      setUpdating(true);

      const response = await fetch(`/api/shipment-assignments/${selectedAssignment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          notes: deliveryNotes || undefined,
          failureReason: newStatus === 'failed' ? failureReason : undefined,
          deliveryOtpCode: requiresOtp ? deliveryOtpCode.trim() : undefined,
        }),
      });

      const data = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(data?.error || 'فشل في تحديث الحالة');
      }

      resetStatusModalState();

      await fetchAssignments();
      await fetchWalletInfo();
    } catch (err) {
      setStatusModalError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحديث الحالة');
    } finally {
      setUpdating(false);
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'SAR' }).format(value);

  const formatDate = (value: string) =>
    new Date(value).toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const getWalletTransactionLabel = (transaction: WalletTransaction) => {
    const labelMap: Record<WalletTransactionType, string> = {
      SHIPMENT_COMPLETED: 'شحنة مكتملة',
      TASK_COMPLETED: 'مهمة مكتملة',
      PAYOUT: 'دفعة من الإدارة',
      ADJUSTMENT: 'تعديل محفظة',
    };

    if (transaction.notes) {
      return transaction.notes;
    }

    return labelMap[transaction.type] || 'عملية محفظة';
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      assigned: { label: 'مُعيّن', className: 'bg-blue-100 text-blue-800' },
      picked_up: { label: 'تم الاستلام', className: 'bg-purple-100 text-purple-800' },
      in_transit: { label: 'قيد التوصيل', className: 'bg-yellow-100 text-yellow-800' },
      delivered: { label: 'تم التوصيل', className: 'bg-green-100 text-green-800' },
      failed: { label: 'فشل', className: 'bg-red-100 text-red-800' },
      cancelled: { label: 'ملغي', className: 'bg-gray-100 text-gray-800' },
    };

    const statusInfo = statusMap[status] || { label: status, className: 'bg-gray-100 text-gray-800' };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
    );
  };

  const getCODStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; className: string }> = {
      pending: { label: 'قيد الانتظار', className: 'bg-gray-100 text-gray-800' },
      collected: { label: 'تم التحصيل', className: 'bg-green-100 text-green-800' },
      deposited: { label: 'تم الإيداع', className: 'bg-blue-100 text-blue-800' },
      reconciled: { label: 'تمت التسوية', className: 'bg-purple-100 text-purple-800' },
      failed: { label: 'فشل', className: 'bg-red-100 text-red-800' },
    };

    const statusInfo = statusMap[status] || { label: status, className: 'bg-gray-100 text-gray-800' };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
    );
  };

  const getTaskStatusBadge = (status: DeliveryAgentTask['status']) => {
    const statusMap: Record<DeliveryAgentTask['status'], { label: string; className: string }> = {
      pending: { label: 'بانتظار التنفيذ', className: 'bg-slate-100 text-slate-800' },
      in_progress: { label: 'قيد التنفيذ', className: 'bg-amber-100 text-amber-800' },
      agent_completed: { label: 'بانتظار تأكيد الإدارة', className: 'bg-blue-100 text-blue-800' },
      completed: { label: 'تم التنفيذ', className: 'bg-green-100 text-green-800' },
      cancelled: { label: 'ملغي', className: 'bg-gray-100 text-gray-700' },
    };

    const statusInfo = statusMap[status];

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.className}`}>
        {statusInfo.label}
      </span>
    );
  };

  const getShipmentTypeBadge = (direction?: 'incoming' | 'outgoing') => {
    if (!direction) return null;
    const statusMap: Record<'incoming' | 'outgoing', { label: string; className: string }> = {
      outgoing: { label: 'شحنة تسليم', className: 'bg-indigo-100 text-indigo-800' },
      incoming: { label: 'شحنة مرتجعة', className: 'bg-teal-100 text-teal-800' },
    };

    const typeInfo = statusMap[direction];
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${typeInfo.className}`}>
        {typeInfo.label}
      </span>
    );
  };

  const getExchangeStatusLabel = (status: string) => {
    const statusMap: Record<string, string> = {
      pending_review: 'بانتظار المراجعة',
      approved: 'تمت الموافقة',
      rejected: 'مرفوض',
      shipped: 'تم شحن المرتجع',
      delivered: 'تم استلام المرتجع',
      completed: 'تم الإنهاء',
      cancelled: 'ملغي',
    };

    return statusMap[status] || status;
  };

  const renderExchangeReminder = (request?: ExchangeRequestInfo | null) => {
    if (!request) return null;

    return (
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">تنبيه استبدال</p>
        <p className="text-amber-800">
          هذه الشحنة مرتبطة بطلب استبدال. استلم المنتج البديل من المستودع قبل التوجه للعميل واستعد
          لاستلام المنتج المرتجع عند التسليم.
        </p>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-amber-900">
          <div>
            <span className="text-amber-700">معرف طلب الاستبدال:</span>{' '}
            <span className="font-mono font-semibold">{request.id}</span>
          </div>
          {request.orderNumber && (
            <div>
              <span className="text-amber-700">طلب العميل الأصلي:</span>{' '}
              <span className="font-mono font-semibold">{request.orderNumber}</span>
            </div>
          )}
          <div>
            <span className="text-amber-700">حالة الطلب:</span>{' '}
            <span className="font-semibold">{getExchangeStatusLabel(request.status)}</span>
          </div>
        </div>
      </div>
    );
  };

  const activeAssignments = assignments.filter(
    (a) => !['delivered', 'failed', 'cancelled'].includes(a.status)
  );
  const completedAssignments = assignments.filter((a) =>
    ['delivered', 'failed', 'cancelled'].includes(a.status)
  );
  const activeAgentTasks = agentTasks.filter(
    (task) => !['agent_completed', 'completed', 'cancelled'].includes(task.status)
  );
  const completedAgentTasks = agentTasks.filter((task) =>
    ['agent_completed', 'completed', 'cancelled'].includes(task.status)
  );
  const visibleTasks = tasksTab === 'active' ? activeAgentTasks : completedAgentTasks;
  const requiresOtpInput = newStatus === 'delivered' && !isAdminUser;
  const adminSelectableCount = adminSelectableAssignments.length;

  const outstandingCodAmount = assignments
    .filter(
      (assignment) =>
        assignment.shipment.isCOD &&
        assignment.shipment.codCollection &&
        (assignment.shipment.codCollection.status === 'pending' ||
          assignment.shipment.codCollection.status === 'collected')
    )
    .reduce((sum, assignment) => {
      const codAmount = assignment.shipment.codCollection?.collectionAmount ?? 0;
      return sum + Number(codAmount);
    }, 0);

  const stats = {
    total: assignments.length,
    active: activeAssignments.length,
    delivered: assignments.filter((a) => a.status === 'delivered').length,
    failed: assignments.filter((a) => a.status === 'failed').length,
    totalCOD: outstandingCodAmount,
  };
  const recentWalletTransactions = walletInfo?.recentTransactions?.slice(0, 5) ?? [];
  const tabButtonClass = (tab: 'shipments' | 'tasks' | 'reports') =>
    `w-full rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
      activeTab === tab ? 'bg-blue-600 text-white shadow' : 'bg-white text-gray-600 hover:text-blue-600'
    }`;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <p>جاري التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">شحناتي</h1>
          <p className="text-gray-600">إدارة ومتابعة الشحنات المُعيّنة لك</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-gray-100 bg-white/80 p-2 shadow-sm backdrop-blur mb-6">
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className={tabButtonClass('shipments')} onClick={() => setActiveTab('shipments')}>
              الشحنات
            </button>
            <button type="button" className={tabButtonClass('tasks')} onClick={() => setActiveTab('tasks')}>
              المهام
            </button>
            <button type="button" className={tabButtonClass('reports')} onClick={() => setActiveTab('reports')}>
              التقارير
            </button>
          </div>
        </div>

        {activeTab === 'reports' && (
          <div className="space-y-6 mb-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <Card className="p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{stats.active}</div>
                <div className="text-sm text-gray-600">الشحنات النشطة</div>
              </Card>
              <Card className="p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{stats.delivered}</div>
                <div className="text-sm text-gray-600">تم التوصيل</div>
              </Card>
              <Card className="p-4 text-center">
                <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
                <div className="text-sm text-gray-600">فشل</div>
              </Card>
              <Card className="p-4 text-center">
                <div className="text-2xl font-bold text-gray-800">{stats.total}</div>
                <div className="text-sm text-gray-600">الإجمالي</div>
              </Card>
              <Card className="p-4 text-center">
                <div className="text-xl font-bold text-orange-600">{formatCurrency(stats.totalCOD)}</div>
                <div className="text-sm text-gray-600">COD قيد التسوية</div>
              </Card>
            </div>

            {/* Wallet summary */}
            <Card className="p-6">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                <div className="flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-gray-500">رصيدي الحالي</p>
                      <p className="text-3xl font-bold text-emerald-600">
                        {walletInfo ? formatCurrency(walletInfo.balance) : walletLoading ? '...' : formatCurrency(0)}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchWalletInfo} disabled={walletLoading}>
                      تحديث المحفظة
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-4 mt-6 text-sm text-gray-600 md:grid-cols-2">
                    <div className="rounded-lg border bg-white p-3">
                      <p className="text-gray-500">الشحنات المكتملة</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {walletInfo?.stats.shipments.count ?? 0}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatCurrency(walletInfo?.stats.shipments.total ?? 0)}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-white p-3">
                      <p className="text-gray-500">المهام المكتملة</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {walletInfo?.stats.tasks.count ?? 0}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatCurrency(walletInfo?.stats.tasks.total ?? 0)}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-white p-3">
                      <p className="text-gray-500">إجمالي مكافآتي</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatCurrency(walletInfo?.stats.totalEarned ?? 0)}
                      </p>
                      <p className="text-xs text-gray-500">شحنات ومهام مكتملة</p>
                    </div>
                    <div className="rounded-lg border bg-white p-3">
                      <p className="text-gray-500">ما تم سداده</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatCurrency(walletInfo?.stats.totalPaid ?? 0)}
                      </p>
                      <p className="text-xs text-gray-500">دفعات خصمتها الإدارة</p>
                    </div>
                  </div>
                  {walletError && (
                    <p className="mt-3 text-sm text-red-600">{walletError}</p>
                  )}
                </div>
                <div className="lg:w-1/2">
                  <p className="text-sm font-medium text-gray-700 mb-2">آخر الحركات</p>
                  {walletLoading ? (
                    <p className="text-sm text-gray-500">جاري تحميل حركات المحفظة...</p>
                  ) : recentWalletTransactions.length === 0 ? (
                    <p className="text-sm text-gray-500">لا توجد حركات حديثة بعد.</p>
                  ) : (
                    <div className="rounded-xl border bg-white divide-y divide-gray-100">
                      {recentWalletTransactions.map((transaction) => (
                        <div
                          key={transaction.id}
                          className="flex items-center justify-between gap-3 px-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {getWalletTransactionLabel(transaction)}
                            </p>
                            <p className="text-xs text-gray-500">{formatDate(transaction.createdAt)}</p>
                          </div>
                          <span
                            className={`text-sm font-semibold ${
                              transaction.amount >= 0 ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {transaction.amount >= 0 ? '+' : '-'} {formatCurrency(Math.abs(transaction.amount))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'tasks' && (
          <Card className="p-6 mb-6">
            {/* Custom delivery tasks */}
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">مهامي الخاصة</h2>
              <p className="text-sm text-gray-500">
                هذه الطلبات أرسلها الفريق لك لتنفيذ مشتريات أو مهام خارج الشحنات الأساسية
              </p>
            </div>
            <Button variant="outline" onClick={fetchAgentTasks} disabled={tasksLoading}>
              تحديث قائمة المهام
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant={tasksTab === 'active' ? 'default' : 'outline'}
              onClick={() => setTasksTab('active')}
            >
              المهام الحالية
            </Button>
            <Button
              variant={tasksTab === 'completed' ? 'default' : 'outline'}
              onClick={() => setTasksTab('completed')}
            >
              المهام المكتملة / بانتظار التأكيد
            </Button>
          </div>

          {tasksError && <p className="text-sm text-red-600 mb-3">{tasksError}</p>}

          {tasksLoading ? (
            <p className="text-center text-gray-500 py-4">جاري تحميل المهام...</p>
          ) : visibleTasks.length === 0 ? (
            <p className="text-center text-gray-500 py-6">
              {tasksTab === 'active'
                ? 'لا توجد مهام حالياً، ستظهر هنا الطلبات عند إرسالها لك.'
                : 'لا توجد مهام مكتملة أو بانتظار التأكيد أو ملغاة.'}
            </p>
          ) : (
            <div className="space-y-4">
              {visibleTasks.map((task) => (
                <div key={task.id} className="rounded-lg border p-4 bg-white">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between mb-2">
                    <div>
                      <p className="text-lg font-semibold text-gray-900">{task.title}</p>
                      <p className="text-sm text-gray-500">
                        من:{' '}
                        <span className="font-medium">
                          {task.createdBy?.name || task.createdByName || task.createdByUsername || 'مستخدم النظام'}
                        </span>
                      </p>
                    </div>
                    {getTaskStatusBadge(task.status)}
                  </div>

                  {task.requestedItem && (
                    <p className="text-sm text-gray-600">
                      المطلوب:{' '}
                      <span className="font-medium">
                        {task.requestedItem}
                        {task.quantity ? ` (العدد: ${task.quantity})` : ''}
                      </span>
                    </p>
                  )}

                  {task.details && (
                    <p className="text-sm text-gray-600 mt-1">
                      التفاصيل: <span className="font-medium">{task.details}</span>
                    </p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-gray-600 mt-3">
                    <div>
                      <span className="text-gray-500">نوع الطلب:</span>{' '}
                      <span className="font-medium">
                        {task.requestType === 'purchase'
                          ? 'شراء عاجل'
                          : task.requestType === 'pickup'
                            ? 'استلام شحنة'
                            : task.requestType === 'support'
                              ? 'مساندة'
                              : 'مهمة متنوعة'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">الأولوية:</span>{' '}
                      <span className="font-medium">
                        {task.priority === 'high'
                          ? 'عالية'
                          : task.priority === 'low'
                            ? 'منخفضة'
                            : 'متوسطة'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">الاستحقاق:</span>{' '}
                      <span className="font-medium">
                        {task.dueDate
                          ? new Date(task.dueDate).toLocaleString('en-GB', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'غير محدد'}
                      </span>
                    </div>
                  </div>

                  {!['completed', 'agent_completed', 'cancelled'].includes(task.status) && (
                    <div className="mt-4 space-y-3">
                      <textarea
                        className="w-full rounded-md border border-input px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        rows={2}
                        placeholder="ملاحظات الشراء أو وصف ما تم (اختياري)"
                        value={taskNotes[task.id] ?? ''}
                        onChange={(event) => handleTaskNotesChange(task.id, event.target.value)}
                      />
                      <div className="flex flex-wrap gap-3">
                        {task.status === 'pending' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleTaskStatusUpdate(task.id, 'in_progress')}
                            disabled={taskUpdatingId === task.id}
                          >
                            بدء المهمة
                          </Button>
                        )}
                        {task.status === 'in_progress' && (
                          <Button
                            size="sm"
                            onClick={() => handleTaskStatusUpdate(task.id, 'agent_completed')}
                            disabled={taskUpdatingId === task.id}
                          >
                            تم التنفيذ (بانتظار التأكيد)
                          </Button>
                        )}
                        {task.status === 'pending' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTaskStatusUpdate(task.id, 'cancelled')}
                            disabled={taskUpdatingId === task.id}
                          >
                            إلغاء المهمة
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {task.status === 'agent_completed' && (
                    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                      <p className="font-semibold">بانتظار تأكيد الإدارة</p>
                      <p className="mt-1">
                        سيتم اعتماد المهمة بعد أن يقوم صاحب الطلب بمراجعة ما تم وتأكيده. يمكنك متابعة الحالة من
                        هذه القائمة.
                      </p>
                      {task.completionNotes && (
                        <p className="mt-2 text-blue-900">
                          ملاحظات التنفيذ: <span className="font-medium">{task.completionNotes}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {task.status === 'completed' && task.completionNotes && (
                    <p className="mt-3 text-sm text-emerald-600">
                      ملاحظات التنفيذ: {task.completionNotes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        )}

        {activeTab === 'shipments' && (
          <div className="space-y-4 mb-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold">شحناتي</h2>
              <p className="text-sm text-gray-500">استعرض الشحنات الحالية أو نتائجك المكتملة</p>
            </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={assignmentsTab === 'active' ? 'default' : 'outline'}
              onClick={() => setAssignmentsTab('active')}
            >
                الشحنات النشطة
              </Button>
              <Button
                variant={assignmentsTab === 'completed' ? 'default' : 'outline'}
                onClick={() => setAssignmentsTab('completed')}
              >
                الشحنات المكتملة
              </Button>
            </div>
          </div>

          {assignmentsTab === 'active' && isAdminUser && (
            <Card className="p-4 border border-emerald-200 bg-white">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-base font-semibold text-emerald-700">وضع تأكيد الإدارة</p>
                    <p className="text-sm text-gray-600">
                      يمكنك تحديد عدة شحنات نشطة وتأكيد تسليمها دون الحاجة إلى رمز العميل.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAdminSelectAll}
                      disabled={adminSelectableCount === 0 || adminBulkUpdating}
                    >
                      تحديد الكل ({adminSelectableCount})
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleAdminClearSelection}
                      disabled={adminSelectionCount === 0 || adminBulkUpdating}
                    >
                      مسح التحديد
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm text-gray-700">
                    عدد الشحنات القابلة للتأكيد:{' '}
                    <span className="font-semibold">{adminSelectableCount}</span>
                    {adminSelectionCount > 0 && (
                      <>
                        {' '}| تم تحديد{' '}
                        <span className="font-semibold">{adminSelectionCount}</span>
                      </>
                    )}
                  </p>
                  <Button
                    onClick={handleAdminBulkDeliver}
                    disabled={adminSelectionCount === 0 || adminBulkUpdating}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {adminBulkUpdating ? 'جاري التأكيد...' : 'تأكيد الشحنات المحددة'}
                  </Button>
                </div>
                {adminBulkError && (
                  <p className="text-sm text-red-600">{adminBulkError}</p>
                )}
              </div>
            </Card>
          )}

          {assignmentsTab === 'active' ? (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">الشحنات النشطة</h3>
              {activeAssignments.length === 0 ? (
                <p className="text-center text-gray-500 py-6">لا توجد شحنات نشطة</p>
              ) : (
                <div className="space-y-4">
                  {activeAssignments.map((assignment) => {
                    const fullAddress = getFullAddressLabel(assignment.shipment);
                    const whatsappLink = getWhatsAppLink(assignment.shipment);
                    const mapsLink = getMapsLink(assignment.shipment);
                    const exchangeCouponCode = getExchangeCouponCode(assignment.shipment);
                    const hasExchangeCoupon = hasExchangeCouponFlag(assignment.shipment);
                    const showExchangeLabel = hasExchangeCoupon || Boolean(assignment.exchangeRequest);
                    const isAdminSelectable =
                      isAdminUser &&
                      ADMIN_DELIVERABLE_STATUSES.includes(assignment.status as string);
                    const isAdminSelected =
                      isAdminSelectable && adminSelectedAssignmentIds.includes(assignment.id);
                    const cardClassName = `border rounded-lg p-4 hover:bg-gray-50 transition-colors ${
                      isAdminSelected ? 'border-emerald-500 bg-emerald-50 shadow-sm' : ''
                    }`;
                    const sallaLocation =
                      assignment.shipment.orderItems?.meta?.shipToLocationText || null;
                    const locationShortCode =
                      assignment.shipment.orderItems?.meta?.shipToLocationCode || null;

                    return (
                      <div key={assignment.id} className={cardClassName}>
                        <div className="flex flex-wrap justify-between items-start gap-4 mb-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="font-semibold">#{assignment.shipment.orderNumber}</span>
                              {getStatusBadge(assignment.status)}
                              {getShipmentTypeBadge(assignment.shipmentDirection)}
                            {assignment.exchangeRequest && (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                طلب استبدال
                              </span>
                            )}
                            {showExchangeLabel && (
                              <span
                                className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700"
                                title="يجب استلام الطلب الأصلي من العميل قبل تسليم هذه الشحنة"
                              >
                                استبدال
                              </span>
                            )}
                              {assignment.shipment.isCOD && (
                                <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                  COD
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-600">
                              رقم التتبع:{' '}
                              <span className="font-mono">{assignment.shipment.trackingNumber}</span>
                            </div>
                          </div>
                          <div className="text-left flex flex-col items-end gap-2">
                            <div className="font-semibold text-lg">
                              {formatCurrency(assignment.shipment.orderTotal)}
                            </div>
                            {assignment.shipment.isCOD && assignment.shipment.codCollection && (
                              <div className="text-xs text-gray-600">
                                {getCODStatusBadge(assignment.shipment.codCollection.status)}
                              </div>
                            )}
                            {isAdminSelectable && (
                              <label className="inline-flex items-center gap-2 text-xs font-medium text-emerald-700">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                                  checked={isAdminSelected}
                                  onChange={() => toggleAdminAssignmentSelection(assignment.id)}
                                  disabled={adminBulkUpdating}
                                />
                                تحديد للتسليم الإداري
                              </label>
                            )}
                          </div>
                        </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3 text-sm">
                        <div>
                          <span className="text-gray-600">العميل:</span>{' '}
                          <span className="font-medium">{assignment.shipment.customerName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div>
                            <span className="text-gray-600">الهاتف:</span>{' '}
                            <span className="font-medium" dir="ltr">
                              {assignment.shipment.customerPhone}
                            </span>
                          </div>
                          {whatsappLink && (
                            <a
                              href={whatsappLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                              title="التواصل عبر واتساب"
                            >
                              <MessageCircle className="h-4 w-4" />
                              <span className="sr-only">إرسال رسالة واتساب</span>
                            </a>
                          )}
                        </div>
                        <div>
                          <span className="text-gray-600">المدينة:</span>{' '}
                          <span className="font-medium">{assignment.shipment.shippingCity}</span>
                        </div>
                        <div>
                          <span className="text-gray-600">تاريخ التعيين:</span>{' '}
                          <span className="font-medium">{formatDate(assignment.assignedAt)}</span>
                        </div>
                      </div>

                      <div className="mb-3 text-sm space-y-1">
                        <div>
                          <span className="text-gray-600">العنوان الكامل:</span>{' '}
                          <span className="font-medium whitespace-pre-line">{fullAddress}</span>
                        </div>
                        {(sallaLocation || isAdminUser) && (
                          <div className="flex flex-wrap items-center gap-2 text-gray-600">
                            <span className="text-gray-600">الموقع من سلة:</span>{' '}
                            <span className={sallaLocation ? 'font-medium' : 'text-gray-400'}>
                              {sallaLocation || 'غير متوفر'}
                            </span>
                            {locationShortCode && (
                              <span className="ml-1 text-xs text-gray-500">({locationShortCode})</span>
                            )}
                            {isAdminUser && (
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                className="ml-auto"
                                onClick={() => handleRefreshLocation(assignment.id)}
                                disabled={refreshingLocationId === assignment.id}
                              >
                                {refreshingLocationId === assignment.id
                                  ? 'جاري التحديث...'
                                  : 'تحديث الموقع'}
                              </Button>
                            )}
                          </div>
                        )}
                        {mapsLink && (
                          <div>
                            <a
                              href={mapsLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-600"
                            >
                              <MapPin className="h-4 w-4" />
                              فتح الموقع على خرائط قوقل
                            </a>
                          </div>
                        )}
                      </div>

                      {renderExchangeReminder(assignment.exchangeRequest)}

                      {!assignment.exchangeRequest && hasExchangeCoupon && (
                        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                          <p className="font-semibold">تنبيه استبدال</p>
                          <p>
                            تم إنشاء هذه الشحنة باستخدام كوبون استبدال. تأكد من استلام الطلب الأصلي من العميل قبل
                            تسليم هذه الشحنة.
                          </p>
                          {exchangeCouponCode && (
                            <p className="mt-1">
                              <span className="font-semibold">الكوبون:</span>{' '}
                              <span className="font-mono">{exchangeCouponCode}</span>
                            </p>
                          )}
                        </div>
                      )}

                      {assignment.notes && (
                        <div className="mb-3 text-sm bg-blue-50 p-2 rounded">
                          <span className="text-gray-600">ملاحظات:</span> <span>{assignment.notes}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {assignment.status === 'assigned' && (
                          <Button size="sm" onClick={() => openStatusModal(assignment, 'picked_up')}>
                            تم الاستلام
                          </Button>
                        )}
                        {(assignment.status === 'assigned' || assignment.status === 'picked_up') && (
                          <Button size="sm" onClick={() => openStatusModal(assignment, 'in_transit')}>
                            قيد التوصيل
                          </Button>
                        )}
                        {['assigned', 'picked_up', 'in_transit'].includes(assignment.status) && (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => openStatusModal(assignment, 'delivered')}
                          >
                            تم التوصيل
                          </Button>
                        )}
                        {['assigned', 'picked_up', 'in_transit'].includes(assignment.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openStatusModal(assignment, 'failed')}
                          >
                            فشل التوصيل
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">الشحنات المكتملة</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-right bg-gray-100">
                      <th className="px-3 py-2">رقم الطلب</th>
                      <th className="px-3 py-2">العميل</th>
                      <th className="px-3 py-2">المدينة</th>
                      <th className="px-3 py-2">المبلغ</th>
                      <th className="px-3 py-2">الحالة</th>
                      <th className="px-3 py-2">تاريخ الإنجاز</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedAssignments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-gray-500 py-6">
                          لا توجد شحنات مكتملة
                        </td>
                      </tr>
                    ) : (
                      completedAssignments.map((assignment) => {
                        const fullAddress = getFullAddressLabel(assignment.shipment);
                        const mapsLink = getMapsLink(assignment.shipment);
                        const hasExchangeCoupon = hasExchangeCouponFlag(assignment.shipment);
                        const showExchangeLabel = hasExchangeCoupon || Boolean(assignment.exchangeRequest);
                        const sallaLocation = assignment.shipment.orderItems?.meta?.shipToLocationText;
                        const locationShortCode =
                          assignment.shipment.orderItems?.meta?.shipToLocationCode;
                        return (
                          <tr key={assignment.id} className="border-b">
                            <td className="px-3 py-2">
                              <div className="font-mono font-semibold">{assignment.shipment.orderNumber}</div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {getShipmentTypeBadge(assignment.shipmentDirection)}
                                {assignment.exchangeRequest && (
                                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                    طلب استبدال
                                  </span>
                                )}
                                {showExchangeLabel && (
                                  <span
                                    className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700"
                                    title="يجب استلام الطلب الأصلي من العميل قبل تسليم هذه الشحنة"
                                  >
                                    استبدال
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div>{assignment.shipment.customerName}</div>
                              <div className="mt-1 text-xs text-gray-600 whitespace-pre-line">
                                {fullAddress}
                              </div>
                              {(sallaLocation || isAdminUser) && (
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                                  <span>الموقع من سلة:</span>
                                  <span className={sallaLocation ? 'font-medium' : 'text-gray-400'}>
                                    {sallaLocation || 'غير متوفر'}
                                  </span>
                                  {locationShortCode && (
                                    <span className="text-gray-500">({locationShortCode})</span>
                                  )}
                                  {isAdminUser && (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      onClick={() => handleRefreshLocation(assignment.id)}
                                      disabled={refreshingLocationId === assignment.id}
                                    >
                                      {refreshingLocationId === assignment.id
                                        ? 'جاري التحديث...'
                                        : 'تحديث الموقع'}
                                    </Button>
                                  )}
                                </div>
                              )}
                              {mapsLink && (
                                <div className="mt-1 text-xs">
                                  <a
                                    href={mapsLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-600"
                                  >
                                    <MapPin className="h-3.5 w-3.5" />
                                    خرائط قوقل
                                  </a>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">{assignment.shipment.shippingCity}</td>
                            <td className="px-3 py-2 font-semibold">
                              {formatCurrency(assignment.shipment.orderTotal)}
                              {assignment.shipment.isCOD && (
                                <span className="text-xs text-orange-600 ml-1">(COD)</span>
                              )}
                            </td>
                            <td className="px-3 py-2">{getStatusBadge(assignment.status)}</td>
                            <td className="px-3 py-2 text-xs">
                              {formatDate(assignment.deliveredAt || assignment.assignedAt)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
        )}

        {/* Update Status Modal */}

        {selectedAssignment && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <Card className="max-w-lg w-full p-6">
              <h3 className="text-xl font-semibold mb-4">تحديث حالة الشحنة</h3>

              <div className="mb-4">
                <div className="text-sm text-gray-600 mb-2">
                  الطلب: <span className="font-mono font-semibold">{selectedAssignment.shipment.orderNumber}</span>
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  العميل: <span className="font-semibold">{selectedAssignment.shipment.customerName}</span>
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  الحالة الجديدة: {getStatusBadge(newStatus)}
                </div>
              </div>

              {statusModalError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {statusModalError}
                </div>
              )}

              {newStatus === 'failed' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    سبب الفشل *
                  </label>
                  <textarea
                    value={failureReason}
                    onChange={(e) => setFailureReason(e.target.value)}
                    placeholder="اذكر سبب فشل التوصيل"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    required
                  />
                </div>
              )}

              {requiresOtpInput && (
                <div className="mb-4 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="text-sm font-medium text-gray-700">رمز التحقق من العميل *</label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleSendOtp}
                      disabled={otpSending || updating}
                    >
                      {otpSending
                        ? 'جاري الإرسال...'
                        : selectedAssignment.deliveryOtpRequestedAt
                          ? 'إعادة إرسال الرمز'
                          : 'إرسال رمز التحقق'}
                    </Button>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={deliveryOtpCode}
                    onChange={(e) => setDeliveryOtpCode(e.target.value)}
                    placeholder="أدخل الرمز المكوّن من 6 أرقام"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-600">
                    سيتم إرسال الرمز إلى{' '}
                    <span className="font-semibold">
                      {otpMaskedPhone ||
                        maskPhoneForDisplay(selectedAssignment.shipment.customerPhone) ||
                        'رقم العميل'}
                    </span>
                    . شارك العميل الرمز مع المندوب لإكمال التسليم.
                  </p>
                  {selectedAssignment.deliveryOtpExpiresAt && (
                    <p className="text-xs text-emerald-700">
                      الرمز الحالي صالح حتى{' '}
                      <span className="font-semibold">
                        {formatDate(selectedAssignment.deliveryOtpExpiresAt)}
                      </span>
                    </p>
                  )}
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ملاحظات (اختياري)
                </label>
                <textarea
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  placeholder="ملاحظات إضافية"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleUpdateStatus}
                  disabled={
                    updating ||
                    (newStatus === 'failed' && !failureReason.trim()) ||
                    (requiresOtpInput && !deliveryOtpCode.trim())
                  }
                  className="flex-1"
                >
                  {updating ? 'جاري التحديث...' : 'تأكيد'}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetStatusModalState}
                  disabled={updating}
                  className="flex-1"
                >
                  إلغاء
                </Button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
