import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  sendPrintJob,
  PRINTNODE_ORDER_NUMBER_PRINTER_ID,
  PRINTNODE_DEFAULT_DPI,
} from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const runtime = 'nodejs';

const ORDER_NUMBER_PRINT_ROLES = new Set(['admin', 'orders', 'warehouse']);
const MM_TO_POINTS = 72 / 25.4;
const ORDER_TICKET_MM = { width: 40, height: 22 } as const;
const ORDER_TICKET_PAPER_NAME = 'Small labels';
const ORDER_TICKET_SIZE = {
  width: ORDER_TICKET_MM.width * MM_TO_POINTS,
  height: ORDER_TICKET_MM.height * MM_TO_POINTS,
};
const ORDER_ANCHOR_MM = { x: 0, yFromTop: 0 };
const DATE_ANCHOR_MM = { x: 0, yFromTop: 9 };
const ORDER_FONT_MAX_PT = 14;
const ORDER_FONT_MIN_PT = 8;
const DATE_FONT_MAX_PT = 14;
const DATE_FONT_MIN_PT = 8;
const LINE_GAP_MM = 1;

const EASTERN_DIGIT_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

const sanitizePrintableText = (input: string) => {
  if (!input) return '';
  const withLatinDigits = input.replace(/[٠-٩]/g, (char) => EASTERN_DIGIT_MAP[char] ?? char);
  const normalized = withLatinDigits.normalize('NFKD');
  return normalized.replace(/[^\x20-\x7E]/g, '').trim();
};

const mmToPoints = (valueMm: number) => valueMm * MM_TO_POINTS;

const getUserRoles = (sessionUser: any): string[] => {
  if (!sessionUser) {
    return [];
  }
  if (Array.isArray(sessionUser.roles)) {
    return sessionUser.roles.filter(Boolean);
  }
  if (sessionUser.role) {
    return [sessionUser.role];
  }
  return [];
};

const DEFAULT_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

const formatPrintDate = (value?: string) => {
  const normalized = sanitizePrintableText(value || '');
  if (normalized) {
    return normalized.slice(0, 20);
  }
  return DEFAULT_DATE_FORMAT.format(new Date());
};

async function generateOrderTicketPdf(orderNumber: string, printDate?: string) {
  const safeOrderNumber = (sanitizePrintableText(orderNumber) || 'UNKNOWN').toUpperCase();
  const spacedOrderNumber = safeOrderNumber.split('').join(' ');
  const dateLabel = formatPrintDate(printDate);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([ORDER_TICKET_SIZE.width, ORDER_TICKET_SIZE.height]);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const lineGap = mmToPoints(LINE_GAP_MM);

  const fitFontToWidth = (text: string, maxPt: number, minPt: number) => {
    let size = maxPt;
    const maxWidth = ORDER_TICKET_SIZE.width - mmToPoints(ORDER_ANCHOR_MM.x) - mmToPoints(0.5);
    let width = font.widthOfTextAtSize(text, size);
    while (size > minPt && width > maxWidth) {
      size -= 0.5;
      width = font.widthOfTextAtSize(text, size);
    }
    return { size, height: font.heightAtSize(size) };
  };

  const orderMetrics = fitFontToWidth(spacedOrderNumber, ORDER_FONT_MAX_PT, ORDER_FONT_MIN_PT);
  const dateStartPt = Math.max(
    DATE_FONT_MIN_PT,
    Math.min(DATE_FONT_MAX_PT, orderMetrics.size - 4)
  );
  const dateMetrics = fitFontToWidth(dateLabel, dateStartPt, DATE_FONT_MIN_PT);

  const orderX = mmToPoints(ORDER_ANCHOR_MM.x);
  const orderY = ORDER_TICKET_SIZE.height - mmToPoints(ORDER_ANCHOR_MM.yFromTop) - orderMetrics.height;
  const dateX = mmToPoints(DATE_ANCHOR_MM.x);
  const preferredDateY = orderY - lineGap - dateMetrics.height;
  const fallbackDateY =
    ORDER_TICKET_SIZE.height - mmToPoints(DATE_ANCHOR_MM.yFromTop) - dateMetrics.height;
  const dateY = Math.max(0, Math.min(preferredDateY, fallbackDateY));

  page.drawText(spacedOrderNumber, {
    x: orderX,
    y: orderY,
    size: orderMetrics.size,
    font,
    color: rgb(0, 0, 0),
  });

  page.drawText(dateLabel, {
    x: dateX,
    y: dateY,
    size: dateMetrics.size,
    font,
    color: rgb(0, 0, 0),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes).toString('base64');
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'غير مصرح لك' }, { status: 401 });
  }

  const roles = getUserRoles(session.user as any);
  const hasAccess = roles.some((role) => ORDER_NUMBER_PRINT_ROLES.has(role));

  if (!hasAccess) {
    return NextResponse.json(
      { success: false, error: 'لا تملك صلاحية طباعة أرقام الطلبات' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const rawOrderNumber = typeof body?.orderNumber === 'string' ? body.orderNumber.trim() : '';
    const rawOrderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
    const rawPrintDate = typeof body?.printDate === 'string' ? body.printDate.trim() : '';
    const shouldIncludePdf = Boolean(body?.debugDownload || body?.downloadPdf);
    const printableOrderReference = rawOrderNumber || rawOrderId;

    if (!printableOrderReference) {
      return NextResponse.json(
        { success: false, error: 'رقم الطلب مطلوب للطباعة' },
        { status: 400 }
      );
    }

    const encodedPdf = await generateOrderTicketPdf(printableOrderReference, rawPrintDate);

    log.info('Sending order number ticket to PrintNode', {
      orderNumber: printableOrderReference,
      requestedBy: (session.user as any)?.username || session.user.email || session.user.name,
    });

    const printResult = await sendPrintJob({
      title: `Order Ticket ${printableOrderReference}`,
      contentType: 'pdf_base64',
      content: encodedPdf,
      printerId: PRINTNODE_ORDER_NUMBER_PRINTER_ID,
      copies: Number.isInteger(body?.copies) && body.copies > 0 ? body.copies : 1,
      paperSizeMm: ORDER_TICKET_MM,
      paperName: ORDER_TICKET_PAPER_NAME,
      fitToPage: false,
      dpi: PRINTNODE_DEFAULT_DPI,
    });

    if (!printResult.success) {
      log.error('Failed to send order number ticket to PrintNode', {
        orderNumber: printableOrderReference,
        error: printResult.error,
      });
      return NextResponse.json(
        { success: false, error: printResult.error || 'تعذر إرسال رقم الطلب للطابعة' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'تم إرسال رقم الطلب للطابعة',
      jobId: printResult.jobId || null,
      ...(shouldIncludePdf ? { pdfBase64: encodedPdf } : {}),
    });
  } catch (error) {
    log.error('Unexpected error while printing order number', { error });
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء معالجة الطلب' },
      { status: 500 }
    );
  }
}
