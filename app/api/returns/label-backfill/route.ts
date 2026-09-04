import { NextRequest, NextResponse } from 'next/server';
import { log } from '@/app/lib/logger';
import {
  syncReturnShipment,
  type ReturnShipmentSyncResult,
  type ReturnShipmentSyncStatus,
} from '@/app/lib/returns/return-shipment-sync';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
// One Salla round-trip per pending request; a backlog can take a while.
export const maxDuration = 300;

const LOOKBACK_DAYS = Number(process.env.RETURN_LABEL_BACKFILL_DAYS || '14');
const BATCH_SIZE = Number(process.env.RETURN_LABEL_BACKFILL_BATCH || '100');

/**
 * GET /api/returns/label-backfill
 *
 * Scheduled pull for return waybills. Salla issues them asynchronously and only
 * announces them through a `shipment.created` webhook that may never arrive (or
 * may arrive without a label), so without this the customer is simply never sent
 * the بوليصة. Walks every request that has not been messaged yet, saves whatever
 * Salla has produced, and sends the WhatsApp as soon as a label exists.
 *
 * Requests Salla accepted but never fulfilled come back as `stuck` and are
 * logged as errors — they need the re-issue action in returns-management.
 *
 * Called by the Vercel cron entry in vercel.json, or by any scheduler that can
 * send the CRON_SECRET bearer token. Pass ?dryRun=1 to report without writing.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    log.warn('Unauthorized return label backfill attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = ['1', 'true', 'yes'].includes(
    (new URL(request.url).searchParams.get('dryRun') || '').toLowerCase()
  );

  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const pending = await prisma.returnRequest.findMany({
      where: {
        returnLabelNotificationSentAt: null,
        status: { notIn: ['cancelled', 'rejected'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      select: {
        id: true,
        merchantId: true,
        orderId: true,
        orderNumber: true,
        createdAt: true,
        smsaTrackingNumber: true,
        returnLabelUrl: true,
        returnLabelNotificationSentAt: true,
      },
    });

    const results: ReturnShipmentSyncResult[] = [];
    for (const returnRequest of pending) {
      results.push(
        await syncReturnShipment(returnRequest, {
          source: 'return-label-backfill-cron',
          dryRun,
        })
      );
    }

    const summary = results.reduce<Record<string, number>>((acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    }, {});

    const stuck = results.filter((result) => result.status === 'stuck');
    if (stuck.length > 0) {
      log.error('Return waybills Salla never issued', {
        count: stuck.length,
        orderNumbers: stuck.map((result) => result.orderNumber),
      });
    }

    const byStatus = (status: ReturnShipmentSyncStatus) =>
      results.filter((result) => result.status === status).map((result) => result.orderNumber);

    return NextResponse.json({
      success: true,
      dryRun,
      timestamp: new Date().toISOString(),
      scanned: pending.length,
      summary,
      stuck: byStatus('stuck'),
      notified: byStatus('notified'),
      errors: results.filter((result) => result.status === 'error'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    log.error('Return label backfill failed', { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
