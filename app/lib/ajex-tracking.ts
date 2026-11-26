import type { AjexLiveStatus } from '@/types/ajex';
import { isAjexDeliveredCode, resolveAjexStatusLabel } from '@/lib/ajex-status';

export interface AjexTrackingEvent {
  trackingId: string;
  referenceId: string | null;
  eventAt: Date;
  status: AjexLiveStatus;
}

const SECONDS_TO_MS_THRESHOLD = 1e12;

const stringOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const pickCity = (location: unknown): string | null => {
  if (typeof location === 'string') {
    return stringOrNull(location);
  }
  if (location && typeof location === 'object') {
    const candidate = location as Record<string, unknown>;
    return stringOrNull(candidate.city) || stringOrNull(candidate.name) || stringOrNull(candidate.hub);
  }
  return null;
};

const pickPodUrls = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }
  const urls = value.map(stringOrNull).filter((url): url is string => Boolean(url));
  return urls.length > 0 ? urls : null;
};

/** Converts an AJEX callback payload into the status we store on a shipment. */
export const normalizeAjexTrackingEvent = (payload: Record<string, unknown>): AjexTrackingEvent | null => {
  const trackingId = stringOrNull(payload.trackingId);
  if (!trackingId) {
    return null;
  }

  const rawEventTime = typeof payload.eventTime === 'number' ? payload.eventTime : null;
  if (rawEventTime === null) {
    return null;
  }
  const eventAt = new Date(rawEventTime < SECONDS_TO_MS_THRESHOLD ? rawEventTime * 1000 : rawEventTime);
  if (Number.isNaN(eventAt.getTime())) {
    return null;
  }

  const statusCode = typeof payload.statusCode === 'number' ? payload.statusCode : null;
  const description = stringOrNull(payload.status);
  const referenceId = stringOrNull(payload.referenceId) || stringOrNull(payload.referenceNumber);

  return {
    trackingId,
    referenceId,
    eventAt,
    status: {
      trackingId,
      reference: referenceId,
      code: statusCode === null ? null : String(statusCode),
      description: description || resolveAjexStatusLabel(statusCode),
      city: pickCity(payload.location),
      timestamp: eventAt.toISOString(),
      timezone: stringOrNull(payload.timezone),
      failureReason: stringOrNull(payload.failureReason),
      podUrls: pickPodUrls(payload.podUrls),
      delivered: isAjexDeliveredCode(statusCode),
      source: 'webhook',
    },
  };
};

/**
 * Warehouse scans carry the AJEX piece barcode (`AJA…001`) while callbacks report
 * the shipment id (`AJA…`), so tracking numbers are matched by prefix.
 */
export const ajexShipmentMatchFilter = (trackingId: string) => ({
  trackingNumber: {
    startsWith: trackingId,
    mode: 'insensitive' as const,
  },
});

/**
 * Callback `trackingId`s a stored tracking number can match: the shipment id
 * itself, plus the shipment id behind a piece barcode (`AJA…001` → `AJA…`).
 */
export const ajexCallbackIdsFor = (trackingNumber: string): string[] => {
  const value = trackingNumber.trim().toUpperCase();
  if (!value) return [];
  const piece = /^(AJ[A-Z]?\d{12})\d{3}$/.exec(value);
  return piece ? [value, piece[1]] : [value];
};

/**
 * Turns stored AJEX callback payloads into a de-duplicated, time-ordered
 * movement history (AJEX retries callbacks, so the same event can arrive twice).
 */
export const ajexTrackingHistory = (payloads: unknown[]): AjexTrackingEvent[] => {
  const seen = new Map<string, AjexTrackingEvent>();
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const event = normalizeAjexTrackingEvent(payload as Record<string, unknown>);
    if (!event) continue;
    const key = `${event.trackingId.toUpperCase()}|${event.status.code ?? ''}|${event.eventAt.getTime()}`;
    if (!seen.has(key)) seen.set(key, event);
  }
  return [...seen.values()].sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime());
};
