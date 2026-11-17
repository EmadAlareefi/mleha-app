import { prisma } from '@/lib/prisma';
import { log } from '@/app/lib/logger';
import { normalizeE164Phone } from '@/app/lib/phone';
import { normalizeOrderReference } from '@/app/lib/salla-order-reference';
import { getOrderCustomerPhones, orderBelongsToPhone } from '@/app/lib/returns/customer-phone';
import { sendWhatsAppTemplate } from '@/app/lib/zoko';
import { sendMsegatSms } from '@/app/lib/msegat';
import {
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  SESSION_TTL_MS,
  codeMatches,
  codeRowUsable,
  decideSend,
  generateCode,
  generateSessionToken,
  hashCode,
  hashSessionToken,
  normalizeCode,
  sessionRowValid,
  type AccessChannel,
} from './access';
import { getOrderManageSettings, isPilotAllowed } from './settings';

/**
 * Database and messaging side of the /my-order sign-in. Orders are looked up
 * in the local mirror only, so anonymous traffic never costs a Salla call.
 */

export const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/** Same per-IP budget, and the same ledger, as the public order lookup. */
const IP_WINDOW_MS = 10 * 60_000;
const MAX_REQUESTS_PER_IP = 20;
const MAX_MISSES_PER_IP = 8;

async function isIpLimited(ipHash: string | null): Promise<boolean> {
  if (!ipHash) return false;
  const since = new Date(Date.now() - IP_WINDOW_MS);
  const [total, misses] = await Promise.all([
    prisma.publicOrderLookupAttempt.count({ where: { ipHash, createdAt: { gte: since } } }),
    prisma.publicOrderLookupAttempt.count({ where: { ipHash, found: false, createdAt: { gte: since } } }),
  ]);
  return total >= MAX_REQUESTS_PER_IP || misses >= MAX_MISSES_PER_IP;
}

async function recordAttempt(ipHash: string | null, reference: string | null, found: boolean) {
  if (!ipHash) return;
  await prisma.publicOrderLookupAttempt
    .create({ data: { ipHash, merchantId: MERCHANT_ID, reference, found } })
    .catch((error) => log.warn('Failed to record order-manage attempt', { error: error instanceof Error ? error.message : error }));
}

type MatchedOrder = { orderId: string; orderNumber: string; phone: string };

/** The order behind a number, only when the supplied mobile is the customer's. */
async function findOwnedOrder(reference: string, mobile: unknown): Promise<MatchedOrder | null> {
  const rows = await prisma.sallaOrder.findMany({
    where: { merchantId: MERCHANT_ID, OR: [{ referenceId: reference }, { orderNumber: reference }] },
    select: { orderId: true, referenceId: true, orderNumber: true, rawOrder: true },
    take: 3,
  });
  const settings = await getOrderManageSettings();
  for (const row of rows) {
    if (!orderBelongsToPhone(row.rawOrder, mobile)) continue;
    if (!isPilotAllowed(settings, getOrderCustomerPhones(row.rawOrder))) continue;
    return {
      orderId: row.orderId,
      orderNumber: row.referenceId || row.orderNumber || reference,
      phone: normalizeE164Phone(String(mobile)),
    };
  }
  return null;
}

