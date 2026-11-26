import { prisma } from '@/lib/prisma';
import { ajexCallbackIdsFor, ajexTrackingHistory, type AjexTrackingEvent } from '@/app/lib/ajex-tracking';

/**
 * AJEX has no scan table like SMSA's SmsaWebhookShipment: every verified
 * callback is kept in WebhookLog (`event = 'ajex.tracking'`, indexed on the
 * waybill by WebhookLog_ajex_trackingId_idx). This rebuilds the movement
 * history per requested tracking number (piece barcodes included). Only
 * tracking fields are read; POD urls and other payload extras are not.
 */
export async function loadAjexTrackingHistory(trackingNumbers: string[]): Promise<Map<string, AjexTrackingEvent[]>> {
  const idsByTracking = new Map(trackingNumbers.map((tn) => [tn, new Set(ajexCallbackIdsFor(tn))]));
  const ids = [...new Set([...idsByTracking.values()].flatMap((set) => [...set]))].filter((id) => id.startsWith('AJ'));
  const result = new Map<string, AjexTrackingEvent[]>();
  if (ids.length === 0) return result;

  const rows = await prisma.$queryRaw<{ json: unknown }[]>`
    SELECT jsonb_build_object(
             'trackingId', w.json->'trackingId', 'statusCode', w.json->'statusCode', 'status', w.json->'status',
             'eventTime', w.json->'eventTime', 'timezone', w.json->'timezone', 'location', w.json->'location',
             'failureReason', w.json->'failureReason', 'referenceId', w.json->'referenceId'
           ) AS json
    FROM "WebhookLog" w
    WHERE w.event = 'ajex.tracking' AND w.json->>'trackingId' = ANY(${ids})
    LIMIT 1000`;
  const history = ajexTrackingHistory(rows.map((row) => row.json));
  for (const [trackingNumber, wanted] of idsByTracking) {
    const events = history.filter((event) => wanted.has(event.trackingId.toUpperCase()));
    if (events.length > 0) result.set(trackingNumber, events);
  }
  return result;
}
