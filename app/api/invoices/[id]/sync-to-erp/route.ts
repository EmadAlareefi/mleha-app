import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { syncInvoiceToERP } from '@/app/lib/erp-integration';
import { log as logger } from '@/app/lib/logger';

export const runtime = 'nodejs';

/**
 * POST /api/invoices/[id]/sync-to-erp
 * Sync a single invoice to the ERP system
 *
 * This endpoint:
 * 1. Fetches the invoice from the database
 * 2. Calls the ERP integration service
 * 3. Updates the invoice with sync status (erpSyncedAt, erpSyncError, erpSyncAttempts)
 * 4. Returns the sync result
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  let invoiceId: string | undefined;

  try {
    const { id } = await context.params;
    invoiceId = id;

    if (!invoiceId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invoice ID is required',
        },
        { status: 400 }
      );
    }

    // Fetch the invoice
    const invoice = await prisma.sallaInvoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invoice not found',
        },
        { status: 404 }
      );
    }

    // Check if already synced (optional - remove if you want to allow re-sync)
    if (invoice.erpSyncedAt) {
      logger.info('Invoice already synced to ERP, re-syncing', {
        invoiceId: invoice.id,
        previousSyncAt: invoice.erpSyncedAt,
      });
    }

    logger.info('Starting ERP sync for invoice', {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      merchantId: invoice.merchantId,
    });

    // Sync to ERP
    const syncResult = await syncInvoiceToERP(invoice);

    if (syncResult.success) {
      // Update invoice with successful sync
      const updatedInvoice = await prisma.sallaInvoice.update({
        where: { id: invoiceId },
        data: {
          erpSyncedAt: new Date(),
          erpSyncError: null, // Clear any previous errors
          erpSyncAttempts: {
            increment: 1,
          },
        },
      });

      logger.info('Invoice synced to ERP successfully', {
        invoiceId: invoice.id,
        erpInvoiceId: syncResult.erpInvoiceId,
        attempts: updatedInvoice.erpSyncAttempts,
      });

      return NextResponse.json({
        success: true,
        message: syncResult.message || 'Invoice synced to ERP successfully',
        data: {
          invoiceId: updatedInvoice.id,
          invoiceNumber: updatedInvoice.invoiceNumber,
          erpSyncedAt: updatedInvoice.erpSyncedAt,
          erpSyncAttempts: updatedInvoice.erpSyncAttempts,
          erpInvoiceId: syncResult.erpInvoiceId,
          erpInvoiceNumber: syncResult.erpInvoiceNumber,
        },
      });
    } else {
      // Update invoice with error
      const updatedInvoice = await prisma.sallaInvoice.update({
        where: { id: invoiceId },
        data: {
          erpSyncError: syncResult.error || 'Unknown error occurred',
          erpSyncAttempts: {
            increment: 1,
          },
          // Don't set erpSyncedAt on failure
        },
      });

      logger.error('Failed to sync invoice to ERP', {
        invoiceId: invoice.id,
        error: syncResult.error,
        attempts: updatedInvoice.erpSyncAttempts,
      });

      return NextResponse.json(
        {
          success: false,
          error: syncResult.error || 'Failed to sync invoice to ERP',
          message: syncResult.message,
          data: {
            invoiceId: updatedInvoice.id,
            invoiceNumber: updatedInvoice.invoiceNumber,
            erpSyncError: updatedInvoice.erpSyncError,
            erpSyncAttempts: updatedInvoice.erpSyncAttempts,
          },
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    logger.error('[POST /api/invoices/[id]/sync-to-erp] Error:', {
      error: error.message,
      stack: error.stack,
    });

    // Try to record the error in the database
    try {
      if (invoiceId) {
        await prisma.sallaInvoice.update({
          where: { id: invoiceId },
          data: {
            erpSyncError: error.message,
            erpSyncAttempts: {
              increment: 1,
            },
          },
        });
      }
    } catch (dbError) {
      logger.error('Failed to record sync error in database', dbError);
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error.message,
      },
      { status: 500 }
    );
  }
}
