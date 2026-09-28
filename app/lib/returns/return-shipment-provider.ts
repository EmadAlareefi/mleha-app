import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { getSallaOrder } from '@/app/lib/salla-api';
import { cancelAjexShipments, createAjexOrder, isAjexConfigured } from '@/app/lib/ajex-api';
import { maybeNotifyReturnLabelCreated } from '@/app/lib/returns/return-label-notification';
import {
  buildAjexReturnOrder,
  buildAjexReturnReference,
  getAjexReturnWarehouse,
  type AjexReturnItemInput,
} from '@/app/lib/returns/ajex-return-shipment';

export type ReturnShipmentProvider = 'ajex' | 'salla';

/**
 * Who issues the return waybill: `RETURN_SHIPMENT_PROVIDER=ajex` creates it
 * directly through the AJEX API, anything else keeps Salla's
 * `create_return_policy` flow. Opt-in on purpose, so configuring sandbox
 * credentials alone never puts live customers on sandbox waybills.
 */
export function getReturnShipmentProvider(): ReturnShipmentProvider {
  return process.env.RETURN_SHIPMENT_PROVIDER?.trim().toLowerCase() === 'ajex' ? 'ajex' : 'salla';
}

export interface CreateAjexReturnShipmentInput {
  order: Record<string, any>;
  orderNumber: string;
  currency: string;
  items: AjexReturnItemInput[];
}

export type CreateAjexReturnShipmentResult =
  | {
      success: true;
      trackingNumber: string;
      labelUrl: string | null;
      referenceNumber: string;
      /** Stored on `ReturnRequest.smsaResponse`. */
      record: Record<string, unknown>;
    }
  | { success: false; error: string; details?: unknown };

export async function createAjexReturnShipment(
  input: CreateAjexReturnShipmentInput,
): Promise<CreateAjexReturnShipmentResult> {
  if (!isAjexConfigured()) {
    return { success: false, error: 'لم يتم إعداد بيانات اعتماد AJEX' };
  }

  const warehouse = getAjexReturnWarehouse();
  if (!warehouse) {
    return { success: false, error: 'عنوان مستودع المرتجعات غير مُعد' };
  }

  const referenceNumber = buildAjexReturnReference(input.orderNumber);
  const built = buildAjexReturnOrder({
    order: input.order,
    items: input.items,
    warehouse,
    referenceNumber,
    currency: input.currency,
    productCode: process.env.AJEX_RETURN_PRODUCT_CODE?.trim() || undefined,
    itemWeightKg: Number(process.env.AJEX_RETURN_ITEM_WEIGHT_KG) || undefined,
  });

  if (!built.ok) {
    return { success: false, error: built.error };
  }

  let result;
  try {
    result = await createAjexOrder(built.request);
  } catch (error) {
    log.error('AJEX return shipment request failed', { referenceNumber, error });
    return { success: false, error: 'تعذر الاتصال بشركة AJEX لإنشاء بوليصة الإرجاع' };
  }

  if (!result.success) {
    return {
      success: false,
      error: `تعذر إنشاء بوليصة الإرجاع لدى AJEX: ${result.error}`,
      details: result.raw,
    };
  }

  log.info('AJEX return shipment created', {
    referenceNumber,
    trackingId: result.data.trackingId,
    pickupAddressType: built.request.pickupAddress.addressType,
  });

  return {
    success: true,
    trackingNumber: result.data.trackingId,
    labelUrl: result.data.waybillFileUrl || null,
    referenceNumber,
    record: {
      provider: 'ajex',
      referenceNumber,
      trackingNumber: result.data.trackingId,
      productCode: built.request.productCode,
      request: built.request,
      response: result.raw,
    },
  };
}

const isAjexRecord = (value: unknown) =>
  Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).provider === 'ajex');

export type ReissueAjexReturnShipmentResult =
  | {
      success: true;
      trackingNumber: string;
      labelUrl: string | null;
      cancelledTrackingNumber: string | null;
      notification: Awaited<ReturnType<typeof maybeNotifyReturnLabelCreated>> | null;
    }
  | { success: false; error: string; status: number; details?: unknown };

