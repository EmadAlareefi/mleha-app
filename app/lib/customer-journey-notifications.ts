import { Prisma } from '@prisma/client';

import { createSignedCustomerDocumentUrl } from '@/app/lib/customer-document-links';
import { env } from '@/app/lib/env';
import { log } from '@/app/lib/logger';
import { normalizePhoneWithDialCode } from '@/app/lib/phone';
import { getSallaOrder } from '@/app/lib/salla-api';
import {
  sendWhatsAppButtonTemplate,
  sendWhatsAppRichTemplate,
  sendWhatsAppTemplate,
} from '@/app/lib/zoko';
import { prisma } from '@/lib/prisma';

type AnyRecord = Record<string, any>;

export type CustomerJourneyStep =
  | 'order_received'
  | 'shipped'
  | 'product_rating'
  | 'cancelled'
  | 'refunded';

type MessageType = 'template' | 'richTemplate' | 'buttonTemplate';

export interface JourneyNotificationData {
  customerName: string;
  orderNumber: string;
  carrier?: string;
  trackingNumber?: string;
  trackingLink?: string;
  ratingLink?: string;
  customerOrderLink?: string;
  refundAmount?: string;
  currency?: string;
}

export interface EnqueueJourneyInput {
  event: string;
  merchantId?: string | null;
  order: AnyRecord;
  data?: AnyRecord;
  status?: string | null;
}

const TEMPLATE_BY_STEP: Record<
  CustomerJourneyStep,
  { id: string; type: MessageType }
> = {
  order_received: { id: env.ZOKO_TPL_ORDER_RECEIVED_INVOICE, type: 'richTemplate' },
  shipped: { id: env.ZOKO_TPL_ORDER_SHIPPED_LABEL, type: 'buttonTemplate' },
  product_rating: { id: env.ZOKO_TPL_ORDER_DELIVERED_RATING, type: 'buttonTemplate' },
  cancelled: { id: env.ZOKO_TPL_ORDER_CANCELLED, type: 'template' },
  refunded: { id: env.ZOKO_TPL_ORDER_REFUNDED, type: 'template' },
};

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
const MAX_SEND_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const MAX_DATA_WAIT_MS = 24 * 60 * 60_000;

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  return '';
}

