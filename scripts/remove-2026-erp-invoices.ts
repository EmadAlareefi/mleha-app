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
  console.log('Looking for ERP-synced orders dated in 2026...\n');

  const ordersToClean = await prisma.sallaOrder.findMany({
    where: {
      erpSyncedAt: { not: null },
      OR: [
        { placedAt: DATE_RANGE },
        { updatedAtRemote: DATE_RANGE },
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
    },
    orderBy: {
      placedAt: 'asc',
    },
  });

  if (ordersToClean.length === 0) {
    console.log('No ERP-synced orders found with a 2026 placement/update date.');
    return;
  }

  console.log(`Found ${ordersToClean.length} ERP-synced orders with dates in 2026:`);
  ordersToClean.forEach((order, index) => {
    console.log(
      `${index + 1}. Order #${order.orderNumber ?? order.orderId ?? order.id} | ` +
      `placed: ${order.placedAt?.toISOString() ?? 'n/a'} | ` +
      `updatedAtRemote: ${order.updatedAtRemote?.toISOString() ?? 'n/a'} | ` +
      `erpSyncedAt: ${order.erpSyncedAt?.toISOString() ?? 'n/a'} | ` +
      `erpInvoiceId: ${order.erpInvoiceId ?? 'n/a'}`
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
        erpSyncedAt: { not: null },
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
    console.error('Failed to remove ERP invoices synced in 2026:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
