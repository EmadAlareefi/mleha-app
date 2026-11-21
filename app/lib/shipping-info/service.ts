import { Prisma, type ShippingInfoRequest } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { env } from '@/app/lib/env';
import { log } from '@/app/lib/logger';
import { normalizePhoneWithDialCode } from '@/app/lib/phone';
import { sendWhatsAppButtonTemplate } from '@/app/lib/zoko';
import { sallaMakeRequest } from '@/app/lib/salla-oauth';
import { updateSallaOrderStatus } from '@/app/lib/salla-order-status';
import { deriveStatusCustomId } from '@/app/lib/salla-orders';
import { detectInternationalOrder } from '@/app/lib/order-destination';
import { fetchLiveOrder, refreshMirrorFromLive } from '@/app/lib/order-prep/salla-live';
import { NEW_ORDER_STATUS_ID } from '@/app/lib/order-prep/sync-rules';
import { createShippingInfoUrl } from './links';
import {
  buildOrderUpdatePayload,
  extractShippingInfo,
  findMissingFields,
  fullNameOf,
  parseSubmission,
  type SubmissionError,
} from './rules';
import { getShippingInfoSettings } from './settings';

type AnyRecord = Record<string, any>;

/** A request that still holds its order (the prep queue checks the same flag). */
const OPEN_STATUSES = ['pending', 'applying', 'failed'];
/** An "applying" row older than this is treated as abandoned and may be retried. */
const APPLY_LOCK_MS = 5 * 60_000;

const asRecord = (value: unknown): AnyRecord => (value && typeof value === 'object' ? (value as AnyRecord) : {});

function customerPhoneOf(order: AnyRecord): string {
  const customer = asRecord(order.customer);
  return normalizePhoneWithDialCode(
    customer.mobile ?? customer.phone ?? '',
    customer.mobile_code ?? customer.mobileCode ?? customer.phone_code ?? customer.country_code ?? '',
  );
}

function orderNumberOf(order: AnyRecord): string {
  return String(order.reference_id ?? order.referenceId ?? order.order_number ?? order.id ?? '').trim();
}

const isPendingPayment = (order: AnyRecord): boolean =>
  order.is_pending_payment === true || asRecord(order.status).slug === 'payment_pending';

/**
 * Called from the order webhooks. Holds an international order whose shipping
 * info is incomplete: moves it to the hold status in Salla and messages the
 * customer a link to complete it. Safe to call repeatedly — one row per order.
 * Never throws; the webhook must not fail because of this.
 */
export async function maybeHoldIncompleteInternationalOrder(input: {
  merchantId: string | null | undefined;
  order: AnyRecord;
}): Promise<{ held: boolean; reason?: string }> {
  try {
    const merchantId = String(input.merchantId ?? '').trim();
    const order = input.order ?? {};
    const orderId = String(order.id ?? order.order_id ?? '').trim();
    if (!merchantId || !orderId) return { held: false, reason: 'missing_ids' };

    const settings = await getShippingInfoSettings();
    if (!settings.enabled) return { held: false, reason: 'disabled' };
    if (!settings.holdStatusId) return { held: false, reason: 'no_hold_status' };

    // Only orders that just reached "طلب جديد" and are paid: earlier is too soon,
    // later means staff already took it.
    if (deriveStatusCustomId(order) !== NEW_ORDER_STATUS_ID) return { held: false, reason: 'not_new_order' };
    if (isPendingPayment(order)) return { held: false, reason: 'pending_payment' };

    const destination = detectInternationalOrder(order);
    if (!destination.isInternational) return { held: false, reason: 'domestic' };

    const info = extractShippingInfo(order);
    const missing = findMissingFields(info);
    if (missing.length === 0) return { held: false, reason: 'complete' };

    const phone = customerPhoneOf(order);
    if (settings.pilotMobiles.length > 0 && !settings.pilotMobiles.includes(phone)) {
      return { held: false, reason: 'not_in_pilot' };
    }

    let row: ShippingInfoRequest;
    try {
      row = await prisma.shippingInfoRequest.create({
        data: {
          merchantId,
          orderId,
          orderNumber: orderNumberOf(order) || null,
          missingFields: missing,
          country: info.countryCode || info.country || destination.country || null,
          customerPhone: phone || null,
          customerName: info.name || null,
          originalStatusId: NEW_ORDER_STATUS_ID,
        },
      });
    } catch (error) {
      // Already handled for this order (webhook retry, or created then updated).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { held: false, reason: 'already_requested' };
      }
      throw error;
    }

    const statusResult = await updateSallaOrderStatus(merchantId, orderId, {
      statusId: settings.holdStatusId,
      timeoutMs: 10_000,
    });
    if (statusResult.success) {
      // Mirror right away so nothing reads the order as "new" before Salla's webhook lands.
      await prisma.sallaOrder
        .updateMany({ where: { merchantId, orderId }, data: { statusCustomId: settings.holdStatusId } })
        .catch(() => undefined);
    } else {
      // The row still keeps the order out of the prep queue; staff see the error.
      log.warn('Shipping info: could not move order to hold status', { orderId, error: statusResult.error });
    }
    await prisma.shippingInfoRequest.update({
      where: { id: row.id },
      data: {
        holdStatusSet: statusResult.success,
        lastError: statusResult.success ? null : `hold_status_failed: ${statusResult.error ?? 'unknown'}`,
      },
    });

    await sendShippingInfoMessage(row.id);
    log.info('Shipping info: international order held', { orderId, missing });
    return { held: true };
  } catch (error) {
    log.error('Shipping info: hold check failed', {
      orderId: input.order?.id,
      error: error instanceof Error ? error.message : error,
    });
    return { held: false, reason: 'error' };
  }
}

