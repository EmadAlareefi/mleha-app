import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const availabilityRequestSelect = {
  id: true,
  merchantId: true,
  productId: true,
  productName: true,
  productSku: true,
  productImageUrl: true,
  variationId: true,
  variationName: true,
  requestedSize: true,
  customerFirstName: true,
  customerLastName: true,
  customerEmail: true,
  customerPhone: true,
  notes: true,
  status: true,
  requestedBy: true,
  requestedByUser: true,
  notifiedAt: true,
  notifiedBy: true,
  source: true,
  customerId: true,
  isGuest: true,
  pageUrl: true,
  locale: true,
  notifyChannel: true,
  notifyAttempts: true,
  notifyError: true,
  lastCheckedAt: true,
  backInStockAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

// `ipHash` and `userAgent` are intentionally left out of the select: they exist for
// rate limiting and abuse triage only, and never need to reach a browser.
export type AvailabilityRequestRecord = Prisma.SallaProductAvailabilityRequestGetPayload<{
  select: typeof availabilityRequestSelect;
}>;

export type AvailabilityRequestSource = 'staff' | 'storefront';

/** How many times we retry a failed notification before parking the request. */
export const MAX_NOTIFY_ATTEMPTS = 3;
export const STALE_NOTIFICATION_CLAIM_MS = 30 * 60 * 1000;

export type CreateAvailabilityRequestInput = {
  productId: number;
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  merchantId?: string | null;
  variationId?: string | number | null;
  variationName?: string | null;
  requestedSize?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerEmail?: string | null;
  customerPhone: string;
  notes?: string | null;
  requestedBy: string;
  requestedByUser?: string | null;
  source?: AvailabilityRequestSource;
  customerId?: string | null;
  isGuest?: boolean;
  pageUrl?: string | null;
  locale?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
};

export type ListAvailabilityRequestsInput = {
  productIds?: number[];
  status?: AvailabilityRequestStatus;
  source?: AvailabilityRequestSource;
  from?: Date;
  to?: Date;
};

export type AvailabilityRequestStatus =
  | 'pending'
  | 'notifying'
  | 'notified'
  | 'failed'
  | 'cancelled';

export const AVAILABILITY_REQUEST_STATUSES: readonly AvailabilityRequestStatus[] = [
  'pending',
  'notifying',
  'notified',
  'failed',
  'cancelled',
];

export function isAvailabilityRequestStatus(value: unknown): value is AvailabilityRequestStatus {
  return (
    typeof value === 'string' &&
    (AVAILABILITY_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export type UpdateAvailabilityRequestStatusInput = {
  id: string;
  status: AvailabilityRequestStatus;
  actorName?: string | null;
};

function buildListWhere(
  params: ListAvailabilityRequestsInput
): Prisma.SallaProductAvailabilityRequestWhereInput {
  const where: Prisma.SallaProductAvailabilityRequestWhereInput = {};

  if (params.productIds && params.productIds.length > 0) {
    where.productId = { in: params.productIds };
  }

  if (params.status) {
    where.status = params.status;
  }

  if (params.source) {
    where.source = params.source;
  }

  if (params.from || params.to) {
    where.createdAt = {
      ...(params.from ? { gte: params.from } : {}),
      ...(params.to ? { lte: params.to } : {}),
    };
  }

  return where;
}

export async function listAvailabilityRequests(
  params: ListAvailabilityRequestsInput = {}
): Promise<AvailabilityRequestRecord[]> {
  return prisma.sallaProductAvailabilityRequest.findMany({
    where: buildListWhere(params),
    orderBy: { createdAt: 'desc' },
    select: availabilityRequestSelect,
  });
}

export async function createAvailabilityRequest(
  input: CreateAvailabilityRequestInput
): Promise<AvailabilityRequestRecord> {
  return prisma.sallaProductAvailabilityRequest.create({
    data: {
      merchantId: input.merchantId ?? null,
      productId: input.productId,
      productName: input.productName,
      productSku: input.productSku ?? null,
      productImageUrl: input.productImageUrl ?? null,
      variationId: input.variationId != null ? String(input.variationId) : null,
      variationName: input.variationName ?? null,
      requestedSize: input.requestedSize ?? null,
      customerFirstName: input.customerFirstName ?? null,
      customerLastName: input.customerLastName ?? null,
      customerEmail: input.customerEmail ?? null,
      customerPhone: input.customerPhone,
      notes: input.notes ?? null,
      requestedBy: input.requestedBy,
      requestedByUser: input.requestedByUser ?? null,
      source: input.source ?? 'staff',
      customerId: input.customerId ?? null,
      isGuest: input.isGuest ?? false,
      pageUrl: input.pageUrl ?? null,
      locale: input.locale ?? null,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
      status: 'pending',
    },
    select: availabilityRequestSelect,
  });
}

/**
 * A customer who taps "notify me" twice, or who is already waiting on the same
 * size, should not queue a second message. Only open requests block a new one —
 * once a request has been notified or cancelled the customer is free to ask again.
 */
export async function findDuplicatePendingRequest(input: {
  productId: number;
  variationId?: string | number | null;
  customerPhone: string;
}): Promise<AvailabilityRequestRecord | null> {
  const variationId = input.variationId != null ? String(input.variationId) : null;

  return prisma.sallaProductAvailabilityRequest.findFirst({
    where: {
      productId: input.productId,
      customerPhone: input.customerPhone,
      variationId,
      status: { in: ['pending', 'notifying'] },
    },
    orderBy: { createdAt: 'desc' },
    select: availabilityRequestSelect,
  });
}

export async function getAvailabilityRequestById(
  id: string
): Promise<AvailabilityRequestRecord | null> {
  if (!id) {
    return null;
  }
  return prisma.sallaProductAvailabilityRequest.findUnique({
    where: { id },
    select: availabilityRequestSelect,
  });
}

export async function updateAvailabilityRequestStatus(
  input: UpdateAvailabilityRequestStatusInput
): Promise<AvailabilityRequestRecord> {
  const data: Prisma.SallaProductAvailabilityRequestUpdateInput = {
    status: input.status,
  };

  if (input.status === 'notified') {
    data.notifiedAt = new Date();
    data.notifiedBy = input.actorName ?? null;
  } else if (input.status === 'pending') {
    // Re-queueing by hand also clears the failure bookkeeping, so a request a human
    // rescues starts its retry budget over instead of parking again immediately.
    data.notifiedAt = null;
    data.notifiedBy = null;
    data.notifyError = null;
    data.notifyAttempts = 0;
  }

  return prisma.sallaProductAvailabilityRequest.update({
    where: { id: input.id },
    data,
    select: availabilityRequestSelect,
  });
}

function normalizeIds(ids: string[]): string[] {
  return Array.isArray(ids)
    ? ids.map((id) => (typeof id === 'string' ? id : String(id ?? ''))).filter((id) => id.length > 0)
    : [];
}

export async function listAvailabilityRequestsByIds(
  ids: string[]
): Promise<AvailabilityRequestRecord[]> {
  const normalized = normalizeIds(ids);
  if (normalized.length === 0) {
    return [];
  }
  return prisma.sallaProductAvailabilityRequest.findMany({
    where: { id: { in: normalized } },
    select: availabilityRequestSelect,
  });
}

/**
 * Claim requests for sending by flipping them `pending` -> `notifying` in a single
 * conditional update. Only rows still in `pending` move, so if two watcher runs
 * overlap the second one claims nothing and no customer is messaged twice.
 * Returns the ids that were actually claimed by *this* call.
 */
export async function claimRequestsForNotification(ids: string[]): Promise<string[]> {
  const normalized = normalizeIds(ids);
  const claimed: string[] = [];

  // One conditional update per row rather than a single updateMany: updateMany
  // reports how many rows moved but not *which*, and with two runs in flight that
  // difference is the whole point. `count === 1` means this call won the row.
  for (const id of normalized) {
    const result = await prisma.sallaProductAvailabilityRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'notifying' },
    });
    if (result.count === 1) {
      claimed.push(id);
    }
  }

  return claimed;
}

/** Release a claimed request back to `pending` (used when a send is skipped). */
export async function releaseClaimedRequest(id: string): Promise<void> {
  await prisma.sallaProductAvailabilityRequest.updateMany({
    where: { id, status: 'notifying' },
    data: { status: 'pending' },
  });
}

/**
 * Recover claims left behind when a serverless invocation is interrupted.
 *
 * Claims are now taken immediately before each individual send, limiting the
 * uncertain window to one request. This recovery prevents an interrupted row
 * from remaining invisible to every future watcher run.
 */
export async function recoverStaleNotificationClaims(
  staleBefore = new Date(Date.now() - STALE_NOTIFICATION_CLAIM_MS)
): Promise<number> {
  const result = await prisma.sallaProductAvailabilityRequest.updateMany({
    where: {
      status: 'notifying',
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: 'pending',
      notifyError: 'Recovered stale notification claim before send confirmation',
    },
  });

  return result.count;
}

export async function markRequestNotified(input: {
  id: string;
  channel: 'whatsapp' | 'sms';
  actorName?: string | null;
}): Promise<AvailabilityRequestRecord> {
  return prisma.sallaProductAvailabilityRequest.update({
    where: { id: input.id },
    data: {
      status: 'notified',
      notifiedAt: new Date(),
      notifiedBy: input.actorName ?? 'auto',
      notifyChannel: input.channel,
      notifyError: null,
    },
    select: availabilityRequestSelect,
  });
}

/**
 * Record a failed send. The request goes back to `pending` so the next run retries
 * it, until it has burned through MAX_NOTIFY_ATTEMPTS — then it parks in `failed`
 * where the reports tab surfaces it for a human.
 */
export async function markRequestFailed(input: {
  id: string;
  error: string;
}): Promise<AvailabilityRequestRecord> {
  const current = await prisma.sallaProductAvailabilityRequest.findUnique({
    where: { id: input.id },
    select: { notifyAttempts: true },
  });

  const attempts = (current?.notifyAttempts ?? 0) + 1;
  const exhausted = attempts >= MAX_NOTIFY_ATTEMPTS;

  return prisma.sallaProductAvailabilityRequest.update({
    where: { id: input.id },
    data: {
      status: exhausted ? 'failed' : 'pending',
      notifyAttempts: attempts,
      notifyError: input.error.slice(0, 2000),
    },
    select: availabilityRequestSelect,
  });
}

/** Stamp the poll timestamp on every request the watcher looked at. */
export async function markRequestsChecked(ids: string[]): Promise<void> {
  const normalized = normalizeIds(ids);
  if (normalized.length === 0) {
    return;
  }
  await prisma.sallaProductAvailabilityRequest.updateMany({
    where: { id: { in: normalized } },
    data: { lastCheckedAt: new Date() },
  });
}

/** Record the moment a request's product was first seen back in stock. */
export async function markRequestsBackInStock(ids: string[]): Promise<void> {
  const normalized = normalizeIds(ids);
  if (normalized.length === 0) {
    return;
  }
  await prisma.sallaProductAvailabilityRequest.updateMany({
    where: { id: { in: normalized }, backInStockAt: null },
    data: { backInStockAt: new Date() },
  });
}

export async function listPendingRequestsForWatcher(): Promise<AvailabilityRequestRecord[]> {
  return prisma.sallaProductAvailabilityRequest.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: availabilityRequestSelect,
  });
}

