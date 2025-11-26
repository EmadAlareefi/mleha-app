import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/**
 * GET /api/invoices
 * Fetch paginated invoices with filters
 *
 * Query params:
 * - merchantId: Filter by merchant ID (optional)
 * - status: Filter by invoice status (optional)
 * - paymentStatus: Filter by payment status (optional)
 * - erpSynced: Filter by ERP sync status - "true", "false", or "null" (optional)
 * - startDate: Filter invoices issued on or after this date (ISO string) (optional)
 * - endDate: Filter invoices issued on or before this date (ISO string) (optional)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - sortBy: Field to sort by (default: "issueDate")
 * - sortOrder: "asc" or "desc" (default: "desc")
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract query parameters
    const merchantId = searchParams.get('merchantId') || undefined;
    const status = searchParams.get('status') || undefined;
    const paymentStatus = searchParams.get('paymentStatus') || undefined;
    const erpSyncedParam = searchParams.get('erpSynced');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const sortBy = searchParams.get('sortBy') || 'issueDate';
    const sortOrder = (searchParams.get('sortOrder') || 'desc') as 'asc' | 'desc';

    // Build where clause
    const where: any = {};

    if (merchantId) {
      where.merchantId = merchantId;
    }

    if (status) {
      where.status = status;
    }

    if (paymentStatus) {
      where.paymentStatus = paymentStatus;
    }

    // ERP sync filter
    if (erpSyncedParam === 'true') {
      where.erpSyncedAt = { not: null };
    } else if (erpSyncedParam === 'false') {
      where.erpSyncedAt = null;
    }
    // If erpSyncedParam === 'null' or undefined, don't filter

    // Date range filter
    if (startDate || endDate) {
      where.issueDate = {};
      if (startDate) {
        where.issueDate.gte = new Date(startDate);
      }
      if (endDate) {
        where.issueDate.lte = new Date(endDate);
      }
    }

    // Build orderBy clause
    const orderBy: any = {};
    if (sortBy === 'issueDate' || sortBy === 'dueDate' || sortBy === 'createdAt' || sortBy === 'updatedAt') {
      orderBy[sortBy] = sortOrder;
    } else if (sortBy === 'totalAmount') {
      orderBy.totalAmount = sortOrder;
    } else {
      orderBy.issueDate = sortOrder;
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Fetch invoices and total count in parallel
    const [invoices, totalCount] = await Promise.all([
      prisma.sallaInvoice.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          merchantId: true,
          invoiceId: true,
          orderId: true,
          orderNumber: true,
          invoiceNumber: true,
          status: true,
          paymentStatus: true,
          currency: true,
          subtotalAmount: true,
          taxAmount: true,
          totalAmount: true,
          shippingAmount: true,
          discountAmount: true,
          issueDate: true,
          dueDate: true,
          customerId: true,
          customerName: true,
          customerMobile: true,
          customerEmail: true,
          notes: true,
          erpSyncedAt: true,
          erpSyncError: true,
          erpSyncAttempts: true,
          createdAt: true,
          updatedAt: true,
          // Exclude rawInvoice and rawOrder from list view for performance
        },
      }),
      prisma.sallaInvoice.count({ where }),
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return NextResponse.json({
      success: true,
      data: invoices,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      },
      filters: {
        merchantId,
        status,
        paymentStatus,
        erpSynced: erpSyncedParam,
        startDate,
        endDate,
      },
    });
  } catch (error: any) {
    console.error('[GET /api/invoices] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch invoices',
        message: error.message,
      },
      { status: 500 }
    );
  }
}
