import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const purchaseRequestSelect = {
  id: true,
  merchantId: true,
  productId: true,
  productName: true,
  productSku: true,
  productImageUrl: true,
  variantId: true,
  variantName: true,
  variantSku: true,
  variantBarcode: true,
  variantOptions: true,
  quantity: true,
  status: true,
  notes: true,
  expectedArrivalAt: true,
  requestedBy: true,
  requestedByUser: true,
  requestedAt: true,
  movedToWayBy: true,
  movedToWayAt: true,
  removedBy: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type PurchaseRequestStatus = 'requested' | 'on_the_way' | 'purchased';

export type PurchaseRequestRecord = Prisma.SallaPurchaseRequestGetPayload<{
  select: typeof purchaseRequestSelect;
}>;

export type CreatePurchaseRequestInput = {
  productId: number;
  productName: string;
  productSku?: string | null;
  productImageUrl?: string | null;
  variantId?: string | null;
  variantName?: string | null;
  variantSku?: string | null;
  variantBarcode?: string | null;
  variantOptions?: Prisma.InputJsonValue | null;
  merchantId?: string | null;
  quantity: number;
  status?: Extract<PurchaseRequestStatus, 'requested' | 'on_the_way'>;
  expectedArrivalAt?: Date | null;
  notes?: string | null;
  requestedBy: string;
  requestedByUser?: string | null;
};

export type ListPurchaseRequestsInput = {
  status?: PurchaseRequestStatus;
};

export async function listPurchaseRequests(
  params: ListPurchaseRequestsInput = {}
): Promise<PurchaseRequestRecord[]> {
  const where: Prisma.SallaPurchaseRequestWhereInput = {};

  if (params.status) {
    where.status = params.status;
  } else {
    // Default board view: active requests only, never archived/purchased.
    where.status = { in: ['requested', 'on_the_way'] };
  }

  return prisma.sallaPurchaseRequest.findMany({
    where,
    orderBy: [{ requestedAt: 'desc' }],
    select: purchaseRequestSelect,
  });
}

export async function createPurchaseRequest(
  input: CreatePurchaseRequestInput
): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.create({
    data: {
      productId: input.productId,
      productName: input.productName,
      productSku: input.productSku ?? null,
      productImageUrl: input.productImageUrl ?? null,
      variantId: input.variantId ?? null,
      variantName: input.variantName ?? null,
      variantSku: input.variantSku ?? null,
      variantBarcode: input.variantBarcode ?? null,
      variantOptions: input.variantOptions ?? undefined,
      merchantId: input.merchantId ?? null,
      quantity: input.quantity,
      notes: input.notes ?? null,
      requestedBy: input.requestedBy,
      requestedByUser: input.requestedByUser ?? null,
      status: input.status ?? 'requested',
      expectedArrivalAt: input.expectedArrivalAt ?? null,
      movedToWayBy: input.status === 'on_the_way' ? input.requestedBy : null,
      movedToWayAt: input.status === 'on_the_way' ? new Date() : null,
    },
    select: purchaseRequestSelect,
  });
}

export async function incrementPurchaseRequestQuantity(
  id: string,
  by: number
): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.update({
    where: { id },
    data: { quantity: { increment: by } },
    select: purchaseRequestSelect,
  });
}

export async function movePurchaseRequestOnTheWay(
  id: string,
  movedToWayBy: string
): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.update({
    where: { id },
    data: {
      status: 'on_the_way',
      movedToWayBy,
      movedToWayAt: new Date(),
    },
    select: purchaseRequestSelect,
  });
}

export async function archivePurchaseRequest(
  id: string,
  removedBy: string
): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.update({
    where: { id },
    data: {
      status: 'purchased',
      removedBy,
      removedAt: new Date(),
    },
    select: purchaseRequestSelect,
  });
}

export async function deletePurchaseRequest(id: string): Promise<PurchaseRequestRecord> {
  return prisma.sallaPurchaseRequest.delete({
    where: { id },
    select: purchaseRequestSelect,
  });
}