/**
 * Issues a fresh AJEX waybill for an existing request — the AJEX counterpart
 * of re-requesting Salla's return policy. A previous AJEX waybill is cancelled
 * first so two couriers are not sent to the same customer.
 */
export async function reissueAjexReturnShipment(
  returnRequestId: string,
): Promise<ReissueAjexReturnShipmentResult> {
  const returnRequest = await prisma.returnRequest.findUnique({
    where: { id: returnRequestId },
    include: { items: true },
  });
  if (!returnRequest) {
    return { success: false, error: 'طلب الإرجاع غير موجود', status: 404 };
  }

  const order = await getSallaOrder(returnRequest.merchantId, returnRequest.orderId);
  if (!order) {
    return { success: false, error: 'لم يتم العثور على الطلب في سلة', status: 502 };
  }

  const previousTracking =
    isAjexRecord(returnRequest.smsaResponse) && returnRequest.smsaTrackingNumber
      ? returnRequest.smsaTrackingNumber
      : null;

  if (previousTracking) {
    const cancelled = await cancelAjexShipments([previousTracking]).catch((error) => ({
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (!cancelled.success) {
      return {
        success: false,
        error: `تعذر إلغاء بوليصة AJEX السابقة (${previousTracking}): ${cancelled.error}`,
        status: 502,
      };
    }
  }

  const created = await createAjexReturnShipment({
    order: order as any,
    orderNumber: returnRequest.orderNumber || returnRequest.orderId,
    currency: returnRequest.currency,
    items: returnRequest.items.map((item) => ({
      productName: item.productName,
      productSku: item.productSku ?? undefined,
      variantName: item.variantName ?? undefined,
      quantity: item.quantity,
      price: Number(item.price),
    })),
  });

  if (!created.success) {
    return { success: false, error: created.error, status: 502, details: created.details };
  }

  await prisma.returnRequest.update({
    where: { id: returnRequest.id },
    data: {
      smsaTrackingNumber: created.trackingNumber,
      smsaAwbNumber: created.trackingNumber,
      smsaResponse: {
        ...created.record,
        ...(previousTracking ? { replacedTrackingNumber: previousTracking } : {}),
      } as any,
      returnLabelUrl: created.labelUrl,
      smsaLiveStatus: Prisma.DbNull,
      smsaLiveStatusUpdatedAt: null,
    },
  });

  const notification = created.labelUrl
    ? await maybeNotifyReturnLabelCreated({
        merchantId: returnRequest.merchantId,
        orderId: returnRequest.orderId,
        orderNumber: returnRequest.orderNumber,
        returnRequestId: returnRequest.id,
        labelUrl: created.labelUrl,
        trackingNumber: created.trackingNumber,
        source: 'returns-management-reissue-ajex',
        // The customer's earlier message points at the waybill that was just cancelled.
        force: true,
      })
    : null;

  return {
    success: true,
    trackingNumber: created.trackingNumber,
    labelUrl: created.labelUrl,
    cancelledTrackingNumber: previousTracking,
    notification,
  };
}

/**
 * Cancels the courier for a request whose waybill was issued directly with
 * AJEX. Salla-issued waybills are left to Salla. Best-effort: AJEX refuses once
 * the parcel is picked up, which must not block rejecting the request.
 */
export async function cancelAjexReturnShipment(returnRequest: {
  id: string;
  smsaTrackingNumber: string | null;
  smsaResponse: unknown;
}): Promise<boolean> {
  if (!isAjexRecord(returnRequest.smsaResponse) || !returnRequest.smsaTrackingNumber) {
    return false;
  }

  try {
    const cancelled = await cancelAjexShipments([returnRequest.smsaTrackingNumber]);
    if (!cancelled.success) {
      log.warn('AJEX refused to cancel return shipment', {
        returnRequestId: returnRequest.id,
        trackingNumber: returnRequest.smsaTrackingNumber,
        error: cancelled.error,
      });
    }
    return cancelled.success;
  } catch (error) {
    log.error('Failed to cancel AJEX return shipment', {
      returnRequestId: returnRequest.id,
      trackingNumber: returnRequest.smsaTrackingNumber,
      error,
    });
    return false;
  }
}
