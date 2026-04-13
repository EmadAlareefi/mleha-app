import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import type { SmsaLiveStatus } from '@/types/smsa';

export const runtime = 'nodejs';

type NormalizedScan = {
  referenceId: number | null;
  city: string | null;
  scanType: string | null;
  scanDescription: string | null;
  scanDateTime: string | null;
  scanTimeZone: string | null;
  receivedBy: string | null;
};

type NormalizedShipment = {
  awb: string;
  reference: string | null;
  pieces: number | null;
  codAmount: number | null;
  contentDesc: string | null;
  recipientName: string | null;
  originCity: string | null;
  originCountry: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  isDelivered: boolean | null;
  scans: NormalizedScan[];
  lastScanDateTime: string | null;
  raw: any;
};

const numberFromValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = Number(value);
    if (!Number.isNaN(normalized) && Number.isFinite(normalized)) {
      return normalized;
    }
  }
  return null;
};

const integerFromValue = (value: unknown): number | null => {
  const normalized = numberFromValue(value);
  if (normalized === null) {
    return null;
  }
  return Math.trunc(normalized);
};

const stringFromValue = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value.toString();
  }
  return null;
};

const booleanFromValue = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
};

const toDecimal = (value: unknown): Prisma.Decimal | null => {
  const numeric = numberFromValue(value);
  if (numeric === null) {
    return null;
  }
  try {
    return new Prisma.Decimal(numeric);
  } catch {
    return null;
  }
};

const normalizeScan = (scan: any): NormalizedScan | null => {
  if (!scan || typeof scan !== 'object') {
    return null;
  }

  return {
    referenceId: integerFromValue(scan.ReferenceID ?? scan.referenceId),
    city: stringFromValue(scan.City),
    scanType: stringFromValue(scan.ScanType),
    scanDescription: stringFromValue(scan.ScanDescription),
    scanDateTime: stringFromValue(scan.ScanDateTime),
    scanTimeZone: stringFromValue(scan.ScanTimeZone),
    receivedBy: stringFromValue(scan.ReceivedBy),
  };
};

