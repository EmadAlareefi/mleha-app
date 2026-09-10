import type { Prisma } from '@prisma/client';

export const RETURN_LABEL_GRACE_MS = 30 * 60 * 1000;

const FINISHED_STATUSES = ['cancelled', 'rejected', 'delivered', 'completed'];
const SHIPMENT_FIELDS = ['smsaTrackingNumber', 'smsaAwbNumber', 'returnLabelUrl'] as const;

interface ShipmentRequest {
  status: string;
  createdAt: Date;
  smsaTrackingNumber?: string | null;
  smsaAwbNumber?: string | null;
  returnLabelUrl?: string | null;
}

export function needsManualReturnShipment(request: ShipmentRequest, now = new Date()) {
  return !FINISHED_STATUSES.includes(request.status)
    && now.getTime() - request.createdAt.getTime() > RETURN_LABEL_GRACE_MS
    && SHIPMENT_FIELDS.every((field) => !request[field]);
}

// Applied before pagination so requests hidden by the normal inspection filter
// still appear in the attention count and the dedicated missing-shipment view.
export function missingReturnShipmentWhere(now = new Date()): Prisma.ReturnRequestWhereInput {
  return {
    status: { notIn: FINISHED_STATUSES },
    createdAt: { lt: new Date(now.getTime() - RETURN_LABEL_GRACE_MS) },
    AND: SHIPMENT_FIELDS.map((field) => ({
      OR: [{ [field]: null }, { [field]: '' }],
    })),
  };
}
