import { env } from './env';
import { normalizeKSA } from './phone';
import { withBackoff } from './retry';

type SendSmsArgs = {
  to: string;
  body: string;
};

type MsegatResponse = {
  code?: string | number;
  message?: string;
  result?: string;
  data?: unknown;
};

function ensureCredentials() {
  if (!env.MSEGAT_USERNAME || !env.MSEGAT_API_KEY || !env.MSEGAT_SENDER_ID) {
    throw new Error('بيانات اتصال مسجات غير مكتملة');
  }
}

function formatRecipient(msisdn: string): string {
  const normalized = normalizeKSA(msisdn).replace(/^\+/, '');
  if (!/^\d{9,15}$/.test(normalized)) {
    throw new Error('رقم الهاتف غير صالح أو غير مدعوم');
  }
  return normalized;
}

async function postToMsegat(payload: Record<string, unknown>) {
  const response = await fetch(env.MSEGAT_API_URL || 'https://www.msegat.com/gw/sendsms.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let parsed: MsegatResponse | null = null;
  try {
    parsed = text ? (JSON.parse(text) as MsegatResponse) : null;
  } catch {
    parsed = null;
  }

  const errorMessage =
    parsed?.message ||
    parsed?.result ||
    (text && text.trim().length > 0 ? text : 'تعذر إرسال رسالة عبر مسجات');

  if (!response.ok) {
    throw new Error(errorMessage);
  }

  const code = parsed?.code;
  if (
    code !== undefined &&
    code !== null &&
    String(code).trim().length > 0 &&
    String(code).trim().toLowerCase() !== '1' &&
    String(code).trim().toLowerCase() !== 'success'
  ) {
    throw new Error(errorMessage || 'تعذر إرسال رسالة عبر مسجات');
  }

  return parsed ?? { code: '1', message: 'Success' };
}

export async function sendMsegatSms({ to, body }: SendSmsArgs) {
  ensureCredentials();
  const target = env.MSEGAT_DEBUG_RECIPIENT?.trim() || to;
  const recipient = formatRecipient(target);
  if (!body || body.trim().length === 0) {
    throw new Error('نص الرسالة مطلوب');
  }

  const payload = {
    userName: env.MSEGAT_USERNAME,
    apiKey: env.MSEGAT_API_KEY,
    userSender: env.MSEGAT_SENDER_ID,
    numbers: recipient,
    msg: body,
    msgEncoding: 'UTF8',
  };

  return withBackoff(() => postToMsegat(payload));
}