const pickAwb = (record: any): string | null => {
  const candidates = [
    record?.AWB,
    record?.awb,
    record?.TrackingNumber,
    record?.trackingNumber,
    record?.ShipmentNumber,
  ];

  for (const candidate of candidates) {
    const normalized = stringFromValue(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const computeLastScanDateTime = (scans: NormalizedScan[]): string | null => {
  let latest: string | null = null;
  let latestTimestamp = -Infinity;

  for (const scan of scans) {
    if (!scan.scanDateTime) continue;
    const timestamp = Date.parse(scan.scanDateTime);
    if (!Number.isNaN(timestamp)) {
      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
        latest = scan.scanDateTime;
      }
      continue;
    }

    if (!latest) {
      latest = scan.scanDateTime;
    }
  }

  return latest;
};

const pickLatestScan = (scans: NormalizedScan[]): NormalizedScan | null => {
  let latest: NormalizedScan | null = null;
  let latestTimestamp = -Infinity;

  for (const scan of scans) {
    if (!scan.scanDateTime) {
      if (!latest) {
        latest = scan;
      }
      continue;
    }

    const timestamp = Date.parse(scan.scanDateTime);
    if (Number.isNaN(timestamp)) {
      if (!latest) {
        latest = scan;
      }
      continue;
    }

    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latest = scan;
    }
  }

  return latest;
};

const normalizeIdentifier = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const collectTrackingMatches = (shipment: NormalizedShipment): string[] => {
  const values = new Set<string>();
  const awb = normalizeIdentifier(shipment.awb);
  if (awb) {
    values.add(awb);
  }
  const reference = normalizeIdentifier(shipment.reference);
  if (reference) {
    values.add(reference);
  }
  return Array.from(values);
};

const deriveDeliveredFlag = (
  explicitFlag: boolean | null | undefined,
  code: string | null,
  description: string | null
): boolean | null => {
  if (typeof explicitFlag === 'boolean') {
    return explicitFlag;
  }

  const normalizedCode = code?.trim().toUpperCase();
  if (normalizedCode === 'DL') {
    return true;
  }

  const normalizedDescription = description?.toLowerCase() || '';
  if (normalizedDescription.includes('delivered') || normalizedDescription.includes('تم التسليم')) {
    return true;
  }

  return null;
};

const buildSmsaLiveStatus = (shipment: NormalizedShipment): SmsaLiveStatus | null => {
  const latestScan = pickLatestScan(shipment.scans);
  const timestamp = latestScan?.scanDateTime ?? shipment.lastScanDateTime ?? null;
  const status: SmsaLiveStatus = {
    awb: shipment.awb,
    reference: shipment.reference,
    code: latestScan?.scanType ?? null,
    description: latestScan?.scanDescription ?? null,
    city: latestScan?.city ?? null,
    timestamp,
    timezone: latestScan?.scanTimeZone ?? null,
    receivedBy: latestScan?.receivedBy ?? null,
    delivered: deriveDeliveredFlag(shipment.isDelivered, latestScan?.scanType ?? null, latestScan?.scanDescription ?? null),
    source: 'webhook',
  };

  const hasMeaningfulData =
    Boolean(
      status.code ||
        status.description ||
        status.city ||
        status.timestamp ||
        status.timezone ||
        status.receivedBy
    ) || typeof status.delivered === 'boolean';

  return hasMeaningfulData ? status : null;
};

const persistLiveStatus = async (shipment: NormalizedShipment) => {
  const liveStatus = buildSmsaLiveStatus(shipment);
  if (!liveStatus) {
    return;
  }

  const identifiers = collectTrackingMatches(shipment);
  if (identifiers.length === 0) {
    return;
  }

  const updatedAt = new Date();
  const shipmentFilters = identifiers.map((value) => ({
    trackingNumber: {
      equals: value,
      mode: 'insensitive',
    } as const,
  }));
  const returnRequestFilters = identifiers.flatMap((value) => [
    {
      smsaTrackingNumber: {
        equals: value,
        mode: 'insensitive',
      } as const,
    },
    {
      smsaAwbNumber: {
        equals: value,
        mode: 'insensitive',
      } as const,
    },
  ]);

  const operations: Parameters<typeof prisma.$transaction>[0] = [];

  if (shipmentFilters.length > 0) {
    operations.push(
      prisma.shipment.updateMany({
        where: { OR: shipmentFilters },
        data: {
          smsaLiveStatus: liveStatus,
          smsaLiveStatusUpdatedAt: updatedAt,
        },
      })
    );
  }

  if (returnRequestFilters.length > 0) {
    operations.push(
      prisma.returnRequest.updateMany({
        where: { OR: returnRequestFilters },
        data: {
          smsaLiveStatus: liveStatus,
          smsaLiveStatusUpdatedAt: updatedAt,
        },
      })
    );
  }

  if (operations.length > 0) {
    try {
      await prisma.$transaction(operations);
    } catch (error) {
      log.error('Failed to persist SMSA live status on related records', {
        identifiers,
        error,
      });
    }
  }
};

const normalizeShipments = (payload: unknown): NormalizedShipment[] => {
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.shipments)
      ? (payload as any).shipments
      : Array.isArray((payload as any)?.data)
        ? (payload as any).data
        : [];

  const shipments: NormalizedShipment[] = [];

  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const awb = pickAwb(entry);
    if (!awb) {
      continue;
    }

    const scansRaw = Array.isArray((entry as any).Scans)
      ? (entry as any).Scans
      : Array.isArray((entry as any).scans)
        ? (entry as any).scans
        : [];

    const scans: NormalizedScan[] = [];
    for (const scan of scansRaw) {
      const normalized = normalizeScan(scan);
      if (normalized) {
        scans.push(normalized);
      }
    }

    shipments.push({
      awb,
      reference: stringFromValue(entry.Reference ?? entry.reference),
      pieces: integerFromValue(entry.Pieces ?? entry.parcels ?? entry.pieces),
      codAmount: numberFromValue(entry.CODAmount ?? entry.cod ?? entry.codAmount),
      contentDesc: stringFromValue(entry.ContentDesc ?? entry.content ?? entry.contentDesc),
      recipientName: stringFromValue(entry.RecipientName ?? entry.receiver ?? entry.receiverName),
      originCity: stringFromValue(entry.OriginCity),
      originCountry: stringFromValue(entry.OriginCountry),
      destinationCity:
        stringFromValue(entry.DesinationCity ?? entry.DestinationCity ?? entry.destinationCity) ??
        null,
      destinationCountry:
        stringFromValue(entry.DesinationCountry ?? entry.DestinationCountry ?? entry.destinationCountry) ??
        null,
      isDelivered: booleanFromValue(entry.isDelivered ?? entry.IsDelivered),
      scans,
      lastScanDateTime: computeLastScanDateTime(scans),
      raw: entry,
    });
  }

  return shipments;
};

