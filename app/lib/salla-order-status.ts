import { getSallaAccessToken } from '@/app/lib/salla-oauth';
import { log } from '@/app/lib/logger';

interface UpdateStatusOptions {
  statusId?: string | number | null;
  slug?: string | null;
  subStatusId?: string | number | null;
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
      if (options.subStatusId !== undefined && options.subStatusId !== null) {
        const numericSubStatusId =
          typeof options.subStatusId === 'string'
            ? Number.parseInt(options.subStatusId, 10)
            : options.subStatusId;
        if (
          typeof numericSubStatusId !== 'number' ||
          Number.isNaN(numericSubStatusId)
        ) {
          return { success: false, error: 'invalid_sub_status_id' };
        }
        payload.sub_status_id = numericSubStatusId;
      }
    } else {
      payload = { slug: options.slug };
    }

    const response = await fetch(url, {
      method: 'PUT',
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

export async function createSallaOrderHistoryEntry(
  merchantId: string,
  orderId: string,
  comment: string
): Promise<{ success: boolean; error?: string }> {
  const trimmedComment = typeof comment === 'string' ? comment.trim() : '';
  if (!merchantId || !orderId || !trimmedComment) {
    return { success: false, error: 'missing_history_comment' };
  }

  try {
    const accessToken = await getSallaAccessToken(merchantId);
    if (!accessToken) {
      log.warn('Cannot add Salla history entry without access token', { merchantId, orderId });
      return { success: false, error: 'missing_token' };
    }

    const url = `${SALLA_API_BASE}/orders/history`;
    const numericOrderId =
      typeof orderId === 'string' && /^\d+$/.test(orderId) ? Number.parseInt(orderId, 10) : null;
    const payload = {
      order_id: numericOrderId ?? orderId,
      comment: trimmedComment,
      notify_customer: false,
    };

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
      log.warn('Failed to add Salla order history entry', {
        merchantId,
        orderId,
        responseStatus: response.status,
        errorText,
      });
      return { success: false, error: errorText || `history_${response.status}` };
    }

    log.info('Salla order history entry created', { merchantId, orderId });
    return { success: true };
  } catch (error) {
    log.error('Error creating Salla order history entry', {
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
