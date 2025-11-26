/**
 * ERP Webhook Auto-Sync Handler
 *
 * Handles automatic syncing of orders to ERP based on webhook events
 * Controlled by application settings
 */

import { SallaOrder } from '@prisma/client';
import { syncOrderToERP } from './erp-invoice';
import { shouldAutoSyncForStatus } from './settings';
import { prisma } from '@/lib/prisma';
import { log as logger } from './logger';

/**
 * Handle order webhook event and sync to ERP if conditions are met
 *
 * @param order - The SallaOrder to potentially sync
 * @param event - The webhook event name (e.g., 'order.updated')
 * @returns Result of sync operation or null if auto-sync is disabled
 */
export async function handleOrderWebhookSync(
  order: SallaOrder,
  event: string
): Promise<{ success: boolean; message: string; synced: boolean }> {
  try {
    // Check if order is already synced
    if (order.erpSyncedAt) {
      logger.info('Order already synced to ERP, skipping webhook sync', {
        orderId: order.orderId,
        orderNumber: order.orderNumber,
      });
      return {
        success: true,
        message: 'Order already synced',
        synced: false,
      };
    }

    // Check if we should auto-sync for this status
    const shouldSync = await shouldAutoSyncForStatus(order.statusSlug || '');

    if (!shouldSync) {
      logger.info('Auto-sync not enabled for this status', {
        orderId: order.orderId,
        status: order.statusSlug,
      });
      return {
        success: true,
        message: 'Auto-sync not enabled for this status',
        synced: false,
      };
    }

    logger.info('Auto-syncing order to ERP', {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      status: order.statusSlug,
      event,
    });

    // Sync to ERP
    const result = await syncOrderToERP(order);

    // Update database with sync status
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

      logger.info('Order auto-synced to ERP successfully', {
        orderId: order.orderId,
        erpInvoiceId: result.erpInvoiceId,
      });

      return {
        success: true,
        message: 'Order synced to ERP successfully',
        synced: true,
      };
    } else {
      // Record the error
      await prisma.sallaOrder.update({
        where: { id: order.id },
        data: {
          erpSyncError: result.error || result.message || 'Unknown error',
          erpSyncAttempts: { increment: 1 },
        },
      });

      logger.error('Failed to auto-sync order to ERP', {
        orderId: order.orderId,
        error: result.error,
      });

      return {
        success: false,
        message: result.message || 'Failed to sync to ERP',
        synced: false,
      };
    }
  } catch (error: any) {
    logger.error('Error in webhook ERP sync handler', {
      orderId: order.orderId,
      error: error.message,
    });

    return {
      success: false,
      message: error.message,
      synced: false,
    };
  }
}

/**
 * Example usage in your webhook handler:
 *
 * import { handleOrderWebhookSync } from '@/app/lib/erp-webhook-sync';
 *
 * // In your webhook handler after saving/updating the order
 * await handleOrderWebhookSync(order, 'order.updated');
 */
