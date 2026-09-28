import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { prisma } from '@/lib/prisma';
import {
  OPEN_RETURN_STATUSES,
  RETURN_PICKUP_REQUEST_TYPE,
  findDeliveredJeddahShipment,
  syncLocalReturnPickupTask,
} from '@/app/lib/returns/local-return-pickup';

/**
 * Creates `return_pickup` tasks for returns that were filed before the returns
 * flow started assigning them to the agent who delivered the order.
 * Runs as a dry run unless `--apply` is passed.
 */
async function main() {
  const apply = process.argv.includes('--apply');

  const openReturns = await prisma.returnRequest.findMany({
    where: { status: { in: OPEN_RETURN_STATUSES } },
    select: { id: true, merchantId: true, orderId: true, orderNumber: true, type: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const planned: { id: string; orderNumber: string | null; type: string; agent: string }[] = [];
  for (const request of openReturns) {
    const shipment = await findDeliveredJeddahShipment(request.merchantId, request.orderId);
    const agentId = shipment?.assignment?.deliveryAgentId;
    if (!shipment || !agentId) continue;

    const existing = await prisma.deliveryAgentTask.count({
      where: {
        relatedShipmentId: shipment.id,
        requestType: RETURN_PICKUP_REQUEST_TYPE,
        status: { in: ['pending', 'in_progress'] },
      },
    });
    if (existing > 0) continue;

    const agent = await prisma.orderUser.findUnique({ where: { id: agentId }, select: { name: true, username: true } });
    planned.push({
      id: request.id,
      orderNumber: request.orderNumber,
      type: request.type,
      agent: agent?.name || agent?.username || agentId,
    });
  }

  console.log(`Open returns: ${openReturns.length}; Jeddah agent pickups to create: ${planned.length}`);
  const perAgent = planned.reduce<Record<string, number>>((acc, row) => {
    acc[row.agent] = (acc[row.agent] || 0) + 1;
    return acc;
  }, {});
  console.table(perAgent);

  if (!apply) {
    console.log('Dry run — pass --apply to create the tasks.');
    return;
  }

  for (const row of planned) {
    await syncLocalReturnPickupTask(row.id);
  }
  console.log(`Created ${planned.length} pickup tasks.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
