import { log } from './logger';

export interface SallaOrderStatus {
  id: number;
  name: string;
  type: 'original' | 'custom';
  slug: string;
  sort: number;
  message: string;
  icon: string;
  is_active: boolean;
  parent: {
    id: number;
    name: string;
  } | null;
  original: {
    id: number;
    name: string;
  } | null;
}

interface SallaStatusesResponse {
  status: number;
  success: boolean;
  data: SallaOrderStatus[];
}

/**
 * Fetch all order statuses from Salla
 */
export async function getSallaOrderStatuses(
  merchantId: string
): Promise<SallaOrderStatus[]> {
  try {
    const { getSallaAccessToken } = await import('./salla-oauth');
    const accessToken = await getSallaAccessToken(merchantId);

    if (!accessToken) {
      log.error('No valid Salla access token for fetching statuses');
      return getDefaultStatuses();
    }

    const baseUrl = 'https://api.salla.dev/admin/v2';
    const response = await fetch(`${baseUrl}/orders/statuses`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error('Failed to fetch order statuses from Salla', {
        status: response.status,
        error: errorText,
      });
      return getDefaultStatuses();
    }

    const data: SallaStatusesResponse = await response.json();

    if (data.success && Array.isArray(data.data)) {
      log.info('Successfully fetched order statuses', { count: data.data.length });
      return data.data;
    }

    return getDefaultStatuses();
  } catch (error) {
    log.error('Error fetching order statuses', { error });
    return getDefaultStatuses();
  }
}

/**
 * Get status by slug
 */
export function getStatusBySlug(
  statuses: SallaOrderStatus[],
  slug: string
): SallaOrderStatus | null {
  return statuses.find(s => s.slug === slug) || null;
}

/**
 * Get active statuses only
 */
export function getActiveStatuses(statuses: SallaOrderStatus[]): SallaOrderStatus[] {
  return statuses.filter(s => s.is_active);
}

/**
 * Get status name by slug (with fallback)
 */
export function getStatusName(
  statuses: SallaOrderStatus[],
  slug: string
): string {
  const status = getStatusBySlug(statuses, slug);
  if (status) return status.name;

  // Fallback to default names
  const defaultNames: Record<string, string> = {
    'payment_pending': 'في انتظار الدفع',
    'under_review': 'تحت المراجعة',
    'in_progress': 'قيد التنفيذ',
    'processing': 'جاري التجهيز',
    'completed': 'تم التنفيذ',
    'ready_for_pickup': 'جاهز للاستلام',
    'delivering': 'جاري التوصيل',
    'delivered': 'تم التوصيل',
    'shipped': 'تم الشحن',
    'canceled': 'ملغي',
    'restored': 'مسترجع',
    'restoring': 'قيد الإسترجاع',
  };

  return defaultNames[slug] || slug;
}

/**
 * Default statuses as fallback
 */
function getDefaultStatuses(): SallaOrderStatus[] {
  return [
    {
      id: 1473353380,
      name: 'بإنتظار الدفع',
      type: 'original',
      slug: 'payment_pending',
      sort: 0,
      message: '',
      icon: 'sicon-wallet',
      is_active: true,
      parent: null,
      original: null,
    },
    {
      id: 566146469,
      name: 'تحت المراجعة',
      type: 'original',
      slug: 'under_review',
      sort: 1,
      message: '',
      icon: 'sicon-eye',
      is_active: true,
      parent: null,
      original: null,
    },
    {
      id: 1939592358,
      name: 'قيد التنفيذ',
      type: 'original',
      slug: 'in_progress',
      sort: 2,
      message: '',
      icon: 'sicon-box',
      is_active: true,
      parent: null,
      original: null,
    },
    {
      id: 1298199463,
      name: 'تم التنفيذ',
      type: 'original',
      slug: 'completed',
      sort: 3,
      message: '',
      icon: 'sicon-check',
      is_active: true,
      parent: null,
      original: null,
    },
    {
      id: 349994915,
      name: 'جاري التوصيل',
      type: 'original',
      slug: 'delivering',
      sort: 4,
      message: '',
      icon: 'sicon-truck',
      is_active: true,
      parent: null,
      original: null,
    },
    {
      id: 1723506348,
      name: 'تم التوصيل',
      type: 'original',
      slug: 'delivered',
      sort: 5,
      message: '',
      icon: 'sicon-check-circle',
      is_active: true,
      parent: null,
      original: null,
    },
    {
      id: 814202285,
      name: 'تم الشحن',
      type: 'original',
      slug: 'shipped',
      sort: 6,
      message: '',
      icon: 'sicon-plane',
      is_active: true,
      parent: null,
      original: null,
    },
    {
      id: 525144736,
      name: 'ملغي',
      type: 'original',
      slug: 'canceled',
      sort: 7,
      message: '',
      icon: 'sicon-cancel',
      is_active: true,
      parent: null,
      original: null,
    },
    {
      id: 989286562,
      name: 'مسترجع',
      type: 'original',
      slug: 'restored',
      sort: 8,
      message: '',
      icon: 'sicon-retweet',
      is_active: true,
      parent: null,
      original: null,
    },
    {
      id: 1548352431,
      name: 'قيد الإسترجاع',
      type: 'original',
      slug: 'restoring',
      sort: 9,
      message: '',
      icon: 'sicon-retweet',
      is_active: true,
      parent: null,
      original: null,
    },
  ];
}
