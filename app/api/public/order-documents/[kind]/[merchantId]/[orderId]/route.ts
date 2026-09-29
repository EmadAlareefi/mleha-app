import { NextRequest, NextResponse } from 'next/server';

import {
  type CustomerDocumentKind,
  verifyCustomerDocumentSignature,
} from '@/app/lib/customer-document-links';
import { getAjexLabelPdf } from '@/app/lib/ajex-api';
import { log } from '@/app/lib/logger';
import { withOrderShipTo } from '@/app/lib/local-shipping/order-shipping-snapshot';
import { getSallaOrder, getSallaOrderInvoices } from '@/app/lib/salla-api';
import { prisma } from '@/lib/prisma';
import { isAjexReturnRequest } from '@/lib/returns/return-provider';
import {
  buildInvoiceData,
  generateSallaInvoicePdf,
  invoiceTotalMatchesOrder,
  selectCustomerSalesInvoice,
} from '@/app/lib/salla-invoice-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_KINDS = new Set<CustomerDocumentKind>(['invoice', 'return-label']);

/** Streams the AJEX waybill for a return request booked directly with AJEX. */
async function serveAjexReturnLabel(merchantId: string, returnRequestId: string) {
  try {
    const returnRequest = await prisma.returnRequest.findUnique({
      where: { id: returnRequestId },
      select: { merchantId: true, smsaTrackingNumber: true, smsaResponse: true },
    });
    if (
      !returnRequest ||
      returnRequest.merchantId !== merchantId ||
      !returnRequest.smsaTrackingNumber ||
      !isAjexReturnRequest(returnRequest.smsaResponse)
    ) {
      return NextResponse.json({ error: 'Return label not found' }, { status: 404 });
    }

    const pdf = await getAjexLabelPdf(returnRequest.smsaTrackingNumber);
    if (!pdf) return NextResponse.json({ error: 'Return label unavailable' }, { status: 502 });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="return-${returnRequest.smsaTrackingNumber}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    log.error('Failed to serve AJEX return label', {
      returnRequestId,
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json({ error: 'Document unavailable' }, { status: 500 });
  }
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

  if (kind === 'return-label') {
    return serveAjexReturnLabel(merchantId, orderId);
  }

  try {
    const liveOrder = await getSallaOrder(merchantId, orderId);
    if (!liveOrder) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    const order = await withOrderShipTo(merchantId, liveOrder);
    const invoices = await getSallaOrderInvoices(merchantId, orderId);
    const officialInvoice = selectCustomerSalesInvoice(invoices, order.id);
    const data = buildInvoiceData(order, officialInvoice);
    if (!invoiceTotalMatchesOrder(data, order)) {
      log.error('Refused to render unreconciled customer invoice', {
        merchantId,
        orderId,
        expectedTotal: order.amounts?.total?.amount,
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
