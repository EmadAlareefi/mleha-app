import crypto from 'crypto';

export const DELIVERY_OTP_EXPIRY_MINUTES = 10;

export function generateDeliveryOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

export function hashDeliveryOtp(code: string) {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

export function maskPhoneNumber(msisdn: string) {
  const digits = msisdn.replace(/\D/g, '');
  if (digits.length <= 4) {
    return digits;
  }
  const maskedLength = Math.max(digits.length - 4, 2);
  return `${'*'.repeat(maskedLength)}${digits.slice(-4)}`;
}
