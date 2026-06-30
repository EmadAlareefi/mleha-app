import { prisma } from '@/lib/prisma';
import { env } from '@/app/lib/env';
import { log } from '@/app/lib/logger';
import { normalizeKSA } from '@/app/lib/phone';
import { extractSallaTrackingNumber } from '@/app/lib/salla-shipment';
import { sendWhatsAppTemplate } from '@/app/lib/zoko';

type AnyRecord = Record<string, any>;

export type ReturnLabelNotificationStatus = 'sent' | 'skipped' | 'failed';

export interface ReturnLabelNotificationInput {
  merchantId?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  labelUrl?: string | null;
  trackingNumber?: string | null;
  shipmentData?: unknown;
  source?: string;
}

export interface ReturnLabelNotificationResult {
  status: ReturnLabelNotificationStatus;
  reason?: string;
  returnRequestId?: string;
  error?: string;
  response?: unknown;
}

export interface ExtractedReturnLabelPayload {
  labelUrl: string | null;
  trackingNumber: string | null;
  courierName: string | null;
  hasReturnMarker: boolean;
}

interface ReturnRequestForNotification {
  id: string;
  merchantId: string;
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  type: string;
  status: string;
  smsaTrackingNumber: string | null;
  smsaResponse: unknown;
  returnLabelNotificationSentAt: Date | null;
}

const FALLBACK_CUSTOMER_NAME = 'عميلنا العزيز';
const RETURN_WORD_PATTERN = /(return|returned|reverse|rto|مرتجع|استرجاع|رجيع)/i;

const normalizeText = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  return null;
};

const getLabelUrl = (shipment: AnyRecord | null | undefined): string | null => {
  if (!shipment) return null;
  return (
    normalizeText(shipment.label?.url) ||
    normalizeText(shipment.label_url) ||
    normalizeText(shipment.labelUrl) ||
    (typeof shipment.label === 'string' ? normalizeText(shipment.label) : null)
  );
};

const getCourierName = (shipment: AnyRecord | null | undefined): string | null => {
  if (!shipment) return null;
  return (
    normalizeText(shipment.courier_name) ||
    normalizeText(shipment.courierName) ||
    normalizeText(shipment.courier) ||
    normalizeText(shipment.company) ||
    null
  );
};

const getTrackingNumber = (shipment: AnyRecord | null | undefined): string | null => {
  if (!shipment) return null;
  return (
    normalizeText(shipment.tracking_number) ||
    normalizeText(shipment.trackingNumber) ||
    normalizeText(shipment.shipping_number) ||
    normalizeText(shipment.tracking_no) ||
    normalizeText(shipment.awb_number) ||
    normalizeText(shipment.awbNumber) ||
    normalizeText(shipment.awb) ||
    normalizeText(shipment.shipment_reference) ||
    normalizeText(shipment.reference) ||
    normalizeText(shipment.reference_id) ||
    null
  );
};

const hasReturnMarker = (source: unknown, depth = 0): boolean => {
  if (!source || depth > 8) return false;

  if (typeof source === 'string' || typeof source === 'number' || typeof source === 'bigint') {
    return RETURN_WORD_PATTERN.test(source.toString());
  }

  if (Array.isArray(source)) {
    return source.some((item) => hasReturnMarker(item, depth + 1));
  }

  if (typeof source !== 'object') {
    return false;
  }

  return Object.entries(source as AnyRecord).some(([key, value]) => {
    if (RETURN_WORD_PATTERN.test(key)) {
      return true;
    }
    return hasReturnMarker(value, depth + 1);
  });
};

const getShipmentCandidates = (payload: unknown): AnyRecord[] => {
  const data = (payload && typeof payload === 'object' ? payload : {}) as AnyRecord;
  const candidates: AnyRecord[] = [];

  if (data.shipping?.shipment && typeof data.shipping.shipment === 'object') {
    candidates.push(data.shipping.shipment);
  }

  if (data.shipment && typeof data.shipment === 'object') {
    candidates.push(data.shipment);
  }

  if (Array.isArray(data.shipments)) {
    candidates.push(...data.shipments.filter((shipment): shipment is AnyRecord => Boolean(shipment && typeof shipment === 'object')));
  }

  return candidates;
};