async function deliverCode(order: MatchedOrder, code: string, preferred: AccessChannel): Promise<AccessChannel> {
  const templateId = process.env.ZOKO_TPL_ORDER_MANAGE_OTP;
  if (preferred === 'whatsapp' && templateId) {
    try {
      await sendWhatsAppTemplate({ to: order.phone, templateId, args: [code] });
      return 'whatsapp';
    } catch (error) {
      log.warn('Order-manage code could not be sent by WhatsApp; trying SMS', {
        orderId: order.orderId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
  await sendMsegatSms({
    to: order.phone,
    body: `رمز التحقق لإدارة طلبك رقم ${order.orderNumber}: ${code}\nصالح لمدة 10 دقائق. لا تشاركيه مع أحد.`,
  });
  return 'sms';
}

export type StartResult =
  | { status: 'sent' }
  | { status: 'unavailable' }
  | { status: 'rate_limited' }
  | { status: 'wait'; retryAfterSeconds: number }
  | { status: 'limit' }
  | { status: 'send_failed' };

/**
 * Sends a one-time code to the order's mobile. An unknown order and a wrong
 * mobile get the same `sent` answer as a real match, so the reply cannot be
 * used to test numbers; only a customer who already knows both can reach the
 * throttle answers.
 */
export async function startAccess(input: {
  orderNumber: unknown;
  mobile: unknown;
  channel?: unknown;
  ipHash: string | null;
}): Promise<StartResult> {
  const settings = await getOrderManageSettings();
  if (!settings.enabled) return { status: 'unavailable' };
  if (await isIpLimited(input.ipHash)) return { status: 'rate_limited' };

  const reference = normalizeOrderReference(input.orderNumber);
  const order = reference ? await findOwnedOrder(reference, input.mobile) : null;
  await recordAttempt(input.ipHash, reference, Boolean(order));
  if (!order) return { status: 'sent' };

  const now = Date.now();
  const [orderLastHour, orderLastDay, ipLastHour, last] = await Promise.all([
    prisma.customerOrderAccess.count({
      where: { merchantId: MERCHANT_ID, orderId: order.orderId, createdAt: { gte: new Date(now - 3_600_000) } },
    }),
    prisma.customerOrderAccess.count({
      where: { merchantId: MERCHANT_ID, orderId: order.orderId, createdAt: { gte: new Date(now - 86_400_000) } },
    }),
    input.ipHash
      ? prisma.customerOrderAccess.count({ where: { ipHash: input.ipHash, createdAt: { gte: new Date(now - 3_600_000) } } })
      : Promise.resolve(0),
    prisma.customerOrderAccess.findFirst({
      where: { merchantId: MERCHANT_ID, orderId: order.orderId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  const decision = decideSend({
    orderLastHour,
    orderLastDay,
    ipLastHour,
    msSinceLastSend: last ? now - last.createdAt.getTime() : null,
  });
  if (!decision.allowed) {
    return decision.reason === 'wait' ? { status: 'wait', retryAfterSeconds: decision.retryAfterSeconds } : { status: 'limit' };
  }

  const preferred: AccessChannel = input.channel === 'sms' ? 'sms' : 'whatsapp';
  const code = generateCode();
  const access = await prisma.customerOrderAccess.create({
    data: {
      merchantId: MERCHANT_ID,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      channel: preferred,
      // Replaced right below: the hash is bound to the row id.
      codeHash: '',
      codeExpiresAt: new Date(now + CODE_TTL_MS),
      ipHash: input.ipHash,
    },
    select: { id: true },
  });
  await prisma.customerOrderAccess.update({ where: { id: access.id }, data: { codeHash: hashCode(code, access.id) } });

  // Any earlier code for this order stops working once a new one is issued.
  await prisma.customerOrderAccess.updateMany({
    where: { merchantId: MERCHANT_ID, orderId: order.orderId, id: { not: access.id }, verifiedAt: null, revokedAt: null },
    data: { revokedAt: new Date(now) },
  });

  try {
    const channel = await deliverCode(order, code, preferred);
    if (channel !== preferred) {
      await prisma.customerOrderAccess.update({ where: { id: access.id }, data: { channel } });
    }
    await prisma.messageLog
      .create({
        // The code itself is never logged.
        data: { orderId: order.orderId, toPhone: order.phone, channel, templateName: 'order_manage_code', status: 'sent' },
      })
      .catch(() => undefined);
    return { status: 'sent' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Order-manage code could not be sent', { orderId: order.orderId, error: message });
    await prisma.customerOrderAccess.update({ where: { id: access.id }, data: { revokedAt: new Date() } }).catch(() => undefined);
    await prisma.messageLog
      .create({
        data: {
          orderId: order.orderId,
          toPhone: order.phone,
          channel: preferred,
          templateName: 'order_manage_code',
          status: 'failed',
          error: message,
        },
      })
      .catch(() => undefined);
    return { status: 'send_failed' };
  }
}

export type VerifyResult =
  | { status: 'ok'; token: string; expiresAt: Date }
  | { status: 'unavailable' }
  | { status: 'rate_limited' }
  | { status: 'invalid' };

/** Exchanges a correct code for a session. Every failure looks the same to the caller. */
export async function verifyAccess(input: {
  orderNumber: unknown;
  mobile: unknown;
  code: unknown;
  ipHash: string | null;
}): Promise<VerifyResult> {
  const settings = await getOrderManageSettings();
  if (!settings.enabled) return { status: 'unavailable' };
  if (await isIpLimited(input.ipHash)) return { status: 'rate_limited' };

  const reference = normalizeOrderReference(input.orderNumber);
  const code = normalizeCode(input.code);
  const order = reference && code.length === 6 ? await findOwnedOrder(reference, input.mobile) : null;
  if (!order) {
    await recordAttempt(input.ipHash, reference, false);
    return { status: 'invalid' };
  }

  const now = new Date();
  const row = await prisma.customerOrderAccess.findFirst({
    where: { merchantId: MERCHANT_ID, orderId: order.orderId, verifiedAt: null, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, codeHash: true, attempts: true, codeExpiresAt: true, verifiedAt: true, revokedAt: true },
  });
  if (!row || !row.codeHash || !codeRowUsable(row, now)) {
    await recordAttempt(input.ipHash, reference, false);
    return { status: 'invalid' };
  }

  // Count the attempt before looking at the code, so parallel guesses cannot
  // share one slot.
  const counted = await prisma.customerOrderAccess.updateMany({
    where: { id: row.id, verifiedAt: null, revokedAt: null, attempts: { lt: CODE_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0 || !codeMatches(code, row.id, row.codeHash)) {
    await recordAttempt(input.ipHash, reference, false);
    return { status: 'invalid' };
  }

  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const claimed = await prisma.customerOrderAccess.updateMany({
    where: { id: row.id, verifiedAt: null, revokedAt: null },
    data: { verifiedAt: now, sessionTokenHash: hashSessionToken(token), sessionExpiresAt: expiresAt },
  });
  if (claimed.count === 0) return { status: 'invalid' };
  await recordAttempt(input.ipHash, reference, true);
  return { status: 'ok', token, expiresAt };
}

export type OrderSession = { accessId: string; merchantId: string; orderId: string; orderNumber: string | null };

export async function getOrderSession(token: string | undefined | null): Promise<OrderSession | null> {
  if (!token) return null;
  const row = await prisma.customerOrderAccess.findUnique({
    where: { sessionTokenHash: hashSessionToken(token) },
    select: { id: true, merchantId: true, orderId: true, orderNumber: true, verifiedAt: true, revokedAt: true, sessionExpiresAt: true },
  });
  if (!row || !sessionRowValid(row, new Date())) return null;
  return { accessId: row.id, merchantId: row.merchantId, orderId: row.orderId, orderNumber: row.orderNumber };
}

export async function revokeOrderSession(accessId: string): Promise<void> {
  await prisma.customerOrderAccess.updateMany({ where: { id: accessId, revokedAt: null }, data: { revokedAt: new Date() } });
}
