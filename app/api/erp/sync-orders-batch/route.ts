/**
 * API endpoint to sync multiple SallaOrders to ERP system in batch
 *
 * POST /api/erp/sync-orders-batch
 * Body: {
 *   orderIds?: string[],
 *   filters?: { statusSlug?: string, dateFrom?: string, dateTo?: string, onlyUnsynced?: boolean }
 *   limit?: number
 *   force?: boolean
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncOrderToERP } from '@/app/lib/erp-invoice';
import { log as logger } from '@/app/lib/logger';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { orderIds, filters = {}, limit = 100, force = false } = body;

    logger.info('Starting batch ERP sync', {
      orderIdsCount: orderIds?.length,
      filters,
      limit,
      force,
    });

    // Build query
    let whereClause: any = {};

    if (orderIds && orderIds.length > 0) {
      whereClause.orderId = { in: orderIds };
    } else if (filters) {
      // Apply filters
      if (filters.statusSlug) {
        whereClause.statusSlug = filters.statusSlug;
      }
      if (filters.dateFrom || filters.dateTo) {
        whereClause.placedAt = {};
        if (filters.dateFrom) {
          whereClause.placedAt.gte = new Date(filters.dateFrom);
        }
        if (filters.dateTo) {
          whereClause.placedAt.lte = new Date(filters.dateTo);
        }
      }
      // Only sync unsynced orders by default
      if (filters.onlyUnsynced !== false) {
        whereClause.erpSyncedAt = null;
      }
    }

    // Fetch orders
    const orders = await prisma.sallaOrder.findMany({
      where: whereClause,
      take: limit,
      orderBy: { placedAt: 'desc' },
    });

    if (orders.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No orders found matching criteria',
        results: [],
        summary: {
          total: 0,
          successful: 0,
          failed: 0,
        },
      });
    }

    logger.info(`Found ${orders.length} orders to sync`);

    // Sync each order
    const results = [];
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (const order of orders) {
      const result = await syncOrderToERP(order, force);

      // Update database with sync status
      if (result.success) {
        // Check if this was actually a new sync or a skip
        const wasSkipped = result.message?.includes('already synced');

        if (!wasSkipped) {
          await prisma.sallaOrder.update({
            where: { id: order.id },
            data: {
              erpSyncedAt: new Date(),
              erpInvoiceId: result.erpInvoiceId ? String(result.erpInvoiceId) : null,
              erpSyncError: null,
              erpSyncAttempts: { increment: 1 },
            },
          });
          successCount++;
        } else {
          skippedCount++;
        }
      } else {
        // Record the error
        await prisma.sallaOrder.update({
          where: { id: order.id },
          data: {
            erpSyncError: result.error || result.message || 'Unknown error',
            erpSyncAttempts: { increment: 1 },
          },
        });
        failCount++;
      }

      results.push({
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        success: result.success,
        message: result.message,
        error: result.error,
        erpInvoiceId: result.erpInvoiceId,
      });

      // Small delay to avoid overwhelming the ERP API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info('Batch ERP sync completed', {
      total: orders.length,
      successful: successCount,
      failed: failCount,
      skipped: skippedCount,
    });

    return NextResponse.json({
      success: true,
      message: `Synced ${successCount} of ${orders.length} orders (${skippedCount} already synced, ${failCount} failed)`,
      results,
      summary: {
        total: orders.length,
        successful: successCount,
        failed: failCount,
        skipped: skippedCount,
      },
    });
  } catch (error: any) {
    logger.error('Error in sync-orders-batch API endpoint', {
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
