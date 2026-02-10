import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import { trackBulkShipments, trackC2BShipment, type SMSATrackingRecord } from '@/app/lib/smsa-api';

export const runtime = 'nodejs';

type SMSATrackingScan = {
  ScanType?: string;
  ScanDescription?: string;
  ScanDateTime?: string;
  ScanTimeZone?: string;
  City?: string;
  ReceivedBy?: string;
};

type TrackingHistoryEntry = {
  code: string | null;
  description: string | null;
  city: string | null;
  timestamp: string | null;
  timezone: string | null;
  receivedBy: string | null;
};

type TrackingStatusPayload = {
  code: string | null;
  description: string | null;
  city: string | null;
  timestamp: string | null;
  timezone: string | null;
  receivedBy: string | null;
  delivered: boolean;
  history: TrackingHistoryEntry[];
};

const normalizeScan = (scan: SMSATrackingScan | null | undefined): TrackingHistoryEntry => ({
  code: scan?.ScanType ?? null,
  description: scan?.ScanDescription ?? null,
  city: scan?.City ?? null,
  timestamp: scan?.ScanDateTime ?? null,
  timezone: scan?.ScanTimeZone ?? null,
  receivedBy: scan?.ReceivedBy ?? null,
});

const sortHistory = (entries: TrackingHistoryEntry[]): TrackingHistoryEntry[] =>
  entries.sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
    const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
    return bTime - aTime;
  });

const extractScans = (payload: SMSATrackingRecord | null | undefined): SMSATrackingScan[] => {
  if (!payload) {
    return [];
  }

  const candidates = [
    payload?.Scans,
    (payload as any)?.scans,
    (payload as any)?.trackingHistory,
    (payload as any)?.history,
    (payload as any)?.TrackingHistory,
    (payload as any)?.tracking,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as SMSATrackingScan[];
    }
  }

  if (Array.isArray((payload as any)?.TrackingLogs)) {
    return (payload as any)?.TrackingLogs as SMSATrackingScan[];
  }

  if (Array.isArray((payload as any)?.Waybills)) {
    // Some responses have scans nested per waybill
    const scans = [];
    for (const waybill of (payload as any).Waybills) {
      if (Array.isArray(waybill?.Scans)) {
        scans.push(...waybill.Scans);
      }
    }
    if (scans.length > 0) {
      return scans as SMSATrackingScan[];
    }
  }

  return [];
};

const toTrackingPayload = (raw: SMSATrackingRecord | null): TrackingStatusPayload | null => {
  if (!raw) {
    return null;
  }
  const history = sortHistory(extractScans(raw).map(normalizeScan));
  const latest = history[0] || null;
  const delivered =
    Boolean(
      raw?.isDelivered ||
      raw?.IsDelivered ||
      history.some((entry) => entry.code === 'DL' || entry.description?.toLowerCase().includes('delivered'))
    ) || false;

  return {
    code: latest?.code ?? null,
    description: latest?.description ?? null,
    city: latest?.city ?? null,
    timestamp: latest?.timestamp ?? null,
    timezone: latest?.timezone ?? null,
    receivedBy: latest?.receivedBy ?? null,
    delivered,
    history,
  };
};

const resolveAwbFromRecord = (record: SMSATrackingRecord): string | null => {
  const candidates = [
    typeof record.AWB === 'string' ? record.AWB.trim() : '',
    typeof record.awb === 'string' ? record.awb.trim() : '',
    typeof (record as any)?.trackingNumber === 'string' ? (record as any).trackingNumber.trim() : '',
  ].filter(Boolean);
  return candidates.length > 0 ? candidates[0] : null;
};

const fetchSingleTrackingRecord = async (awb: string): Promise<SMSATrackingRecord | null> => {
  const normalized = awb.trim();
  if (!normalized) {
    return null;
  }

  try {
    const c2b = await trackC2BShipment(normalized);
    if (c2b && typeof c2b === 'object') {
      return c2b as SMSATrackingRecord;
    }
  } catch (error) {
    log.warn('Failed to fetch SMSA C2B tracking for AWB', { awb: normalized, error });
  }

  return null;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const trackingNumbers: unknown[] = Array.isArray(body?.trackingNumbers) ? body.trackingNumbers : [];

    const normalized = Array.from(
      new Set(
        trackingNumbers
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value): value is string => value.length > 0)
      )
    );

    if (normalized.length === 0) {
      return NextResponse.json({ success: true, statuses: {} });
    }

    const statuses: Record<string, TrackingStatusPayload | null> = {};

    const trackingRecords = await trackBulkShipments(normalized);
    const recordMap = new Map<string, SMSATrackingRecord>();
    for (const record of trackingRecords) {
      const awb = resolveAwbFromRecord(record);
      if (awb) {
        recordMap.set(awb, record);
      }
    }

    const missingAwbs: string[] = [];
    for (const awb of normalized) {
      const record = recordMap.get(awb);
      const payload = toTrackingPayload(record ?? null);
      statuses[awb] = payload;
      if (!payload) {
        missingAwbs.push(awb);
      }
    }

    if (missingAwbs.length > 0) {
      for (const awb of missingAwbs) {
        const fallbackRecord = await fetchSingleTrackingRecord(awb);
        const payload = toTrackingPayload(fallbackRecord);
        if (payload) {
          statuses[awb] = payload;
        }
      }
    }

    return NextResponse.json({ success: true, statuses });
  } catch (error) {
    log.error('Failed to fetch SMSA tracking statuses', { error });
    return NextResponse.json(
      { success: false, error: 'تعذر جلب حالة الشحنة من سمسا' },
      { status: 500 }
    );
  }
}
