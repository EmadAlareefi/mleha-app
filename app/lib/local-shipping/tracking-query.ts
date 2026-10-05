import type { Prisma } from '@prisma/client';

// Explicit selection keeps driver credentials and delivery OTPs out of staff responses.
export const localTrackingSelect = {
  id: true, merchantId: true, orderId: true, orderNumber: true,
  trackingNumber: true, customerName: true, shippingCity: true,
  shippingAddress: true, status: true, createdAt: true, updatedAt: true,
  deliveredAt: true, cancelledAt: true, cancellationReason: true, deliveryNotes: true,
  warehouse: { select: { name: true } },
  assignment: { select: {
    status: true, assignedAt: true, pickedUpAt: true, deliveredAt: true,
    failedAt: true, cancelledAt: true, updatedAt: true, failureReason: true,
    cancellationReason: true, recipientName: true,
    deliveryAgent: { select: { name: true, phone: true } },
  } },
  tasks: {
    where: { requestType: 'return_pickup' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, createdAt: true, updatedAt: true,
      completedAt: true, completionNotes: true,
      deliveryAgent: { select: { name: true, phone: true } },
    },
  },
} satisfies Prisma.LocalShipmentSelect;

export type LocalTrackingRecord = Prisma.LocalShipmentGetPayload<{ select: typeof localTrackingSelect }>;
// JSON representation shared by staff clients.
export type LocalTrackingShipment = Omit<LocalTrackingRecord,
  'createdAt' | 'updatedAt' | 'deliveredAt' | 'cancelledAt' | 'assignment' | 'tasks'> & {
  createdAt: string; updatedAt: string; deliveredAt: string | null; cancelledAt: string | null;
  assignment: (Omit<NonNullable<LocalTrackingRecord['assignment']>,
    'assignedAt' | 'pickedUpAt' | 'deliveredAt' | 'failedAt' | 'cancelledAt' | 'updatedAt'> & {
      assignedAt: string; pickedUpAt: string | null; deliveredAt: string | null;
      failedAt: string | null; cancelledAt: string | null; updatedAt: string;
    }) | null;
  tasks: Array<Omit<LocalTrackingRecord['tasks'][number], 'createdAt' | 'updatedAt' | 'completedAt'> & {
    createdAt: string; updatedAt: string; completedAt: string | null;
  }>;
};

export function buildLocalTrackingWhere({ id, search, status }: {
  id?: string | null; search: string; status: string;
}): Prisma.LocalShipmentWhereInput {
  const conditions: Prisma.LocalShipmentWhereInput[] = [];
  if (id) conditions.push({ id });
  if (search) conditions.push({ OR: [
    { trackingNumber: { contains: search, mode: 'insensitive' } },
    { orderNumber: { contains: search, mode: 'insensitive' } },
    { customerName: { contains: search, mode: 'insensitive' } },
  ] });
  if (status) conditions.push({ OR: [
    { assignment: { is: { status } } },
    { assignment: { is: null }, status },
  ] });
  return conditions.length ? { AND: conditions } : {};
}
