import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import {
  normalizers,
  extractCustomer,
  buildCustomerName,
  extractAmounts,
  extractCurrency,
  extractDates,
  extractFulfillmentStatus,
  extractPaymentStatus,
  extractOrderNumber,
  extractReferenceId,
  extractPaymentMethod,
  deriveStatusInfo,
  extractCampaign,
} from '@/app/lib/salla-orders';
import { normalizeAffiliateName, sanitizeAffiliateName } from '@/lib/affiliate';

export async function upsertSallaOrderFromPayload(payload: any): Promise<{
  success: boolean;
  orderId?: string;
  merchantId?: string;
}> {
  if (!payload) {
    return { success: false };
  }

  const order = payload?.order ?? payload ?? {};
  const merchantId = normalizers.id(
    order?.merchant_id ??
      order?.merchantId ??
      order?.store?.id ??
      order?.store_id ??
      order?.storeId ??
      payload?.merchant ??
      payload?.merchant_id ??
      payload?.store?.id ??
      payload?.store_id ??
      payload?.storeId ??
      payload?.merchantId
  );
  const orderId = normalizers.id(order?.id ?? order?.order_id ?? order?.orderId);

  if (!merchantId || !orderId) {
    log.warn('Missing merchant or order id when syncing webhook payload', {
      merchantId,
      orderId,
    });
    return { success: false };
  }

  const customer = extractCustomer(order);
  const customerName = buildCustomerName(customer);
  const amounts = extractAmounts(order);
  const currency = extractCurrency(order);
  const dates = extractDates(order);
  const { slug: statusSlug, name: statusName } = deriveStatusInfo(order);
  const campaign = extractCampaign(order);
  const sanitizedCampaignName = sanitizeAffiliateName(campaign.name);
  const normalizedCampaignName = normalizeAffiliateName(campaign.name);

  let affiliateCommission = new Prisma.Decimal(10.0);
  if (normalizedCampaignName) {
    const affiliateUser = await prisma.orderUser.findFirst({
      where: {
        affiliateName: {
          equals: normalizedCampaignName,
          mode: 'insensitive',
        },
      },
      select: { affiliateCommission: true },
    });
    if (affiliateUser?.affiliateCommission) {
      affiliateCommission = affiliateUser.affiliateCommission;
    }
  }

  await prisma.sallaOrder.upsert({
    where: {
      merchantId_orderId: {
        merchantId,
        orderId,
      },
    },
    create: {
      merchantId,
      orderId,
      referenceId: extractReferenceId(order) ?? undefined,
      orderNumber: extractOrderNumber(order) ?? undefined,
      statusSlug: statusSlug ?? undefined,
      statusName: statusName ?? undefined,
      fulfillmentStatus: extractFulfillmentStatus(order) ?? undefined,
      paymentStatus: extractPaymentStatus(order) ?? undefined,
      currency: currency ?? undefined,
      subtotalAmount: amounts.subtotal ?? undefined,
      taxAmount: amounts.tax ?? undefined,
      shippingAmount: amounts.shipping ?? undefined,
      discountAmount: amounts.discount ?? undefined,
      totalAmount: amounts.total ?? undefined,
      customerId: normalizers.id(customer?.id ?? order.customer_id) ?? undefined,
      customerName: customerName ?? undefined,
      customerMobile: normalizers.string(
        customer?.mobile ?? customer?.phone ?? order.customer_mobile ?? order.customer_phone
      ) ?? undefined,
      customerEmail: normalizers.string(customer?.email ?? order.customer_email) ?? undefined,
      customerCity: normalizers.string(
        customer?.city ?? order.shipping_address?.city ?? order.billing_address?.city
      ) ?? undefined,
      customerCountry: normalizers.string(
        customer?.country ?? order.shipping_address?.country ?? order.billing_address?.country
      ) ?? undefined,
      paymentMethod: extractPaymentMethod(order) ?? undefined,
      fulfillmentCompany: normalizers.string(order.shipping?.company) ?? undefined,
      trackingNumber: normalizers.string(order.shipping?.tracking_number) ?? undefined,
      placedAt: dates.created ?? undefined,
      updatedAtRemote: dates.updated ?? undefined,
      campaignSource: campaign.source ?? undefined,
      campaignMedium: campaign.medium ?? undefined,
      campaignName: sanitizedCampaignName ?? undefined,
      affiliateCommission: affiliateCommission,
      rawOrder: order,
    },
    update: {
      referenceId: extractReferenceId(order) ?? undefined,
      orderNumber: extractOrderNumber(order) ?? undefined,
      statusSlug: statusSlug ?? undefined,
      statusName: statusName ?? undefined,
      fulfillmentStatus: extractFulfillmentStatus(order) ?? undefined,
      paymentStatus: extractPaymentStatus(order) ?? undefined,
      currency: currency ?? undefined,
      subtotalAmount: amounts.subtotal ?? undefined,
      taxAmount: amounts.tax ?? undefined,
      shippingAmount: amounts.shipping ?? undefined,
      discountAmount: amounts.discount ?? undefined,
      totalAmount: amounts.total ?? undefined,
      customerId: normalizers.id(customer?.id ?? order.customer_id) ?? undefined,
      customerName: customerName ?? undefined,
      customerMobile: normalizers.string(
        customer?.mobile ?? customer?.phone ?? order.customer_mobile ?? order.customer_phone
      ) ?? undefined,
      customerEmail: normalizers.string(customer?.email ?? order.customer_email) ?? undefined,
      customerCity: normalizers.string(
        customer?.city ?? order.shipping_address?.city ?? order.billing_address?.city
      ) ?? undefined,
      customerCountry: normalizers.string(
        customer?.country ?? order.shipping_address?.country ?? order.billing_address?.country
      ) ?? undefined,
      paymentMethod: extractPaymentMethod(order) ?? undefined,
      fulfillmentCompany: normalizers.string(order.shipping?.company) ?? undefined,
      trackingNumber: normalizers.string(order.shipping?.tracking_number) ?? undefined,
      placedAt: dates.created ?? undefined,
      updatedAtRemote: dates.updated ?? undefined,
      campaignSource: campaign.source ?? undefined,
      campaignMedium: campaign.medium ?? undefined,
      campaignName: sanitizedCampaignName ?? undefined,
      affiliateCommission: affiliateCommission,
      rawOrder: order,
    },
  });

  return { success: true, orderId, merchantId };
}
