/**
 * SMSA webhook payload parsing, shared by the webhook route and the scan
 * history backfill (which replays stored WebhookLog payloads).
 */

export type NormalizedScan = {
  referenceId: number | null;
  city: string | null;
  scanType: string | null;
  scanDescription: string | null;
  scanDateTime: string | null;
  scanTimeZone: string | null;
  receivedBy: string | null;
};

export type NormalizedShipment = {
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

export const numberFromValue = (value: unknown): number | null => {
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

export const integerFromValue = (value: unknown): number | null => {
  const normalized = numberFromValue(value);
  if (normalized === null) {
    return null;
  }
  return Math.trunc(normalized);
};

export const stringFromValue = (value: unknown): string | null => {
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

export const booleanFromValue = (value: unknown): boolean | null => {
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


export const normalizeScan = (scan: any): NormalizedScan | null => {
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

export const pickAwb = (record: any): string | null => {
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

export const computeLastScanDateTime = (scans: NormalizedScan[]): string | null => {
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

export const normalizeShipments = (payload: unknown): NormalizedShipment[] => {
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

/** Identity of one scan: SMSA resends earlier scans, which must not be stored twice. */
export const smsaScanKey = (scan: Pick<NormalizedScan, 'scanType' | 'scanDateTime' | 'scanDescription'>): string =>
  [scan.scanType ?? '', scan.scanDateTime ?? '', (scan.scanDescription ?? '').toLowerCase()].join('|');