export type AvailabilityMessageParts = {
  /** Customer's first name, or a neutral greeting when we don't have one. */
  customerName: string;
  /** Product name with the size/variant label folded in, e.g. "عباية سوداء (M)". */
  productLabel: string;
  /** Canonical storefront link to the product. */
  productLink: string;
};

/**
 * The three pieces both channels need: the SMS body below is assembled from them,
 * and they map 1:1 onto the positional arguments of the Zoko WhatsApp template.
 */
export function buildAvailabilityMessageParts(
  request: AvailabilityRequestRecord
): AvailabilityMessageParts {
  const productName = request.productName?.trim() || 'المنتج المطلوب';
  const variationLabel = request.variationName?.trim();
  const sizeLabel = request.requestedSize?.trim();
  const extraInfo =
    variationLabel && variationLabel !== productName
      ? variationLabel
      : sizeLabel
      ? `المقاس ${sizeLabel}`
      : '';

  return {
    customerName: request.customerFirstName?.trim() || 'عميلنا العزيز',
    productLabel: `${productName}${extraInfo ? ` (${extraInfo})` : ''}`,
    productLink: request.productId
      ? `https://mleha.com/ar/products/p${request.productId}`
      : 'https://mleha.com/ar',
  };
}

export function buildAvailabilityNotificationMessage(request: AvailabilityRequestRecord): string {
  const { productLabel, productLink } = buildAvailabilityMessageParts(request);
  const parts = [
    'عميلنا العزيز،',
    `منتج ${productLabel} أصبح متوفر الآن في متجر مليحة.`,
    `يمكنك الطلب عبر الرابط: ${productLink}`,
    'شكراً لاختيارك مليحة.',
  ];
  return parts.filter(Boolean).join(' ');
}
