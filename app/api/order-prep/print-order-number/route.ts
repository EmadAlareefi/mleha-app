import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/lib/auth';
import { sendPrintJob, PRINTNODE_ORDER_NUMBER_PRINTER_ID } from '@/app/lib/printnode';
import { log } from '@/app/lib/logger';

export const runtime = 'nodejs';

const ORDER_NUMBER_PRINT_ROLES = new Set(['admin', 'orders', 'warehouse']);

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

const buildTicketText = (orderNumber: string, operator: string) => {
  const safeOrderNumber = orderNumber || 'غير محدد';
  const safeOperator = operator || 'مستخدم غير معروف';
  const timestamp = new Date().toLocaleString('ar-SA');

  return [
    '******************************',
    '      أمر تجهيز جديد',
    '******************************',
    '',
    `رقم الطلب: ${safeOrderNumber}`,
    '',
    `المسؤول: ${safeOperator}`,
    `التاريخ: ${timestamp}`,
    '',
    'يرجى التأكد من مطابقة هذا الرقم مع الطلب قبل الشحن.',
    '',
    '******************************',
  ].join('\n');
};

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

    const operatorLabel =
      (session.user.name as string) ||
      (session.user as any)?.username ||
      (session.user.email as string) ||
      'مستخدم النظام';

    const ticketText = buildTicketText(printableOrderReference, operatorLabel);
    const encodedTicket = Buffer.from(ticketText, 'utf8').toString('base64');

    log.info('Sending order number ticket to PrintNode', {
      orderNumber: printableOrderReference,
      requestedBy: (session.user as any)?.username || session.user.email || session.user.name,
    });

    const printResult = await sendPrintJob({
      title: `Order Ticket ${printableOrderReference}`,
      contentType: 'raw_base64',
      content: encodedTicket,
      printerId: PRINTNODE_ORDER_NUMBER_PRINTER_ID,
      copies: Number.isInteger(body?.copies) && body.copies > 0 ? body.copies : 1,
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
