import { prisma } from '@/lib/prisma';
import { receiveAjexWebhook } from '@/app/lib/ajex-webhook';
import { applyAjexTrackingToShipments } from '@/app/lib/ajex-shipment-tracking';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return receiveAjexWebhook(request, process.env.AJEX_WEBHOOK_BEARER_TOKEN,
    (data) => prisma.webhookLog.create({ data }),
    (event) => applyAjexTrackingToShipments(prisma, event));
}
