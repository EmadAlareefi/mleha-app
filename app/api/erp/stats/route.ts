/**
 * ERP Sync Statistics API
 *
 * GET /api/erp/stats - Get sync statistics
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log as logger } from '@/app/lib/logger';
import { NEGATIVE_ERP_INVOICE_ID_PREFIX } from '@/lib/erp-order-sync';

export async function GET() {
  try {
    // Get total orders
    const total = await prisma.sallaOrder.count();

    // Get synced orders
    const synced = await prisma.sallaOrder.count({
      where: {
        erpSyncedAt: { not: null },
        NOT: {
          erpInvoiceId: { startsWith: NEGATIVE_ERP_INVOICE_ID_PREFIX },
        },
      },
    });

    // Get unsynced orders
    const unsynced = await prisma.sallaOrder.count({
      where: {
        erpSyncedAt: null,
        erpSyncError: null,
        NOT: {
          erpInvoiceId: { startsWith: NEGATIVE_ERP_INVOICE_ID_PREFIX },
        },
      },
    });

    // Get failed orders (with errors)
    const failed = await prisma.sallaOrder.count({
      where: {
        OR: [
          {
            erpSyncedAt: null,
            erpSyncError: { not: null },
          },
          {
            erpInvoiceId: { startsWith: NEGATIVE_ERP_INVOICE_ID_PREFIX },
          },
        ],
      },
    });

    return NextResponse.json({
      success: true,
      stats: {
        total,
        synced,
        unsynced,
        failed,
      },
    });
  } catch (error: any) {
    logger.error('Error fetching ERP stats', { error: error.message });

    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