export function normalizeJourneyTrackingLink(value: unknown): string {
  const link = text(value);
  if (!link || link === '0') return '';

  try {
    const url = new URL(link);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';

    const parameters = `${url.search}${url.hash}`;
    if (
      /(?:^|[?&#])(?:awb|id|shipmentnumber|track|tracking(?:_?(?:no|number))?)=0(?:$|[&#])/i.test(
        parameters
      )
    ) {
      return '';
    }

    return link;
  } catch {
    return '';
  }
}

function firstUsableTrackingLink(...values: unknown[]): string {
  for (const value of values) {
    const link = normalizeJourneyTrackingLink(value);
    if (link) return link;
  }
  return '';
}

function statusValue(value: unknown): string {
  if (value && typeof value === 'object') {
    return text((value as AnyRecord).slug ?? (value as AnyRecord).code ?? (value as AnyRecord).name)
      .toLowerCase();
  }
  return text(value).toLowerCase();
}

function customerName(order: AnyRecord): string {
  const customer = order.customer ?? order.customer_info ?? {};
  return (
    text(customer.first_name ?? customer.firstName ?? customer.name ?? customer.full_name) ||
    'عميلنا العزيز'
  );
}

function recipientPhone(order: AnyRecord): string {
  const customer = order.customer ?? order.customer_info ?? {};
  const receiver = order.receiver ?? order.shipping?.receiver ?? {};
  return normalizePhoneWithDialCode(
    customer.mobile ?? customer.phone ?? receiver.phone ?? '',
    customer.mobile_code ??
      customer.mobileCode ??
      customer.phone_code ??
      customer.dial_code ??
      receiver.mobile_code ??
      ''
  );
}

function orderNumber(order: AnyRecord): string {
  return text(
    order.reference_id ??
      order.referenceId ??
      order.order_number ??
      order.orderNumber ??
      order.id ??
      order.order_id
  );
}

export function extractJourneyShipment(order: AnyRecord, data: AnyRecord = {}) {
  const candidates = [
    order.shipping?.shipment,
    data.shipping?.shipment,
    order.shipment,
    data.shipment,
    ...(Array.isArray(order.shipments) ? order.shipments : []),
    ...(Array.isArray(data.shipments) ? data.shipments : []),
    data,
  ].filter(Boolean);
  const outbound =
    candidates.find((item) => !/return|reverse|مرتجع|استرجاع/i.test(text(item?.type))) || {};
  const shipping = order.shipping ?? data.shipping ?? {};
  const trackingLink = firstUsableTrackingLink(
    ...candidates.flatMap((item) => [item?.tracking_link, item?.trackingLink, item?.tracking_url]),
    order.shipping?.tracking_link,
    data.shipping?.tracking_link,
    shipping.tracking_link,
    order.tracking_link,
    data.tracking_link
  );
  const trackingNumber = text(
    outbound.tracking_number ??
      outbound.trackingNumber ??
      outbound.awb ??
      shipping.tracking_number ??
      order.tracking_number
  );
  return {
    carrier: text(
      outbound.courier_name ??
        outbound.courierName ??
        outbound.courier ??
        shipping.company ??
        order.shipping_company
    ),
    trackingNumber,
    trackingLink,
    labelUrl: text(
      outbound.label?.url ??
        outbound.label_url ??
        outbound.labelUrl ??
        (typeof outbound.label === 'string' ? outbound.label : '')
    ),
  };
}

export function extractJourneyRatingLink(order: AnyRecord): string {
  return text(order.urls?.rating ?? order.rating_link ?? order.review_link ?? order.survey_link);
}

export function isDeliveredJourneyStatus(status: string | null | undefined): boolean {
  const normalized = text(status).toLowerCase().replace(/\s+/g, ' ');
  return normalized === 'delivered' || normalized === 'تم التوصيل';
}

function extractRefund(order: AnyRecord, data: AnyRecord) {
  const refund = data.refund ?? order.refund ?? data;
  // Never substitute the order total for a refund amount: partial refunds
  // would then produce a confidently wrong customer notification.
  const amountNode = refund.amount ?? refund.total ?? refund.refunded_amount;
  const amount =
    typeof amountNode === 'object' && amountNode
      ? text(amountNode.amount ?? amountNode.value)
      : text(amountNode);
  const currency = text(
    refund.currency ??
      (typeof amountNode === 'object' ? amountNode.currency : '') ??
      order.currency ??
      order.amounts?.total?.currency
  );
  return { amount, currency };
}

export function stepForJourneyEvent(event: string, status: string): CustomerJourneyStep | null {
  if (event === 'order.created') return 'order_received';
  if (event === 'order.cancelled' || status === 'canceled' || status === 'cancelled') {
    return 'cancelled';
  }
  if (event === 'order.refunded') return 'refunded';
  if (event === 'shipment.created' || event === 'order.shipment.created') return 'shipped';
  if (status === 'shipped') return 'shipped';
  // Preparation and out-for-delivery are intentionally silent. Meta charges per
  // delivered template, so these low-information milestones are consolidated
  // into the received/shipped/final-review messages.
  if (isDeliveredJourneyStatus(status)) return 'product_rating';
  return null;
}

export function buildJourneyNotificationData(
  order: AnyRecord,
  data: AnyRecord = {}
): JourneyNotificationData {
  const shipment = extractJourneyShipment(order, data);
  const refund = extractRefund(order, data);
  return {
    customerName: customerName(order),
    orderNumber: orderNumber(order),
    carrier: shipment.carrier || undefined,
    trackingNumber: shipment.trackingNumber || undefined,
    trackingLink: shipment.trackingLink || undefined,
    ratingLink: extractJourneyRatingLink(order) || undefined,
    customerOrderLink: text(order.urls?.customer) || undefined,
    refundAmount: refund.amount || undefined,
    currency: refund.currency || text(order.currency) || undefined,
  };
}

async function enqueueStep(input: {
  merchantId: string;
  orderId: string;
  recipient: string;
  step: CustomerJourneyStep;
  data: JourneyNotificationData;
  scheduledFor?: Date;
  dedupeDiscriminator?: string;
}) {
  const definition = TEMPLATE_BY_STEP[input.step];
  const dedupeKey = [
    input.merchantId,
    input.orderId,
    input.step,
    input.dedupeDiscriminator,
  ].filter(Boolean).join(':');
  return prisma.customerJourneyNotification.upsert({
    where: { dedupeKey },
    create: {
      merchantId: input.merchantId,
      orderId: input.orderId,
      step: input.step,
      dedupeKey,
      recipient: input.recipient,
      templateId: definition.id,
      messageType: definition.type,
      language: env.WHATSAPP_DEFAULT_LANG || 'ar',
      data: input.data as unknown as Prisma.InputJsonValue,
      scheduledFor: input.scheduledFor ?? new Date(),
    },
    update: {
      recipient: input.recipient,
      templateId: definition.id,
      messageType: definition.type,
      data: input.data as unknown as Prisma.InputJsonValue,
      // A later, richer webhook should wake messages that were waiting for data.
      nextAttemptAt: new Date(),
    },
  });
}

export async function enqueueCustomerJourneyEvent(input: EnqueueJourneyInput) {
  if (!env.ZOKO_CUSTOMER_JOURNEY_ENABLED) return { status: 'disabled' as const };
  const order = input.order ?? {};
  const data = input.data ?? {};
  const merchantId = text(
    input.merchantId ?? order.merchant_id ?? order.merchantId ?? data.merchant ?? data.store?.id
  );
  const orderId = text(order.id ?? order.order_id ?? data.order_id ?? data.id);
  const recipient = recipientPhone(order) || normalizePhoneWithDialCode(data.receiver?.phone ?? '');
  const status = statusValue(input.status ?? order.status ?? data.status);
  const step = stepForJourneyEvent(input.event, status);

  if (!step) return { status: 'ignored' as const, reason: 'unmapped_event_or_status' };
  if (!merchantId || !orderId || !recipient) {
    log.warn('Could not enqueue customer journey notification', {
      event: input.event,
      hasMerchantId: Boolean(merchantId),
      hasOrderId: Boolean(orderId),
      hasRecipient: Boolean(recipient),
    });
    return { status: 'skipped' as const, reason: 'missing_identity' };
  }

  const notificationData = buildJourneyNotificationData(order, data);
  const refundDiscriminator =
    step === 'refunded'
      ? text(data.refund?.id ?? data.refund_id ?? data.refundId ?? data.transaction_id)
      : '';
  // Version the rating key around the actual delivery milestone. This keeps a
  // rating row that may have been queued by the old `completed` mapping from
  // retaining its earlier countdown when `delivered` arrives.
  const ratingDiscriminator = step === 'product_rating' ? 'delivered' : '';
  const delayHours = Number.isFinite(env.CUSTOMER_RATING_DELAY_HOURS)
    ? Math.max(0, env.CUSTOMER_RATING_DELAY_HOURS)
    : 24;
  const row = await enqueueStep({
    merchantId,
    orderId,
    recipient,
    step,
    data: notificationData,
    scheduledFor:
      step === 'product_rating'
        ? new Date(Date.now() + delayHours * 60 * 60_000)
        : undefined,
    dedupeDiscriminator: refundDiscriminator || ratingDiscriminator || undefined,
  });

  if (step === 'product_rating') {
    await prisma.customerJourneyNotification.updateMany({
      where: {
        merchantId,
        orderId,
        id: { not: row.id },
        step: { in: ['preparing', 'shipped', 'out_for_delivery', 'product_rating'] },
        status: { in: ['pending', 'waiting_for_data', 'retrying'] },
      },
      data: {
        status: 'superseded',
        nextAttemptAt: null,
        lastError: 'Replaced when the delivered milestone started a new rating countdown',
      },
    });
  }

  if (step === 'cancelled' || step === 'refunded') {
    await prisma.customerJourneyNotification.updateMany({
      where: {
        merchantId,
        orderId,
        step: { in: ['preparing', 'shipped', 'out_for_delivery', 'product_rating'] },
        status: { in: ['pending', 'waiting_for_data', 'retrying'] },
      },
      data: { status: 'cancelled', lastError: `Order ${step}` },
    });
  }

  return { status: 'queued' as const, id: row.id, step };
}

function providerMessageId(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const record = response as AnyRecord;
  return text(
    record.messageId ??
      record.id ??
      record.message_id ??
      record.data?.messageId ??
      record.data?.id ??
      record.data?.message_id
  ) || null;
}

async function enrichNotification(row: {
  merchantId: string;
  orderId: string;
  step: string;
  data: unknown;
}): Promise<JourneyNotificationData> {
  const current = (row.data || {}) as JourneyNotificationData;
  const stored = await prisma.sallaOrder.findUnique({
    where: { merchantId_orderId: { merchantId: row.merchantId, orderId: row.orderId } },
    select: {
      customerName: true,
      customerMobile: true,
      orderNumber: true,
      referenceId: true,
      currency: true,
      fulfillmentCompany: true,
      trackingNumber: true,
      rawOrder: true,
    },
  });
  const rawOrder = (stored?.rawOrder || {}) as AnyRecord;
  const shipment = await prisma.sallaShipment.findUnique({
    where: { merchantId_orderId: { merchantId: row.merchantId, orderId: row.orderId } },
    select: { courierName: true, trackingNumber: true, shipmentData: true },
  });
  const shipmentData = (shipment?.shipmentData || {}) as AnyRecord;
  const shipmentPayload = (shipmentData.raw_payload || {}) as AnyRecord;
  const storedShipmentDetails = extractJourneyShipment(shipmentData, shipmentPayload);
  const storedOrderShipment = extractJourneyShipment(rawOrder);
  let ratingLink = current.ratingLink || extractJourneyRatingLink(rawOrder);
  let customerOrderLink = current.customerOrderLink || text(rawOrder.urls?.customer);

  if (row.step === 'product_rating' && !ratingLink) {
    const freshOrder = await getSallaOrder(row.merchantId, row.orderId);
    if (freshOrder) {
      ratingLink = extractJourneyRatingLink(freshOrder as unknown as AnyRecord);
      customerOrderLink = customerOrderLink || text(freshOrder.urls?.customer);
    }
  }

  return {
    ...current,
    customerName: current.customerName || stored?.customerName || 'عميلنا العزيز',
    orderNumber:
      current.orderNumber || stored?.orderNumber || stored?.referenceId || row.orderId,
    carrier: current.carrier || shipment?.courierName || stored?.fulfillmentCompany || undefined,
    trackingNumber:
      current.trackingNumber || shipment?.trackingNumber || stored?.trackingNumber || undefined,
    trackingLink:
      firstUsableTrackingLink(
        current.trackingLink,
        shipmentData.tracking_link,
        shipmentData.trackingLink,
        shipmentData.tracking_url,
        storedShipmentDetails.trackingLink,
        storedOrderShipment.trackingLink
      ) ||
      undefined,
    ratingLink: ratingLink || undefined,
    customerOrderLink: customerOrderLink || undefined,
    currency: current.currency || stored?.currency || 'SAR',
  };
}

function argsForStep(input: {
  step: string;
  merchantId: string;
  orderId: string;
  data: JourneyNotificationData;
}): (string | number)[] {
  const { step, merchantId, orderId, data } = input;
  if (step === 'order_received') {
    return [
      createSignedCustomerDocumentUrl({ kind: 'invoice', merchantId, orderId }),
      data.customerName,
      data.orderNumber,
    ];
  }
  if (step === 'shipped') {
    return [
      data.customerName,
      data.orderNumber,
      data.carrier || '',
      data.trackingNumber || '',
      data.trackingLink || '',
    ];
  }
  if (step === 'product_rating') return [data.customerName, data.orderNumber, data.ratingLink || ''];
  if (step === 'cancelled') return [data.customerName, data.orderNumber];
  if (step === 'refunded') {
    return [data.customerName, data.orderNumber, data.refundAmount || '', data.currency || 'SAR'];
  }
  return [];
}

function requiredDataMissing(step: string, data: JourneyNotificationData): string[] {
  const missing: string[] = [];
  if (!data.customerName) missing.push('customerName');
  if (!data.orderNumber) missing.push('orderNumber');
  if (step === 'shipped') {
    if (!data.carrier) missing.push('carrier');
    if (!data.trackingNumber) missing.push('trackingNumber');
    if (!data.trackingLink) missing.push('trackingLink');
  }
  if (step === 'product_rating' && !data.ratingLink) missing.push('ratingLink');
  if (step === 'refunded' && !data.refundAmount) missing.push('refundAmount');
  return missing;
}

async function sendClaimedNotification(row: any) {
  try {
    if (
      row.step === 'product_rating' &&
      !text(row.dedupeKey).endsWith(':product_rating:delivered')
    ) {
      // Rows created before the delivered-only rule may have started their
      // countdown at `completed`. Never let those legacy schedules send.
      await prisma.customerJourneyNotification.update({
        where: { id: row.id },
        data: {
          status: 'superseded',
          nextAttemptAt: null,
          lastError: 'Legacy rating schedule did not originate from delivered status',
        },
      });
      return { id: row.id, status: 'superseded' };
    }

    const data = await enrichNotification(row);
    const missing = requiredDataMissing(row.step, data);
    if (missing.length > 0) {
      const age = Date.now() - new Date(row.createdAt).getTime();
      await prisma.customerJourneyNotification.update({
        where: { id: row.id },
        data: {
          data: data as unknown as Prisma.InputJsonValue,
          status: age >= MAX_DATA_WAIT_MS ? 'failed' : 'waiting_for_data',
          nextAttemptAt: age >= MAX_DATA_WAIT_MS ? null : new Date(Date.now() + 5 * 60_000),
          failedAt: age >= MAX_DATA_WAIT_MS ? new Date() : null,
          lastError: `Missing required data: ${missing.join(', ')}`,
        },
      });
      return { id: row.id, status: age >= MAX_DATA_WAIT_MS ? 'failed' : 'waiting_for_data' };
    }

    const args = argsForStep({
      step: row.step,
      merchantId: row.merchantId,
      orderId: row.orderId,
      data,
    });
    let response: unknown;
    if (row.messageType === 'richTemplate') {
      response = await sendWhatsAppRichTemplate({
        to: row.recipient,
        templateId: row.templateId,
        lang: row.language,
        args,
      });
    } else if (row.messageType === 'buttonTemplate') {
      response = await sendWhatsAppButtonTemplate({
        to: row.recipient,
        templateId: row.templateId,
        lang: row.language,
        templateArgs: args,
      });
    } else {
      response = await sendWhatsAppTemplate({
        to: row.recipient,
        templateId: row.templateId,
        lang: row.language,
        args,
      });
    }

    const messageId = providerMessageId(response);
    await prisma.customerJourneyNotification.update({
      where: { id: row.id },
      data: {
        data: data as unknown as Prisma.InputJsonValue,
        status: 'accepted',
        providerMessageId: messageId,
        acceptedAt: new Date(),
        nextAttemptAt: null,
        lastError: null,
      },
    });
    return { id: row.id, status: 'accepted' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attemptCount = row.attemptCount + 1;
    const terminal = /Zoko error 4\d\d/i.test(message) || attemptCount >= MAX_SEND_ATTEMPTS;
    const delay = RETRY_DELAYS_MS[Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1)];
    await prisma.customerJourneyNotification.update({
      where: { id: row.id },
      data: {
        status: terminal ? 'failed' : 'retrying',
        attemptCount,
        nextAttemptAt: terminal ? null : new Date(Date.now() + delay),
        failedAt: terminal ? new Date() : null,
        lastError: message,
      },
    });
    log.error('Customer journey notification failed', {
      notificationId: row.id,
      step: row.step,
      attemptCount,
      terminal,
      error: message,
    });
    return { id: row.id, status: terminal ? 'failed' : 'retrying' };
  }
}

export async function processDueCustomerJourneyNotifications(limit = 50) {
  if (!env.ZOKO_CUSTOMER_JOURNEY_ENABLED) {
    return { processed: 0, results: [], disabled: true };
  }
  const now = new Date();
  await prisma.customerJourneyNotification.updateMany({
    where: {
      status: 'processing',
      updatedAt: { lte: new Date(now.getTime() - 10 * 60_000) },
    },
    data: {
      status: 'retrying',
      nextAttemptAt: now,
      lastError: 'Worker lease expired before completion',
    },
  });
  const candidates = await prisma.customerJourneyNotification.findMany({
    where: {
      status: { in: ['pending', 'waiting_for_data', 'retrying'] },
      scheduledFor: { lte: now },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 100)),
  });
  const results = [];
  for (const candidate of candidates) {
    const claimed = await prisma.customerJourneyNotification.updateMany({
      where: {
        id: candidate.id,
        status: { in: ['pending', 'waiting_for_data', 'retrying'] },
      },
      data: { status: 'processing' },
    });
    if (claimed.count !== 1) continue;
    results.push(await sendClaimedNotification(candidate));
  }
  return { processed: results.length, results, disabled: false };
}

export async function reconcileCustomerJourneyDelivery(input: {
  providerMessageId: string;
  deliveryStatus?: string | null;
  occurredAt?: Date | null;
}) {
  const status = text(input.deliveryStatus).toLowerCase();
  if (!input.providerMessageId || !status) return { count: 0 };
  const occurredAt = input.occurredAt ?? new Date();
  const data: Prisma.CustomerJourneyNotificationUpdateManyMutationInput = {};
  if (status === 'read') {
    data.status = 'read';
    data.readAt = occurredAt;
    data.deliveredAt = occurredAt;
  } else if (status === 'delivered') {
    data.status = 'delivered';
    data.deliveredAt = occurredAt;
  } else if (status === 'sent' || status === 'accepted') {
    data.status = 'accepted';
    data.acceptedAt = occurredAt;
  } else if (['failed', 'undelivered', 'rejected', 'expired'].includes(status)) {
    data.status = 'failed';
    data.failedAt = occurredAt;
    data.lastError = `Zoko delivery ${status}`;
  } else {
    return { count: 0 };
  }
  return prisma.customerJourneyNotification.updateMany({
    where: { providerMessageId: input.providerMessageId },
    data,
  });
}
