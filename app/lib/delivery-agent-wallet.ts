import { randomUUID } from 'crypto';
import { Prisma, DeliveryAgentWalletTransactionType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const SHIPMENT_REFERENCE_TYPE = 'local_shipment';
const TASK_REFERENCE_TYPE = 'delivery_agent_task';
const PAYOUT_REFERENCE_TYPE = 'payout';
const DEFAULT_REWARD_AMOUNT = new Prisma.Decimal(30);

type Metadata = Record<string, unknown>;

const sanitizeMetadata = (metadata?: Metadata | null) => {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null)
  ) as Prisma.JsonObject;
};

const isNotFoundError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

export async function ensureShipmentWalletCredit(params: {
  shipmentId: string;
  deliveryAgentId: string;
  assignmentId?: string;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  createdById?: string;
  createdByName?: string;
}) {
  const metadata = sanitizeMetadata({
    assignmentId: params.assignmentId,
    orderNumber: params.orderNumber,
    trackingNumber: params.trackingNumber,
  });
  const description = params.orderNumber
    ? `تم تسليم الشحنة ${params.orderNumber}`
    : 'تم تسليم شحنة محلية';

  return prisma.deliveryAgentWalletTransaction.upsert({
    where: {
      referenceType_referenceId: {
        referenceType: SHIPMENT_REFERENCE_TYPE,
        referenceId: params.shipmentId,
      },
    },
    update: {
      deliveryAgentId: params.deliveryAgentId,
      metadata,
      notes: description,
      createdById: params.createdById,
      createdByName: params.createdByName,
    },
    create: {
      deliveryAgentId: params.deliveryAgentId,
      type: DeliveryAgentWalletTransactionType.SHIPMENT_COMPLETED,
      amount: DEFAULT_REWARD_AMOUNT,
      referenceType: SHIPMENT_REFERENCE_TYPE,
      referenceId: params.shipmentId,
      metadata,
      notes: description,
      createdById: params.createdById,
      createdByName: params.createdByName,
    },
  });
}

export async function removeShipmentWalletCredit(shipmentId: string) {
  try {
    await prisma.deliveryAgentWalletTransaction.delete({
      where: {
        referenceType_referenceId: {
          referenceType: SHIPMENT_REFERENCE_TYPE,
          referenceId: shipmentId,
        },
      },
    });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

export async function ensureTaskWalletCredit(params: {
  taskId: string;
  deliveryAgentId: string;
  title?: string;
  createdById?: string;
  createdByName?: string;
}) {
  const metadata = sanitizeMetadata({
    title: params.title,
  });
  const description = params.title ? `تم إنهاء المهمة: ${params.title}` : 'تم إنهاء مهمة للمندوب';

  return prisma.deliveryAgentWalletTransaction.upsert({
    where: {
      referenceType_referenceId: {
        referenceType: TASK_REFERENCE_TYPE,
        referenceId: params.taskId,
      },
    },
    update: {
      deliveryAgentId: params.deliveryAgentId,
      metadata,
      notes: description,
      createdById: params.createdById,
      createdByName: params.createdByName,
    },
    create: {
      deliveryAgentId: params.deliveryAgentId,
      type: DeliveryAgentWalletTransactionType.TASK_COMPLETED,
      amount: DEFAULT_REWARD_AMOUNT,
      referenceType: TASK_REFERENCE_TYPE,
      referenceId: params.taskId,
      metadata,
      notes: description,
      createdById: params.createdById,
      createdByName: params.createdByName,
    },
  });
}

export async function removeTaskWalletCredit(taskId: string) {
  try {
    await prisma.deliveryAgentWalletTransaction.delete({
      where: {
        referenceType_referenceId: {
          referenceType: TASK_REFERENCE_TYPE,
          referenceId: taskId,
        },
      },
    });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

export async function recordDeliveryAgentWalletPayout(params: {
  deliveryAgentId: string;
  amount: number;
  paymentMethod?: string;
  notes?: string;
  createdById?: string;
  createdByName?: string;
}) {
  const normalizedAmount = Math.abs(params.amount || 0);
  if (normalizedAmount === 0) {
    throw new Error('المبلغ يجب أن يكون أكبر من صفر');
  }

  const metadata = sanitizeMetadata({
    paymentMethod: params.paymentMethod,
  });

  return prisma.deliveryAgentWalletTransaction.create({
    data: {
      deliveryAgentId: params.deliveryAgentId,
      type: DeliveryAgentWalletTransactionType.PAYOUT,
      amount: new Prisma.Decimal(-normalizedAmount),
      referenceType: PAYOUT_REFERENCE_TYPE,
      referenceId: randomUUID(),
      metadata,
      notes: params.notes || 'دفع رصيد للمندوب',
      createdById: params.createdById,
      createdByName: params.createdByName,
    },
  });
}

export async function recordManualWalletAdjustment(params: {
  deliveryAgentId: string;
  amount: number;
  notes?: string;
  createdById?: string;
  createdByName?: string;
}) {
  if (!params.amount) {
    throw new Error('يجب تحديد مبلغ صالح للتسوية');
  }

  return prisma.deliveryAgentWalletTransaction.create({
    data: {
      deliveryAgentId: params.deliveryAgentId,
      type: DeliveryAgentWalletTransactionType.ADJUSTMENT,
      amount: new Prisma.Decimal(params.amount),
      referenceId: randomUUID(),
      referenceType: 'manual_adjustment',
      notes: params.notes || 'تعديل يدوي للمحفظة',
      createdById: params.createdById,
      createdByName: params.createdByName,
    },
  });
}
