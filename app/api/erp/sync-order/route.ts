/**
 * API endpoint to sync a SallaOrder to ERP system
 *
 * POST /api/erp/sync-order
 * Body: { orderId: string } or { orderNumber: string, force?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncOrderToERP } from '@/app/lib/erp-invoice';
import { log as logger } from '@/app/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderId, orderNumber, force = false } = body;

    if (!orderId && !orderNumber) {
      return NextResponse.json(
        { error: 'Either orderId or orderNumber is required' },
        { status: 400 }
      );
    }

    // Find the order
    const order = await prisma.sallaOrder.findFirst({
      where: orderId
        ? { orderId }
        : { orderNumber },
    });

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    logger.info('Syncing order to ERP via API', {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      force,
    });

    // Sync to ERP
    const result = await syncOrderToERP(order, force);

    // Update order sync status in database
    if (result.success) {
      await prisma.sallaOrder.update({
        where: { id: order.id },
        data: {
          erpSyncedAt: new Date(),
          erpInvoiceId: result.erpInvoiceId ? String(result.erpInvoiceId) : null,
          erpSyncError: null,
          erpSyncAttempts: { increment: 1 },
        },
      });
    } else {
      // Record the error
      await prisma.sallaOrder.update({
        where: { id: order.id },
        data: {
          erpSyncError: result.error || result.message || 'Unknown error',
          erpSyncAttempts: { increment: 1 },
        },
      });
    }

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          message: result.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      erpInvoiceId: result.erpInvoiceId,
      order: {
        id: order.id,
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        status: order.statusSlug,
        erpSyncedAt: new Date(),
      },
    });
  } catch (error: any) {
    logger.error('Error in sync-order API endpoint', {
      error: error.message,
    });

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        message: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
