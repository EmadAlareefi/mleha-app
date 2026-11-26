import { prisma } from '@/lib/prisma';
import { loadAjexTrackingHistory } from '@/app/lib/ajex-tracking-store';
import { resolveAjexStatusLabel } from '@/lib/ajex-status';
import { resolveMajorSmsaStatus } from '@/lib/smsa-status';
import { smsaScanKey } from '@/app/lib/smsa-webhook-payload';

export type MovementCarrier = 'smsa' | 'ajex';

/** One carrier tracking event, the same shape for SMSA and AJEX. */
export interface CarrierMovement {
  trackingNumber: string;
  carrier: MovementCarrier;
  code: string | null;
  /** Arabic label from the shared SMSA/AJEX classification. */
  label: string | null;
  /** The carrier's own wording. */
  description: string | null;
  /** Why a pickup/delivery failed (AJEX only). */
  failureReason: string | null;
  city: string | null;
  /** ISO time, or null when the carrier sent something unparseable. */
  at: string | null;
  /** The raw carrier time, kept only when it could not be parsed. */
  atRaw: string | null;
  timezone: string | null;
}

const MAX_EVENTS_PER_SHIPMENT = 100;

/**
 * SMSA sends a local wall-clock time (`2026-11-26T15:40:00`) with the offset in
 * a separate field (`+03:00`); joining them gives the real instant.
 */
export function smsaScanTime(dateTime: string | null | undefined, timeZone: string | null | undefined): Date | null {
  const raw = dateTime?.trim();
  if (!raw) return null;
  const base = /^\d{4}-\d{2}-\d{2} /.test(raw) ? raw.replace(' ', 'T') : raw;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(base);
  const offset = /^[+-]\d{2}:\d{2}$/.test(timeZone?.trim() ?? '') ? timeZone!.trim() : null;
  const parsed = new Date(!hasOffset && offset && /T\d{2}:\d{2}/.test(base) ? `${base}${offset}` : base);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const byTime = (a: CarrierMovement, b: CarrierMovement) => (a.at ?? '').localeCompare(b.at ?? '');

async function loadSmsaMovements(trackingNumbers: string[]): Promise<CarrierMovement[]> {
  const shipments = await prisma.smsaWebhookShipment.findMany({
    where: { awb: { in: trackingNumbers } },
    select: {
      awb: true,
      // receivedBy (a person's name) is deliberately not selected.
      scans: {
        select: { scanType: true, scanDescription: true, city: true, scanDateTime: true, scanTimeZone: true },
        take: 200,
      },
    },
  });
  return shipments.flatMap((shipment) => {
    // Concurrent webhook posts can both store the same scan.
    const seen = new Set<string>();
    return shipment.scans
      .filter((scan) => {
        const key = smsaScanKey(scan);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((scan): CarrierMovement => {
        const at = smsaScanTime(scan.scanDateTime, scan.scanTimeZone);
        return {
          trackingNumber: shipment.awb,
          carrier: 'smsa',
          code: scan.scanType,
          label: resolveMajorSmsaStatus({ code: scan.scanType, description: scan.scanDescription }),
          description: scan.scanDescription,
          failureReason: null,
          city: scan.city,
          at: at?.toISOString() ?? null,
          atRaw: at ? null : scan.scanDateTime,
          timezone: scan.scanTimeZone,
        };
      })
      .sort(byTime)
      .slice(-MAX_EVENTS_PER_SHIPMENT);
  });
}

async function loadAjexMovements(trackingNumbers: string[]): Promise<CarrierMovement[]> {
  const histories = await loadAjexTrackingHistory(trackingNumbers);
  return [...histories].flatMap(([trackingNumber, events]) =>
    events.slice(-MAX_EVENTS_PER_SHIPMENT).map((event): CarrierMovement => {
      const code = Number.parseInt(event.status.code ?? '', 10);
      const label = resolveAjexStatusLabel(Number.isNaN(code) ? null : code) ?? event.status.description ?? null;
      return {
        trackingNumber,
        carrier: 'ajex',
        code: event.status.code ?? null,
        label,
        description: event.status.description ?? null,
        failureReason: event.status.failureReason ?? null,
        city: event.status.city ?? null,
        at: event.eventAt.toISOString(),
        atRaw: null,
        timezone: event.status.timezone ?? null,
      };
    })
  );
}

/** Movement history from both carrier feeds, oldest first per shipment. */
export async function loadCarrierMovements(trackingNumbers: string[]): Promise<CarrierMovement[]> {
  const wanted = [...new Set(trackingNumbers.map((tn) => tn.trim()).filter(Boolean))];
  if (wanted.length === 0) return [];
  const [smsa, ajex] = await Promise.all([loadSmsaMovements(wanted), loadAjexMovements(wanted)]);
  return [...smsa, ...ajex].sort(byTime);
}
