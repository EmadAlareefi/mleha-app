import type { AjexLiveStatus } from '@/types/ajex';
import type { SmsaLiveStatus } from '@/types/smsa';
import { resolveMajorAjexStatus } from '@/lib/ajex-status';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';

export type LiveStatusCarrier = 'smsa' | 'ajex';

export interface ShipmentLiveStatusSource {
  company?: string | null;
  smsaLiveStatus?: SmsaLiveStatus | null;
  ajexLiveStatus?: AjexLiveStatus | null;
}

export interface ShipmentLiveStatusView {
  carrier: LiveStatusCarrier;
  carrierLabel: string;
  label: string | null;
  detail: string | null;
  city: string | null;
  timestamp: string | null;
  delivered: boolean | null;
}

const CARRIER_LABELS: Record<LiveStatusCarrier, string> = {
  smsa: 'سمسا',
  ajex: 'ايجكس',
};

/**
 * Picks the tracking feed that belongs to a scanned shipment and normalizes it,
 * so the warehouse table and details dialog render SMSA and AJEX the same way.
 */
export const resolveShipmentLiveStatus = (
  shipment: ShipmentLiveStatusSource | null | undefined
): ShipmentLiveStatusView | null => {
  if (!shipment) {
    return null;
  }

  const smsa = shipment.smsaLiveStatus || null;
  const ajex = shipment.ajexLiveStatus || null;
  const company = shipment.company?.trim().toLowerCase() || null;

  const preferAjex = ajex && (company === 'ajex' || !smsa);
  if (preferAjex) {
    const label = resolveMajorAjexStatus(ajex);
    const failureReason = ajex!.failureReason?.trim() || null;

    return {
      carrier: 'ajex',
      carrierLabel: CARRIER_LABELS.ajex,
      label: label || ajex!.code || null,
      // The carrier wording only adds information when it explains a failure.
      detail: failureReason && failureReason !== label ? failureReason : null,
      city: ajex!.city?.trim() || null,
      timestamp: ajex!.timestamp || null,
      delivered: typeof ajex!.delivered === 'boolean' ? ajex!.delivered : null,
    };
  }

  if (smsa) {
    const label = resolveMajorSmsaStatus(smsa);

    return {
      carrier: 'smsa',
      carrierLabel: CARRIER_LABELS.smsa,
      label: label || smsa.description?.trim() || smsa.code || null,
      detail: null,
      city: smsa.city?.trim() || null,
      timestamp: smsa.timestamp || null,
      delivered: typeof smsa.delivered === 'boolean' ? smsa.delivered : null,
    };
  }

  return null;
};

/**
 * Return requests keep one `smsaLiveStatus` column for every carrier: AJEX
 * callbacks land there too. AJEX entries carry `trackingId` (SMSA ones `awb`),
 * so the payload itself says which classification to read it with.
 */
export const resolveReturnLiveStatus = (
  live: SmsaLiveStatus | AjexLiveStatus | null | undefined,
  carrierId?: string | null
): ShipmentLiveStatusView | null => {
  if (!live) return null;
  const isAjex = carrierId === 'ajex' || ('trackingId' in live && !('awb' in live && live.awb));
  return resolveShipmentLiveStatus(
    isAjex
      ? { company: 'ajex', ajexLiveStatus: live as AjexLiveStatus }
      : { company: 'smsa', smsaLiveStatus: live as SmsaLiveStatus }
  );
};
