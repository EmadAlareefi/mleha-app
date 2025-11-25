import { sallaMakeRequest } from './salla-oauth';
import { log } from './logger';

export interface SallaCoupon {
  id: number;
  code: string;
  type: 'fixed' | 'percentage';
  amount: number;
  free_shipping: boolean;
  exclude_sale_products: boolean;
  minimum_amount?: number;
  maximum_amount?: number;
  start_date?: string;
  expiry_date?: string;
  usage_limit?: number;
  usage_limit_per_user?: number;
  active: boolean;
}

export interface CreateCouponRequest {
  code: string;
  type: 'fixed' | 'percentage';
  amount: number;
  free_shipping?: boolean;
  exclude_sale_products?: boolean;
  minimum_amount?: number;
  maximum_amount?: number;
  start_date?: string;
  expiry_date?: string;
  usage_limit?: number;
  usage_limit_per_user?: number;
  active?: boolean;
}

/**
 * Create a coupon in Salla
 */
export async function createSallaCoupon(
  merchantId: string,
  couponData: CreateCouponRequest
): Promise<{ success: boolean; coupon?: SallaCoupon; error?: string }> {
  try {
    log.info('Creating Salla coupon', { merchantId, code: couponData.code });

    const response = await sallaMakeRequest<{
      status: number;
      success: boolean;
      data: SallaCoupon;
      error?: string;
    }>(merchantId, '/coupons', {
      method: 'POST',
      body: JSON.stringify(couponData),
    });

    if (!response || !response.success) {
      log.error('Failed to create Salla coupon', { merchantId, response });

      // Check if it's a scope/permission error
      const errorMsg = response?.error || 'فشل إنشاء الكوبون';
      if (errorMsg.includes('Unauthorized') || errorMsg.includes('marketing')) {
        return {
          success: false,
          error: 'صلاحيات غير كافية. يتطلب إنشاء الكوبونات صلاحية marketing.read_write من سلة',
        };
      }

      return {
        success: false,
        error: errorMsg,
      };
    }

    log.info('Salla coupon created successfully', {
      merchantId,
      couponId: response.data.id,
      code: response.data.code,
    });

    return {
      success: true,
      coupon: response.data,
    };
  } catch (error) {
    log.error('Error creating Salla coupon', {
      error,
      merchantId,
      code: couponData.code,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'خطأ غير متوقع',
    };
  }
}

/**
 * Get a coupon by ID
 */
export async function getSallaCoupon(
  merchantId: string,
  couponId: string
): Promise<SallaCoupon | null> {
  try {
    const response = await sallaMakeRequest<{
      status: number;
      success: boolean;
      data: SallaCoupon;
    }>(merchantId, `/coupons/${couponId}`);

    if (!response || !response.success) {
      log.error('Failed to fetch Salla coupon', { merchantId, couponId });
      return null;
    }

    return response.data;
  } catch (error) {
    log.error('Error fetching Salla coupon', { error, merchantId, couponId });
    return null;
  }
}

/**
 * Delete a coupon
 */
export async function deleteSallaCoupon(
  merchantId: string,
  couponId: string
): Promise<boolean> {
  try {
    log.info('Deleting Salla coupon', { merchantId, couponId });

    const response = await sallaMakeRequest<{
      status: number;
      success: boolean;
    }>(merchantId, `/coupons/${couponId}`, {
      method: 'DELETE',
    });

    if (!response || !response.success) {
      log.error('Failed to delete Salla coupon', { merchantId, couponId });
      return false;
    }

    log.info('Salla coupon deleted successfully', { merchantId, couponId });
    return true;
  } catch (error) {
    log.error('Error deleting Salla coupon', { error, merchantId, couponId });
    return false;
  }
}

/**
 * Generate a unique coupon code
 */
export function generateCouponCode(prefix: string = 'EXCHANGE'): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}
