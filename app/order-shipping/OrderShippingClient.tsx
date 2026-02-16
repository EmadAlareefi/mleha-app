'use client';

import { useState, useEffect, useMemo, useCallback, FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import AppNavbar from '@/components/AppNavbar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { getShippingAddressSummary, getShippingCompanyName } from '@/app/lib/shipping-company';
import { detectMessengerShipments, buildShipToArabicLabel } from '@/app/lib/local-shipping/messenger';

interface OrderUser {
  id: string;
  username: string;
  name: string;
}

interface OrderShipmentRecord {
  id: string;
  trackingNumber?: string | null;
  courierName?: string | null;
  status?: string | null;
  labelUrl?: string | null;
  labelPrinted?: boolean | null;
  labelPrintedAt?: string | null;
  printCount?: number | null;
  updatedAt?: string | null;
  type?: 'salla' | 'local';
  localShipmentId?: string | null;
  assignedAgentName?: string | null;
  assignmentStatus?: string | null;
}

interface OrderAssignment {
  id: string;
  orderId: string;
  orderNumber: string;
  orderData: any;
  merchantId?: string | null;
  status: string;
  assignedAt: string;
  shipment?: OrderShipmentRecord | null;
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
  source?: string | null;
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

interface DeliveryAgentOption {
  id: string;
  name: string;
  username: string;
  phone?: string | null;
}

interface ConfirmationState {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
}

interface SearchFeedback {
  type: 'success' | 'error';
  message: string;
}

const ACTION_BUTTON_BASE = 'w-full py-3 text-sm sm:py-4 sm:text-base';
const UNDER_REVIEW_X4_STATUS_ID = '2046404155';

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

type PrepStatus = 'ready' | 'comingSoon' | 'unavailable';

const prepStatusMeta: Record<
  PrepStatus,
  { label: string; className: string }
> = {
  ready: {
    label: 'تم التجهيز',
    className: 'bg-green-50 border-green-200 text-green-800',
  },
  comingSoon: {
    label: 'سيتوفر قريباً',
    className: 'bg-amber-50 border-amber-200 text-amber-800',
  },
  unavailable: {
    label: 'غير متوفر',
    className: 'bg-rose-50 border-rose-200 text-rose-800',
  },
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

export default function OrderShippingPage() {
  const { data: session, status } = useSession();
  const baseRole = (session?.user as any)?.role;
  const roles = ((session?.user as any)?.roles || (baseRole ? [baseRole] : [])) as string[];
  const isOrdersUser = roles.includes('orders') || roles.includes('admin');
  const [user, setUser] = useState<OrderUser | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState<SearchFeedback | null>(null);
  const [currentOrder, setCurrentOrder] = useState<OrderAssignment | null>(null);
  const [lastSearchTerm, setLastSearchTerm] = useState('');

  const [refreshingItems, setRefreshingItems] = useState(false);
  const [creatingShipment, setCreatingShipment] = useState(false);
  const [printingShipmentLabel, setPrintingShipmentLabel] = useState(false);
  const [returningOrder, setReturningOrder] = useState(false);
  const [shipmentInfo, setShipmentInfo] = useState<{
    trackingNumber: string;
    courierName: string;
    labelPrinted: boolean;
    printedAt: string | null;
    labelUrl: string | null;
    type: 'salla' | 'local';
    localShipmentId: string | null;
    assignedAgentName?: string | null;
    assignmentStatus?: string | null;
  } | null>(null);
  const [shipmentError, setShipmentError] = useState<string | null>(null);
  const [deliveryAgents, setDeliveryAgents] = useState<DeliveryAgentOption[]>([]);
  const [deliveryAgentsError, setDeliveryAgentsError] = useState<string | null>(null);
  const [creatingLocalShipment, setCreatingLocalShipment] = useState(false);

  const applyShipmentFromAssignment = useCallback(
    (assignment: OrderAssignment | null, options: { resetWhenMissing?: boolean } = {}) => {
      const shouldReset = options.resetWhenMissing ?? true;
      if (!assignment?.shipment) {
        if (shouldReset) {
          setShipmentInfo(null);
        }
        return;
      }
      const shipment = assignment.shipment;
      const shipmentType: 'salla' | 'local' = shipment.type === 'local' ? 'local' : 'salla';
      setShipmentInfo({
        trackingNumber: shipment.trackingNumber || 'سيتم توفير رقم التتبع قريباً',
        courierName:
          shipment.courierName ||
          (shipmentType === 'local' ? 'شحن محلي' : 'شركة الشحن المعتمدة'),
        labelPrinted: Boolean(shipment.labelPrinted),
        printedAt: shipment.labelPrintedAt || null,
        labelUrl: shipment.labelUrl || null,
        type: shipmentType,
        localShipmentId: shipmentType === 'local' ? shipment.localShipmentId || shipment.id : null,
        assignedAgentName: shipment.assignedAgentName || null,
        assignmentStatus: shipment.assignmentStatus || null,
      });
    },
    [],
  );

  const [productLocations, setProductLocations] = useState<Record<string, ProductLocation>>({});
  const [loadingProductLocations, setLoadingProductLocations] = useState(false);
  const [productLocationError, setProductLocationError] = useState<string | null>(null);

  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationState | null>(null);

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

  useEffect(() => {
    if (session?.user && isOrdersUser) {
      const sessionUser = session.user as any;
      setUser({
        id: sessionUser.id,
        username: sessionUser.username,
        name: sessionUser.name,
      });
    }
  }, [session, isOrdersUser]);

  const fetchDeliveryAgents = useCallback(async (): Promise<DeliveryAgentOption[]> => {
    try {
      setDeliveryAgentsError(null);
      const response = await fetch('/api/delivery-agents');
      const data = await parseJsonResponse<{
        success?: boolean;
        deliveryAgents?: DeliveryAgentOption[];
        error?: string;
      }>(response, 'GET /api/delivery-agents');

      if (!response.ok || data.success === false) {
        throw new Error(data?.error || 'تعذر تحميل قائمة المناديب');
      }

      const agents = Array.isArray(data.deliveryAgents) ? data.deliveryAgents : [];
      setDeliveryAgents(agents);
      return agents;
    } catch (error) {
      console.error('Failed to load delivery agents', error);
      setDeliveryAgents([]);
      setDeliveryAgentsError(error instanceof Error ? error.message : 'تعذر تحميل قائمة المناديب');
      return [];
    }
  }, []);

  const resolvedMerchantId = useMemo(() => {
    if (!currentOrder) {
      return '';
    }
    if (currentOrder.merchantId) {
      return currentOrder.merchantId;
    }
    const data = currentOrder.orderData || {};
    const candidateFields = [
      (data as any)?.merchant_id,
      (data as any)?.merchantId,
      (data as any)?.merchant?.id,
      (data as any)?.merchant?.merchant_id,
    ];
    for (const candidate of candidateFields) {
      const value = getStringValue(candidate).trim();
      if (value) {
        return value;
      }
    }
    return '';
  }, [currentOrder]);

  const resolvedShippingCompanyName = useMemo(() => {
    const normalize = (value: unknown): string | null => {
      if (typeof value !== 'string') {
        return null;
      }
      const trimmed = value.trim();
      return trimmed || null;
    };

    const fromShipmentState = normalize(shipmentInfo?.courierName);
    if (fromShipmentState) {
      return fromShipmentState;
    }

    const fromAssignmentShipment = normalize(currentOrder?.shipment?.courierName);
    if (fromAssignmentShipment) {
      return fromAssignmentShipment;
    }

    if (currentOrder?.orderData) {
      const derived = getShippingCompanyName(currentOrder.orderData);
      if (derived) {
        return derived;
      }
    }

    return null;
  }, [currentOrder, shipmentInfo]);

  const shippingAddressSummary = useMemo(() => {
    if (!currentOrder?.orderData) {
      return null;
    }
    return getShippingAddressSummary(currentOrder.orderData);
  }, [currentOrder]);

  const resolvedShippingAddressLabel =
    shippingAddressSummary?.addressLine || shippingAddressSummary?.locationLabel || null;
  const resolvedShippingLocationHint =
    shippingAddressSummary?.addressLine && shippingAddressSummary?.locationLabel
      ? shippingAddressSummary.locationLabel
      : null;

  const messengerShipments = useMemo(() => {
    if (!currentOrder?.orderData) {
      return [];
    }
    try {
      return detectMessengerShipments(currentOrder.orderData);
    } catch (error) {
      console.error('Failed to detect messenger shipments', error);
      return [];
    }
  }, [currentOrder]);

  const primaryMessengerEntry = messengerShipments.length > 0 ? messengerShipments[0] : null;
  const primaryMessengerShipTo = primaryMessengerEntry?.shipTo || null;
  const primaryMessengerCourierLabel = primaryMessengerEntry?.courierLabel || null;
  const primaryMessengerShipToArabic = useMemo(
    () => buildShipToArabicLabel(primaryMessengerShipTo),
    [primaryMessengerShipTo],
  );
  const autoSelectDeliveryAgent = useCallback(
    (agents: DeliveryAgentOption[]): DeliveryAgentOption | null => {
      if (!agents.length) {
        return null;
      }

      const normalizeText = (value: string | null | undefined) => {
        if (!value) {
          return null;
        }
        return value.toString().replace(/\s+/g, '').toLowerCase();
      };

      const normalizePhone = (value: string | null | undefined) => {
        if (!value) {
          return null;
        }
        const digits = value.replace(/\D+/g, '');
        return digits || null;
      };

      const labelCandidates = [primaryMessengerCourierLabel, resolvedShippingCompanyName];
      for (const candidate of labelCandidates) {
        const normalizedLabel = normalizeText(candidate);
        if (!normalizedLabel) {
          continue;
        }
        const match = agents.find((agent) => {
          const normalizedName = normalizeText(agent.name);
          const normalizedUsername = normalizeText(agent.username);
          return (
            (normalizedName && normalizedLabel.includes(normalizedName)) ||
            (normalizedUsername && normalizedLabel.includes(normalizedUsername))
          );
        });
        if (match) {
          return match;
        }
      }

      const phoneCandidates = [primaryMessengerShipTo?.phone];
      for (const phone of phoneCandidates) {
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) {
          continue;
        }
        const match = agents.find((agent) => {
          const agentPhone = normalizePhone(agent.phone);
          if (!agentPhone) {
            return false;
          }
          return (
            agentPhone.endsWith(normalizedPhone) ||
            normalizedPhone.endsWith(agentPhone)
          );
        });
        if (match) {
          return match;
        }
      }

      return agents[0];
    },
    [primaryMessengerCourierLabel, primaryMessengerShipTo, resolvedShippingCompanyName],
  );

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

const prepItemStatuses = useMemo(() => {
  const raw = currentOrder?.orderData?.prepItemStatuses;
  if (!Array.isArray(raw)) {
    return [] as Array<{ index: number; normalizedSku: string | null; status: PrepStatus }>;
  }
  return raw
    .map((entry: any, idx: number) => {
      const status: PrepStatus | null =
        entry?.status === 'ready' || entry?.status === 'comingSoon' || entry?.status === 'unavailable'
          ? entry.status
          : null;
      if (!status) {
        return null;
      }
      const normalized =
        typeof entry?.normalizedSku === 'string' && entry.normalizedSku
          ? entry.normalizedSku
          : typeof entry?.sku === 'string'
            ? normalizeSku(entry.sku)
            : null;
      const index = typeof entry?.index === 'number' ? entry.index : idx;
      return { index, normalizedSku: normalized, status };
    })
    .filter(
      (entry): entry is { index: number; normalizedSku: string | null; status: PrepStatus } =>
        Boolean(entry),
    );
}, [currentOrder]);

const getPrepStatusForItem = useCallback(
  (item: any, index: number): PrepStatus | null => {
    if (prepItemStatuses.length === 0) {
      return null;
    }
    const normalized = normalizeSku(item?.sku);
    if (normalized) {
      const match = prepItemStatuses.find((entry) => entry.normalizedSku === normalized);
      if (match) {
        return match.status;
      }
    }
    const fallback = prepItemStatuses.find((entry) => entry.index === index);
    return fallback?.status ?? null;
  },
  [prepItemStatuses],
);

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

  const existingShipmentLabelUrl = useMemo(() => {
    if (!currentOrder) return null;
    const labelFromOrderData = getLabelUrlFromOrderData(currentOrder.orderData);
    if (labelFromOrderData) {
      return labelFromOrderData;
    }
    if (shipmentInfo?.labelUrl) {
      return shipmentInfo.labelUrl;
    }
    const labelFromNotes = extractHttpUrl(currentOrder.notes) || findUrlInsideText(currentOrder.notes);
    if (labelFromNotes) {
      return labelFromNotes;
    }
    return null;
  }, [currentOrder, shipmentInfo]);

  const shouldShowManualPrintButton =
    Boolean(existingShipmentLabelUrl) && !shipmentInfo && currentOrder?.status !== 'shipped';

  const canPrintShipmentLabel =
    Boolean(currentOrder && (currentOrder.status === 'shipped' || shipmentInfo));
  const shouldShowShipmentCard = Boolean(
    shipmentInfo || currentOrder?.status === 'shipped' || existingShipmentLabelUrl,
  );

  const canCreateLocalShipment = Boolean(currentOrder && resolvedMerchantId && currentOrder.orderNumber);
  const canReturnOrderToReview = Boolean(
    currentOrder && (!currentOrder.source || currentOrder.source === 'assignment')
  );

  useEffect(() => {
    if (!shipmentInfo || shipmentInfo.type !== 'salla' || shipmentInfo.labelUrl) {
      return;
    }

    const labelFromOrderData = currentOrder ? getLabelUrlFromOrderData(currentOrder.orderData) : null;
    if (labelFromOrderData) {
      setShipmentInfo((prev) => {
        if (!prev || prev.labelUrl === labelFromOrderData) {
          return prev;
        }
        return {
          ...prev,
          labelUrl: labelFromOrderData,
        };
      });
      return;
    }

    const assignmentShipment = currentOrder?.shipment;
    const labelFromSallaShipment =
      assignmentShipment && assignmentShipment.type !== 'local'
        ? assignmentShipment.labelUrl || null
        : null;

    if (labelFromSallaShipment) {
      setShipmentInfo((prev) => {
        if (!prev || prev.labelUrl === labelFromSallaShipment) {
          return prev;
        }
        return {
          ...prev,
          labelUrl: labelFromSallaShipment,
        };
      });
    }
  }, [currentOrder, shipmentInfo]);

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

        const data = await parseJsonResponse(response, 'POST /api/order-prep/product-locations');

        if (!response.ok || !data.success) {
          throw new Error(data?.error || 'تعذر تحميل مواقع المنتجات');
        }

        const map: Record<string, ProductLocation> = {};
        (Array.isArray(data.locations) ? data.locations : []).forEach((location: ProductLocation) => {
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

  // Shipment info is reset at the start of handleSearch and via applyShipmentFromAssignment.
  // A useEffect on currentOrder?.id would race with applyShipmentFromAssignment and clear
  // the shipment info that was just set from the search result.

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

  const fetchAssignmentByQuery = useCallback(async (query: string) => {
    const response = await fetch(`/api/order-assignments/search?query=${encodeURIComponent(query)}`, {
      cache: 'no-store',
    });
    const data = await parseJsonResponse(response, 'GET /api/order-assignments/search');

    if (!response.ok || !data?.assignment) {
      throw new Error(data?.error || 'تعذر العثور على الطلب');
    }

    return data.assignment as OrderAssignment;
  }, []);

  const reloadCurrentOrder = useCallback(async () => {
    if (!currentOrder) return;
    const identifier = currentOrder.orderNumber || currentOrder.orderId || lastSearchTerm;
    if (!identifier) return;

    try {
      const assignment = await fetchAssignmentByQuery(identifier);
      setCurrentOrder(assignment);
      applyShipmentFromAssignment(assignment, { resetWhenMissing: false });
    } catch (error) {
      console.error('Failed to reload order', error);
    }
  }, [currentOrder, fetchAssignmentByQuery, lastSearchTerm, applyShipmentFromAssignment]);

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearchFeedback(null);

    if (!searchQuery.trim()) {
      setSearchFeedback({ type: 'error', message: 'يرجى إدخال رقم الطلب أو بيانات البحث.' });
      setCurrentOrder(null);
      applyShipmentFromAssignment(null);
      return;
    }

    setSearching(true);
    setShipmentInfo(null);
    setShipmentError(null);

    try {
      const assignment = await fetchAssignmentByQuery(searchQuery.trim());
      setCurrentOrder(assignment);
      applyShipmentFromAssignment(assignment);
      setLastSearchTerm(searchQuery.trim());
      setSearchFeedback({ type: 'success', message: `تم العثور على الطلب #${assignment.orderNumber}.` });
    } catch (error) {
      console.error('Order search failed', error);
      setCurrentOrder(null);
      applyShipmentFromAssignment(null);
      const message = error instanceof Error ? error.message : 'تعذر العثور على الطلب.';
      setSearchFeedback({ type: 'error', message });
    } finally {
      setSearching(false);
    }
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
        await reloadCurrentOrder();
        alert(`تم تحديث المنتجات بنجاح - عدد المنتجات: ${data.itemsCount}`);
      } else {
        alert(data.error || 'فشل تحديث المنتجات');
      }
    } catch (error) {
      console.error('Refresh items failed', error);
      alert('فشل تحديث المنتجات');
    } finally {
      setRefreshingItems(false);
    }
  };

  const handleCreateShipment = async () => {
    if (!currentOrder) return;

    const shouldIncludeAssignmentId =
      !currentOrder.source || currentOrder.source === 'assignment';

    setCreatingShipment(true);
    setShipmentError(null);
    try {
      const response = await fetch('/api/salla/create-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: shouldIncludeAssignmentId ? currentOrder.id : undefined,
          orderId: currentOrder.orderId,
          orderNumber: currentOrder.orderNumber,
          merchantId: currentOrder.merchantId || null,
        }),
      });

      const data = await parseJsonResponse(response, 'POST /api/salla/create-shipment');

      if (data.success) {
        const labelPrinted = Boolean(data.data.labelPrinted);
        const labelPrintedAt = data.data.labelPrintedAt || null;
        const labelUrl = data.data.labelUrl || null;
        setShipmentInfo({
          trackingNumber: data.data.trackingNumber,
          courierName: data.data.courierName,
          labelPrinted,
          printedAt: labelPrintedAt,
          labelUrl,
          type: 'salla',
          localShipmentId: null,
          assignedAgentName: null,
          assignmentStatus: null,
        });
        setShipmentError(null);

        const message = labelPrinted
          ? `✅ تم إنشاء الشحنة وطباعة البوليصة بنجاح!\n\nرقم التتبع: ${data.data.trackingNumber}\nشركة الشحن: ${data.data.courierName}`
          : `✅ تم إنشاء الشحنة بنجاح!\n\nرقم التتبع: ${data.data.trackingNumber}\nشركة الشحن: ${data.data.courierName}\n\n💡 اضغط زر "طباعة البوليصة" أدناه لإرسالها للطابعة الآن.`;

        alert(message);
        await reloadCurrentOrder();
      } else {
        const errorMsg = data.details ? `${data.error}\n\nتفاصيل: ${data.details}` : data.error;
        console.error('Shipment creation failed:', data);
        setShipmentError(errorMsg || 'فشل إنشاء الشحنة، حاول مرة أخرى.');
        alert(errorMsg || 'فشل إنشاء الشحنة');
      }
    } catch (error) {
      console.error('Create shipment exception:', error);
      const errorMessage = error instanceof Error ? error.message : 'خطأ غير معروف';
      setShipmentError(`خطأ في الاتصال: ${errorMessage}`);
      alert(`فشل إنشاء الشحنة\n\nخطأ: ${errorMessage}`);
    } finally {
      setCreatingShipment(false);
    }
  };

  const handleSendShipmentToPrinter = async () => {
    if (!currentOrder) return;

    const shouldIncludeAssignmentId =
      !currentOrder.source || currentOrder.source === 'assignment';
    const currentShipmentInfo = shipmentInfo;
    const isLocalShipment = currentShipmentInfo?.type === 'local';

    setPrintingShipmentLabel(true);
    try {
      const response = await fetch(isLocalShipment ? '/api/local-shipping/print' : '/api/salla/shipments/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isLocalShipment
            ? {
                shipmentId: currentShipmentInfo?.localShipmentId || undefined,
                orderNumber: currentOrder.orderNumber,
                trackingNumber: currentShipmentInfo?.trackingNumber,
                shipTo: primaryMessengerShipTo,
                messengerCourierLabel: primaryMessengerCourierLabel,
                shipToArabicText: primaryMessengerShipToArabic,
              }
            : {
                assignmentId: shouldIncludeAssignmentId ? currentOrder.id : undefined,
                orderId: currentOrder.orderId,
                orderNumber: currentOrder.orderNumber,
              }),
        }),
      });

      const data = await parseJsonResponse(
        response,
        isLocalShipment ? 'POST /api/local-shipping/print' : 'POST /api/salla/shipments/print',
      );

      if (data.success) {
        const printedAt = data.data?.labelPrintedAt || new Date().toISOString();

        setShipmentInfo((prev) => ({
          trackingNumber: prev?.trackingNumber || 'سيتم توفير رقم التتبع قريباً',
          courierName:
            prev?.courierName ||
            (isLocalShipment ? 'شحن محلي' : 'شركة الشحن المعتمدة'),
          labelPrinted: true,
          printedAt,
          labelUrl: data.data?.labelUrl || prev?.labelUrl || null,
          type: prev?.type || (isLocalShipment ? 'local' : 'salla'),
          localShipmentId: prev?.localShipmentId || (isLocalShipment ? currentShipmentInfo?.localShipmentId || null : null),
          assignedAgentName: prev?.assignedAgentName || null,
          assignmentStatus: prev?.assignmentStatus || null,
        }));

        alert(data.message || 'تم إرسال البوليصة للطابعة');
        await reloadCurrentOrder();
      } else {
        const errorMsg = data.details ? `${data.error}\n\nتفاصيل: ${data.details}` : data.error;
        alert(errorMsg || 'فشل إرسال البوليصة للطابعة');
      }
    } catch (error) {
      console.error('Manual shipment print exception:', error);
      alert('فشل إرسال البوليصة للطابعة');
    } finally {
      setPrintingShipmentLabel(false);
    }
  };

  const handleReturnOrderToUnderReview = async () => {
    if (!currentOrder) return;

    const shouldIncludeAssignmentId =
      !currentOrder.source || currentOrder.source === 'assignment';

    if (!shouldIncludeAssignmentId) {
      alert('لا يمكن تحديث حالة هذا الطلب لأنه غير مرتبط بتعيين داخلي.');
      return;
    }

    setReturningOrder(true);
    try {
      const response = await fetch('/api/order-assignments/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
          targetStatusId: UNDER_REVIEW_X4_STATUS_ID,
        }),
      });

      const data = await parseJsonResponse(response, 'POST /api/order-assignments/release');

      if (!response.ok || data?.success === false) {
        throw new Error(data?.error || 'تعذر تحديث حالة الطلب في سلة');
      }

      alert(
        data.message ||
          'تم تحويل الطلب إلى حالة "غير متوفر (ارجاع مبلغ)" وإعادته إلى قائمة الطلبات قيد المراجعة.',
      );
      setCurrentOrder(null);
      setShipmentInfo(null);
      setShipmentError(null);
      setSearchFeedback({
        type: 'success',
        message: 'تمت إعادة الطلب لحالة المراجعة.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر تحديث حالة الطلب في سلة';
      alert(message);
    } finally {
      setReturningOrder(false);
    }
  };
 
  const createLocalShipmentForAgent = useCallback(
    async (agent: DeliveryAgentOption) => {
      if (!currentOrder || !resolvedMerchantId) {
        alert('لا يمكن تحديد الطلب أو التاجر لإنشاء شحنة محلية.');
        return;
      }

      try {
        setCreatingLocalShipment(true);

        const createResponse = await fetch('/api/local-shipping/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            merchantId: resolvedMerchantId,
            orderNumber: currentOrder.orderNumber,
            generatedBy: user?.username || user?.name || 'order-shipping',
          }),
        });

        const createData = await parseJsonResponse<{
          success?: boolean;
          shipment?: {
            id: string;
            trackingNumber: string;
            labelUrl?: string | null;
            labelPrinted?: boolean;
            labelPrintedAt?: string | null;
          };
          error?: string;
          reused?: boolean;
          sallaStatusUpdated?: boolean;
          autoPrint?: {
            success?: boolean;
            error?: string | null;
            jobId?: number | null;
          } | null;
        }>(createResponse, 'POST /api/local-shipping/create');

        if (!createResponse.ok || createData.success === false || !createData.shipment) {
          throw new Error(createData?.error || 'تعذر إنشاء الشحنة المحلية');
        }

        const assignmentResponse = await fetch('/api/shipment-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shipmentId: createData.shipment.id,
            deliveryAgentId: agent.id,
          }),
        });

        const assignmentData = await parseJsonResponse<{
          success?: boolean;
          error?: string;
        }>(assignmentResponse, 'POST /api/shipment-assignments');

        if (!assignmentResponse.ok || assignmentData.success === false) {
          throw new Error(assignmentData?.error || 'تم إنشاء الشحنة ولكن فشل تعيينها للمندوب');
        }

        const agentDisplayName = agent.name || agent.username || 'المندوب المختار';
        if (createData.shipment) {
          setShipmentInfo({
            trackingNumber: createData.shipment.trackingNumber,
            courierName: 'شحن محلي',
            labelPrinted: Boolean(createData.shipment.labelPrinted),
            printedAt: createData.shipment.labelPrintedAt || null,
            labelUrl: createData.shipment.labelUrl || null,
            type: 'local',
            localShipmentId: createData.shipment.id,
            assignedAgentName: agentDisplayName,
            assignmentStatus: 'assigned',
          });
        }
        const trackingNumber = createData.shipment?.trackingNumber || 'غير معروف';
        const baseMessage = createData.reused
          ? `تم العثور على شحنة محلية سابقة (${trackingNumber}) وتم تأكيد تعيينها إلى ${agentDisplayName}.`
          : `تم إنشاء شحنة محلية (${trackingNumber}) وتعيينها إلى ${agentDisplayName}.`;
        const autoPrintMessage = createData.autoPrint
          ? createData.autoPrint.success
            ? '\n\nتم إرسال البوليصة للطابعة تلقائياً عبر PrintNode.'
            : '\n\n⚠️ تعذر إرسال البوليصة تلقائياً للطابعة، يرجى الضغط على زر "طباعة البوليصة".'
          : '';
        const sallaStatusMessage = createData.sallaStatusUpdated
          ? '\n\n✅ تم تحديث حالة الطلب في سلة إلى "تم التنفيذ".'
          : createData.reused
            ? ''
            : '\n\n⚠️ تعذر تحديث حالة الطلب في سلة تلقائياً.';
        alert(`${baseMessage}${autoPrintMessage}${sallaStatusMessage}`);
        await reloadCurrentOrder();
      } catch (error) {
        console.error('Local shipment creation failed', error);
        const message =
          error instanceof Error ? error.message : 'حدث خطأ أثناء إنشاء الشحنة المحلية';
        alert(message);
      } finally {
        setCreatingLocalShipment(false);
      }
    },
    [currentOrder, resolvedMerchantId, user, reloadCurrentOrder],
  );

  const handleCreateLocalShipment = useCallback(async () => {
    if (!currentOrder) {
      return;
    }
    if (!resolvedMerchantId) {
      alert('لا يمكن إنشاء شحنة محلية لهذا الطلب لعدم توفر معرف التاجر.');
      return;
    }

    let agents = deliveryAgents;
    if (agents.length === 0) {
      agents = await fetchDeliveryAgents();
    }

    if (agents.length === 0) {
      alert(
        deliveryAgentsError ||
          'لا يوجد مناديب متاحون حالياً لتعيين الشحنة المحلية. يرجى التواصل مع مسؤول المستودع.',
      );
      return;
    }

    const selectedAgent = autoSelectDeliveryAgent(agents);
    if (!selectedAgent) {
      alert('تعذر تحديد المندوب المناسب لتعيين الشحنة المحلية.');
      return;
    }

    await createLocalShipmentForAgent(selectedAgent);
  }, [
    currentOrder,
    resolvedMerchantId,
    deliveryAgents,
    fetchDeliveryAgents,
    deliveryAgentsError,
    autoSelectDeliveryAgent,
    createLocalShipmentForAgent,
  ]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg">جاري التحميل...</p>
      </div>
    );
  }

  if (!session || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">شحن الطلبات</h1>
          <p className="text-gray-600 mb-6">يجب تسجيل الدخول كمستخدم طلبات للوصول إلى هذه الصفحة</p>
          <Button onClick={() => (window.location.href = '/login')} className="w-full">
            تسجيل الدخول
          </Button>
        </Card>
      </div>
    );
  }

  if (!isOrdersUser) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <Card className="p-8 max-w-md">
          <p className="text-lg font-semibold text-gray-700">
            ليس لديك صلاحية للوصول إلى لوحة شحن الطلبات.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <AppNavbar title="شحن الطلبات" subtitle={`مرحباً، ${user.name}`} collapseOnMobile />

      <div className="w-full">
        <div className="w-full max-w-7xl mx-auto px-4 md:px-6 pt-6 pb-32 md:pb-40">
          <Card className="w-full p-4 mb-6">
            <form onSubmit={handleSearch} className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="flex-1">
                <label htmlFor="orderSearch" className="block text-sm font-semibold text-gray-700 mb-1">
                  ابحث عن الطلب
                </label>
                <Input
                  id="orderSearch"
                  placeholder="رقم الطلب، رقم المرجع، رقم الهاتف، أو المعرف الخارجي"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  disabled={searching}
                  className="w-full"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={searching} className="min-w-[140px]">
                  {searching ? 'جاري البحث...' : '🔍 بحث'}
                </Button>
                {currentOrder && (
                  <Button type="button" variant="outline" onClick={reloadCurrentOrder} disabled={searching}>
                    تحديث الطلب
                  </Button>
                )}
              </div>
            </form>
            {searchFeedback && (
              <p
                className={`mt-3 text-sm font-medium ${
                  searchFeedback.type === 'error' ? 'text-red-600' : 'text-green-700'
                }`}
              >
                {searchFeedback.message}
              </p>
            )}
          </Card>

          {!currentOrder ? (
            <Card className="w-full p-8 md:p-12 text-center">
              <div className="mb-6">
                <svg className="w-24 h-24 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-xl text-gray-600 mb-2">ابحث عن طلب لبدء إنشاء الشحنة</p>
                <p className="text-sm text-gray-500 mb-4">
                  أدخل رقم الطلب أو بيانات البحث واضغط على زر &quot;بحث&quot; لعرض معلومات الطلب وإرسال الشحنات.
                </p>
              </div>
            </Card>
          ) : (
            <div className="w-full">
              <Card className="p-4 md:p-6 mb-4 md:mb-6">
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
                      <p className="text-sm text-gray-500 mt-1">
                        📍 {location && `${location} - `}
                        {city}
                      </p>
                    );
                  })()}
                  {(() => {
                    const notesText = getStringValue(currentOrder.orderData?.notes);
                    if (!notesText) return null;
                    return (
                      <p className="text-sm text-orange-600 mt-2 font-medium">
                        📝 ملاحظات: {notesText}
                      </p>
                    );
                  })()}

                  {currentOrder.isHighPriority && (
                    <div className="mt-4 p-4 bg-orange-50 border-2 border-orange-400 rounded-lg">
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

              <Card className="p-4 md:p-6 mb-4 md:mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">معلومات العميل</h3>
                    <div className="space-y-2 text-sm text-gray-700">
                      <p>الاسم: {getStringValue(currentOrder.orderData?.customer?.name) || 'غير متوفر'}</p>
                      <p>رقم الهاتف: {getStringValue(currentOrder.orderData?.customer?.phone) || 'غير متوفر'}</p>
                      <p>البريد الإلكتروني: {getStringValue(currentOrder.orderData?.customer?.email) || 'غير متوفر'}</p>
                      <p>المدينة: {getStringValue(currentOrder.orderData?.customer?.city) || 'غير متوفر'}</p>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">ملخص الطلب</h3>
                    <div className="space-y-2 text-sm text-gray-700">
                      <p>حالة الطلب: {currentOrder.status || 'غير معروفة'}</p>
                      <p>
                        الإجمالي:
                        <span className="font-semibold text-gray-900 mr-2">
                          {getNumberValue(currentOrder.orderData?.total)} ريال
                        </span>
                      </p>
                      <p>
                        قيمة الشحن:
                        <span className="font-semibold text-gray-900 mr-2">
                          {getNumberValue(
                            currentOrder.orderData?.shipping_amount ||
                            currentOrder.orderData?.shipping?.price
                          )} ريال
                        </span>
                      </p>
                      <p>
                        شركة الشحن:
                        <span className="font-semibold text-gray-900 mr-2">
                          {resolvedShippingCompanyName || 'غير محددة'}
                        </span>
                      </p>
                      <p>
                        عنوان الشحن:
                        <span className="font-semibold text-gray-900 mr-2">
                          {resolvedShippingAddressLabel || 'غير متوفر'}
                        </span>
                      </p>
                      {resolvedShippingLocationHint && (
                        <p className="text-xs text-gray-500">📍 {resolvedShippingLocationHint}</p>
                      )}
                      <p>تاريخ الطلب: {new Date(currentOrder.assignedAt).toLocaleString('ar-SA')}</p>
                    </div>
                  </div>
                </div>
              </Card>

              {messengerShipments.length > 0 && (
                <Card className="p-4 md:p-6 mb-4 md:mb-6 border-green-300 bg-green-50">
                  <div className="flex flex-col gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-green-900 flex items-center gap-2">
                        <span role="img" aria-label="delivery">
                          🚚
                        </span>
                        تم اكتشاف شحنة مندوب من سلة
                      </h3>
                      <p className="text-sm text-green-800 mt-1">
                        سيتم استخدام عنوان <code className="font-semibold">ship_to</code> عند إنشاء الشحنة
                        المحلية لضمان دقة بيانات التوصيل.
                      </p>
                    </div>
                    <div className="space-y-3">
                      {messengerShipments.map((entry, index) => {
                        const shipToLabel = buildShipToArabicLabel(entry.shipTo);
                        return (
                          <div
                            key={`${entry.source}-${index}`}
                            className="rounded-lg border border-green-200 bg-white/70 p-3 shadow-sm"
                          >
                            <p className="text-sm font-semibold text-green-900">
                              الشركة: {entry.courierLabel || 'مندوب التوصيل'} · المصدر: {entry.source}
                            </p>
                            {shipToLabel && (
                              <pre
                                className="mt-2 whitespace-pre-wrap rounded-md bg-green-50/80 p-2 text-sm text-green-800"
                                dir="rtl"
                              >
                                {shipToLabel}
                              </pre>
                            )}
                            {!shipToLabel && (
                              <p className="text-xs text-green-700 mt-1">لا توجد بيانات ship_to مفصلة.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Card>
              )}

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
                        <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0z" />
                        </svg>
                        <h3 className="text-lg font-bold text-amber-900">مواقع التخزين</h3>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {locationSummary.map((block) => (
                          <div key={block.key} className="rounded-xl border bg-white/70 p-3 shadow-sm">
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
                {currentOrder.orderData?.items && currentOrder.orderData.items.length > 0 ? (
                  <>
                    {currentOrder.orderData.items.map((item: any, idx: number) => {
                      const normalizedSku = normalizeSku(item?.sku);
                      const locationInfo = normalizedSku ? getLocationForSku(normalizedSku) : undefined;
                      const skuDisplay = normalizedSku || getStringValue(item?.sku);
                      const locationUpdatedAt = locationInfo?.updatedAt
                        ? new Date(locationInfo.updatedAt).toLocaleString('ar-SA')
                        : null;
                      const prepStatus = getPrepStatusForItem(item, idx);
                      const prepMeta = prepStatus ? prepStatusMeta[prepStatus] : null;

                      return (
                        <Card key={`item-${idx}`} className="p-4 md:p-6">
                          <div className="flex flex-col md:flex-row gap-4 md:gap-6">
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

                            <div className="flex-1 space-y-3">
                              <h3 className="text-2xl font-bold text-gray-900">{item.name}</h3>

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
                                      <span className={`text-sm font-semibold ${locationInfo ? 'text-amber-800' : 'text-gray-600'}`}>
                                        الموقع:
                                      </span>
                                      <span className={`text-base font-bold ${locationInfo ? 'text-amber-900' : 'text-gray-500'}`}>
                                        {locationInfo ? locationInfo.location : 'غير مسجل'}
                                      </span>
                                    </div>
                                    {locationInfo?.updatedBy && (
                                      <span className="text-xs text-gray-500">
                                        آخر تحديث بواسطة {locationInfo.updatedBy}
                                        {locationUpdatedAt ? ` في ${locationUpdatedAt}` : ''}
                                      </span>
                                    )}
                                    {locationInfo?.notes && (
                                      <span className="text-xs text-gray-600">ملاحظات: {locationInfo.notes}</span>
                                    )}
                                  </div>
                                )}
                                {prepMeta && (
                                  <div className={`inline-flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold ${prepMeta.className}`}>
                                    <span>{prepMeta.label}</span>
                                  </div>
                                )}
                              </div>

                              {item.options && Array.isArray(item.options) && item.options.length > 0 && (
                                <div className="mt-3">
                                  <h4 className="text-sm font-bold text-gray-700 mb-1">خيارات المنتج:</h4>
                                  <div className="flex flex-wrap gap-2">
                                    {item.options.map((option: any, optionIdx: number) => (
                                      <span
                                        key={`${item.sku}-option-${optionIdx}`}
                                        className="inline-flex items-center gap-2 rounded-lg bg-purple-50 px-3 py-1 text-xs font-medium text-purple-800 border border-purple-200"
                                      >
                                        <span className="font-semibold">{getStringValue(option?.name)}:</span>
                                        <span>{getStringValue(option?.value)}</span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {item.notes && (
                                <div className="flex items-start gap-2 rounded-lg bg-yellow-50 px-3 py-2">
                                  <svg className="w-4 h-4 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                  <p className="text-sm text-yellow-800">{getStringValue(item.notes)}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })}

                    {(() => {
                      const packagingAmount = getNumberValue(currentOrder.orderData?.amounts?.options_total?.amount);
                      const items = Array.isArray(currentOrder.orderData?.items) ? currentOrder.orderData.items : [];
                      const giftSkuPatterns = ['7571', '6504'];
                      const giftSkuItems = items.filter((item: any) => {
                        const sku = getStringValue(item?.sku).toUpperCase();
                        return sku && giftSkuPatterns.some((pattern) => sku.includes(pattern));
                      });
                      const hasManualGiftFlag = Boolean(currentOrder?.hasGiftFlag);
                      const shouldHighlightGiftWrap = packagingAmount > 0 || giftSkuItems.length > 0 || hasManualGiftFlag;

                      if (!shouldHighlightGiftWrap) {
                        return null;
                      }

                      const giftReasonMessage =
                        hasManualGiftFlag
                          ? currentOrder?.giftFlagReason || 'تم وضع علامة بأن هذا الطلب يحتاج تغليف هدية.'
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

              {shouldShowShipmentCard && (
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
                        {shipmentInfo.type === 'local' && shipmentInfo.assignedAgentName && (
                          <p className="text-sm text-green-800">
                            <strong>المندوب:</strong> {shipmentInfo.assignedAgentName}
                            {shipmentInfo.assignmentStatus && (
                              <span className="inline-block mr-2 rounded-full bg-green-200 px-2 py-0.5 text-xs font-semibold text-green-900">
                                {shipmentInfo.assignmentStatus}
                              </span>
                            )}
                          </p>
                        )}
                        {shipmentInfo.labelPrinted && (
                          <p className="text-sm text-green-800">
                            <strong>حالة الطباعة:</strong>{' '}
                            {shipmentInfo.printedAt
                              ? `تمت الطباعة ${new Date(shipmentInfo.printedAt).toLocaleString('ar-SA')}`
                              : 'تمت الطباعة'}
                          </p>
                        )}
                      </>
                    )}
                    {!shipmentInfo && existingShipmentLabelUrl && (
                      <p className="text-sm text-green-800">
                        تم جلب رابط البوليصة من بيانات الطلب في سلة. يمكنك عرضه أو طباعته مباشرة.
                      </p>
                    )}
                    {existingShipmentLabelUrl && (
                      <a
                        href={existingShipmentLabelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-800 underline font-medium"
                      >
                        عرض رابط البوليصة
                      </a>
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
                      بعد التأكد من الطباعة يمكنك الانتقال للطلب التالي.
                    </p>
                    {canPrintShipmentLabel && (
                      <div className="mt-3 flex flex-col sm:flex-row gap-3">
                        <Button
                          variant="outline"
                          onClick={handleSendShipmentToPrinter}
                          disabled={printingShipmentLabel}
                          className="w-full sm:w-auto"
                        >
                          {printingShipmentLabel
                            ? 'جاري إرسال البوليصة...'
                            : shipmentInfo?.labelPrinted
                              ? 'إعادة طباعة البوليصة'
                              : 'طباعة البوليصة'}
                        </Button>
                      </div>
                    )}
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

              <div className="mt-8 md:mt-10 md:sticky md:bottom-0 md:z-40 md:-mx-6 md:px-6">
                <div className="rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-white/80 md:rounded-none md:border-x-0 md:border-b-0 md:border-t md:shadow-[0_-12px_30px_rgba(15,23,42,0.12)] md:bg-white/95 md:p-5">
                  <div className="flex flex-col sm:flex-row gap-3">
                    {canPrintShipmentLabel ? (
                      <Button
                        type="button"
                        onClick={() =>
                          openConfirmationDialog({
                            title: shipmentInfo?.labelPrinted ? 'إعادة طباعة البوليصة' : 'تأكيد طباعة البوليصة',
                            message: shipmentInfo?.labelPrinted
                              ? 'سيتم إعادة إرسال البوليصة الحالية إلى الطابعة. تأكد أن الطابعة جاهزة قبل المتابعة.'
                              : 'سيتم إرسال البوليصة للطابعة الآن.',
                            confirmLabel: shipmentInfo?.labelPrinted ? 'نعم، أعد الطباعة' : 'نعم، اطبع الآن',
                            onConfirm: handleSendShipmentToPrinter,
                          })
                        }
                        disabled={printingShipmentLabel}
                        className={`${ACTION_BUTTON_BASE} bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed`}
                      >
                        {printingShipmentLabel
                          ? 'جاري إرسال البوليصة...'
                          : shipmentInfo?.labelPrinted
                            ? 'إعادة طباعة البوليصة'
                            : 'طباعة البوليصة'}
                      </Button>
                    ) : shouldShowManualPrintButton ? (
                      <div className="w-full">
                        <Button
                          type="button"
                          onClick={() =>
                            openConfirmationDialog({
                              title: 'تأكيد طباعة البوليصة',
                              message: 'تم العثور على بوليصة محفوظة لهذا الطلب وسيتم إرسالها يدوياً إلى PrintNode للطباعة.',
                              confirmLabel: 'نعم، اطبع البوليصة',
                              onConfirm: handleSendShipmentToPrinter,
                            })
                          }
                          disabled={printingShipmentLabel}
                          className={`${ACTION_BUTTON_BASE} bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed`}
                        >
                          {printingShipmentLabel ? 'جاري إرسال البوليصة...' : 'طباعة البوليصة المخزنة'}
                        </Button>
                        {existingShipmentLabelUrl && (
                          <a
                            href={existingShipmentLabelUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 block text-sm text-blue-700 underline text-center"
                          >
                            عرض رابط البوليصة المخزنة
                          </a>
                        )}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        onClick={() =>
                          openConfirmationDialog({
                            title: 'تأكيد إنشاء الشحنة',
                            message: 'سيتم إنشاء شحنة جديدة للطلب الحالي. تأكد من صحة المنتجات والوزن قبل المتابعة.',
                            confirmLabel: 'نعم، أنشئ الشحنة',
                            onConfirm: handleCreateShipment,
                          })
                        }
                        disabled={creatingShipment || !!shipmentInfo}
                        className={`${ACTION_BUTTON_BASE} bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed`}
                      >
                        {creatingShipment ? 'جاري إنشاء الشحنة...' : shipmentInfo ? '✓ تم إنشاء الشحنة' : 'انشاء شحنة'}
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() =>
                        openConfirmationDialog({
                          title: 'تأكيد إنشاء الشحنة المحلية',
                          message:
                            'سيتم إنشاء شحنة محلية جديدة، وإرسال البوليصة للطابعة، وتعيين الشحنة تلقائياً لأحد المناديب المتاحين.',
                          confirmLabel: 'نعم، أنشئ الشحنة',
                          onConfirm: () => {
                            void handleCreateLocalShipment();
                          },
                        })
                      }
                      disabled={!canCreateLocalShipment || creatingLocalShipment}
                      className={`${ACTION_BUTTON_BASE} bg-amber-500 hover:bg-amber-600 text-white disabled:bg-gray-400 disabled:cursor-not-allowed`}
                    >
                      {creatingLocalShipment ? 'جاري إنشاء الشحنة المحلية...' : 'إنشاء شحنة محلية'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => reloadCurrentOrder()}
                      className={`${ACTION_BUTTON_BASE}`}
                    >
                      تحديث معلومات الطلب
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        openConfirmationDialog({
                          title: 'تأكيد إعادة الطلب',
                          message:
                            'سيتم تغيير حالة الطلب إلى "غير متوفر (ارجاع مبلغ)" في سلة وإعادته للمتابعة. هل تريد المتابعة؟',
                          confirmLabel: 'تأكيد الإرجاع',
                          confirmVariant: 'danger',
                          onConfirm: handleReturnOrderToUnderReview,
                        })
                      }
                      disabled={!canReturnOrderToReview || returningOrder}
                      className={`${ACTION_BUTTON_BASE} border-rose-200 text-rose-900 hover:bg-rose-50 disabled:bg-gray-200 disabled:text-gray-500`}
                    >
                      {returningOrder ? 'جاري التحديث...' : 'غير متوفر (ارجاع مبلغ)'}
                    </Button>
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
    </div>
  );
}
