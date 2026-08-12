import { NextRequest, NextResponse } from 'next/server';

import {
  type CustomerDocumentKind,
  verifyCustomerDocumentSignature,
} from '@/app/lib/customer-document-links';
import { log } from '@/app/lib/logger';
import { getSallaOrder, getSallaOrderInvoices } from '@/app/lib/salla-api';
import {
  buildInvoiceData,
  generateSallaInvoicePdf,
} from '@/app/lib/salla-invoice-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_KINDS = new Set<CustomerDocumentKind>(['invoice']);

function amount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return Number(value.replace(/,/g, '')) || 0;
  if (value && typeof value === 'object' && 'amount' in value) {
    return amount((value as { amount: unknown }).amount);
  }
  return 0;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ kind: string; merchantId: string; orderId: string }> }
) {
  const { kind: rawKind, merchantId, orderId } = await context.params;
  if (!VALID_KINDS.has(rawKind as CustomerDocumentKind)) {
    return NextResponse.json({ error: 'Unsupported document type' }, { status: 404 });
  }
  const kind = rawKind as CustomerDocumentKind;
  const expiresAt = Number(request.nextUrl.searchParams.get('exp'));
  const signature = request.nextUrl.searchParams.get('sig') || '';

  if (
    !verifyCustomerDocumentSignature({
      kind,
      merchantId,
      orderId,
      expiresAt,
      signature,
    })
  ) {
    return NextResponse.json({ error: 'Invalid or expired document link' }, { status: 403 });
  }

  try {
    const order = await getSallaOrder(merchantId, orderId);
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const invoices = await getSallaOrderInvoices(merchantId, orderId);
    const officialInvoice =
      invoices.find((invoice) => /tax|ضريب/i.test(String(invoice?.type || ''))) ||
      invoices[0] ||
      null;
    const data = buildInvoiceData(order, officialInvoice);
    const expectedTotal = amount(order.amounts?.total);
    if (expectedTotal > 0 && Math.abs(data.total - expectedTotal) > 0.02) {
      log.error('Refused to render unreconciled customer invoice', {
        merchantId,
        orderId,
        expectedTotal,
        renderedTotal: data.total,
      });
      return NextResponse.json({ error: 'Invoice totals do not reconcile' }, { status: 409 });
    }
    const pdf = await generateSallaInvoicePdf(data);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${data.invoiceNumber}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    log.error('Failed to serve signed customer document', {
      kind,
      merchantId,
      orderId,
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json({ error: 'Document unavailable' }, { status: 500 });
  }
}
