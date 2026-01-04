import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

interface UpdateStatusOptions {
  statusId?: string | number | null;
  slug?: string | null;
}

const SALLA_API_BASE = 'https://api.salla.dev/admin/v2';

export async function updateSallaOrderStatus(
  merchantId: string,
  orderId: string,
  options: UpdateStatusOptions
): Promise<{ success: boolean; error?: string }> {
  if (!merchantId || !orderId) {
    return { success: false, error: 'missing_ids' };
  }

  if (!options.statusId && !options.slug) {
    return { success: false, error: 'missing_status' };
  }

  try {
    const accessToken = await getSallaAccessToken(merchantId);
    if (!accessToken) {
      log.warn('Cannot update Salla status without access token', { merchantId, orderId });
      return { success: false, error: 'missing_token' };
    }

    const url = `${SALLA_API_BASE}/orders/${orderId}/status`;
    let payload: Record<string, unknown>;
    if (options.statusId !== undefined && options.statusId !== null) {
      const numericStatusId =
        typeof options.statusId === 'string'
          ? Number.parseInt(options.statusId, 10)
          : options.statusId;

      if (typeof numericStatusId !== 'number' || Number.isNaN(numericStatusId)) {
        return { success: false, error: 'invalid_status_id' };
      }

      payload = { status_id: numericStatusId };
    } else {
      payload = { slug: options.slug };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      log.warn('Failed to update Salla order status', {
        merchantId,
        orderId,
        payload,
        responseStatus: response.status,
        errorText,
      });
      return { success: false, error: errorText || `status_${response.status}` };
    }

    log.info('Salla order status updated', {
      merchantId,
      orderId,
      payload,
    });
    return { success: true };
  } catch (error) {
    log.error('Error updating Salla order status', {
      merchantId,
      orderId,
      error,
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'unknown_error',
    };
  }
}
