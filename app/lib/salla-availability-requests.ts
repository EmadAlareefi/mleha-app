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
  createdAt: true,
  updatedAt: true,
} as const;

export type AvailabilityRequestRecord = Prisma.SallaProductAvailabilityRequestGetPayload<{
  select: typeof availabilityRequestSelect;
}>;

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
};

export type ListAvailabilityRequestsInput = {
  productIds?: number[];
  status?: 'pending' | 'notified' | 'cancelled';
};

export type AvailabilityRequestStatus = 'pending' | 'notified' | 'cancelled';

export type UpdateAvailabilityRequestStatusInput = {
  id: string;
  status: AvailabilityRequestStatus;
  actorName?: string | null;
};

export async function listAvailabilityRequests(
  params: ListAvailabilityRequestsInput = {}
): Promise<AvailabilityRequestRecord[]> {
  const where: Prisma.SallaProductAvailabilityRequestWhereInput = {};

  if (params.productIds && params.productIds.length > 0) {
    where.productId = { in: params.productIds };
  }

  if (params.status) {
    where.status = params.status;
  }

  return prisma.sallaProductAvailabilityRequest.findMany({
    where,
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
      status: 'pending',
    },
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
    data.notifiedAt = null;
    data.notifiedBy = null;
  }

  return prisma.sallaProductAvailabilityRequest.update({
    where: { id: input.id },
    data,
    select: availabilityRequestSelect,
  });
}

export async function listAvailabilityRequestsByIds(
  ids: string[]
): Promise<AvailabilityRequestRecord[]> {
  const normalized = Array.isArray(ids)
    ? ids.map((id) => (typeof id === 'string' ? id : String(id ?? ''))).filter((id) => id.length > 0)
    : [];
  if (normalized.length === 0) {
    return [];
  }
  return prisma.sallaProductAvailabilityRequest.findMany({
    where: { id: { in: normalized } },
    select: availabilityRequestSelect,
  });
}

const DEFAULT_TEMPLATE_IMAGE =
  'https://cdn.files.salla.network/homepage/1696031053/9239dc2f-2c06-4548-9011-ff615b728924.webp';

export function buildAvailabilityTemplateArgs(
  request: AvailabilityRequestRecord
): (string | number)[] {
  const imageUrl = request.productImageUrl || DEFAULT_TEMPLATE_IMAGE;
  const productName = request.productName || `منتج رقم ${request.productId}`;
  const productLink = request.productSku
    ? `https://mleha.com/ar/search?q=${encodeURIComponent(request.productSku)}`
    : `https://mleha.com/ar/products/${request.productId}`;
  return [imageUrl, productName, productLink];
}
