import { NextRequest, NextResponse } from 'next/server';

import {
  getSallaOrder,
  getSallaOrderByReference,
  getSallaOrderInvoices,
  type SallaOrder,
} from '@/app/lib/salla-api';
import {
  buildInvoiceData,
  generateSallaInvoicePdf,
} from '@/app/lib/salla-invoice-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MERCHANT_ID = process.env.NEXT_PUBLIC_MERCHANT_ID || '1696031053';

/**
 * GET /invoices/[id]/pdf
 *
 * Public endpoint that renders a Salla order's tax invoice (فاتورة ضريبية) as
 * a PDF. `[id]` may be either the Salla order id or the human order reference
 * number. Pass `?download=1` to force a file download instead of inline view.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!id || !id.trim()) {
    return NextResponse.json({ error: 'Order id is required' }, { status: 400 });
  }

  try {
    // Accept either a Salla order id or a reference (order) number.
    let order: SallaOrder | null = await getSallaOrder(MERCHANT_ID, id).catch(() => null);
    if (!order) {
      order = await getSallaOrderByReference(MERCHANT_ID, id).catch(() => null);
    }

    if (!order) {
      return NextResponse.json(
        { error: `No order found for "${id}"` },
        { status: 404 },
      );
    }

    // Pull the official tax invoice for this order (totals + invoice number).
    const invoices = await getSallaOrderInvoices(MERCHANT_ID, order.id).catch(() => []);
    const taxInvoice =
      invoices.find((inv) => typeof inv?.type === 'string' && inv.type.includes('ضريبية')) ||
      invoices[0] ||
      null;

    const data = buildInvoiceData(order, taxInvoice);
    const pdf = await generateSallaInvoicePdf(data);

    const download = request.nextUrl.searchParams.get('download');
    const disposition = download ? 'attachment' : 'inline';
    const filename = `invoice-${data.invoiceNumber || order.id}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (error) {
    console.error('[GET /invoices/[id]/pdf] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate invoice PDF' },
      { status: 500 },
    );
  }
}
