import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const quantityRequestSelect = {
  id: true,
  productId: true,
  productName: true,
  productSku: true,
  productImageUrl: true,
  merchantId: true,
  requestedAmount: true,
  requestedRefundAmount: true,
  requestedFrom: true,
  requestedBy: true,
  requestedByUser: true,
  requestedFor: true,
  notes: true,
  status: true,
  requestedAt: true,
  fulfilledAt: true,
  providedBy: true,
  providedAmount: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type QuantityRequestRecord = Prisma.SallaProductQuantityRequestGetPayload<{
  select: typeof quantityRequestSelect;
}>;

export type CreateQuantityRequestInput = {
  productId: number;
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  merchantId?: string | null;
  requestedAmount: number;
  requestedRefundAmount?: number | null;
  requestedFrom: string;
  requestedBy: string;
  requestedByUser?: string | null;
  requestedFor?: string | Date | null;
  notes?: string | null;
};

export type FulfillQuantityRequestInput = {
  id: string;
  providedBy: string;
  providedAmount: number;
};

export type ListQuantityRequestsInput = {
  productIds?: number[];
  status?: 'pending' | 'completed';
  fromDate?: Date;
  toDate?: Date;
};

export async function listQuantityRequests(
  params: ListQuantityRequestsInput = {}
): Promise<QuantityRequestRecord[]> {
  const where: Prisma.SallaProductQuantityRequestWhereInput = {};

  if (params.productIds && params.productIds.length > 0) {
    where.productId = { in: params.productIds };
  }

  if (params.status) {
    where.status = params.status;
  }

  if (params.fromDate || params.toDate) {
    where.requestedAt = {};
    if (params.fromDate) {
      where.requestedAt.gte = params.fromDate;
    }
    if (params.toDate) {
      where.requestedAt.lte = params.toDate;
    }
  }

  return prisma.sallaProductQuantityRequest.findMany({
    where,
    orderBy: [
      { status: 'asc' }, // Pending first
      { requestedAt: 'desc' },
    ],
    select: quantityRequestSelect,
  });
}

export async function createQuantityRequest(
  input: CreateQuantityRequestInput
): Promise<QuantityRequestRecord> {
  const normalizedRequestedFor =
    input.requestedFor != null && input.requestedFor !== ''
      ? new Date(input.requestedFor)
      : null;

  return prisma.sallaProductQuantityRequest.create({
    data: {
      productId: input.productId,
      productName: input.productName,
      productSku: input.productSku ?? null,
      productImageUrl: input.productImageUrl ?? null,
      merchantId: input.merchantId ?? null,
      requestedAmount: input.requestedAmount,
      requestedRefundAmount: input.requestedRefundAmount ?? null,
      requestedFrom: input.requestedFrom,
      requestedBy: input.requestedBy,
      requestedByUser: input.requestedByUser ?? null,
      requestedFor: normalizedRequestedFor,
      notes: input.notes ?? null,
      status: 'pending',
    },
    select: quantityRequestSelect,
  });
}

export async function fulfillQuantityRequest(
  input: FulfillQuantityRequestInput
): Promise<QuantityRequestRecord> {
  return prisma.sallaProductQuantityRequest.update({
    where: { id: input.id },
    data: {
      status: 'completed',
      providedBy: input.providedBy,
      providedAmount: input.providedAmount,
      fulfilledAt: new Date(),
    },
    select: quantityRequestSelect,
  });
}
