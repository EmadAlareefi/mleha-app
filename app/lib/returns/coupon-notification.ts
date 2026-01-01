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
  amount: number;
  expiryDate?: Date;
  currencyLabel?: string;
}

export interface CouponNotificationResult {
  status: CouponNotificationStatus;
  error?: string;
  response?: unknown;
  reason?: string;
}

const FALLBACK_TEMPLATE_ID = env.ZOKO_TPL_EXCHANGE_COUPON || 'exchange_coupon_ready';
const FALLBACK_CURRENCY = process.env.EXCHANGE_COUPON_CURRENCY_LABEL || 'ر.س';
const FALLBACK_CUSTOMER_NAME = 'عميلنا العزيز';

const formatAmount = (amount: number, currencyLabel: string = FALLBACK_CURRENCY) => {
  if (!Number.isFinite(amount)) {
    return `0.00 ${currencyLabel}`;
  }
  return `${amount.toFixed(2)} ${currencyLabel}`;
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
    formatAmount(payload.amount, payload.currencyLabel),
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
