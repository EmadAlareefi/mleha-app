import { sendWhatsAppTemplate } from '@/app/lib/zoko';
import { normalizeKSA } from '@/app/lib/phone';
import { env } from '@/app/lib/env';
import { log } from '@/app/lib/logger';

export type CouponNotificationStatus = 'sent' | 'skipped' | 'failed';

export interface CouponNotificationInput {
  customerName?: string | null;
  customerPhone?: string | null;
  orderNumber?: string | null;
  couponCode: string;
  /** Customer-facing pre-VAT coupon value. */
  discountedAmount: number;
  /** Customer-facing VAT-inclusive credit the customer receives. */
  fullAmount: number;
  currency?: string | null;
  sarFullAmount?: number | null;
  expiryDate?: Date;
}

export interface CouponNotificationResult {
  status: CouponNotificationStatus;
  error?: string;
  response?: unknown;
  reason?: string;
}

const FALLBACK_TEMPLATE_ID = env.ZOKO_TPL_EXCHANGE_COUPON || 'exchange_coupon_ready';
const FALLBACK_CUSTOMER_NAME = 'عميلنا العزيز';

/**
 * Combined amount shown to the customer, e.g. "383.48 (441.00 شامل الضريبة)".
 * The discounted value is the coupon face value; the full value is the
 * VAT-inclusive credit the customer effectively receives at checkout.
 */
const formatCouponAmount = (
  discountedAmount: number,
  fullAmount: number,
  currency?: string | null,
  sarFullAmount?: number | null,
) => {
  const safeDiscounted = Number.isFinite(discountedAmount) ? discountedAmount : 0;
  const safeFull = Number.isFinite(fullAmount) ? fullAmount : 0;
  const normalizedCurrency = currency?.trim().toUpperCase() || 'SAR';
  const suffix = normalizedCurrency === 'SAR' ? 'ر.س' : normalizedCurrency;
  const baseText = `${safeDiscounted.toFixed(2)} ${suffix} (${safeFull.toFixed(2)} ${suffix} شامل الضريبة)`;

  if (normalizedCurrency === 'SAR' || !sarFullAmount || !Number.isFinite(sarFullAmount)) {
    return baseText;
  }

  return `${baseText} - يعادل ${sarFullAmount.toFixed(2)} ر.س`;
};

const formatExpiry = (expiryDate?: Date) => {
  if (!(expiryDate instanceof Date) || Number.isNaN(expiryDate.getTime())) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(env.WHATSAPP_DEFAULT_LANG || 'ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(expiryDate);
  } catch {
    return expiryDate.toISOString().split('T')[0] ?? '';
  }
};

export async function notifyExchangeCoupon(
  payload: CouponNotificationInput
): Promise<CouponNotificationResult> {
  const templateId = FALLBACK_TEMPLATE_ID;

  if (!templateId) {
    const error = 'ZOKO_TPL_EXCHANGE_COUPON env is not configured';
    log.error('Missing template id for exchange coupon notification', {
      couponCode: payload.couponCode,
    });
    return { status: 'failed', error };
  }

  const normalizedRecipient = normalizeKSA(payload.customerPhone);

  if (!normalizedRecipient) {
    log.warn('Skipping coupon notification because phone number is missing', {
      couponCode: payload.couponCode,
    });
    return { status: 'skipped', reason: 'missing_phone' };
  }

  const templateArgs: (string | number)[] = [
    payload.customerName?.trim() || FALLBACK_CUSTOMER_NAME,
    payload.couponCode,
    formatCouponAmount(
      payload.discountedAmount,
      payload.fullAmount,
      payload.currency,
      payload.sarFullAmount,
    ),
    formatExpiry(payload.expiryDate),
    payload.orderNumber || '',
  ];

  try {
    const response = await sendWhatsAppTemplate({
      to: normalizedRecipient,
      templateId,
      args: templateArgs,
    });

    log.info('Coupon notification sent via Zoko', {
      couponCode: payload.couponCode,
      to: normalizedRecipient,
    });

    return {
      status: 'sent',
      response,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    log.error('Failed to send coupon notification via Zoko', {
      couponCode: payload.couponCode,
      to: normalizedRecipient,
      error: errorMessage,
    });

    return {
      status: 'failed',
      error: errorMessage,
    };
  }
}