const getClientIp = (req: NextRequest): string | undefined => {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined
  );
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: any | null = null;
  let parseError: string | undefined;
  if (rawBody.trim().length > 0) {
    try {
      payload = JSON.parse(rawBody);
    } catch (error: any) {
      parseError = error?.message || 'Failed to parse JSON body';
    }
  }

  try {
    await prisma.webhookLog.create({
      data: {
        method: 'POST',
        url: request.url,
        ip: getClientIp(request),
        headers: Object.fromEntries(request.headers.entries()),
        signature: null,
        signatureHeader: null,
        verified: false,
        event: 'smsa.webhook',
        orderId: null,
        status: null,
        rawText: rawBody,
        json: payload,
        parseError,
      },
    });
  } catch (error) {
    log.warn('Failed to persist SMSA webhook log entry', { error });
  }

  if (parseError) {
    log.warn('SMSA webhook payload could not be parsed', { parseError });
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const shipments = normalizeShipments(payload);
  if (shipments.length === 0) {
    log.info('SMSA webhook received but no shipments detected', { hasPayload: Boolean(payload) });
    return NextResponse.json({ ok: true, ingested: 0 });
  }

  const processed: { awb: string; scans: number; created: boolean }[] = [];
  for (const shipment of shipments) {
    try {
      const codAmountDecimal = toDecimal(shipment.codAmount ?? undefined);
      const data = {
        reference: shipment.reference,
        pieces: shipment.pieces ?? undefined,
        codAmount: codAmountDecimal ?? undefined,
        contentDesc: shipment.contentDesc,
        recipientName: shipment.recipientName,
        originCity: shipment.originCity,
        originCountry: shipment.originCountry,
        destinationCity: shipment.destinationCity,
        destinationCountry: shipment.destinationCountry,
        isDelivered: shipment.isDelivered ?? undefined,
        rawPayload: shipment.raw,
        lastScanDateTime: shipment.lastScanDateTime,
      };

      const result = await prisma.smsaWebhookShipment.upsert({
        where: { awb: shipment.awb },
        update: data,
        create: {
          awb: shipment.awb,
          ...data,
        },
      });

      await prisma.smsaWebhookScan.deleteMany({ where: { shipmentId: result.id } });

      if (shipment.scans.length > 0) {
        await prisma.smsaWebhookScan.createMany({
          data: shipment.scans.map((scan) => ({
            shipmentId: result.id,
            referenceId: scan.referenceId,
            city: scan.city,
            scanType: scan.scanType,
            scanDescription: scan.scanDescription,
            scanDateTime: scan.scanDateTime,
            scanTimeZone: scan.scanTimeZone,
            receivedBy: scan.receivedBy,
          })),
        });
      }

      await persistLiveStatus(shipment);

      processed.push({
        awb: shipment.awb,
        scans: shipment.scans.length,
        created: result.createdAt.getTime() === result.updatedAt.getTime(),
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        log.error('Failed to persist SMSA scans due to relation error', {
          awb: shipment.awb,
          error,
        });
      } else {
        log.error('Failed to persist SMSA webhook shipment', { awb: shipment.awb, error });
      }
    }
  }

  return NextResponse.json({ ok: true, ingested: processed.length, shipments: processed });
}
