import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { hasServiceAccess } from '@/app/lib/service-access';
import {
  sendPrintJob,
  PRINTNODE_ORDER_NUMBER_PRINTER_ID,
  PRINTNODE_DEFAULT_DPI,
} from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const runtime = 'nodejs';

const MM_TO_POINTS = 72 / 25.4;
const LABEL_MM = { width: 40, height: 22 } as const;
const LABEL_POINTS = {
  width: LABEL_MM.width * MM_TO_POINTS,
  height: LABEL_MM.height * MM_TO_POINTS,
};

const sanitizeText = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
};

async function generateSkuLabelPdf(sku: string, name?: string) {
  const safeSku = (sanitizeText(sku) || 'UNKNOWN').toUpperCase();
  const safeName = sanitizeText(name || '');

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([LABEL_POINTS.width, LABEL_POINTS.height]);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const skuFontSize = safeSku.length > 12 ? 12 : 16;
  const nameFontSize = 8;

  page.drawText(safeSku, {
    x: 10,
    y: LABEL_POINTS.height - skuFontSize - 5,
    size: skuFontSize,
    font,
    color: rgb(0, 0, 0),
  });

  if (safeName) {
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText(safeName.slice(0, 30), {
      x: 10,
      y: 6,
      size: nameFontSize,
      font: regular,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes).toString('base64');
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'غير مصرح' }, { status: 401 });
  }

  if (!hasServiceAccess(session, ['order-prep', 'order-shipping', 'warehouse'])) {
    return NextResponse.json(
      { success: false, error: 'لا تملك صلاحية الطباعة' },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const sku = sanitizeText(body?.sku);
    const productName = sanitizeText(body?.productName);

    if (!sku) {
      return NextResponse.json(
        { success: false, error: 'لا يمكن الطباعة بدون SKU صالح' },
        { status: 400 },
      );
    }

    const encodedPdf = await generateSkuLabelPdf(sku, productName);
    const result = await sendPrintJob({
      title: `SKU ${sku}`,
      contentType: 'pdf_base64',
      content: encodedPdf,
      printerId: PRINTNODE_ORDER_NUMBER_PRINTER_ID,
      copies: Number.isInteger(body?.copies) && body.copies > 0 ? body.copies : 1,
      paperSizeMm: LABEL_MM,
      paperName: 'Small labels',
      fitToPage: false,
      dpi: PRINTNODE_DEFAULT_DPI,
    });

    if (!result.success) {
      log.error('Failed to print SKU label', { sku, error: result.error });
      return NextResponse.json(
        { success: false, error: result.error || 'تعذر إرسال رمز المنتج للطابعة' },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, jobId: result.jobId || null });
  } catch (error) {
    log.error('Unexpected error while printing SKU label', { error });
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء محاولة الطباعة' },
      { status: 500 },
    );
  }
}