export function extractReturnLabelPayload(payload: unknown): ExtractedReturnLabelPayload {
  const candidates = getShipmentCandidates(payload);
  const returnLabelCandidate = candidates.find((shipment) => getLabelUrl(shipment) && hasReturnMarker(shipment));
  const firstLabelCandidate = candidates.find((shipment) => getLabelUrl(shipment));
  const selectedShipment = returnLabelCandidate || firstLabelCandidate || null;
  const data = (payload && typeof payload === 'object' ? payload : {}) as AnyRecord;

  return {
    labelUrl: getLabelUrl(selectedShipment),
    trackingNumber:
      getTrackingNumber(selectedShipment) ||
      extractSallaTrackingNumber(data) ||
      null,
    courierName:
      getCourierName(selectedShipment) ||
      normalizeText(data.shipping?.company) ||
      null,
    hasReturnMarker: Boolean(
      (selectedShipment && hasReturnMarker(selectedShipment)) ||
      hasReturnMarker(data.shipping?.shipment) ||
      hasReturnMarker(data.shipping?.status) ||
      hasReturnMarker(data.status) ||
      hasReturnMarker(data.shipments)
    ),
  };
}

export function buildReturnLabelTemplateArgs(input: {
  customerName?: string | null;
  orderNumber?: string | null;
  orderId?: string | null;
  labelUrl: string;
}): (string | number)[] {
  return [
    input.customerName?.trim() || FALLBACK_CUSTOMER_NAME,
    input.orderNumber?.trim() || input.orderId?.trim() || '',
    input.labelUrl,
  ];
}

const getResponseId = (response: unknown): string | undefined => {
  if (!response || typeof response !== 'object') return undefined;
  const record = response as AnyRecord;
  return (
    normalizeText(record.id) ||
    normalizeText(record.messageId) ||
    normalizeText(record.message_id) ||
    normalizeText(record.data?.id) ||
    normalizeText(record.data?.messageId) ||
    undefined
  );
};

const providerIsSalla = (response: unknown) => {
  if (!response || typeof response !== 'object') return false;
  return normalizeText((response as AnyRecord).provider)?.toLowerCase() === 'salla';
};

async function findReturnRequest(input: {
  merchantId: string;
  orderId?: string | null;
  orderNumber?: string | null;
}): Promise<ReturnRequestForNotification | null> {
  const identifiers = Array.from(
    new Set([input.orderId, input.orderNumber].map((value) => normalizeText(value)).filter((value): value is string => Boolean(value)))
  );

  if (identifiers.length === 0) {
    return null;
  }

  return prisma.returnRequest.findFirst({
    where: {
      merchantId: input.merchantId,
      status: { notIn: ['cancelled', 'rejected'] },
      OR: identifiers.flatMap((value) => [
        { orderId: value },
        { orderNumber: value },
      ]),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      merchantId: true,
      orderId: true,
      orderNumber: true,
      customerName: true,
      customerPhone: true,
      type: true,
      status: true,
      smsaTrackingNumber: true,
      smsaResponse: true,
      returnLabelNotificationSentAt: true,
    },
  }) as Promise<ReturnRequestForNotification | null>;
}

async function recordMessageLog(input: {
  orderId?: string | null;
  toPhone: string;
  status: 'sent' | 'failed';
  zokoMsgId?: string;
  error?: string;
}) {
  try {
    await prisma.messageLog.create({
      data: {
        orderId: input.orderId || undefined,
        toPhone: input.toPhone,
        channel: 'whatsapp',
        templateName: env.ZOKO_TPL_RETURN_ORDER_LABEL_CREATED,
        body: 'return_order_label_created_ar',
        zokoMsgId: input.zokoMsgId,
        status: input.status,
        error: input.error,
      },
    });
  } catch (error) {
    log.warn('Failed to write return label Zoko MessageLog', { error });
  }
}

