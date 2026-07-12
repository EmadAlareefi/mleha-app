import { sendWhatsAppTemplate } from '@/app/lib/zoko';
import { normalizeKSA } from '@/app/lib/phone';
import { env } from '@/app/lib/env';
import { log } from '@/app/lib/logger';

export type AssignmentNotificationStatus = 'sent' | 'skipped' | 'failed';

export interface AssignmentNotificationInput {
  chatId: string;
  customerPhone?: string | null;
  agentName?: string | null;
}

export interface AssignmentNotificationResult {
  status: AssignmentNotificationStatus;
  error?: string;
  reason?: string;
}

const TEMPLATE_ID = env.ZOKO_TPL_ASSIGNED_WELCOME;

function collectRecipients(to: string): string[] {
  const recipients = new Set<string>();
  recipients.add(to);
  const debug = env.ZOKO_DEBUG_PHONE?.replace(/\s/g, '');
  if (debug) recipients.add(debug);
  return Array.from(recipients);
}

export async function notifyChatAssigned(
  payload: AssignmentNotificationInput
): Promise<AssignmentNotificationResult> {
  const agentName = payload.agentName?.trim();
  if (!agentName) {
    log.warn('Skipping assignment notification because agent name is missing', {
      chatId: payload.chatId,
    });
    return { status: 'skipped', reason: 'missing_agent_name' };
  }

  const normalizedRecipient = normalizeKSA(payload.customerPhone);
  if (!normalizedRecipient) {
    log.warn('Skipping assignment notification because phone number is missing', {
      chatId: payload.chatId,
    });
    return { status: 'skipped', reason: 'missing_phone' };
  }

  const recipients = collectRecipients(normalizedRecipient);
  let lastError: string | undefined;
  let anySent = false;

  for (const recipient of recipients) {
    try {
      await sendWhatsAppTemplate({
        to: recipient,
        templateId: TEMPLATE_ID,
        args: [agentName],
      });
      anySent = true;
      log.info('Assignment welcome notification sent via Zoko', {
        chatId: payload.chatId,
        to: recipient,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      log.error('Failed to send assignment welcome notification via Zoko', {
        chatId: payload.chatId,
        to: recipient,
        error: lastError,
      });
    }
  }

  if (!anySent) {
    return { status: 'failed', error: lastError };
  }

  return { status: 'sent' };
}
