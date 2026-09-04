import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { fetchSallaOrderShipments } from '@/app/lib/salla-api';
import { extractTrackingFromShipment } from '@/app/lib/salla-shipment';
import {
  extractReturnLabelPayload,
  maybeNotifyReturnLabelCreated,
  type ReturnLabelNotificationResult,
} from '@/app/lib/returns/return-label-notification';

type AnyRecord = Record<string, any>;

/**
 * How long Salla is given to actually produce the waybill before a request is
 * called stuck. Healthy orders get tracking + label within seconds.
 */
export const RETURN_LABEL_GRACE_MS = 30 * 60 * 1000;

export type ReturnShipmentSyncStatus =
  /** Label found and the WhatsApp send was attempted on this pass. */
  | 'notified'
  /** Label found, but the customer had already been messaged. */
  | 'already_notified'
  /** Tracking number captured; Salla has not published a label yet. */
  | 'tracking_only'
  /** Salla is still working and is inside the grace window. */
  | 'pending'
  /** Salla accepted the request but never produced a waybill. Needs a re-issue. */
  | 'stuck'
  | 'error';

export interface ReturnShipmentSyncResult {
  returnRequestId: string;
  orderNumber: string | null;
  status: ReturnShipmentSyncStatus;
  trackingNumber: string | null;
  labelUrl: string | null;
  notification?: ReturnLabelNotificationResult;
  error?: string;
}

export interface SyncableReturnRequest {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  createdAt: Date;
  smsaTrackingNumber: string | null;
  returnLabelUrl?: string | null;
  returnLabelNotificationSentAt: Date | null;
}

const isReturnShipment = (shipment: AnyRecord) =>
  String(shipment?.type || '').toLowerCase() === 'return';

const getLabelUrl = (shipment: AnyRecord | null) =>
  shipment ? extractReturnLabelPayload(shipment).labelUrl : null;

/**
 * Pulls the return shipment for one request straight from Salla, persists
 * whatever it has produced, and sends the waybill on WhatsApp once a label
 * exists.
 *
 * The app never creates the return waybill itself — it asks Salla to
 * (`create_return_policy`) and Salla fulfils that asynchronously. Before this,
 * the only thing that could deliver the label was a `shipment.created` webhook
 * that happened to carry a `label.url`; when that webhook didn't arrive, or
 * arrived without a label, the customer was simply never told. This is the
 * pull-side counterpart, safe to call repeatedly.
 */
export async function syncReturnShipment(
  request: SyncableReturnRequest,
  options: { source?: string; dryRun?: boolean } = {}
): Promise<ReturnShipmentSyncResult> {
  const source = options.source || 'return-shipment-sync';
  const base = {
    returnRequestId: request.id,
    orderNumber: request.orderNumber,
    trackingNumber: request.smsaTrackingNumber,
    labelUrl: request.returnLabelUrl ?? null,
  };

  // The label is already known and only the send failed (a Zoko outage, a bad
  // number). Retry the message without paying for another Salla round-trip —
  // otherwise the backfill would re-fetch the same shipment every ten minutes
  // for as long as the request stays in the window.
  if (request.returnLabelUrl && !request.returnLabelNotificationSentAt && !options.dryRun) {
    const notification = await maybeNotifyReturnLabelCreated({
      merchantId: request.merchantId,
      orderId: request.orderId,
      orderNumber: request.orderNumber,
      returnRequestId: request.id,
      labelUrl: request.returnLabelUrl,
      trackingNumber: request.smsaTrackingNumber,
      source,
    });

    return { ...base, status: 'notified', notification };
  }

  // A failed fetch must not read as "Salla never issued a waybill" — that would
  // send agents chasing re-issues for what is really an API problem.
  const fetched = await fetchSallaOrderShipments(request.merchantId, String(request.orderId));

  if (!fetched.ok) {
    log.warn('Failed to fetch return shipments from Salla', {
      returnRequestId: request.id,
      orderId: request.orderId,
      error: fetched.error,
    });
    return { ...base, status: 'error', error: fetched.error };
  }

  const returnShipments = (fetched.shipments as AnyRecord[]).filter(isReturnShipment);
  // Prefer a shipment that already carries a label, then one with tracking.
  const shipment =
    returnShipments.find((candidate) => getLabelUrl(candidate)) ||
    returnShipments.find((candidate) => extractTrackingFromShipment(candidate)) ||
    returnShipments[0] ||
    null;

  const trackingNumber = shipment ? extractTrackingFromShipment(shipment) : null;
  const labelUrl = getLabelUrl(shipment);
  const overdue = Date.now() - request.createdAt.getTime() > RETURN_LABEL_GRACE_MS;

  if (!trackingNumber && !labelUrl) {
    return {
      ...base,
      status: overdue ? 'stuck' : 'pending',
    };
  }

  if (options.dryRun) {
    return {
      ...base,
      trackingNumber: trackingNumber ?? base.trackingNumber,
      labelUrl: labelUrl ?? base.labelUrl,
      status: labelUrl
        ? request.returnLabelNotificationSentAt
          ? 'already_notified'
          : 'notified'
        : 'tracking_only',
    };
  }

  if (trackingNumber && !request.smsaTrackingNumber) {
    try {
      await prisma.returnRequest.update({
        where: { id: request.id },
        data: { smsaTrackingNumber: trackingNumber, smsaAwbNumber: trackingNumber },
      });
    } catch (error) {
      // smsaTrackingNumber is unique; a conflict means another row already owns
      // it, which is worth knowing but must not stop the label from being sent.
      log.warn('Failed to persist return tracking number', {
        returnRequestId: request.id,
        trackingNumber,
        error,
      });
    }
  }

  if (!labelUrl) {
    return { ...base, trackingNumber, status: 'tracking_only' };
  }

  // Store the label before notifying: the notification can still skip (an
  // already-messaged customer, a missing phone) and the admin UI needs the link
  // regardless of whether a message went out.
  if (!request.returnLabelUrl) {
    await prisma.returnRequest.update({
      where: { id: request.id },
      data: { returnLabelUrl: labelUrl },
    });
  }

  const notification = await maybeNotifyReturnLabelCreated({
    merchantId: request.merchantId,
    orderId: request.orderId,
    orderNumber: request.orderNumber,
    returnRequestId: request.id,
    labelUrl,
    trackingNumber,
    shipmentData: shipment,
    source,
  });

  return {
    ...base,
    trackingNumber,
    labelUrl,
    status: notification.reason === 'already_sent' ? 'already_notified' : 'notified',
    notification,
  };
}
