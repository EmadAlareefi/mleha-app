import { sallaMakeRequest } from './salla-oauth';
import { log } from './logger';

// Salla API Types
export interface SallaOrder {
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
  date: {
    created: string;
    updated: string;
  };
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    mobile: string;
    email: string;
  };
  items: SallaOrderItem[];
  shipping?: {
    pickup_address?: any;
    company?: string;
    tracking_number?: string;
  };
}

export interface SallaOrderItem {
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

export interface SallaOrdersResponse {
  status: number;
  success: boolean;
  data: SallaOrder[];
  pagination?: {
    count: number;
    total: number;
    per_page: number;
    current_page: number;
    total_pages: number;
  };
}

export interface SallaSingleOrderResponse {
  status: number;
  success: boolean;
  data: SallaOrder;
}

/**
 * Fetches a specific order by ID from Salla
 */
export async function getSallaOrder(
  merchantId: string,
  orderId: string
): Promise<SallaOrder | null> {
  try {
    const response = await sallaMakeRequest<SallaSingleOrderResponse>(
      merchantId,
      `/v2/orders/${orderId}`
    );

    if (!response || !response.success) {
      log.error('Failed to fetch Salla order', { merchantId, orderId, response });
      return null;
    }

    return response.data;
  } catch (error) {
    log.error('Error fetching Salla order', { merchantId, orderId, error });
    return null;
  }
}

/**
 * Fetches a specific order by reference ID (order number) from Salla
 */
export async function getSallaOrderByReference(
  merchantId: string,
  referenceId: string
): Promise<SallaOrder | null> {
  try {
    // Salla API supports filtering by reference_id
    const response = await sallaMakeRequest<SallaOrdersResponse>(
      merchantId,
      `/v2/orders?reference_id=${encodeURIComponent(referenceId)}`
    );

    if (!response || !response.success || !response.data || response.data.length === 0) {
      log.warn('Order not found by reference', { merchantId, referenceId });
      return null;
    }

    return response.data[0];
  } catch (error) {
    log.error('Error fetching Salla order by reference', { merchantId, referenceId, error });
    return null;
  }
}

/**
 * Fetches recent orders for a specific customer
 */
export async function getCustomerOrders(
  merchantId: string,
  customerId: string,
  limit: number = 10
): Promise<SallaOrder[]> {
  try {
    const response = await sallaMakeRequest<SallaOrdersResponse>(
      merchantId,
      `/v2/orders?customer=${customerId}&per_page=${limit}&sort_by=created&sort=desc`
    );

    if (!response || !response.success) {
      log.error('Failed to fetch customer orders', { merchantId, customerId });
      return [];
    }

    return response.data || [];
  } catch (error) {
    log.error('Error fetching customer orders', { merchantId, customerId, error });
    return [];
  }
}

/**
 * Fetches orders by customer email or phone
 */
export async function findOrdersByCustomerContact(
  merchantId: string,
  emailOrPhone: string
): Promise<SallaOrder[]> {
  try {
    // Try searching by email first
    let response = await sallaMakeRequest<SallaOrdersResponse>(
      merchantId,
      `/v2/orders?email=${encodeURIComponent(emailOrPhone)}&per_page=20&sort_by=created&sort=desc`
    );

    if (response && response.success && response.data && response.data.length > 0) {
      return response.data;
    }

    // Try searching by phone if email didn't work
    response = await sallaMakeRequest<SallaOrdersResponse>(
      merchantId,
      `/v2/orders?mobile=${encodeURIComponent(emailOrPhone)}&per_page=20&sort_by=created&sort=desc`
    );

    if (response && response.success) {
      return response.data || [];
    }

    return [];
  } catch (error) {
    log.error('Error finding orders by contact', { merchantId, emailOrPhone, error });
    return [];
  }
}

/**
 * Validates if an order can be returned/exchanged
 * Returns true if the order is in a returnable state
 */
export function isOrderReturnable(order: SallaOrder): boolean {
  const returnableStatuses = ['delivered', 'completed'];
  const orderStatus = order.status.slug.toLowerCase();

  return returnableStatuses.includes(orderStatus);
}

/**
 * Calculates the maximum returnable quantity for an order item
 */
export function getMaxReturnableQuantity(item: SallaOrderItem): number {
  // In a real implementation, you might want to check for already returned quantities
  return item.quantity;
}
