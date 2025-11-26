/**
 * API endpoint to clear all debug ERP invoices
 * Removes erpSyncedAt and erpInvoiceId for orders with DEBUG invoice IDs
 *
 * POST /api/erp/clear-debug-invoices
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { log as logger } from '@/app/lib/logger';

export async function POST(req: NextRequest) {
  try {
    logger.info('Starting debug invoices cleanup');

    // Find all orders with DEBUG invoice IDs
    const debugOrders = await prisma.sallaOrder.findMany({
      where: {
        erpInvoiceId: {
          startsWith: 'DEBUG-',
        },
      },
      select: {
        id: true,
        orderId: true,
        orderNumber: true,
        erpInvoiceId: true,
      },
    });

    if (debugOrders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No debug invoices found',
        count: 0,
      });
    }

    logger.info(`Found ${debugOrders.length} debug invoices to clear`);

    // Clear the debug sync data
    const result = await prisma.sallaOrder.updateMany({
      where: {
        erpInvoiceId: {
          startsWith: 'DEBUG-',
        },
      },
      data: {
        erpSyncedAt: null,
        erpInvoiceId: null,
        erpSyncError: null,
      },
    });

    logger.info('Debug invoices cleared successfully', {
      count: result.count,
    });

    return NextResponse.json({
      success: true,
      message: `Cleared ${result.count} debug invoices`,
      count: result.count,
      orders: debugOrders.map(o => ({
        orderId: o.orderId,
        orderNumber: o.orderNumber,
        debugInvoiceId: o.erpInvoiceId,
      })),
    });
  } catch (error: any) {
    logger.error('Error clearing debug invoices', {
      error: error.message,
    });

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        message: 'Failed to clear debug invoices',
      },
      { status: 500 }
    );
  }
}
