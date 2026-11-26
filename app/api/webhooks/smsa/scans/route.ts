import { markReturnsReceived } from '@/app/lib/returns/auto-progress';
import { carrierDelivered } from '@/lib/returns/workflow';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import type { SmsaLiveStatus } from '@/types/smsa';
import {
  normalizeShipments,
  numberFromValue,
  type NormalizedScan,
  type NormalizedShipment,
} from '@/app/lib/smsa-webhook-payload';
import { appendSmsaScans } from '@/app/lib/smsa-scan-store';

export const runtime = 'nodejs';

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

  const operations: Prisma.PrismaPromise<unknown>[] = [];

  if (shipmentFilters.length > 0) {
    operations.push(
      prisma.shipment.updateMany({
        where: { OR: shipmentFilters },
        data: {
          smsaLiveStatus: liveStatus as Prisma.InputJsonValue,
          smsaLiveStatusUpdatedAt: updatedAt,
        } as any,
      })
    );
  }

  if (returnRequestFilters.length > 0) {
    operations.push(
      prisma.returnRequest.updateMany({
        where: { OR: returnRequestFilters },
        data: {
          smsaLiveStatus: liveStatus as Prisma.InputJsonValue,
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

  // A delivered return moves to "received" on the server, ready for inspection.
  if (returnRequestFilters.length > 0 && carrierDelivered(liveStatus)) {
    await markReturnsReceived({ OR: returnRequestFilters }, 'smsa-webhook').catch((error) =>
      log.error('Failed to mark SMSA return as received', { identifiers, error })
    );
  }
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

      // Append, never replace: SMSA posts one scan at a time, so replacing
      // threw away every earlier movement.
      await appendSmsaScans(result.id, shipment.scans);

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
