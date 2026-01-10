import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import {
  sendPrintJob,
  PRINTNODE_ORDER_NUMBER_PRINTER_ID,
  PRINTNODE_DEFAULT_DPI,
} from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';
import { PDFDocument, rgb } from 'pdf-lib';

export const runtime = 'nodejs';

const ORDER_NUMBER_PRINT_ROLES = new Set(['admin', 'orders', 'warehouse']);
const MM_TO_POINTS = 72 / 25.4;
const ORDER_TICKET_MM = { width: 40, height: 20 } as const;
const ORDER_TICKET_SIZE = {
  width: ORDER_TICKET_MM.width * MM_TO_POINTS,
  height: ORDER_TICKET_MM.height * MM_TO_POINTS,
};

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

const BITMAP_FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  'E': ['11111', '10000', '11110', '10000', '10000', '10000', '11111'],
  'F': ['11111', '10000', '11110', '10000', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10000', '10011', '10001', '01110'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00001', '00001', '00001', '00001', '10001', '10001', '01110'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  'X': ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  'Y': ['10001', '01010', '00100', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '01010'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '?': ['01110', '10001', '00010', '00100', '00100', '00000', '00100'],
};

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

const drawBitmapChar = ({
  page,
  char,
  startX,
  startY,
  pixelSize,
}: {
  page: any;
  char: string;
  startX: number;
  startY: number;
  pixelSize: number;
}) => {
  const pattern = BITMAP_FONT[char] || BITMAP_FONT['?'];
  const rows = pattern.length;
  const cols = pattern[0]?.length || 5;

  for (let row = 0; row < rows; row++) {
    const line = pattern[row];
    for (let col = 0; col < cols; col++) {
      if (line[col] === '1') {
        const x = startX + col * pixelSize;
        const y = startY - row * pixelSize;
        page.drawRectangle({
          x,
          y: y - pixelSize,
          width: pixelSize,
          height: pixelSize,
          color: rgb(0, 0, 0),
        });
      }
    }
  }

  return startX + cols * pixelSize + pixelSize;
};

async function generateOrderTicketPdf(orderNumber: string) {
  const safeOrderNumber = (sanitizePrintableText(orderNumber) || 'UNKNOWN').toUpperCase();
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([ORDER_TICKET_SIZE.width, ORDER_TICKET_SIZE.height]);

  const padding = 4;
  const availableWidth = ORDER_TICKET_SIZE.width - padding * 2;
  const availableHeight = ORDER_TICKET_SIZE.height - padding * 2;
  const displayText = safeOrderNumber.slice(0, 12);
  const charCount = displayText.length;

  const charSpacingUnits = 1; // 1 pixel of spacing
  const effectiveColsPerChar = 5 + charSpacingUnits;
  const pixelSizeByWidth = availableWidth / (charCount * effectiveColsPerChar);
  const pixelSizeByHeight = availableHeight / 7;
  const pixelSize = Math.max(1.5, Math.min(pixelSizeByWidth, pixelSizeByHeight));
  const charWidth = 5 * pixelSize;
  const totalTextWidth = charCount * charWidth + (charCount - 1) * pixelSize;

  let cursorX = padding + Math.max((availableWidth - totalTextWidth) / 2, 0);
  const baselineY = ORDER_TICKET_SIZE.height - padding;

  for (const char of displayText) {
    cursorX = drawBitmapChar({
      page,
      char,
      startX: cursorX,
      startY: baselineY,
      pixelSize,
    });
  }

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

    const printableOrderReference = rawOrderNumber || rawOrderId;

    if (!printableOrderReference) {
      return NextResponse.json(
        { success: false, error: 'رقم الطلب مطلوب للطباعة' },
        { status: 400 }
      );
    }

    const encodedPdf = await generateOrderTicketPdf(printableOrderReference);

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
      fitToPage: false,
      dpi: PRINTNODE_DEFAULT_DPI,
      rotate: 90,
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
    });
  } catch (error) {
    log.error('Unexpected error while printing order number', { error });
    return NextResponse.json(
      { success: false, error: 'حدث خطأ غير متوقع أثناء معالجة الطلب' },
      { status: 500 }
    );
  }
}
