import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeMarketing, marketingErrorResponse } from '@/app/api/marketing/_shared';
import {
  MARKETING_SEND_BATCH_SIZE,
  providerMessageId,
} from '@/app/lib/marketing-customers';
import { getZokoTemplates, sendWhatsAppTemplateByType, type ZokoTemplateType } from '@/app/lib/zoko';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type ClaimedMessage = { id: string; recipient: string };

async function refreshCampaign(campaignId: string) {
  const rows = await prisma.marketingCampaignMessage.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  const pending = (counts.pending || 0) + (counts.processing || 0);
  const sent = counts.sent || 0;
  const failed = counts.failed || 0;
  const skipped = counts.skipped || 0;
  const status = pending > 0 ? 'sending' : failed > 0 ? (sent > 0 ? 'partial' : 'failed') : 'completed';
  const campaign = await prisma.marketingCampaign.update({
    where: { id: campaignId },
    data: {
      status,
      sentCount: sent,
      failedCount: failed,
      skippedCount: skipped,
      ...(pending === 0 ? { completedAt: new Date() } : {}),
    },
  });
  return { campaign, hasMore: pending > 0 };
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeMarketing();
  if (auth.response) return auth.response;
  const { id } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    if (body?.confirm !== true) {
      return NextResponse.json({ error: 'يتطلب الإرسال تأكيداً صريحاً' }, { status: 400 });
    }
    const campaign = await prisma.marketingCampaign.findUnique({ where: { id } });
    if (!campaign) return NextResponse.json({ error: 'الحملة غير موجودة' }, { status: 404 });
    if (['completed', 'failed'].includes(campaign.status)) {
      const progress = await refreshCampaign(id);
      return NextResponse.json({ success: true, ...progress, processed: 0 });
    }

    const liveTemplate = (await getZokoTemplates()).find((template) => template.templateId === campaign.templateId && template.active);
    if (!liveTemplate) return NextResponse.json({ error: 'قالب زوكو لم يعد نشطاً' }, { status: 409 });
    if (
      liveTemplate.templateType !== campaign.templateType ||
      liveTemplate.templateLanguage !== campaign.templateLanguage ||
      liveTemplate.templateVariableCount !== campaign.templateVariableCount
    ) {
      return NextResponse.json({ error: 'تغير القالب في زوكو بعد إنشاء الحملة؛ أنشئ حملة جديدة' }, { status: 409 });
    }
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE "MarketingCampaignMessage"
        SET "status" = 'pending', "processingStartedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "campaignId" = ${id}
          AND "status" = 'processing'
          AND "processingStartedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
      `,
      prisma.$executeRaw`
        UPDATE "MarketingCampaignMessage" AS message
        SET "status" = 'skipped',
            "lastError" = 'Customer is inactive or does not have active marketing consent',
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE message."campaignId" = ${id}
          AND message."status" = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM "MarketingCustomer" AS customer
            WHERE customer."id" = message."customerId"
              AND customer."isActive" = true
              AND customer."consentStatus" = 'opted_in'
          )
      `,
    ]);

    await prisma.marketingCampaign.update({
      where: { id },
      data: { status: 'sending', startedAt: campaign.startedAt || new Date() },
    });

    const claimed = await prisma.$queryRaw<ClaimedMessage[]>(Prisma.sql`
      UPDATE "MarketingCampaignMessage"
      SET "status" = 'processing',
          "attemptCount" = "attemptCount" + 1,
          "processingStartedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" IN (
        SELECT message."id"
        FROM "MarketingCampaignMessage" AS message
        JOIN "MarketingCustomer" AS customer ON customer."id" = message."customerId"
        WHERE message."campaignId" = ${id}
          AND message."status" = 'pending'
          AND customer."isActive" = true
          AND customer."consentStatus" = 'opted_in'
        ORDER BY message."createdAt" ASC
        LIMIT ${MARKETING_SEND_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "recipient"
    `);

    if (!claimed.length) {
      const progress = await refreshCampaign(id);
      return NextResponse.json({ success: true, ...progress, processed: 0 });
    }

    const templateArgs = Array.isArray(campaign.templateArgs)
      ? campaign.templateArgs.map((value) => String(value))
      : [];
    const results = await Promise.all(claimed.map(async (message) => {
      try {
        const response = await sendWhatsAppTemplateByType({
          to: message.recipient,
          templateId: campaign.templateId,
          templateLanguage: campaign.templateLanguage,
          templateType: campaign.templateType as ZokoTemplateType,
          templateArgs,
        });
        return { id: message.id, status: 'sent' as const, providerMessageId: providerMessageId(response) };
      } catch (error) {
        return {
          id: message.id,
          status: 'failed' as const,
          error: (error instanceof Error ? error.message : 'Zoko send failed').slice(0, 4000),
        };
      }
    }));

    await prisma.$transaction(results.map((result) =>
      prisma.marketingCampaignMessage.update({
        where: { id: result.id },
        data: result.status === 'sent'
          ? {
              status: 'sent',
              providerMessageId: result.providerMessageId,
              sentAt: new Date(),
              processingStartedAt: null,
              lastError: null,
            }
          : {
              status: 'failed',
              processingStartedAt: null,
              lastError: result.error,
            },
      })
    ));

    const progress = await refreshCampaign(id);
    return NextResponse.json({ success: true, ...progress, processed: claimed.length });
  } catch (error) {
    return marketingErrorResponse(error, 'تعذر إرسال دفعة الحملة');
  }
}
