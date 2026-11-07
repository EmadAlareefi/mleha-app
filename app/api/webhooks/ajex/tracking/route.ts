import { prisma } from '@/lib/prisma';
import { receiveAjexWebhook } from '@/app/lib/ajex-webhook';
import { applyAjexTrackingToShipments } from '@/app/lib/ajex-shipment-tracking';
import { applyAjexEventToReturns } from '@/app/lib/returns/auto-progress';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return receiveAjexWebhook(request, process.env.AJEX_WEBHOOK_BEARER_TOKEN,
    (data) => prisma.webhookLog.create({ data }),
    async (event) => {
      await applyAjexTrackingToShipments(prisma, event);
      await applyAjexEventToReturns(event.trackingId, event.status as any);
    });
}
