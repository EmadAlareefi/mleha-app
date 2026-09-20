import type { Prisma } from '@prisma/client';
import { ajexShipmentMatchFilter, type AjexTrackingEvent } from '@/app/lib/ajex-tracking';

export interface ShipmentTrackingWriter {
  shipment: {
    updateMany: (args: {
      where: Prisma.ShipmentWhereInput;
      data: Prisma.ShipmentUpdateManyMutationInput;
    }) => Promise<{ count: number }>;
  };
}

/**
 * Links an AJEX callback to the scanned warehouse shipments (incoming and outgoing)
 * that carry the same waybill. Stale callbacks are ignored so retries and
 * out-of-order deliveries cannot overwrite a newer status.
 */
export const applyAjexTrackingToShipments = async (
  client: ShipmentTrackingWriter,
  event: AjexTrackingEvent
): Promise<number> => {
  const { count } = await client.shipment.updateMany({
    where: {
      ...ajexShipmentMatchFilter(event.trackingId),
      OR: [{ ajexLiveStatusEventAt: null }, { ajexLiveStatusEventAt: { lte: event.eventAt } }],
    },
    data: {
      ajexLiveStatus: event.status as unknown as Prisma.InputJsonValue,
      ajexLiveStatusUpdatedAt: new Date(),
      ajexLiveStatusEventAt: event.eventAt,
    },
  });

  return count;
};