/** Sends (or resends) the WhatsApp message with the form link. */
export async function sendShippingInfoMessage(
  requestId: string,
  options: { reminder?: boolean } = {},
): Promise<{ sent: boolean; error?: string }> {
  const row = await prisma.shippingInfoRequest.findUnique({ where: { id: requestId } });
  if (!row) return { sent: false, error: 'not_found' };

  const fail = async (error: string) => {
    await prisma.shippingInfoRequest.update({ where: { id: row.id }, data: { sendError: error } });
    return { sent: false, error };
  };

  const templateId = env.ZOKO_TPL_SHIPPING_INFO_REQUEST;
  if (!templateId) return fail('template_not_configured');
  if (!row.customerPhone) return fail('no_phone');

  try {
    const url = createShippingInfoUrl({ merchantId: row.merchantId, orderId: row.orderId });
    const firstName = (row.customerName ?? '').split(' ')[0] || 'العميلة';
    // Button template (21_11_26_template_u7jk): {{1}} name in the body, {{2}} the
    // button's URL (the whole signed link, like the tracking/rating buttons).
    await sendWhatsAppButtonTemplate({
      to: row.customerPhone,
      templateId,
      templateArgs: [firstName, url],
    });
    const now = new Date();
    await prisma.shippingInfoRequest.update({
      where: { id: row.id },
      data: options.reminder ? { reminderSentAt: now, sendError: null } : { sentAt: now, sendError: null },
    });
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Shipping info: WhatsApp send failed', { orderId: row.orderId, error: message });
    return fail(message.slice(0, 500));
  }
}

export type PublicRequestView = {
  state: 'open' | 'done' | 'closed';
  orderNumber: string;
  countryCode: string;
  country: string;
  city: string;
  missingFields: string[];
  rawOrder: unknown;
};

/** What the customer page needs; null when there is no request for this order. */
export async function loadRequestForCustomer(merchantId: string, orderId: string): Promise<PublicRequestView | null> {
  const row = await prisma.shippingInfoRequest.findUnique({ where: { merchantId_orderId: { merchantId, orderId } } });
  if (!row) return null;
  const stored = await prisma.sallaOrder.findUnique({
    where: { merchantId_orderId: { merchantId, orderId } },
    select: { rawOrder: true },
  });
  const info = extractShippingInfo(stored?.rawOrder);
  const state =
    row.status === 'applied' || row.submittedAt ? 'done' : OPEN_STATUSES.includes(row.status) ? 'open' : 'closed';
  return {
    state,
    orderNumber: row.orderNumber || orderId,
    countryCode: info.countryCode,
    country: info.country,
    city: info.city,
    missingFields: row.missingFields,
    rawOrder: stored?.rawOrder ?? null,
  };
}

export type SubmitResult =
  | { ok: true; applied: boolean }
  | { ok: false; code: 'not_found' | 'closed' | 'invalid' | 'busy'; errors?: SubmissionError[] };

