import { prisma } from '@/lib/prisma';
import { env } from '@/app/lib/env';
import { log } from '@/app/lib/logger';
import { normalizeKSA } from '@/app/lib/phone';
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

function collectRecipients(to: string): string[] {
  const recipients = new Set<string>([to]);
  const debugPhone = env.ZOKO_DEBUG_PHONE?.replace(/\s/g, '');
  if (debugPhone) {
    recipients.add(debugPhone);
  }
  return Array.from(recipients);
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
  const recipient = normalizeKSA(request.customerPhone);
  if (!recipient || recipient.length < 8) {
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
  const templateArgs = [parts.customerName, parts.productLabel, parts.productLink];
  const lang = request.locale === 'en' ? 'en' : env.WHATSAPP_DEFAULT_LANG || 'ar';

  const recipients = collectRecipients(recipient);
  let lastError: string | undefined;
  let zokoMsgId: string | undefined;
  let anySent = false;

  for (const to of recipients) {
    try {
      const response = await sendWhatsAppTemplate({
        to,
        templateId: TEMPLATE_ID,
        lang,
        args: templateArgs,
      });

      anySent = true;
      zokoMsgId = zokoMsgId ?? extractZokoMessageId(response);
      await recordMessageLog({
        toPhone: to,
        body: readableBody,
        status: 'sent',
        zokoMsgId: extractZokoMessageId(response),
      });

      log.info('Availability notification sent via Zoko', { requestId: request.id, to });
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      await recordMessageLog({
        toPhone: to,
        body: readableBody,
        status: 'failed',
        error: lastError,
      });
      log.error('Failed to send availability notification via Zoko', {
        requestId: request.id,
        to,
        error: lastError,
      });
    }
  }

  if (!anySent) {
    return { status: 'failed', error: lastError || 'UNKNOWN_ERROR' };
  }

  return { status: 'sent', zokoMsgId };
}
