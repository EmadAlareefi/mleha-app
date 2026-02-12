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