export async function maybeNotifyReturnLabelCreated(
  input: ReturnLabelNotificationInput
): Promise<ReturnLabelNotificationResult> {
  try {
    const merchantId = normalizeText(input.merchantId);
    if (!merchantId) {
      return { status: 'skipped', reason: 'missing_merchant_id' };
    }

    const extracted = extractReturnLabelPayload(input.shipmentData);
    const labelUrl = normalizeText(input.labelUrl) || extracted.labelUrl;
    if (!labelUrl) {
      return { status: 'skipped', reason: 'missing_label_url' };
    }

    const returnRequest = await findReturnRequest({
      merchantId,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
    });

    if (!returnRequest) {
      return { status: 'skipped', reason: 'no_matching_return_request' };
    }

    if (returnRequest.returnLabelNotificationSentAt) {
      return {
        status: 'skipped',
        reason: 'already_sent',
        returnRequestId: returnRequest.id,
      };
    }

    const hasExplicitReturnMarker = extracted.hasReturnMarker || hasReturnMarker(input.shipmentData);
    if (!hasExplicitReturnMarker && !providerIsSalla(returnRequest.smsaResponse)) {
      return {
        status: 'skipped',
        reason: 'not_return_label',
        returnRequestId: returnRequest.id,
      };
    }

    const recipient = normalizeKSA(returnRequest.customerPhone);
    if (!recipient) {
      await prisma.returnRequest.update({
        where: { id: returnRequest.id },
        data: {
          returnLabelUrl: labelUrl,
          returnLabelNotificationError: 'missing_phone',
        },
      });
      return {
        status: 'skipped',
        reason: 'missing_phone',
        returnRequestId: returnRequest.id,
      };
    }

    const trackingNumber = normalizeText(input.trackingNumber) || extracted.trackingNumber;
    if (!returnRequest.smsaTrackingNumber && trackingNumber) {
      try {
        await prisma.returnRequest.update({
          where: { id: returnRequest.id },
          data: {
            smsaTrackingNumber: trackingNumber,
            smsaAwbNumber: trackingNumber,
          },
        });
      } catch (error) {
        log.warn('Failed to backfill return request tracking number before label notification', {
          returnRequestId: returnRequest.id,
          trackingNumber,
          error,
        });
      }
    }

    const templateArgs = buildReturnLabelTemplateArgs({
      customerName: returnRequest.customerName,
      orderNumber: returnRequest.orderNumber,
      orderId: returnRequest.orderId,
      labelUrl,
    });

    let response: unknown;
    try {
      response = await sendWhatsAppTemplate({
        to: recipient,
        templateId: env.ZOKO_TPL_RETURN_ORDER_LABEL_CREATED,
        args: templateArgs,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      await prisma.returnRequest.update({
        where: { id: returnRequest.id },
        data: {
          returnLabelUrl: labelUrl,
          returnLabelNotificationError: errorMessage,
        },
      });
      await recordMessageLog({
        orderId: returnRequest.orderId,
        toPhone: recipient,
        status: 'failed',
        error: errorMessage,
      });

      log.error('Failed to send return label notification via Zoko', {
        returnRequestId: returnRequest.id,
        orderId: returnRequest.orderId,
        source: input.source,
        error: errorMessage,
      });

      return {
        status: 'failed',
        returnRequestId: returnRequest.id,
        error: errorMessage,
      };
    }

    const sentAt = new Date();
    await prisma.returnRequest.update({
      where: { id: returnRequest.id },
      data: {
        returnLabelUrl: labelUrl,
        returnLabelNotificationSentAt: sentAt,
        returnLabelNotificationError: null,
        returnLabelNotificationResponse: response as any,
      },
    });

    await recordMessageLog({
      orderId: returnRequest.orderId,
      toPhone: recipient,
      status: 'sent',
      zokoMsgId: getResponseId(response),
    });

    log.info('Return label notification sent via Zoko', {
      returnRequestId: returnRequest.id,
      orderId: returnRequest.orderId,
      source: input.source,
    });

    return {
      status: 'sent',
      returnRequestId: returnRequest.id,
      response,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    log.error('Failed to send return label notification via Zoko', {
      error: errorMessage,
      source: input.source,
      merchantId: input.merchantId,
      orderId: input.orderId,
    });

    if (input.merchantId && (input.orderId || input.orderNumber)) {
      try {
        const returnRequest = await findReturnRequest({
          merchantId: input.merchantId,
          orderId: input.orderId,
          orderNumber: input.orderNumber,
        });
        if (returnRequest) {
          await prisma.returnRequest.update({
            where: { id: returnRequest.id },
            data: { returnLabelNotificationError: errorMessage },
          });
        }
      } catch (recordError) {
        log.warn('Failed to persist return label notification error', { recordError });
      }
    }

    return { status: 'failed', error: errorMessage };
  }
}
