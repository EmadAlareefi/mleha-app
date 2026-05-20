import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

const YEAR_START = new Date('2026-01-01T00:00:00.000Z');
const NEXT_YEAR_START = new Date('2027-01-01T00:00:00.000Z');

const DATE_RANGE = {
  gte: YEAR_START,
  lt: NEXT_YEAR_START,
} as const;

async function removeFutureErpInvoices() {
  console.log('Looking for 2026 orders with ERP sync markers...\n');

  const ordersToClean = await prisma.sallaOrder.findMany({
    where: {
      AND: [
        {
          OR: [
            { placedAt: DATE_RANGE },
            { updatedAtRemote: DATE_RANGE },
          ],
        },
        {
          OR: [
            { erpSyncedAt: { not: null } },
            { erpInvoiceId: { not: null } },
            { erpSyncError: { not: null } },
          ],
        },
      ],
    },
    select: {
      id: true,
      orderId: true,
      orderNumber: true,
      placedAt: true,
      updatedAtRemote: true,
      erpSyncedAt: true,
      erpInvoiceId: true,
      erpSyncError: true,
    },
    orderBy: {
      placedAt: 'asc',
    },
  });

  if (ordersToClean.length === 0) {
    console.log('No 2026 orders found with ERP sync markers.');
    return;
  }

  console.log(`Found ${ordersToClean.length} 2026 orders with ERP sync markers:`);
  ordersToClean.forEach((order, index) => {
    console.log(
      `${index + 1}. Order #${order.orderNumber ?? order.orderId ?? order.id} | ` +
      `placed: ${order.placedAt?.toISOString() ?? 'n/a'} | ` +
      `updatedAtRemote: ${order.updatedAtRemote?.toISOString() ?? 'n/a'} | ` +
      `erpSyncedAt: ${order.erpSyncedAt?.toISOString() ?? 'n/a'} | ` +
      `erpInvoiceId: ${order.erpInvoiceId ?? 'n/a'} | ` +
      `erpSyncError: ${order.erpSyncError ?? 'n/a'}`
    );
  });

  const orderIds = ordersToClean.map(order => order.id);
  const relatedOrderIds = Array.from(
    new Set(
      ordersToClean
        .map(order => order.orderId)
        .filter((orderId): orderId is string => Boolean(orderId))
    ),
  );

  const ordersResult = await prisma.sallaOrder.updateMany({
    where: {
      id: {
        in: orderIds,
      },
    },
    data: {
      erpSyncedAt: null,
      erpInvoiceId: null,
      erpSyncError: null,
    },
  });

  let invoicesResultCount = 0;
  if (relatedOrderIds.length > 0) {
    const invoicesResult = await prisma.sallaInvoice.updateMany({
      where: {
        orderId: { in: relatedOrderIds },
        OR: [
          { erpSyncedAt: { not: null } },
          { erpSyncError: { not: null } },
        ],
      },
      data: {
        erpSyncedAt: null,
        erpSyncError: null,
      },
    });
    invoicesResultCount = invoicesResult.count;
  }

  console.log('\nERP sync markers cleared successfully.');
  console.log(`Orders updated : ${ordersResult.count}`);
  console.log(`Invoices updated: ${invoicesResultCount}`);
}

removeFutureErpInvoices()
  .catch(error => {
    console.error('Failed to clear ERP sync markers for 2026 orders:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
