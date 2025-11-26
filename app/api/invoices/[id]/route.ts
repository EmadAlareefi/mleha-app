import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

/**
 * GET /api/invoices/[id]
 * Fetch a single invoice by ID with full details including raw data
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invoice ID is required',
        },
        { status: 400 }
      );
    }

    const invoice = await prisma.sallaInvoice.findUnique({
      where: { id },
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

    return NextResponse.json({
      success: true,
      data: invoice,
    });
  } catch (error: any) {
    console.error('[GET /api/invoices/[id]] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch invoice',
        message: error.message,
      },
      { status: 500 }
    );
  }
}
