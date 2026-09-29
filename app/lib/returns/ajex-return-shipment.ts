import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import type { SallaOrder } from '@/app/lib/salla-api';
import { createAjexReturnShipment, type AjexShipmentResult } from '@/app/lib/ajex-api';
import {
  buildConsigneeAddressFromOrder,
  buildMerchantShipperAddress,
} from '@/app/lib/manual-smsa/address';
import { createSignedCustomerDocumentUrl } from '@/app/lib/customer-document-links';
import { maybeNotifyReturnLabelCreated } from '@/app/lib/returns/return-label-notification';

/** Per-item weight used when the order carries none; same rule the SMSA C2B flow used. */
const WEIGHT_PER_ITEM_KG = 0.5;
const RETURN_LABEL_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface BookAjexReturnInput {
  order: SallaOrder;
  quantity: number;
  declaredValue: number;
  currency: string;
}

/**
 * Books the reverse pickup with AJEX. The customer is the pickup point and the
 * warehouse (`SMSA_MERCHANT_*` / `NEXT_PUBLIC_MERCHANT_*`) the destination.
 */
export async function bookAjexReturnShipment(input: BookAjexReturnInput): Promise<AjexShipmentResult> {
  const orderReference = String(input.order.reference_id || input.order.id);
  const quantity = Math.max(1, input.quantity);

  return createAjexReturnShipment({
    // Unique per attempt so a re-issue or a second return on the same order is
    // not rejected as a duplicate; the `R-` prefix marks it as a return.
    referenceId: `R-${orderReference}-${Date.now().toString(36)}`,
    orderNumber: orderReference,
    pickup: buildConsigneeAddressFromOrder(input.order),
    receiver: buildMerchantShipperAddress(),
    pieces: quantity,
    weightKg: quantity * WEIGHT_PER_ITEM_KG,
    declaredValue: input.declaredValue,
    currency: input.currency,
    description: `Return for Order ${orderReference}`,
  });
}

/** The stored `smsaResponse` for an AJEX-booked request. */
export const buildAjexSmsaResponse = (result: AjexShipmentResult) => ({
  provider: 'ajex',
  trackingNumber: result.trackingNumber ?? null,
  labelUrl: result.labelUrl ?? null,
  request: result.request ?? null,
  // The base64 PDF is served on demand from AJEX, not kept in the row.
  response: stripLabelBase64(result.rawResponse),
});

const stripLabelBase64 = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return value ?? null;
  if (Array.isArray(value)) return value.map(stripLabelBase64);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) =>
      typeof entry === 'string' && entry.length > 2000 ? [key, '[omitted]'] : [key, stripLabelBase64(entry)],
    ),
  );
};

/** A long-lived signed link to `/api/public/order-documents/return-label/...`. */
export const buildSignedReturnLabelUrl = (merchantId: string, returnRequestId: string) =>
  createSignedCustomerDocumentUrl({
    kind: 'return-label',
    merchantId,
    orderId: returnRequestId,
    expiresAt: Math.floor(Date.now() / 1000) + RETURN_LABEL_LINK_TTL_SECONDS,
  });

/**
 * Stores the label link on the request and sends it on WhatsApp. AJEX returns
 * the waybill synchronously, so unlike the Salla flow there is nothing to poll.
 */
export async function publishAjexReturnLabel(
  returnRequest: {
    id: string;
    merchantId: string;
    orderId: string;
    orderNumber: string | null;
    smsaTrackingNumber: string | null;
  },
  result: AjexShipmentResult,
  source: string,
) {
  // AJEX's own waybillFileUrl carries a short-lived token, so the customer gets
  // our signed link, which fetches a fresh PDF from AJEX on every open.
  let labelUrl: string | null;
  try {
    labelUrl = buildSignedReturnLabelUrl(returnRequest.merchantId, returnRequest.id);
  } catch (error) {
    log.error('Cannot build signed AJEX return label link', {
      returnRequestId: returnRequest.id,
      error: error instanceof Error ? error.message : error,
    });
    labelUrl = result.labelUrl ?? null;
  }
  if (!labelUrl) return null;

  await prisma.returnRequest.update({
    where: { id: returnRequest.id },
    data: { returnLabelUrl: labelUrl },
  });

  return maybeNotifyReturnLabelCreated({
    merchantId: returnRequest.merchantId,
    orderId: returnRequest.orderId,
    orderNumber: returnRequest.orderNumber,
    returnRequestId: returnRequest.id,
    labelUrl,
    trackingNumber: returnRequest.smsaTrackingNumber,
    source,
  });
}
