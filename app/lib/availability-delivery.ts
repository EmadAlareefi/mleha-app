export type AvailabilityDeliveryUpdate = {
  deliveryStatus: string;
  deliveredAt?: Date | null;
  deliveryFailedAt?: Date | null;
  notifyError?: string | null;
};

/**
 * Convert provider-specific delivery labels into the fields stored on an
 * availability request. "read" is proof of delivery as well as engagement.
 */
export function buildAvailabilityDeliveryUpdate(
  rawStatus: string | null | undefined,
  eventAt = new Date()
): AvailabilityDeliveryUpdate | null {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (!status) {
    return null;
  }

  if (status === 'delivered' || status === 'read') {
    return {
      deliveryStatus: status,
      deliveredAt: eventAt,
      deliveryFailedAt: null,
      notifyError: null,
    };
  }

  if (['failed', 'undelivered', 'rejected', 'expired'].includes(status)) {
    return {
      deliveryStatus: 'failed',
      deliveryFailedAt: eventAt,
      notifyError: `Zoko delivery ${status}`,
    };
  }

  return { deliveryStatus: status };
}
