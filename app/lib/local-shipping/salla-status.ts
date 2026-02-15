import { log } from '@/app/lib/logger';
import { updateSallaOrderStatus } from '@/app/lib/salla-order-status';

interface MarkSallaOrderCompletedOptions {
  merchantId: string;
  orderId: string;
  shipmentId?: string | null;
  orderNumber?: string;
  trackingNumber?: string;
  action?: string;
}

export async function markSallaOrderCompletedAfterLocalShipment(
  options: MarkSallaOrderCompletedOptions
): Promise<{ success: boolean; error?: string }> {
  const {
    merchantId,
    orderId,
    shipmentId = null,
    orderNumber,
    trackingNumber,
    action = 'local-shipping',
  } = options;

  if (!merchantId || !orderId) {
    log.warn('Cannot update Salla status after local shipment due to missing identifiers', {
      merchantId,
      orderId,
      shipmentId,
      action,
    });
    return { success: false, error: 'missing_ids' };
  }

  const logContext = {
    merchantId,
    orderId,
    shipmentId,
    orderNumber,
    trackingNumber,
    action,
  };

  try {
    const result = await updateSallaOrderStatus(merchantId, orderId, { slug: 'completed' });
    if (result.success) {
      log.info('Salla order status set to completed after local shipment action', logContext);
    } else {
      log.warn('Failed to set Salla order status to completed after local shipment action', {
        ...logContext,
        error: result.error,
      });
    }
    return result;
  } catch (error) {
    log.error('Unexpected error while updating Salla status after local shipment action', {
      ...logContext,
      error: error instanceof Error ? error.message : error,
    });
    return { success: false, error: error instanceof Error ? error.message : 'unknown_error' };
  }
}
