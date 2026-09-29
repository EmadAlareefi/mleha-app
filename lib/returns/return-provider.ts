import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { isAjexConfigured } from '@/app/lib/ajex-api';
import { extractSallaTrackingNumber } from '@/app/lib/salla-shipment';
import { getShippingCompanyName } from '@/app/lib/shipping-company';
import { detectShipmentCompany } from '@/lib/shipment-detector';

/**
 * Who books the return waybill for a new return request:
 *  - `ajex`  orders AJEX delivered: the app books the reverse pickup with AJEX
 *  - `salla` every other courier: Salla issues it (`create_return_policy`)
 */
export type ReturnShipmentProvider = 'salla' | 'ajex';

const AJEX_NAME_PATTERN = /ajex|aj-ex|أ?[يا]جكس|أجكس|اجكس/i;

export const isAjexCourierName = (value: unknown) =>
  typeof value === 'string' && AJEX_NAME_PATTERN.test(value);

export const isAjexTrackingNumber = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '' && detectShipmentCompany(value).id === 'ajex';

type AnyRecord = Record<string, any>;

/**
 * Whether the order's outbound shipment went with AJEX. The stored Salla
 * shipment is the most reliable signal, then the courier name on the order,
 * then the shape of its tracking number.
 */
export function orderShippedWithAjex(
  order: AnyRecord,
  sallaShipment?: { courierCode?: string | null; courierName?: string | null; trackingNumber?: string | null } | null
): boolean {
  if (sallaShipment) {
    const courierText = [sallaShipment.courierCode, sallaShipment.courierName].filter(Boolean).join(' ');
    if (courierText) return isAjexCourierName(courierText);
    if (sallaShipment.trackingNumber) return isAjexTrackingNumber(sallaShipment.trackingNumber);
  }

  const companyName = getShippingCompanyName(order);
  if (companyName) return isAjexCourierName(companyName);

  return isAjexTrackingNumber(extractSallaTrackingNumber(order as any));
}

export async function resolveReturnShipmentProvider(
  merchantId: string,
  order: AnyRecord
): Promise<ReturnShipmentProvider> {
  const orderId = String(order.id ?? '');
  const sallaShipment = orderId
    ? await prisma.sallaShipment.findUnique({
        where: { merchantId_orderId: { merchantId, orderId } },
        select: { courierCode: true, courierName: true, trackingNumber: true },
      })
    : null;

  if (!orderShippedWithAjex(order, sallaShipment)) return 'salla';

  if (!isAjexConfigured()) {
    // Better a Salla-issued waybill than no return at all.
    log.warn('AJEX order returned via Salla because AJEX API credentials are not configured', {
      merchantId,
      orderId,
    });
    return 'salla';
  }

  return 'ajex';
}

/** The provider a stored request was created with, read from its `smsaResponse`. */
export const getRequestShipmentProvider = (smsaResponse: unknown): string | null => {
  if (!smsaResponse || typeof smsaResponse !== 'object') return null;
  const provider = (smsaResponse as Record<string, unknown>).provider;
  return typeof provider === 'string' ? provider.trim().toLowerCase() : null;
};

export const isAjexReturnRequest = (smsaResponse: unknown) =>
  getRequestShipmentProvider(smsaResponse) === 'ajex';