/** The customer submitted the form. */
export async function submitShippingInfo(
  merchantId: string,
  orderId: string,
  input: Record<string, unknown>,
): Promise<SubmitResult> {
  const row = await prisma.shippingInfoRequest.findUnique({ where: { merchantId_orderId: { merchantId, orderId } } });
  if (!row) return { ok: false, code: 'not_found' };
  if (row.submittedAt || row.status === 'applied') return { ok: true, applied: row.status === 'applied' };
  if (!OPEN_STATUSES.includes(row.status)) return { ok: false, code: 'closed' };

  const parsed = parseSubmission(input);
  if (!parsed.ok) return { ok: false, code: 'invalid', errors: parsed.errors };

  const saved = await prisma.shippingInfoRequest.updateMany({
    where: { id: row.id, submittedAt: null },
    data: { submittedAt: new Date(), submittedData: parsed.value as unknown as Prisma.InputJsonValue },
  });
  if (saved.count === 0) return { ok: true, applied: false };

  const result = await applyShippingInfo(row.id);
  return { ok: true, applied: result.ok };
}

/**
 * Writes the submitted info to Salla and puts the order back to its original
 * status. Retry-safe: a step already done (appliedAt) is not repeated.
 */
export async function applyShippingInfo(requestId: string): Promise<{ ok: boolean; error?: string }> {
  const lockCutoff = new Date(Date.now() - APPLY_LOCK_MS);
  const locked = await prisma.shippingInfoRequest.updateMany({
    where: {
      id: requestId,
      submittedAt: { not: null },
      OR: [{ status: { in: ['pending', 'failed'] } }, { status: 'applying', updatedAt: { lt: lockCutoff } }],
    },
    data: { status: 'applying', attempts: { increment: 1 } },
  });
  if (locked.count === 0) return { ok: false, error: 'busy_or_not_ready' };
  const row = await prisma.shippingInfoRequest.findUniqueOrThrow({ where: { id: requestId } });

  const fail = async (error: string) => {
    log.error('Shipping info: apply failed', { orderId: row.orderId, error });
    await prisma.shippingInfoRequest.update({
      where: { id: row.id },
      data: { status: 'failed', lastError: error.slice(0, 1000) },
    });
    return { ok: false, error };
  };

  try {
    const parsed = parseSubmission(asRecord(row.submittedData));
    if (!parsed.ok) return fail(`invalid_submission: ${parsed.errors.join(',')}`);

    const live = await fetchLiveOrder(row.merchantId, row.orderId, { timeoutMs: 10_000 });
    if (live.kind !== 'ok') return fail(`salla_read_${live.kind}${live.kind === 'error' ? `: ${live.message}` : ''}`);
    const slug = asRecord(live.detail.status).slug;
    if (slug === 'canceled' || slug === 'completed' || slug === 'delivered' || slug === 'shipped') {
      return fail(`order_status_${slug}`);
    }

    // 1) The address and receiver name.
    let detail = live.detail;
    if (!row.appliedAt) {
      const body = buildOrderUpdatePayload(detail, parsed.value);
      try {
        await sallaMakeRequest(row.merchantId, `/orders/${encodeURIComponent(row.orderId)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
          throwOnError: true,
        });
      } catch (error) {
        return fail(`salla_update: ${error instanceof Error ? error.message : String(error)}`);
      }
      await prisma.shippingInfoRequest.update({ where: { id: row.id }, data: { appliedAt: new Date() } });
      const reread = await fetchLiveOrder(row.merchantId, row.orderId, { timeoutMs: 10_000 });
      if (reread.kind === 'ok') detail = reread.detail;
      const after = extractShippingInfo(detail);
      if (after.name !== fullNameOf(parsed.value)) {
        // Salla answered OK but did not keep the name: worth a staff look.
        log.warn('Shipping info: Salla name differs after update', { orderId: row.orderId });
      }
    }

    // 2) Back to the status it came from, unless staff already moved it elsewhere.
    const currentStatus = deriveStatusCustomId(detail);
    const settings = await getShippingInfoSettings({ fresh: true });
    const target = row.originalStatusId || NEW_ORDER_STATUS_ID;
    if (row.holdStatusSet && currentStatus === settings.holdStatusId) {
      const restored = await updateSallaOrderStatus(row.merchantId, row.orderId, { statusId: target, timeoutMs: 10_000 });
      if (!restored.success) return fail(`status_restore: ${restored.error ?? 'unknown'}`);
      const reread = await fetchLiveOrder(row.merchantId, row.orderId, { timeoutMs: 10_000 });
      if (reread.kind === 'ok') detail = reread.detail;
    }
    await refreshMirrorFromLive(row.merchantId, detail);

    await prisma.shippingInfoRequest.update({
      where: { id: row.id },
      data: { status: 'applied', holdActive: false, lastError: null },
    });
    log.info('Shipping info: applied and released', { orderId: row.orderId });
    return { ok: true };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Staff: let the order go on without the customer's answers. */
export async function releaseShippingInfoHold(requestId: string, actorName: string): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.shippingInfoRequest.findUnique({ where: { id: requestId } });
  if (!row) return { ok: false, error: 'not_found' };
  if (!row.holdActive) return { ok: true };

  const settings = await getShippingInfoSettings({ fresh: true });
  const live = await fetchLiveOrder(row.merchantId, row.orderId, { timeoutMs: 10_000 });
  if (live.kind === 'ok' && row.holdStatusSet && deriveStatusCustomId(live.detail) === settings.holdStatusId) {
    const restored = await updateSallaOrderStatus(row.merchantId, row.orderId, {
      statusId: row.originalStatusId || NEW_ORDER_STATUS_ID,
      timeoutMs: 10_000,
    });
    if (!restored.success) return { ok: false, error: restored.error ?? 'status_restore_failed' };
    const reread = await fetchLiveOrder(row.merchantId, row.orderId, { timeoutMs: 10_000 });
    if (reread.kind === 'ok') await refreshMirrorFromLive(row.merchantId, reread.detail);
  }
  await prisma.shippingInfoRequest.update({
    where: { id: row.id },
    data: { status: 'released', holdActive: false, resolvedByName: actorName },
  });
  return { ok: true };
}

const REMINDER_AFTER_MS = 24 * 60 * 60_000;

/**
 * Cron: one reminder after 24h, and close requests whose order left the hold
 * status in Salla some other way (staff moved it, or it was cancelled).
 */
export async function runShippingInfoWorker(): Promise<Record<string, number>> {
  const summary: Record<string, number> = { reminded: 0, released: 0, cancelled: 0, retried: 0 };
  const settings = await getShippingInfoSettings({ fresh: true });

  const due = await prisma.shippingInfoRequest.findMany({
    where: {
      status: 'pending',
      submittedAt: null,
      reminderSentAt: null,
      sentAt: { lt: new Date(Date.now() - REMINDER_AFTER_MS) },
    },
    select: { id: true },
    take: 25,
  });
  for (const { id } of due) {
    if ((await sendShippingInfoMessage(id, { reminder: true })).sent) summary.reminded += 1;
  }

  // Orders that moved out of the hold status without the form.
  if (settings.holdStatusId) {
    const open = await prisma.shippingInfoRequest.findMany({
      where: { status: 'pending', holdActive: true, holdStatusSet: true, submittedAt: null },
      select: { id: true, merchantId: true, orderId: true },
      take: 200,
    });
    if (open.length > 0) {
      const mirrors = await prisma.sallaOrder.findMany({
        where: { OR: open.map((r) => ({ merchantId: r.merchantId, orderId: r.orderId })) },
        select: { merchantId: true, orderId: true, statusCustomId: true, statusSlug: true },
      });
      const byKey = new Map(mirrors.map((m) => [`${m.merchantId}:${m.orderId}`, m]));
      for (const row of open) {
        const mirror = byKey.get(`${row.merchantId}:${row.orderId}`);
        if (!mirror?.statusCustomId || mirror.statusCustomId === settings.holdStatusId) continue;
        const cancelled = mirror.statusSlug === 'canceled';
        await prisma.shippingInfoRequest.update({
          where: { id: row.id },
          data: {
            status: cancelled ? 'cancelled' : 'released',
            holdActive: false,
            resolvedByName: 'Salla (status changed outside the form)',
          },
        });
        summary[cancelled ? 'cancelled' : 'released'] += 1;
      }
    }
  }

  // Submissions whose first apply attempt failed on something transient.
  const retry = await prisma.shippingInfoRequest.findMany({
    where: { status: 'failed', submittedAt: { not: null }, attempts: { lt: 3 }, updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
    select: { id: true },
    take: 10,
  });
  for (const { id } of retry) {
    if ((await applyShippingInfo(id)).ok) summary.retried += 1;
  }
  return summary;
}
