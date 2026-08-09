import { prisma } from '@/lib/prisma';
import { env } from '@/app/lib/env';
import { log } from '@/app/lib/logger';
import { normalizeE164Phone } from '@/app/lib/phone';
import { sendWhatsAppTemplate } from '@/app/lib/zoko';
import {
  buildAvailabilityMessageParts,
  buildAvailabilityNotificationMessage,
  type AvailabilityRequestRecord,
} from '@/app/lib/salla-availability-requests';

/**
 * Sends the back-in-stock WhatsApp template through Zoko. Follows the same
 * shape as zoko-assignment-notification.ts: normalize -> send -> log -> return a
 * structured result rather than throwing, so the caller can decide what a failure
 * means for the request's status.
 */

export type AvailabilityNotificationStatus = 'sent' | 'skipped' | 'failed';

export interface AvailabilityNotificationResult {
  status: AvailabilityNotificationStatus;
  error?: string;
  reason?: string;
  zokoMsgId?: string;
}

const TEMPLATE_ID = env.ZOKO_TPL_PRODUCT_BACK_IN_STOCK;

function getDebugRecipient(to: string): string | null {
  const debugPhone = env.ZOKO_DEBUG_PHONE?.replace(/\s/g, '');
  return debugPhone && debugPhone !== to ? debugPhone : null;
}

function extractZokoMessageId(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') {
    return undefined;
  }
  const record = response as Record<string, unknown>;
  const id = record.id ?? record.messageId ?? record.message_id;
  return typeof id === 'string' ? id : undefined;
}

async function recordMessageLog(input: {
  availabilityRequestId: string;
  toPhone: string;
  body: string;
  status: 'sent' | 'failed';
  zokoMsgId?: string;
  error?: string;
}): Promise<void> {
  try {
    await prisma.messageLog.create({
      data: {
        toPhone: input.toPhone,
        availabilityRequestId: input.availabilityRequestId,
        channel: 'whatsapp',
        templateName: TEMPLATE_ID,
        body: input.body,
        zokoMsgId: input.zokoMsgId ?? null,
        status: input.status,
        error: input.error ?? null,
      },
    });
  } catch (error) {
    // Logging must never be the reason a notification fails.
    log.warn('Could not write availability MessageLog row', {
      error: error instanceof Error ? error.message : error,
    });
  }
}

export async function sendAvailabilityNotification(
  request: AvailabilityRequestRecord
): Promise<AvailabilityNotificationResult> {
  const recipient = normalizeE164Phone(request.customerPhone);
  if (!recipient) {
    log.warn('Skipping availability notification: unusable phone number', {
      requestId: request.id,
    });
    return { status: 'skipped', reason: 'missing_phone' };
  }

  if (!env.ZOKO_API_KEY) {
    log.warn('Skipping availability notification: ZOKO_API_KEY is not configured', {
      requestId: request.id,
    });
    return { status: 'skipped', reason: 'zoko_not_configured' };
  }

  const parts = buildAvailabilityMessageParts(request);
  // The SMS body is the closest readable rendering of what the template says —
  // stored on the log row so the team can see what a customer received.
  const readableBody = buildAvailabilityNotificationMessage(request);
  const templateArgs = [parts.productLink];
  const lang = request.locale === 'en' ? 'en' : env.WHATSAPP_DEFAULT_LANG || 'ar';

  let customerResponse: unknown;
  try {
    customerResponse = await sendWhatsAppTemplate({
      to: recipient,
      templateId: TEMPLATE_ID,
      lang,
      args: templateArgs,
    });
    await recordMessageLog({
      availabilityRequestId: request.id,
      toPhone: recipient,
      body: readableBody,
      status: 'sent',
      zokoMsgId: extractZokoMessageId(customerResponse),
    });
    log.info('Availability notification accepted by Zoko', {
      requestId: request.id,
      to: recipient,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    await recordMessageLog({
      availabilityRequestId: request.id,
      toPhone: recipient,
      body: readableBody,
      status: 'failed',
      error: message,
    });
    log.error('Failed to send availability notification via Zoko', {
      requestId: request.id,
      to: recipient,
      error: message,
    });
    return { status: 'failed', error: message };
  }

  // A debug copy is observability only. It must never decide whether the
  // customer's request was sent or which provider message tracks delivery.
  const debugRecipient = getDebugRecipient(recipient);
  if (debugRecipient) {
    try {
      const response = await sendWhatsAppTemplate({
        to: debugRecipient,
        templateId: TEMPLATE_ID,
        lang,
        args: templateArgs,
      });
      await recordMessageLog({
        availabilityRequestId: request.id,
        toPhone: debugRecipient,
        body: readableBody,
        status: 'sent',
        zokoMsgId: extractZokoMessageId(response),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      await recordMessageLog({
        availabilityRequestId: request.id,
        toPhone: debugRecipient,
        body: readableBody,
        status: 'failed',
        error: message,
      });
      log.warn('Availability debug copy failed', {
        requestId: request.id,
        to: debugRecipient,
        error: message,
      });
    }
  }

  return { status: 'sent', zokoMsgId: extractZokoMessageId(customerResponse) };
}
